# UX Round 2 Plan

**Goal:** Ship one verified release on `main` that fixes video-connect failures
(TURN + failure detection), makes every game mobile-friendly and visually
obvious (team banners, countdown bar, C4 drop preview), upgrades Wordle
(60s timer, real dictionary), removes mic/cam clutter, and adds a co-op
Hangman game — all passing the repo e2e suite.

*Exploration stage skipped deliberately: the orchestrator authored the entire
codebase this session and has current knowledge of every file.*

## Codebase map (ground truth for builders)

- `server.js` — Express + ws matchmaker/relay. Message types: find, cancel,
  create_room, join_room, signal, chat, game_invite/accept/decline/move/quit,
  skip. `game_accept` generates shared `seed` + random `first`.
- `public/js/main.js` — UI state machine; game ctx = `{seed, first, sendMove,
  setTurn(bool|null), finish('win'|'lose'|'draw')}`; per-game `turnSeconds`
  (default 10) drives a countdown that calls `instance.randomMove()` at 0.
- `public/js/rtc.js` — getUserMedia + RTCPeerConnection, STUN-only today.
- `public/js/games/registry.js` — GAMES map {id, name, desc, turnSeconds?, create}.
- Games: `pool.js` (canvas, drag-from-cue aiming, shooter-authoritative sync),
  `connect4.js` (7x6 DOM grid, mine/theirs classes), `wordle.js` + `words.js`
  (race, colors-only opponent board).
- `public/css/style.css` — dark theme; game styles in marked blocks
  (`/* ---- 8-ball pool ---- */`, `/* ---- connect four ---- */`,
  `/* ---- wordle ---- */`).
- Test suite currently lives outside the repo (session scratchpad) — Wave 1
  brings it in as `test/e2e.js`.

## Phases

### Wave 1 — Platform (one builder; owns rtc.js, main.js, index.html, style.css, test/)
Done when:
- RTC config includes Open Relay TURN servers; ICE failure/disconnect is
  detected; one `restartIce()` retry; if video not connected ~15s after match,
  stranger mode auto-re-finds with a toast, friend mode shows overlay message.
- Mic/Cam buttons gone (controls = Games, Skip).
- Countdown is a draining progress bar inside the pill (white fill, red when
  ≤3s or ≤30%), seconds still visible.
- `ctx.setBanner(text, colorDot?)` renders bold uppercase `#game-banner`.
- `finish` accepts `coop_win`/`coop_loss` → "You beat it together" / "It got
  you both", scoreboard untouched, no Rematch changes needed.
- `index.html` home chips include Hangman.
- `test/e2e.js` (spawns its own server on :3100) passes; `npm run test:e2e`.

### Wave 2 — Games (three parallel builders; disjoint JS; style.css by Edit-only
within own marked block)
- **2a pool.js**: drag-anywhere relative aiming (drag vector = direction+power,
  finger never covers the shot), longer guide line, `setBanner('YOU ARE
  SOLIDS/STRIPES')` once groups assign (+ 'TABLE OPEN' before).
- **2b connect4.js/wordle.js/words.js**: C4 red (first) vs blue (second) discs,
  bordered board frame, hover ghost-drop preview in landing cell, banner 'YOU
  ARE RED/BLUE'; Wordle 60s shared timer — solve early wins, at 0:00 most
  greens in best single row wins (tie = draw), guesses validated against a
  real downloaded 5-letter dictionary (`dictionary.js`).
- **2c hangman.js (new) + hangmanWords.js + registry.js**: co-op — seed picks
  category + 5–6 letter word; alternating letter guesses (turn timer applies,
  `randomMove` guesses a random unused letter); 6 wrong = stickman complete =
  `coop_loss`; solved = `coop_win`; SVG stickman, category label, used
  letters, on-screen keyboard; banner 'TEAM GAME — CATEGORY: X'.

### Standing gate (after every wave)
```
for f in server.js public/js/*.js public/js/games/*.js; do node --check "$f"; done
node test/e2e.js   # full suite, exit 0
```

### Final gate
Adversarial Opus review loop (report-only rounds → fix pass → re-gate) until
zero findings, then commit to `main` (author naidx0, no AI trailers) and push.
