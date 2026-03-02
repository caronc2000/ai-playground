const TILE = 24;
const STEP_MS = 120;
const POWER_DURATION_MS = 8000;

const RAW_MAP = [
    '#############',
    '#o...#...#oG#',
    '#.###.#.#.###',
    '#.....#.....#',
    '###.#.###.#.#',
    '#..#..P..#..#',
    '#.#.#.###.#G#',
    '#...#.....#.#',
    '#.###.#.#.###',
    '#o....#....o#',
    '#############',
];

const DIRECTIONS = {
    left: { x: -1, y: 0, angle: Math.PI },
    right: { x: 1, y: 0, angle: 0 },
    up: { x: 0, y: -1, angle: -Math.PI / 2 },
    down: { x: 0, y: 1, angle: Math.PI / 2 },
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const statusEl = document.getElementById('status');
const restartButton = document.getElementById('restart');

let walls = new Set();
let pellets = new Set();
let powerPellets = new Set();
let ghostStarts = [];
let pacmanStart = { x: 1, y: 1 };
let totalPellets = 0;

let pacman;
let ghosts;
let score;
let lives;
let frightenedUntil;
let running;
let gameOver;
let accumulator;
let lastTime;

function cellKey(x, y) {
    return `${x},${y}`;
}

function parseMap() {
    walls = new Set();
    pellets = new Set();
    powerPellets = new Set();
    ghostStarts = [];

    RAW_MAP.forEach((row, y) => {
        row.split('').forEach((cell, x) => {
            const key = cellKey(x, y);
            if (cell === '#') {
                walls.add(key);
            } else if (cell === '.') {
                pellets.add(key);
            } else if (cell === 'o') {
                powerPellets.add(key);
            } else if (cell === 'P') {
                pacmanStart = { x, y };
            } else if (cell === 'G') {
                ghostStarts.push({ x, y });
            }
        });
    });

    totalPellets = pellets.size + powerPellets.size;
}

function createGhosts() {
    const colors = ['#ff4d6d', '#53d3ff', '#ffa94d', '#ff7ce5'];
    return ghostStarts.map((start, index) => ({
        x: start.x,
        y: start.y,
        startX: start.x,
        startY: start.y,
        dir: index % 2 === 0 ? 'left' : 'right',
        color: colors[index % colors.length],
    }));
}

function resetEntities() {
    pacman = {
        x: pacmanStart.x,
        y: pacmanStart.y,
        dir: 'left',
        nextDir: 'left',
    };
    ghosts = createGhosts();
}

function resetGame() {
    parseMap();
    score = 0;
    lives = 3;
    frightenedUntil = 0;
    running = true;
    gameOver = false;
    accumulator = 0;
    lastTime = performance.now();

    resetEntities();
    updateHud();
    setStatus('Use arrow keys or WASD to move.');
}

function updateHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
}

function setStatus(text) {
    statusEl.textContent = text;
}

function inBounds(x, y) {
    return y >= 0 && y < RAW_MAP.length && x >= 0 && x < RAW_MAP[0].length;
}

function isWall(x, y) {
    if (!inBounds(x, y)) {
        return true;
    }
    return walls.has(cellKey(x, y));
}

function tryMove(entity, dirName) {
    const dir = DIRECTIONS[dirName];
    if (!dir) {
        return false;
    }
    const nextX = entity.x + dir.x;
    const nextY = entity.y + dir.y;
    if (isWall(nextX, nextY)) {
        return false;
    }
    entity.x = nextX;
    entity.y = nextY;
    entity.dir = dirName;
    return true;
}

function maybeEatPellet() {
    const key = cellKey(pacman.x, pacman.y);
    if (pellets.has(key)) {
        pellets.delete(key);
        score += 10;
    } else if (powerPellets.has(key)) {
        powerPellets.delete(key);
        score += 50;
        frightenedUntil = performance.now() + POWER_DURATION_MS;
    }
    if (score > 0) {
        updateHud();
    }
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function oppositeDirection(dirName) {
    if (dirName === 'left') return 'right';
    if (dirName === 'right') return 'left';
    if (dirName === 'up') return 'down';
    return 'up';
}

function getValidDirections(entity) {
    const options = [];
    Object.entries(DIRECTIONS).forEach(([dirName, vec]) => {
        const nx = entity.x + vec.x;
        const ny = entity.y + vec.y;
        if (!isWall(nx, ny)) {
            options.push(dirName);
        }
    });
    return options;
}

function pickGhostDirection(ghost, frightened) {
    const valid = getValidDirections(ghost);
    if (valid.length === 0) {
        return ghost.dir;
    }

    const reverse = oppositeDirection(ghost.dir);
    let candidates = valid.filter((dirName) => dirName !== reverse);
    if (candidates.length === 0) {
        candidates = valid;
    }

    if (frightened) {
        return randomChoice(candidates);
    }

    if (Math.random() < 0.2) {
        return randomChoice(candidates);
    }

    let best = candidates[0];
    let bestDist = Infinity;
    for (const dirName of candidates) {
        const v = DIRECTIONS[dirName];
        const nx = ghost.x + v.x;
        const ny = ghost.y + v.y;
        const dist = Math.abs(nx - pacman.x) + Math.abs(ny - pacman.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = dirName;
        }
    }
    return best;
}

function checkCollisions() {
    const frightened = performance.now() < frightenedUntil;

    for (const ghost of ghosts) {
        if (ghost.x === pacman.x && ghost.y === pacman.y) {
            if (frightened) {
                score += 200;
                ghost.x = ghost.startX;
                ghost.y = ghost.startY;
                ghost.dir = 'left';
                updateHud();
            } else {
                lives -= 1;
                updateHud();
                if (lives <= 0) {
                    running = false;
                    gameOver = true;
                    setStatus('Game over. Press restart to play again.');
                } else {
                    resetEntities();
                    setStatus('Ouch! Keep going.');
                }
                return;
            }
        }
    }

    const remainingPellets = pellets.size + powerPellets.size;
    if (remainingPellets === 0) {
        running = false;
        gameOver = true;
        setStatus('You win! Press restart to play again.');
    }
}

function updateStep() {
    if (!running) {
        return;
    }

    tryMove(pacman, pacman.nextDir) || tryMove(pacman, pacman.dir);
    maybeEatPellet();

    const frightened = performance.now() < frightenedUntil;
    for (const ghost of ghosts) {
        const nextDir = pickGhostDirection(ghost, frightened);
        tryMove(ghost, nextDir);
    }

    checkCollisions();
}

function drawBoard() {
    ctx.fillStyle = '#020411';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < RAW_MAP.length; y += 1) {
        for (let x = 0; x < RAW_MAP[0].length; x += 1) {
            const left = x * TILE;
            const top = y * TILE;
            const key = cellKey(x, y);

            if (walls.has(key)) {
                ctx.fillStyle = '#273fa8';
                ctx.fillRect(left, top, TILE, TILE);
                ctx.fillStyle = '#4d68dd';
                ctx.fillRect(left + 3, top + 3, TILE - 6, TILE - 6);
            } else if (pellets.has(key)) {
                ctx.fillStyle = '#f8f8f8';
                ctx.beginPath();
                ctx.arc(left + TILE / 2, top + TILE / 2, 2.2, 0, Math.PI * 2);
                ctx.fill();
            } else if (powerPellets.has(key)) {
                ctx.fillStyle = '#f4fd8c';
                ctx.beginPath();
                ctx.arc(left + TILE / 2, top + TILE / 2, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPacman() {
    const centerX = pacman.x * TILE + TILE / 2;
    const centerY = pacman.y * TILE + TILE / 2;
    const mouth = (Math.sin(performance.now() / 95) + 1) * 0.2 + 0.1;
    const facing = DIRECTIONS[pacman.dir]?.angle ?? 0;

    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, TILE * 0.43, facing + mouth, facing + Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
}

function drawGhost(ghost, frightened) {
    const left = ghost.x * TILE;
    const top = ghost.y * TILE;
    const bodyColor = frightened ? '#4f77ff' : ghost.color;

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(left + TILE / 2, top + TILE * 0.45, TILE * 0.38, Math.PI, 0);
    ctx.rect(left + TILE * 0.12, top + TILE * 0.45, TILE * 0.76, TILE * 0.42);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(left + TILE * 0.38, top + TILE * 0.56, TILE * 0.12, 0, Math.PI * 2);
    ctx.arc(left + TILE * 0.62, top + TILE * 0.56, TILE * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(left + TILE * 0.38, top + TILE * 0.56, TILE * 0.06, 0, Math.PI * 2);
    ctx.arc(left + TILE * 0.62, top + TILE * 0.56, TILE * 0.06, 0, Math.PI * 2);
    ctx.fill();
}

function render() {
    drawBoard();
    drawPacman();
    const frightened = performance.now() < frightenedUntil;
    ghosts.forEach((ghost) => drawGhost(ghost, frightened));

    if (gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, canvas.height / 2 - 32, canvas.width, 64);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(statusEl.textContent, canvas.width / 2, canvas.height / 2 + 8);
    }
}

function loop(now) {
    const delta = now - lastTime;
    lastTime = now;
    accumulator += delta;

    while (accumulator >= STEP_MS) {
        updateStep();
        accumulator -= STEP_MS;
    }

    render();
    requestAnimationFrame(loop);
}

function onKeyDown(event) {
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') pacman.nextDir = 'left';
    if (key === 'arrowright' || key === 'd') pacman.nextDir = 'right';
    if (key === 'arrowup' || key === 'w') pacman.nextDir = 'up';
    if (key === 'arrowdown' || key === 's') pacman.nextDir = 'down';
}

function init() {
    canvas.width = RAW_MAP[0].length * TILE;
    canvas.height = RAW_MAP.length * TILE;

    resetGame();

    window.addEventListener('keydown', onKeyDown);
    restartButton.addEventListener('click', resetGame);

    requestAnimationFrame(loop);
}

init();
