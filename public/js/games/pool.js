// 8-Ball Pool. Top-down table, drag from the cue ball to aim, release to shoot.
// Turn-based: only the shot vector is sent; both clients run the same physics
// and the shooter's final state is authoritative (sent as a sync snapshot).
//
// Simplified rules (GamePigeon-style):
// - Groups (solids/stripes) are assigned by the first potted ball
// - Pot one of your group and you keep the turn; otherwise it passes
// - Potting the cue ball is a scratch: cue respawns, turn passes
// - Pot the 8-ball after clearing your group to win; pot it early and you lose

const W = 880;
const H = 440;
const RAIL = 26;
const R = 11; // ball radius
const STEP = 1 / 240; // physics substep, seconds
const FRICTION = 0.9963; // per substep
const STOP_SPEED = 5; // px/s
const WALL_E = 0.9;
const BALL_E = 0.97;
const MAX_DRAG = 240; // px of drag for full power
const MAX_SPEED = 1500;

const MIN_X = RAIL + R;
const MAX_X = W - RAIL - R;
const MIN_Y = RAIL + R;
const MAX_Y = H - RAIL - R;

const POCKETS = [
  { x: RAIL + 4, y: RAIL + 4, r: 25 },
  { x: W / 2, y: RAIL - 8, r: 21 },
  { x: W - RAIL - 4, y: RAIL + 4, r: 25 },
  { x: RAIL + 4, y: H - RAIL - 4, r: 25 },
  { x: W / 2, y: H - RAIL + 8, r: 21 },
  { x: W - RAIL - 4, y: H - RAIL - 4, r: 25 },
];

const COLORS = {
  1: '#d4b13f', 2: '#4a6fa5', 3: '#b0483e', 4: '#7a5aa0',
  5: '#c47f3a', 6: '#4f8a5c', 7: '#8a4a52',
};
const colorOf = (id) => COLORS[id > 8 ? id - 8 : id];
const typeOf = (id) => (id >= 1 && id <= 7 ? 'solid' : id >= 9 ? 'stripe' : null);

function makeBalls() {
  const balls = [{ id: 0, x: W * 0.26, y: H / 2, vx: 0, vy: 0, alive: true }];
  // fixed rack layout, 8-ball in the middle of the third row
  const rack = [1, 9, 2, 10, 8, 3, 11, 4, 12, 13, 5, 14, 6, 15, 7];
  const ax = W * 0.68;
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      balls.push({
        id: rack[k++],
        x: ax + row * (R * 2 * 0.87),
        y: H / 2 + i * R * 2 - row * R,
        vx: 0, vy: 0, alive: true,
      });
    }
  }
  return balls;
}

export function create(container, ctx) {
  let balls = makeBalls();
  const ball = (id) => balls.find((b) => b.id === id);

  let myTurn = ctx.first;
  let myGroup = null; // 'solid' | 'stripe' | null
  let groupsAssigned = false;
  let over = false;
  let phase = 'aim'; // 'aim' | 'anim'
  let iAmShooter = false;
  let pottedThisShot = [];
  let pendingSync = null;
  let waitingForSync = false;

  // ---- dom ------------------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'pool-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'pool-canvas';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const status = document.createElement('div');
  status.className = 'pool-status';
  wrap.appendChild(canvas);
  wrap.appendChild(status);
  container.appendChild(wrap);

  // ---- aiming (mobile-friendly slingshot: drag ANYWHERE on the table) --------
  // The finger never needs to touch the cue ball or the shot line. The gesture
  // vector (pointerdown anchor -> current pointer) sets both direction and power.
  let aiming = false;
  let startX = 0; // pointerdown anchor (logical)
  let startY = 0;
  let aimX = 0; // current pointer (logical)
  let aimY = 0;

  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
  }

  function onDown(e) {
    if (!myTurn || phase !== 'aim' || over) return;
    aiming = true;
    ({ x: startX, y: startY } = toLogical(e));
    aimX = startX;
    aimY = startY;
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (aiming) ({ x: aimX, y: aimY } = toLogical(e));
  }
  function onUp() {
    // Only a live aim on our own turn can shoot. If the turn timer already
    // fired randomMove() mid-drag, phase is 'anim' (or over) — bail so the
    // release can't launch a SECOND shot mid-animation.
    if (!aiming || !myTurn || phase !== 'aim' || over) { aiming = false; return; }
    aiming = false;
    const dx = aimX - startX;
    const dy = aimY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist < 18) return; // too small to be a deliberate shot
    const power = Math.min(dist / MAX_DRAG, 1);
    fire(dx / dist, dy / dist, power, true);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ---- shooting & physics -----------------------------------------------------
  function fire(nx, ny, power, mine) {
    const cue = ball(0);
    const speed = 300 + power * (MAX_SPEED - 300);
    cue.vx = nx * speed;
    cue.vy = ny * speed;
    aiming = false; // a shot is committed; kill any in-progress aim/drag
    phase = 'anim';
    iAmShooter = mine;
    pottedThisShot = [];
    ctx.setTurn(null);
    setStatus(mine ? 'Nice — balls rolling…' : 'They took their shot…');
    if (mine) ctx.sendMove({ shot: [nx, ny, power] });
  }

  let acc = 0;
  function stepPhysics(dt) {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      substep();
      if (phase !== 'anim') return;
    }
  }

  function substep() {
    let anyMoving = false;
    for (const b of balls) {
      if (!b.alive) continue;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
        b.vx = 0;
        b.vy = 0;
      } else {
        anyMoving = true;
      }

      // pockets first: a ball at a pocket mouth falls in instead of bouncing
      let potted = false;
      for (const p of POCKETS) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r - 2) {
          b.alive = false;
          b.vx = 0;
          b.vy = 0;
          pottedThisShot.push(b.id);
          potted = true;
          break;
        }
      }
      if (potted) continue;

      if (b.x < MIN_X) { b.x = MIN_X; b.vx = -b.vx * WALL_E; }
      if (b.x > MAX_X) { b.x = MAX_X; b.vx = -b.vx * WALL_E; }
      if (b.y < MIN_Y) { b.y = MIN_Y; b.vy = -b.vy * WALL_E; }
      if (b.y > MAX_Y) { b.y = MAX_Y; b.vy = -b.vy * WALL_E; }
    }

    // ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = R * 2;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rel > 0) {
            const imp = rel * BALL_E;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
          }
        }
      }
    }

    if (!anyMoving) {
      phase = 'aim';
      onSettle();
    }
  }

  // ---- turn resolution ----------------------------------------------------------
  function remaining(group) {
    return balls.filter((b) => b.alive && typeOf(b.id) === group).length;
  }

  function respawnCue() {
    const cue = ball(0);
    cue.alive = true;
    cue.vx = 0;
    cue.vy = 0;
    cue.x = W * 0.26;
    cue.y = H / 2;
    while (balls.some((b) => b.alive && b.id !== 0 && Math.hypot(b.x - cue.x, b.y - cue.y) < R * 2 + 1)) {
      cue.x -= R;
      if (cue.x < MIN_X) { cue.x = W * 0.26; cue.y -= R * 2; }
    }
  }

  function onSettle() {
    if (over) return;
    if (iAmShooter) {
      resolveMyShot();
    } else if (pendingSync) {
      applySync(pendingSync);
      pendingSync = null;
    } else {
      waitingForSync = true;
    }
  }

  function resolveMyShot() {
    const potted = pottedThisShot;
    const scratch = potted.includes(0);
    const eight = potted.includes(8);
    let result = null; // 'shooter' | 'opponent'
    let iKeepTurn = false;

    if (eight) {
      const cleared = myGroup && remaining(myGroup) === 0;
      result = cleared && !scratch ? 'shooter' : 'opponent';
    } else {
      if (!groupsAssigned) {
        const firstObj = potted.find((id) => id !== 0 && id !== 8);
        if (firstObj !== undefined) {
          myGroup = typeOf(firstObj);
          groupsAssigned = true;
        }
      }
      if (scratch) respawnCue();
      iKeepTurn = !scratch && potted.some((id) => id !== 0 && typeOf(id) === myGroup && myGroup);
    }

    ctx.sendMove({
      sync: {
        balls: balls.map((b) => [b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, b.alive ? 1 : 0]),
        gA: groupsAssigned,
        sg: myGroup, // the shooter's group
        next: iKeepTurn ? 'shooter' : 'other',
        result,
      },
    });
    concludeShot(result === null ? null : result === 'shooter' ? 'win' : 'lose', result ? null : iKeepTurn);
  }

  function applySync(sync) {
    for (const [id, x, y, alive] of sync.balls) {
      const b = ball(id);
      if (!b) continue;
      b.x = x; b.y = y; b.vx = 0; b.vy = 0; b.alive = Boolean(alive);
    }
    groupsAssigned = Boolean(sync.gA);
    // the sender is the shooter, so their group is the opposite of mine
    myGroup = groupsAssigned && sync.sg ? (sync.sg === 'solid' ? 'stripe' : 'solid') : null;
    const result = sync.result === null ? null : sync.result === 'shooter' ? 'lose' : 'win';
    concludeShot(result, result ? null : sync.next === 'other');
  }

  function concludeShot(result, turnIsMine) {
    phase = 'aim';
    if (result) {
      over = true;
      ctx.setTurn(null);
      setStatus(result === 'win' ? 'You win' : 'You lose');
      ctx.finish(result);
      return;
    }
    myTurn = turnIsMine;
    ctx.setTurn(myTurn);
    updateBanner();
    setStatus();
  }

  function setStatus(text) {
    if (text) {
      status.textContent = text;
      return;
    }
    if (!myTurn) {
      status.textContent = 'Their shot…';
      return;
    }
    const info = groupsAssigned && myGroup ? `${remaining(myGroup)} left` : 'Table open';
    status.textContent = `${info} — drag anywhere to aim`;
  }

  // Team banner in the game header (main.js renders ctx.setBanner). The dot
  // colour mirrors the group's ball look: solids gold, stripes white.
  function updateBanner() {
    if (!ctx.setBanner) return;
    if (groupsAssigned && myGroup) {
      ctx.setBanner(myGroup === 'solid' ? 'YOU ARE SOLIDS' : 'YOU ARE STRIPES',
        myGroup === 'solid' ? '#d4b13f' : '#f5f5f7');
    } else {
      ctx.setBanner('TABLE OPEN');
    }
  }

  // ---- drawing -------------------------------------------------------------------
  function draw() {
    g.clearRect(0, 0, W, H);
    // rails
    g.fillStyle = '#232326';
    roundRect(0, 0, W, H, 20);
    g.fill();
    // felt
    g.fillStyle = '#2c6e4f';
    roundRect(RAIL - 8, RAIL - 8, W - (RAIL - 8) * 2, H - (RAIL - 8) * 2, 12);
    g.fill();
    // head string line
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(W * 0.26, RAIL);
    g.lineTo(W * 0.26, H - RAIL);
    g.stroke();
    // pockets
    for (const p of POCKETS) {
      g.fillStyle = '#0a0a0b';
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
    }
    // aim guide — dashed shot line from the CUE ball along the drag direction,
    // plus a slingshot "pull-back" power bar behind the cue.
    const cue = ball(0);
    if (aiming && cue.alive) {
      const dx = aimX - startX;
      const dy = aimY - startY;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const power = Math.min(d / MAX_DRAG, 1);
        const nx = dx / d;
        const ny = dy / d;
        const len = 60 + power * 260; // up to ~320px at full power
        g.strokeStyle = `rgba(255,255,255,${(0.4 + power * 0.5).toFixed(3)})`;
        g.lineWidth = 2 + power * 1.5;
        g.setLineDash([8, 8]);
        g.beginPath();
        g.moveTo(cue.x, cue.y);
        g.lineTo(cue.x + nx * len, cue.y + ny * len);
        g.stroke();
        g.setLineDash([]);
        // power bar: a short thick segment pulled back opposite the aim
        g.strokeStyle = power > 0.66 ? '#f5b642' : 'rgba(255,255,255,0.85)';
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cue.x, cue.y);
        g.lineTo(cue.x - nx * (power * 58), cue.y - ny * (power * 58));
        g.stroke();
        g.lineCap = 'butt';
        g.lineWidth = 1;
      }
    }
    // balls
    for (const b of balls) {
      if (!b.alive) continue;
      if (b.id === 0) {
        drawBall(b.x, b.y, '#f2f2f0');
      } else if (b.id === 8) {
        drawBall(b.x, b.y, '#151517');
        g.fillStyle = '#f2f2f0';
        g.beginPath();
        g.arc(b.x, b.y, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#151517';
        g.font = 'bold 8px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('8', b.x, b.y + 0.5);
      } else if (typeOf(b.id) === 'solid') {
        drawBall(b.x, b.y, colorOf(b.id));
      } else {
        drawBall(b.x, b.y, '#f2f2f0');
        g.save();
        g.beginPath();
        g.arc(b.x, b.y, R - 0.5, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = colorOf(b.id);
        g.fillRect(b.x - R, b.y - R * 0.45, R * 2, R * 0.9);
        g.restore();
      }
    }
  }

  function drawBall(x, y, color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(x - R * 0.3, y - R * 0.35, R * 0.32, 0, Math.PI * 2);
    g.fill();
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---- loop -----------------------------------------------------------------------
  let raf = null;
  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (phase === 'anim') stepPhysics(dt);
    draw();
  }
  raf = requestAnimationFrame(loop);

  ctx.setTurn(myTurn);
  updateBanner();
  setStatus();

  return {
    onMove(data) {
      if (over) return;
      if (data.shot && Array.isArray(data.shot)) {
        // Defense in depth: ignore a relayed shot unless we're between shots.
        // A shot arriving mid-animation would corrupt the shared physics.
        if (phase !== 'aim') return;
        const [nx, ny, power] = data.shot.map(Number);
        if ([nx, ny, power].some(Number.isNaN)) return;
        fire(nx, ny, Math.min(Math.max(power, 0), 1), false);
      } else if (data.sync) {
        if (waitingForSync || phase === 'aim') {
          waitingForSync = false;
          applySync(data.sync);
        } else {
          pendingSync = data.sync;
        }
      }
    },
    // turn timer expired: fire a random medium shot toward the pack
    randomMove() {
      if (over || !myTurn || phase !== 'aim') return;
      const angle = Math.random() * Math.PI * 2;
      fire(Math.cos(angle), Math.sin(angle), 0.45 + Math.random() * 0.3, true);
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      wrap.remove();
    },
  };
}
