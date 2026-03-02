const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const statusEl = document.getElementById('status');
const restartButton = document.getElementById('restart');

const WORLD = {
  width: canvas.width,
  height: canvas.height,
  groundY: canvas.height - 42,
};

const keys = {
  left: false,
  right: false,
  fire: false,
};

let audioCtx = null;
let audioUnlocked = false;
let stepTone = 0;

let player;
let bullets;
let invaders;
let bombs;
let barriers;
let score;
let lives;
let level;
let gameOver;
let wonLevel;
let fireCooldown;
let invaderDir;
let invaderStepTimer;
let invaderStepDelay;
let animationId;
let lastTime;

function unlockAudio() {
  if (audioUnlocked) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  audioUnlocked = true;
}

function tone({ frequency = 440, type = 'square', duration = 0.08, gain = 0.04, slideTo = null }) {
  if (!audioUnlocked || !audioCtx) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (slideTo !== null) {
    osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
  }

  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(amp);
  amp.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

function noise({ duration = 0.12, gain = 0.06 }) {
  if (!audioUnlocked || !audioCtx) return;

  const now = audioCtx.currentTime;
  const frames = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const source = audioCtx.createBufferSource();
  const amp = audioCtx.createGain();
  source.buffer = buffer;

  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(amp);
  amp.connect(audioCtx.destination);
  source.start(now);
}

function playShoot() {
  tone({ frequency: 820, slideTo: 260, duration: 0.09, gain: 0.05, type: 'square' });
}

function playInvaderStep() {
  const tones = [180, 210, 240, 200];
  tone({ frequency: tones[stepTone % tones.length], duration: 0.06, gain: 0.03, type: 'triangle' });
  stepTone += 1;
}

function playExplosion() {
  noise({ duration: 0.13, gain: 0.07 });
  tone({ frequency: 120, slideTo: 70, duration: 0.12, gain: 0.03, type: 'sawtooth' });
}

function playPlayerHit() {
  tone({ frequency: 300, slideTo: 90, duration: 0.2, gain: 0.06, type: 'square' });
  noise({ duration: 0.18, gain: 0.05 });
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateHud() {
  scoreEl.textContent = String(score);
  livesEl.textContent = String(lives);
  levelEl.textContent = String(level);
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function createBarriers() {
  const count = 4;
  const barrierW = 92;
  const barrierH = 52;
  const marginX = 90;
  const gap = (WORLD.width - marginX * 2 - barrierW * count) / (count - 1);
  const barrierY = WORLD.groundY - 125;

  const items = [];
  for (let i = 0; i < count; i += 1) {
    const x = marginX + i * (barrierW + gap);
    items.push({ x, y: barrierY, w: barrierW, h: barrierH, hp: 9 });
  }
  return items;
}

function createInvaders() {
  const cols = 10;
  const rows = 5;
  const startX = 120;
  const startY = 90;
  const spacingX = 64;
  const spacingY = 48;

  const items = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      items.push({
        x: startX + col * spacingX,
        y: startY + row * spacingY,
        w: 34,
        h: 24,
        alive: true,
        type: row,
      });
    }
  }
  return items;
}

function resetRound(keepScore = false) {
  player = {
    x: WORLD.width / 2 - 22,
    y: WORLD.groundY,
    w: 44,
    h: 22,
    speed: 360,
  };

  bullets = [];
  bombs = [];
  barriers = createBarriers();
  invaders = createInvaders();
  invaderDir = 1;
  fireCooldown = 0;
  invaderStepTimer = 0;
  invaderStepDelay = Math.max(0.16, 0.62 - (level - 1) * 0.06);
  wonLevel = false;

  if (!keepScore) {
    score = 0;
    lives = 3;
    level = 1;
  }

  gameOver = false;
  updateHud();
  setStatus('Move: ← → or A/D • Shoot: Space • Restart: Enter');
}

function fullRestart() {
  resetRound(false);
}

function nextLevel() {
  level += 1;
  updateHud();
  resetRound(true);
  setStatus(`Level ${level} - Invaders are faster.`);
}

function invaderBounds() {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const invader of invaders) {
    if (!invader.alive) continue;
    minX = Math.min(minX, invader.x);
    maxX = Math.max(maxX, invader.x + invader.w);
    maxY = Math.max(maxY, invader.y + invader.h);
  }

  return { minX, maxX, maxY };
}

function livingInvaders() {
  return invaders.filter((it) => it.alive);
}

function fireBullet() {
  if (fireCooldown > 0 || gameOver || wonLevel) return;
  bullets.push({
    x: player.x + player.w / 2 - 2,
    y: player.y - 10,
    w: 4,
    h: 10,
    vy: -520,
  });
  fireCooldown = 0.24;
  playShoot();
}

function invaderShootChance(dt) {
  const alive = livingInvaders();
  if (alive.length === 0) return;

  const rate = Math.min(0.95, 0.3 + level * 0.06);
  if (Math.random() > dt * rate) return;

  const shootersByCol = new Map();
  for (const invader of alive) {
    const col = Math.round(invader.x / 10);
    const current = shootersByCol.get(col);
    if (!current || invader.y > current.y) shootersByCol.set(col, invader);
  }

  const candidates = [...shootersByCol.values()];
  const shooter = candidates[Math.floor(Math.random() * candidates.length)];

  bombs.push({
    x: shooter.x + shooter.w / 2 - 2,
    y: shooter.y + shooter.h + 4,
    w: 4,
    h: 12,
    vy: 220 + level * 24,
  });
}

function hitBarrier(projectile) {
  for (const barrier of barriers) {
    if (barrier.hp <= 0) continue;
    if (rectsOverlap(projectile, barrier)) {
      barrier.hp -= 1;
      playExplosion();
      return true;
    }
  }
  return false;
}

function updatePlayer(dt) {
  let vx = 0;
  if (keys.left) vx -= 1;
  if (keys.right) vx += 1;

  player.x += vx * player.speed * dt;
  if (player.x < 12) player.x = 12;
  if (player.x + player.w > WORLD.width - 12) player.x = WORLD.width - 12 - player.w;

  if (keys.fire) {
    fireBullet();
  }
}

function updateBullets(dt) {
  for (const bullet of bullets) {
    bullet.y += bullet.vy * dt;
  }

  bullets = bullets.filter((b) => b.y + b.h > 0);

  for (const bullet of [...bullets]) {
    if (hitBarrier(bullet)) {
      bullets.splice(bullets.indexOf(bullet), 1);
      continue;
    }

    for (const invader of invaders) {
      if (!invader.alive) continue;
      if (rectsOverlap(bullet, invader)) {
        invader.alive = false;
        bullets.splice(bullets.indexOf(bullet), 1);

        const points = 10 + (4 - invader.type) * 5;
        score += points;
        updateHud();
        playExplosion();
        break;
      }
    }
  }
}

function updateBombs(dt) {
  for (const bomb of bombs) {
    bomb.y += bomb.vy * dt;
  }

  bombs = bombs.filter((b) => b.y < WORLD.height + 20);

  for (const bomb of [...bombs]) {
    if (hitBarrier(bomb)) {
      bombs.splice(bombs.indexOf(bomb), 1);
      continue;
    }

    if (rectsOverlap(bomb, player)) {
      bombs.splice(bombs.indexOf(bomb), 1);
      lives -= 1;
      updateHud();
      playPlayerHit();

      if (lives <= 0) {
        gameOver = true;
        setStatus('Game over. Press Enter or Restart.');
      } else {
        player.x = WORLD.width / 2 - player.w / 2;
        setStatus(`Ship hit! ${lives} lives left.`);
      }
    }
  }
}

function updateInvaders(dt) {
  invaderStepTimer += dt;
  if (invaderStepTimer < invaderStepDelay) return;
  invaderStepTimer = 0;

  const live = livingInvaders();
  if (live.length === 0) {
    wonLevel = true;
    setStatus('Wave cleared! Starting next level...');
    setTimeout(() => {
      if (!gameOver) nextLevel();
    }, 700);
    return;
  }

  const { minX, maxX } = invaderBounds();
  const hitRight = maxX >= WORLD.width - 20;
  const hitLeft = minX <= 20;

  if ((hitRight && invaderDir === 1) || (hitLeft && invaderDir === -1)) {
    invaderDir *= -1;
    for (const invader of live) {
      invader.y += 18;
    }
  } else {
    for (const invader of live) {
      invader.x += 12 * invaderDir;
    }
  }

  const speedup = 1 - live.length / invaders.length;
  invaderStepDelay = Math.max(0.08, (0.58 - (level - 1) * 0.05) * (1 - speedup * 0.58));
  playInvaderStep();

  const { maxY } = invaderBounds();
  if (maxY >= player.y - 10) {
    gameOver = true;
    setStatus('Invaders landed. Press Enter or Restart.');
  }
}

function update(dt) {
  if (gameOver || wonLevel) return;

  fireCooldown = Math.max(0, fireCooldown - dt);

  updatePlayer(dt);
  updateBullets(dt);
  updateInvaders(dt);
  invaderShootChance(dt);
  updateBombs(dt);
}

function drawStars() {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 97) % WORLD.width;
    const y = (i * 53) % (WORLD.height - 20);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

function drawPlayer() {
  ctx.fillStyle = '#7ef79c';
  ctx.fillRect(player.x, player.y + 10, player.w, 12);
  ctx.fillRect(player.x + 15, player.y, 14, 12);
}

function drawInvader(invader) {
  const colorByType = ['#ff5f7a', '#ff9d57', '#59e2ff', '#95ff6c', '#b98dff'];
  ctx.fillStyle = colorByType[invader.type % colorByType.length];

  ctx.fillRect(invader.x + 4, invader.y, invader.w - 8, 6);
  ctx.fillRect(invader.x, invader.y + 6, invader.w, 8);
  ctx.fillRect(invader.x + 6, invader.y + 14, invader.w - 12, 6);
  ctx.fillRect(invader.x + 2, invader.y + 20, 6, 4);
  ctx.fillRect(invader.x + invader.w - 8, invader.y + 20, 6, 4);
}

function drawBarriers() {
  for (const barrier of barriers) {
    if (barrier.hp <= 0) continue;

    const alpha = Math.max(0.2, barrier.hp / 9);
    ctx.fillStyle = `rgba(129, 235, 158, ${alpha})`;
    ctx.fillRect(barrier.x, barrier.y, barrier.w, barrier.h);

    ctx.globalCompositeOperation = 'destination-out';
    const damage = 9 - barrier.hp;
    for (let i = 0; i < damage; i += 1) {
      const holeX = barrier.x + ((i * 17 + 11) % barrier.w);
      const holeY = barrier.y + ((i * 23 + 7) % barrier.h);
      ctx.beginPath();
      ctx.arc(holeX, holeY, 4 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawProjectiles() {
  ctx.fillStyle = '#ffee65';
  for (const bullet of bullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h);
  }

  ctx.fillStyle = '#ff6f59';
  for (const bomb of bombs) {
    ctx.fillRect(bomb.x, bomb.y, bomb.w, bomb.h);
  }
}

function drawGround() {
  ctx.fillStyle = '#1f2d65';
  ctx.fillRect(0, WORLD.groundY + player.h + 14, WORLD.width, 6);
}

function drawOverlay() {
  if (!gameOver) return;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, WORLD.height / 2 - 55, WORLD.width, 110);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('GAME OVER', WORLD.width / 2, WORLD.height / 2 - 8);
  ctx.font = '18px sans-serif';
  ctx.fillText('Press Enter or Restart', WORLD.width / 2, WORLD.height / 2 + 28);
}

function render() {
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  drawStars();
  drawGround();
  drawBarriers();

  for (const invader of invaders) {
    if (invader.alive) drawInvader(invader);
  }

  drawProjectiles();
  drawPlayer();
  drawOverlay();
}

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  render();

  animationId = requestAnimationFrame(frame);
}

function onKeyDown(event) {
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') keys.left = true;
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') keys.right = true;
  if (event.key === ' ') {
    event.preventDefault();
    keys.fire = true;
  }

  if (event.key === 'Enter' && gameOver) {
    fullRestart();
  }

  unlockAudio();
}

function onKeyUp(event) {
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') keys.left = false;
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') keys.right = false;
  if (event.key === ' ') keys.fire = false;
}

function init() {
  resetRound(false);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', unlockAudio);

  restartButton.addEventListener('click', () => {
    unlockAudio();
    fullRestart();
  });

  if (animationId) cancelAnimationFrame(animationId);
  lastTime = performance.now();
  animationId = requestAnimationFrame(frame);
}

init();
