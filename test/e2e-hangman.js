// Focused e2e for co-op Hangman. Spawns its own server on :3200 (isolated from
// the main suite on :3100 so concurrent gate runs don't collide), drives two
// browsers through invite -> accept -> a shared alternating guess, exits 0/1.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const log = (...a) => console.log('[hangman-e2e]', ...a);

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

  // ---- invite Hangman via the gamebox card ----
  await A.click('#btn-open-gamebox');
  await A.waitForSelector('#stage-gamebox:not([hidden])');
  const cardNames = await A.$$eval('.game-card .gc-name', (els) => els.map((e) => e.textContent));
  log('gamebox games:', cardNames.join(', '));
  assert(cardNames.includes('Hangman'), 'Hangman card present in gamebox');
  await A.click('.game-card:has-text("Hangman")');
  await A.waitForSelector('#stage-waiting:not([hidden])');
  await B.waitForSelector('#modal-invite:not([hidden])');
  log('B sees invite:', await B.textContent('#invite-text'));
  await B.click('#btn-accept-invite');
  await A.waitForSelector('#stage-game:not([hidden])');
  await B.waitForSelector('#stage-game:not([hidden])');
  await A.waitForSelector('.hm-wrap');
  await B.waitForSelector('.hm-wrap');
  log('hangman started on both');

  // ---- banner + category shown on both ----
  for (const [name, p] of [['A', A], ['B', B]]) {
    const banner = await p.evaluate(() => ({
      hidden: document.getElementById('game-banner').hidden,
      text: document.getElementById('game-banner').textContent,
    }));
    const catText = await p.textContent('.hm-cat');
    log(name, 'banner:', JSON.stringify(banner.text), '| category label:', JSON.stringify(catText));
    assert(!banner.hidden && banner.text.includes('TEAM GAME'), `${name} banner shows TEAM GAME`);
    assert(catText.includes('CATEGORY:'), `${name} category label shown`);
  }

  // ---- blanks count equals word length, and matches on both ----
  const blanksA = await A.$$eval('.hm-blank', (els) => els.length);
  const blanksB = await B.$$eval('.hm-blank', (els) => els.length);
  log('word blanks — A:', blanksA, 'B:', blanksB);
  assert(blanksA > 0 && blanksA === blanksB, 'both boards render the same non-zero blank count');

  // ---- the turn holder guesses a letter -> used on BOTH + turn flips ----
  const holder = (await A.textContent('#game-turn')) === 'Your turn' ? A : B;
  const other = holder === A ? B : A;
  assert((await other.textContent('#game-turn')) === 'Their turn', 'exactly one player has the turn at start');

  const letter = await holder.evaluate(() => {
    const key = [...document.querySelectorAll('.hm-key')].find((b) => !b.disabled);
    key.click();
    return key.textContent;
  });
  log('turn holder guessed letter:', JSON.stringify(letter));

  const keyDisabled = (letter) => (p) => p.waitForFunction((l) => {
    const k = [...document.querySelectorAll('.hm-key')].find((b) => b.textContent === l);
    return k && k.disabled;
  }, letter, { timeout: 5000 });

  await keyDisabled(letter)(holder);
  await keyDisabled(letter)(other);
  log('letter shows as used on BOTH pages');

  // turn must have flipped to the other player
  await holder.waitForFunction(() => document.getElementById('game-turn').textContent === 'Their turn', null, { timeout: 5000 });
  await other.waitForFunction(() => document.getElementById('game-turn').textContent === 'Your turn', null, { timeout: 5000 });
  log('turn flipped: holder now waits, other now plays');

  // ---- quit cleanly ----
  await A.click('#btn-quit-game');
  await A.waitForSelector('#stage-idle:not([hidden])');
  await B.waitForFunction(() => [...document.querySelectorAll('.msg.sys')].some((m) => m.textContent.includes('quit')), null, { timeout: 5000 });
  log('quit relayed to opponent');

  log('DONE — all checks passed');
} catch (err) {
  failed = true;
  console.error('[hangman-e2e] FAILED:', err);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

process.exit(failed ? 1 : 0);
