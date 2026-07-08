// Full-flow e2e suite. Spawns its own server on :3100, drives real browsers
// through match / video / chat / games / skip / friend rooms, exits 0 on pass.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamecam-e2e-'));
const SHOT = (n) => path.join(shotDir, `${n}.png`);
const log = (...a) => console.log('[e2e]', ...a);

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// ---- spawn the server under test ----
const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready on :3100');
}

const chromiumDir = fs.readdirSync('/opt/pw-browsers').find((d) => /^chromium-\d+$/.test(d));
assert(chromiumDir, 'chromium binary found in /opt/pw-browsers');

let browser = null;
let failed = false;

try {
  await waitForServer();
  log('server ready on', BASE);

  browser = await chromium.launch({
    executablePath: `/opt/pw-browsers/${chromiumDir}/chrome-linux/chrome`,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const newPage = async (name) => {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[${name} console.error]`, m.text());
    });
    page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
    return page;
  };

  const A = await newPage('A');
  const B = await newPage('B');

  // ---- 1. both users hop on ----
  await A.goto(BASE);
  await B.goto(BASE);

  // home chips include Hangman
  const chips = await A.$$eval('.home-game-chip', (els) => els.map((e) => e.textContent));
  log('home chips:', chips.join(', '));
  assert(chips.includes('Hangman'), 'Hangman chip on home screen');

  await A.click('#btn-start');
  await B.click('#btn-start');

  // ---- 2. they get matched ----
  await A.waitForSelector('#screen-chat:not([hidden])');
  await B.waitForSelector('#screen-chat:not([hidden])');
  for (const [name, p] of [['A', A], ['B', B]]) {
    await p.waitForFunction(() => document.getElementById('status-text').textContent.includes('Connected'), null, { timeout: 10000 });
    log(name, 'status:', await p.textContent('#status-text'));
  }

  // mic/cam buttons are gone; controls = Games + Skip
  const controls = await A.evaluate(() => ({
    mic: document.getElementById('btn-mic'),
    cam: document.getElementById('btn-cam'),
    labels: [...document.querySelectorAll('.controls .ctrl-btn')].map((b) => b.textContent),
  }));
  log('controls:', controls.labels.join(', '));
  assert(controls.mic === null && controls.cam === null, 'no Mic/Cam buttons');
  assert(controls.labels.length === 2, 'controls are exactly Games + Skip');

  // game banner exists and starts hidden
  const bannerHidden = await A.evaluate(() => document.getElementById('game-banner').hidden);
  assert(bannerHidden, '#game-banner present and hidden by default');

  // ---- 3. WebRTC video flows both ways ----
  for (const [name, p] of [['A', A], ['B', B]]) {
    await p.waitForFunction(() => {
      const v = document.getElementById('remote-video');
      return v.readyState >= 2 && v.videoWidth > 0;
    }, null, { timeout: 15000 });
    const dims = await p.evaluate(() => {
      const v = document.getElementById('remote-video');
      return `${v.videoWidth}x${v.videoHeight} readyState=${v.readyState}`;
    });
    const overlayHidden = await p.evaluate(() => document.getElementById('remote-overlay').hidden);
    log(name, 'remote video:', dims, 'overlay hidden:', overlayHidden);
    assert(overlayHidden, `${name} remote overlay dropped once video flows`);
  }
  await A.screenshot({ path: SHOT('1-connected-A') });

  // ---- 4. chat both directions ----
  await A.fill('#chat-input', 'hello from A 👋');
  await A.press('#chat-input', 'Enter');
  await B.waitForFunction(() => [...document.querySelectorAll('.msg.them')].some((m) => m.textContent.includes('hello from A')));
  await B.fill('#chat-input', 'yo whats up');
  await B.press('#chat-input', 'Enter');
  await A.waitForFunction(() => [...document.querySelectorAll('.msg.them')].some((m) => m.textContent.includes('yo whats up')));
  log('chat OK both directions');

  // ---- 5. game invite -> accept -> Connect 4 full round ----
  await A.click('#btn-open-gamebox');
  await A.waitForSelector('#stage-gamebox:not([hidden])');
  const cardNames = await A.$$eval('.game-card .gc-name', (els) => els.map((e) => e.textContent));
  log('gamebox games:', cardNames.join(', '));
  await A.click('.game-card:has-text("Connect 4")');
  await A.waitForSelector('#stage-waiting:not([hidden])');
  await B.waitForSelector('#modal-invite:not([hidden])');
  log('B sees invite:', await B.textContent('#invite-text'));
  await B.click('#btn-accept-invite');
  await A.waitForSelector('#stage-game:not([hidden])');
  await B.waitForSelector('#stage-game:not([hidden])');
  log('game started on both. A turn pill:', await A.textContent('#game-turn'), '| B turn pill:', await B.textContent('#game-turn'));

  // countdown pill: draining fill element + a seconds number
  const aTurn = (await A.textContent('#game-turn')) === 'Your turn';
  const current = aTurn ? A : B;
  const timer = await current.evaluate(() => ({
    num: document.getElementById('game-timer-num').textContent,
    fillWidth: document.getElementById('game-timer-fill').style.width,
    hidden: document.getElementById('game-timer').hidden,
  }));
  log('countdown pill:', JSON.stringify(timer));
  assert(!timer.hidden, 'countdown pill visible on current player');
  assert(/^\d+s$/.test(timer.num), `seconds number shows Ns style (got ${JSON.stringify(timer.num)})`);
  assert(parseInt(timer.num) > 0 && parseInt(timer.num) <= 10, 'C4 countdown starts from 10s window');
  assert(/%$/.test(timer.fillWidth), 'progress fill has a percentage width');

  // probe: the player whose turn it ISN'T clicks a column -> nothing should happen
  const waiter = aTurn ? B : A;
  await waiter.click('.c4-cell >> nth=3');
  await waiter.waitForTimeout(300);
  const discsAfter = await waiter.evaluate(() => document.querySelectorAll('.c4-cell.mine, .c4-cell.theirs').length);
  log('probe: off-turn click =>', discsAfter, 'discs', discsAfter === 0 ? '(correctly ignored)' : '(BUG: registered!)');
  assert(discsAfter === 0, 'off-turn click ignored');

  // scripted game: first player stacks column 0 (vertical four), second uses column 1
  const first = aTurn ? A : B;
  const second = aTurn ? B : A;
  for (let i = 0; i < 4; i++) {
    await first.click('.c4-cell >> nth=0');
    if (i < 3) {
      await second.waitForFunction((want) => document.querySelectorAll('.c4-cell.mine, .c4-cell.theirs').length === want, i * 2 + 1);
      await second.waitForFunction(() => document.getElementById('game-turn').textContent === 'Your turn');
      await second.click('.c4-cell >> nth=1');
      await first.waitForFunction(() => document.getElementById('game-turn').textContent === 'Your turn');
    }
  }
  await first.screenshot({ path: SHOT('2-c4-win') });
  await first.waitForFunction(() => document.getElementById('result-text').textContent.includes('won'), null, { timeout: 5000 });
  await second.waitForFunction(() => document.getElementById('result-text').textContent.includes('lost'), null, { timeout: 5000 });
  log('result:', 'winner sees:', await first.textContent('#result-text'), '| loser sees:', await second.textContent('#result-text'));
  log('scoreboard winner:', await first.textContent('#scoreboard'));
  await first.screenshot({ path: SHOT('3-result-winner') });

  // ---- 6. probe: rematch flow + decline ----
  await first.click('#btn-rematch');
  await second.waitForSelector('#modal-invite:not([hidden])');
  await second.click('#btn-decline-invite');
  await first.waitForSelector('#stage-gamebox:not([hidden])', { timeout: 5000 });
  log('probe: decline OK — inviter lands back in gamebox with toast:', await first.textContent('#toast'));
  await first.click('#btn-close-gamebox');

  // ---- 6.5 probe: turn timer auto-plays a random move after 10s of idling ----
  await A.click('#btn-gamebox');
  await A.click('.game-card:has-text("Connect 4")');
  await B.waitForSelector('#modal-invite:not([hidden])');
  await B.click('#btn-accept-invite');
  await A.waitForSelector('.c4-board');
  await B.waitForSelector('.c4-board');
  const mover = (await A.textContent('#game-turn')) === 'Your turn' ? A : B;
  log('timer pill on current player shows:', JSON.stringify(await mover.textContent('#game-timer')));
  const discs = (p) => p.evaluate(() => document.querySelectorAll('.c4-cell.mine, .c4-cell.theirs').length);
  log('discs before idle wait:', await discs(A));
  await A.waitForFunction(() => document.querySelectorAll('.c4-cell.mine, .c4-cell.theirs').length >= 1, null, { timeout: 13000 });
  await B.waitForFunction(() => document.querySelectorAll('.c4-cell.mine, .c4-cell.theirs').length >= 1, null, { timeout: 5000 });
  log('probe: idled past the 10s timer => random move auto-played and relayed; discs now A:', await discs(A), 'B:', await discs(B));
  await A.click('#btn-quit-game');
  await A.waitForSelector('#stage-idle:not([hidden])');

  // ---- 6.6 probe: 8-Ball Pool — drag shot, physics, settle, turn resolution ----
  await A.click('#btn-gamebox');
  await A.click('.game-card:has-text("8-Ball Pool")');
  await B.waitForSelector('#modal-invite:not([hidden])');
  await B.click('#btn-accept-invite');
  await A.waitForSelector('.pool-canvas');
  await B.waitForSelector('.pool-canvas');
  const shooter = (await A.textContent('#game-turn')) === 'Your turn' ? A : B;
  const other = shooter === A ? B : A;
  const poolTimer = await shooter.textContent('#game-timer-num');
  log('pool started. shooter timer pill:', JSON.stringify(poolTimer),
    '| shooter status:', await shooter.textContent('.pool-status'));
  assert(/^\d+s$/.test(poolTimer) && parseInt(poolTimer) > 10 && parseInt(poolTimer) <= 15,
    `pool countdown uses the 15s window (got ${JSON.stringify(poolTimer)})`);
  const box = await (await shooter.$('.pool-canvas')).boundingBox();
  const cueX = box.x + box.width * 0.26;
  const cueY = box.y + box.height / 2;
  // drag from near the cue toward the rack and release -> fires a shot
  await shooter.mouse.move(cueX + box.width * 0.2, cueY);
  await shooter.mouse.down();
  await shooter.mouse.move(cueX + box.width * 0.24, cueY + 4, { steps: 4 });
  await shooter.mouse.up();
  // balls animate on BOTH pages, then shooter syncs and someone gets the turn back
  await shooter.waitForFunction(() => document.getElementById('game-turn').textContent.length > 0 && !document.getElementById('game-turn').hidden, null, { timeout: 25000 });
  await other.waitForFunction(() => !document.getElementById('game-turn').hidden, null, { timeout: 25000 });
  const sTurn = await shooter.textContent('#game-turn');
  const oTurn = await other.textContent('#game-turn');
  log('pool shot resolved. shooter pill:', JSON.stringify(sTurn), '| other pill:', JSON.stringify(oTurn));
  assert((sTurn === 'Your turn') !== (oTurn === 'Your turn'), 'exactly one player has the turn after the shot');
  log('pool status after shot — shooter:', await shooter.textContent('.pool-status'), '| other:', await other.textContent('.pool-status'));
  await shooter.screenshot({ path: SHOT('8-pool') });
  await A.click('#btn-quit-game');
  await A.waitForSelector('#stage-idle:not([hidden])');
  await B.waitForFunction(() => document.getElementById('stage-idle') && !document.getElementById('stage-idle').hidden);

  // ---- 7. probe: Wordle Race — moves relay, opponent mini-board updates ----
  await A.click('#btn-gamebox');
  await A.click('.game-card:has-text("Wordle Race")');
  await B.waitForSelector('#modal-invite:not([hidden])');
  await B.click('#btn-accept-invite');
  await A.waitForSelector('.wordle-board');
  await B.waitForSelector('.wordle-board');
  await A.keyboard.type('crane');
  await A.keyboard.press('Enter');
  await B.waitForFunction(() => {
    const mini = document.querySelector('.wordle-board.mini');
    return [...mini.querySelectorAll('.wordle-tile')].filter((t) => t.classList.contains('g') || t.classList.contains('y') || t.classList.contains('b')).length === 5;
  }, null, { timeout: 5000 });
  log('probe: wordle guess relayed — B mini-board shows 5 colored tiles; B status:', await B.textContent('.wordle-side:nth-child(2) .wordle-status'));
  // probe: 4-letter guess rejected
  await A.keyboard.type('cat');
  await A.keyboard.press('Enter');
  const wStatus = await A.textContent('.wordle-status');
  log('probe: short guess =>', JSON.stringify(wStatus));
  await A.screenshot({ path: SHOT('4-wordle') });
  await A.click('#btn-quit-game');
  await B.waitForFunction(() => [...document.querySelectorAll('.msg.sys')].some((m) => m.textContent.includes('quit')));
  log('probe: quit game relayed to opponent');

  // ---- 8. probe: skip -> both re-enter pool and re-match ----
  const scoreBefore = await A.textContent('#score-me');
  await A.click('#btn-skip');
  // the "left" sys message is transient (re-match clears chat), so wait for the re-match itself;
  // only two people are in the pool, so they should find each other again
  for (const p of [A, B]) {
    await p.waitForFunction(() => document.getElementById('status-text').textContent.includes('Connected'), null, { timeout: 10000 });
  }
  const scoreAfter = await A.textContent('#score-me');
  log(`probe: skip -> re-matched; score was ${scoreBefore}, now ${scoreAfter}`);
  assert(scoreAfter === '0', 'score resets after skip');

  // ---- 9. friend link flow: Copy pushes the host into the waiting room ----
  const C = await newPage('C');
  const D = await newPage('D');
  await C.goto(BASE);
  await C.click('#btn-friend');
  await C.waitForSelector('#friend-box:not([hidden])');
  const link = await C.inputValue('#friend-link');
  log('friend link generated:', link);
  await C.click('#btn-copy');
  log('copy button says:', await C.textContent('#btn-copy'));
  await C.waitForSelector('#screen-chat:not([hidden])', { timeout: 5000 });
  log('host C pushed into room. status:', await C.textContent('#status-text'),
    '| idle title:', await C.textContent('#stage-idle-title'),
    '| link shown in room:', await C.inputValue('#idle-link') === link,
    '| gamebox hidden while waiting:', await C.evaluate(() => document.getElementById('btn-open-gamebox').hidden));
  await C.screenshot({ path: SHOT('7-friend-waiting-room') });

  // probe: a random stranger must NOT be matched into the private room
  const E1 = await newPage('E1');
  await E1.goto(BASE);
  await E1.click('#btn-start');
  await E1.waitForTimeout(1500);
  const e1Status = await E1.textContent('#status-text');
  const cStatus = await C.textContent('#status-text');
  log('probe: stranger searching while host waits => stranger:', JSON.stringify(e1Status), '| host:', JSON.stringify(cStatus));
  assert(e1Status.includes('Looking') && cStatus.includes('Waiting'), 'stranger stays out of the private room');
  await E1.close();

  // friend joins via the link
  await D.goto(link);
  const dBtn = await D.textContent('#btn-start');
  log('D landing button says:', JSON.stringify(dBtn.trim()));
  await D.click('#btn-start');
  await D.waitForFunction(() => document.getElementById('status-text').textContent.includes('friend'), null, { timeout: 10000 });
  await C.waitForFunction(() => document.getElementById('status-text').textContent.includes('friend'), null, { timeout: 10000 });
  log('D status:', await D.textContent('#status-text'), '| C status:', await C.textContent('#status-text'));
  log('C idle after join:', await C.textContent('#stage-idle-title'),
    '| link row hidden again:', await C.evaluate(() => document.getElementById('idle-link-row').hidden),
    '| gamebox back:', await C.evaluate(() => !document.getElementById('btn-open-gamebox').hidden));
  await D.screenshot({ path: SHOT('5-friend-D') });
  await C.screenshot({ path: SHOT('6-friend-C-host') });

  // probe: expired link
  const E = await newPage('E');
  await E.goto(`${BASE}/?room=DEADBEEF`);
  await E.click('#btn-start');
  await E.waitForSelector('#toast:not([hidden])', { timeout: 5000 });
  log('probe: dead room code => toast:', await E.textContent('#toast'));

  log('screenshots in', shotDir);
  log('DONE — all checks passed');
} catch (err) {
  failed = true;
  console.error('[e2e] FAILED:', err);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

process.exit(failed ? 1 : 0);
