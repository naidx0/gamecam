// Focused e2e for the Wordle Race end-of-game clock resolution (fix-pass for
// H1/M3/M4). Spawns its own server on :3300 (isolated from the main suite on
// :3100 and hangman on :3200 so concurrent gate runs don't collide). Uses a
// fast clock via window.__WORDLE_GAME_MS so the 60s round finishes quickly, and
// in-page test helpers (window.__wordleTest) to craft valid dictionary guesses.
//
// Scenario 1 (H1/M4): A gets some greens, B guesses nothing, the clock runs
//   out -> A wins, B loses. Locks that BOTH pages reach a result (no hang) and
//   that resolution goes through the greens verdict / fallback, not a stall.
// Scenario 2 (H1's exact trigger): the non-first player busts all 6 guesses
//   (with at least one green) right before expiry -> that player wins, the
//   other loses, and NEITHER page shows 'Draw' (the old maybeDraw() bug).
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3300;
const BASE = `http://localhost:${PORT}`;
const GAME_MS = 5000; // fast Wordle clock for the test
const log = (...a) => console.log('[wordle-clock-e2e]', ...a);

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
  throw new Error(`server did not become ready on :${PORT}`);
}

const chromiumDir = fs.readdirSync('/opt/pw-browsers').find((d) => /^chromium-\d+$/.test(d));
assert(chromiumDir, 'chromium binary found in /opt/pw-browsers');

let browser = null;
let failed = false;

// submit a list of guesses on a page via the real keyboard path
async function typeGuesses(page, guesses) {
  for (const w of guesses) {
    await page.keyboard.type(w);
    await page.keyboard.press('Enter');
  }
}

// invite Wordle from A, accept on B, wait for both boards
async function startWordle(A, B) {
  await A.click('#btn-open-gamebox');
  await A.waitForSelector('#stage-gamebox:not([hidden])');
  await A.click('.game-card:has-text("Wordle Race")');
  await A.waitForSelector('#stage-waiting:not([hidden])');
  await B.waitForSelector('#modal-invite:not([hidden])');
  await B.click('#btn-accept-invite');
  await A.waitForSelector('.wordle-board');
  await B.waitForSelector('.wordle-board');
}

const resultOf = (p) => p.textContent('#result-text');

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
    // fast clock on BOTH pages, set before any app script runs
    await page.addInitScript((ms) => { window.__WORDLE_GAME_MS = ms; }, GAME_MS);
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[${name} console.error]`, m.text());
    });
    page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
    return page;
  };

  const A = await newPage('A');
  const B = await newPage('B');

  // ---- match the two players ----
  await A.goto(BASE);
  await B.goto(BASE);
  await A.click('#btn-start');
  await B.click('#btn-start');
  for (const [name, p] of [['A', A], ['B', B]]) {
    await p.waitForSelector('#screen-chat:not([hidden])');
    await p.waitForFunction(() => document.getElementById('status-text').textContent.includes('Connected'), null, { timeout: 15000 });
    log(name, 'status:', await p.textContent('#status-text'));
  }

  // =====================================================================
  // Scenario 1: A gets greens, B guesses nothing, clock runs out.
  // =====================================================================
  await startWordle(A, B);
  const g1 = await A.evaluate(() => window.__wordleTest.greenGuess());
  assert(g1, 'test helper produced a green guess');
  log('scenario 1 — A guesses (some greens):', JSON.stringify(g1), '| B guesses nothing');
  await typeGuesses(A, [g1]);
  // relay lands on B's mini board
  await B.waitForFunction(() => {
    const mini = document.querySelector('.wordle-board.mini');
    return mini && [...mini.querySelectorAll('.wordle-tile')].some((t) => t.classList.contains('g') || t.classList.contains('y') || t.classList.contains('b'));
  }, null, { timeout: 5000 });

  // both pages MUST reach the result stage (H1/M4: no hang, no locked-forever
  // input). Wait on the stage becoming visible, not on result-text — the text
  // persists across games, so a length check would pass on stale content.
  await A.waitForSelector('#stage-result:not([hidden])', { timeout: 20000 });
  await B.waitForSelector('#stage-result:not([hidden])', { timeout: 20000 });
  const a1 = await resultOf(A);
  const b1 = await resultOf(B);
  log('scenario 1 result — A:', JSON.stringify(a1), '| B:', JSON.stringify(b1));
  assert(a1.includes('won'), 'A (more greens) sees a win');
  assert(b1.includes('lost'), 'B (no greens) sees a loss');
  log('scenario 1 PASS — greens verdict resolved both sides, no hang');

  // ---- rematch to set up scenario 2 ----
  await A.waitForSelector('#stage-result:not([hidden])');
  await A.click('#btn-rematch');
  await B.waitForSelector('#modal-invite:not([hidden])');
  await B.click('#btn-accept-invite');
  await A.waitForSelector('.wordle-board');
  await B.waitForSelector('.wordle-board');

  // =====================================================================
  // Scenario 2: the non-first player busts all 6 guesses (with >=1 green)
  // before expiry while the first player never guesses. Busting must not
  // finish the game locally; resolution happens via the clock-expiry
  // greens verdict -> the buster wins, the other loses, neither shows
  // 'Draw', and both pages reach a result (no hang). Note: the both-
  // players-bust-early path (checkBothOut -> beginResolution) is not
  // driven here — it shares the same resolution machinery but a
  // dedicated case is a known follow-up.
  // =====================================================================
  const aFirst = await A.evaluate(() => window.__wordleTest.first);
  const first = aFirst ? A : B;      // authoritative player, guesses nothing
  const nonFirst = aFirst ? B : A;   // busts all 6 guesses
  log('scenario 2 — first player is', aFirst ? 'A' : 'B', '| non-first busts all 6');

  const busts = await nonFirst.evaluate(() => {
    const t = window.__wordleTest;
    // 6 non-winning guesses, guaranteeing at least one green (greenGuess)
    return [t.greenGuess(), ...t.bustGuesses()].slice(0, 6);
  });
  assert(busts.length === 6 && busts.every(Boolean), 'six valid bust guesses crafted');
  log('scenario 2 — non-first submits 6 guesses:', busts.join(' '));
  await typeGuesses(nonFirst, busts);

  // both pages must reach the result stage (freshly shown for this round)
  await first.waitForSelector('#stage-result:not([hidden])', { timeout: 20000 });
  await nonFirst.waitForSelector('#stage-result:not([hidden])', { timeout: 20000 });
  const rFirst = await resultOf(first);
  const rNon = await resultOf(nonFirst);
  log('scenario 2 result — first:', JSON.stringify(rFirst), '| non-first:', JSON.stringify(rNon));
  // non-first had greens, first had none -> non-first wins; a greens tie would
  // be a legitimate draw, but greenGuess guarantees non-first > first here.
  assert(!rFirst.includes('Draw') && !rNon.includes('Draw'), 'neither page shows Draw (greens do not tie)');
  assert(rNon.includes('won'), 'non-first (has greens, busted) wins by greens');
  assert(rFirst.includes('lost'), 'first (no greens) loses by greens');
  log('scenario 2 PASS — busting resolves by greens, not a bogus draw, both reach a result');

  log('DONE — all checks passed');
} catch (err) {
  failed = true;
  console.error('[wordle-clock-e2e] FAILED:', err);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

process.exit(failed ? 1 : 0);
