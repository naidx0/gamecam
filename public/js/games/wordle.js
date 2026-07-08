// Wordle Race: both players race to guess the SAME word. First correct guess
// wins. You see your opponent's progress as a colors-only mini board. A shared
// 60-second clock caps the game: at 0:00 whoever has the most greens in a
// single row wins (tie = draw).
import { WORDS } from './words.js';
import { DICTIONARY } from './dictionary.js';

const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '⏎zxcvbnm⌫'];
// Overridable via window hooks so the clock scenarios can run on a fast clock
// in e2e (see test/e2e-wordle-clock.js). Production uses the defaults.
const GAME_MS = (typeof window !== 'undefined' && window.__WORDLE_GAME_MS) || 60000;
// Grace before the first player broadcasts its authoritative verdict, so any
// in-flight winning move lands first. Fallback: how long the second player
// waits for a verdict before resolving locally (covers a frozen first tab).
const GRACE_MS = (typeof window !== 'undefined' && window.__WORDLE_GRACE_MS) || 1500;
const FALLBACK_MS = (typeof window !== 'undefined' && window.__WORDLE_FALLBACK_MS) || 5000;

export function create(container, ctx) {
  const word = WORDS[ctx.seed % WORDS.length];
  let over = false;
  let row = 0;
  let current = '';
  let iAmOut = false;
  let theyAreOut = false;
  let timeExpired = false;
  let myBestGreens = 0;   // most green tiles I've had in any single row
  let theirBestGreens = 0; // same, for the opponent (from received colors)
  let verdictTimer = null;  // first player: pending authoritative broadcast
  let fallbackTimer = null; // second player: local resolve if no verdict arrives

  ctx.setTurn(null); // no turns — it's a race

  const wrap = document.createElement('div');
  wrap.className = 'wordle-wrap';

  // --- shared 60s clock ----------------------------------------------------
  const clockEl = document.createElement('div');
  clockEl.className = 'wordle-clock';
  // appended to `wrap` after the two sides (below) so :nth-child selectors on
  // .wordle-side stay stable; CSS `order:-1` renders it visually on top.
  const startAt = Date.now();
  let clockInt = setInterval(tick, 200);
  function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function tick() {
    if (over) { stopClock(); return; }
    const remain = Math.max(0, GAME_MS - (Date.now() - startAt));
    const secs = Math.ceil(remain / 1000);
    clockEl.textContent = fmt(secs);
    clockEl.classList.toggle('urgent', secs <= 10);
    if (remain <= 0) { stopClock(); onTimeUp(); }
  }
  function stopClock() {
    if (clockInt) { clearInterval(clockInt); clockInt = null; }
  }
  tick(); // paint 1:00 immediately

  // Clock hit 0:00 on this client: lock input, then kick off resolution.
  function onTimeUp() {
    if (over || timeExpired) return;
    timeExpired = true;
    iAmOut = true; // lock further input
    if (!over) status.textContent = "Time's up!";
    beginResolution();
  }

  // Unified end-of-game resolution. The instant-solve path (a correct guess
  // before your own clock expires) stays separate; EVERYTHING else — running
  // out the clock, or both players busting their 6 guesses — resolves here via
  // the greens tiebreak. Nobody ever finishes locally from being "out".
  //
  // Resolution begins for a client once EITHER its own clock has expired OR
  // both players are out of guesses. The FIRST player is authoritative: after
  // a grace (so any in-flight winning move lands), it broadcasts both green
  // counts and both clients finish consistently. The SECOND player normally
  // just waits for that verdict, but has a local fallback in case the first
  // tab is frozen/backgrounded and never sends one.
  function beginResolution() {
    if (over) return;
    if (ctx.first) {
      if (verdictTimer) return;
      verdictTimer = setTimeout(resolveAsFirst, GRACE_MS);
    } else {
      if (fallbackTimer) return;
      fallbackTimer = setTimeout(() => {
        // No verdict (or winning move) arrived in time — resolve locally from
        // our own view. A frozen first tab can leave a small residual
        // divergence in the exact green counts; that's accepted here.
        finishByGreens(myBestGreens, theirBestGreens);
      }, FALLBACK_MS);
    }
  }

  // Both players are out of guesses: resolve now (no need to wait for 0:00).
  function checkBothOut() {
    if (iAmOut && theyAreOut && !over) beginResolution();
  }

  function clearResolveTimers() {
    if (verdictTimer) { clearTimeout(verdictTimer); verdictTimer = null; }
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }

  function resolveAsFirst() {
    verdictTimer = null;
    if (over) return;
    ctx.sendMove({ timeUp: { mine: myBestGreens, theirs: theirBestGreens } });
    finishByGreens(myBestGreens, theirBestGreens);
  }

  function finishByGreens(mine, theirs) {
    if (over) return;
    over = true;
    clearResolveTimers();
    stopClock();
    if (mine > theirs) ctx.finish('win');
    else if (mine < theirs) ctx.finish('lose');
    else ctx.finish('draw');
  }

  // Single-shot finish for the instant win/lose paths.
  function finishNow(result) {
    if (over) return;
    over = true;
    clearResolveTimers();
    stopClock();
    ctx.finish(result);
  }

  // --- my side -------------------------------------------------------------
  const mySide = document.createElement('div');
  mySide.className = 'wordle-side';
  mySide.innerHTML = '<div class="wordle-side-label">YOU</div>';
  const myBoard = buildBoard(false);
  mySide.appendChild(myBoard.el);
  const status = document.createElement('div');
  status.className = 'wordle-status';
  status.textContent = 'Guess the 5-letter word — first one to crack it wins!';
  mySide.appendChild(status);

  const kb = document.createElement('div');
  kb.className = 'wordle-kb';
  const keyEls = {};
  for (const rowStr of KB_ROWS) {
    const kbRow = document.createElement('div');
    kbRow.className = 'wordle-kb-row';
    for (const ch of rowStr) {
      const key = document.createElement('button');
      key.className = 'wordle-key' + (ch === '⏎' || ch === '⌫' ? ' wide' : '');
      key.textContent = ch;
      key.addEventListener('click', () => press(ch));
      if (ch !== '⏎' && ch !== '⌫') keyEls[ch] = key;
      kbRow.appendChild(key);
    }
    kb.appendChild(kbRow);
  }
  mySide.appendChild(kb);

  // --- their side ----------------------------------------------------------
  const theirSide = document.createElement('div');
  theirSide.className = 'wordle-side';
  theirSide.innerHTML = '<div class="wordle-side-label">STRANGER</div>';
  const theirBoard = buildBoard(true);
  theirSide.appendChild(theirBoard.el);
  const theirStatus = document.createElement('div');
  theirStatus.className = 'wordle-status';
  theirStatus.textContent = '0 / 6 guesses';
  theirSide.appendChild(theirStatus);

  wrap.appendChild(mySide);
  wrap.appendChild(theirSide);
  wrap.appendChild(clockEl);
  container.appendChild(wrap);

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') press('⏎');
    else if (e.key === 'Backspace') press('⌫');
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  }
  document.addEventListener('keydown', onKeydown);

  function buildBoard(mini) {
    const el = document.createElement('div');
    el.className = 'wordle-board' + (mini ? ' mini' : '');
    const tiles = [];
    for (let r = 0; r < 6; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'wordle-row';
      tiles.push([]);
      for (let c = 0; c < 5; c++) {
        const t = document.createElement('div');
        t.className = 'wordle-tile';
        tiles[r].push(t);
        rowEl.appendChild(t);
      }
      el.appendChild(rowEl);
    }
    return { el, tiles };
  }

  function press(ch) {
    if (over || iAmOut) return;
    if (ch === '⌫') {
      current = current.slice(0, -1);
    } else if (ch === '⏎') {
      submit();
      return;
    } else if (current.length < 5) {
      current += ch;
    }
    renderCurrent();
  }

  function renderCurrent() {
    for (let c = 0; c < 5; c++) {
      const t = myBoard.tiles[row][c];
      t.textContent = current[c] || '';
      t.classList.toggle('filled', Boolean(current[c]));
    }
  }

  // standard two-pass wordle scoring: greens first, then yellows with counts
  function score(guess) {
    const colors = Array(5).fill('b');
    const remaining = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === word[i]) colors[i] = 'g';
      else remaining[word[i]] = (remaining[word[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (colors[i] === 'g') continue;
      if (remaining[guess[i]] > 0) {
        colors[i] = 'y';
        remaining[guess[i]]--;
      }
    }
    return colors;
  }

  // Test-only helpers (present only when the fast-clock override is set). They
  // run in-page where DICTIONARY, score() and the answer are all in scope, so
  // the e2e can craft valid guesses without shipping the answer to production.
  if (typeof window !== 'undefined' && window.__WORDLE_GAME_MS) {
    window.__wordleTest = {
      first: ctx.first,
      // a valid dictionary word with 1..4 greens vs the answer (never a win)
      greenGuess() {
        for (const w of DICTIONARY) {
          const g = score(w).filter((c) => c === 'g').length;
          if (g >= 1 && g <= 4) return w;
        }
        return null;
      },
      // six valid dictionary words, none of them the answer (guaranteed busts)
      bustGuesses() {
        const out = [];
        for (const w of DICTIONARY) {
          if (w !== word) out.push(w);
          if (out.length >= 6) break;
        }
        return out;
      },
    };
  }

  function submit() {
    if (current.length !== 5) {
      flashStatus('Need 5 letters!');
      return;
    }
    if (!DICTIONARY.has(current)) {
      flashStatus('Not a word');
      return;
    }
    const guess = current;
    const colors = score(guess);
    const greens = colors.filter((c) => c === 'g').length;
    if (greens > myBestGreens) myBestGreens = greens;
    for (let c = 0; c < 5; c++) {
      const t = myBoard.tiles[row][c];
      t.textContent = guess[c];
      t.classList.add(colors[c]);
      const key = keyEls[guess[c]];
      if (key) {
        // never downgrade key colors: g > y > b
        if (colors[c] === 'g') key.className = 'wordle-key g';
        else if (colors[c] === 'y' && !key.classList.contains('g')) key.className = 'wordle-key y';
        else if (!key.classList.contains('g') && !key.classList.contains('y')) key.className = 'wordle-key b';
      }
    }
    const won = guess === word;
    row++;
    current = '';
    ctx.sendMove({ row, colors, won, out: !won && row >= 6 });

    if (won) {
      // Instant solve before my own clock expired: I win locally now.
      finishNow('win');
      return;
    }
    if (row >= 6) {
      // Busted. Lock input and wait for the clock / verdict — never finish
      // locally from being out. If they're already out too, resolve now.
      iAmOut = true;
      status.textContent = 'Out of guesses — waiting for the clock…';
      checkBothOut();
      return;
    }
    status.textContent = `${row} / 6 guesses used`;
  }

  function flashStatus(text) {
    const prev = status.textContent;
    status.textContent = text;
    setTimeout(() => {
      if (status.textContent === text) status.textContent = prev;
    }, 1200);
  }

  return {
    onMove(data) {
      if (over) return;
      // Authoritative time-up resolution from the first player. Their message
      // is from THEIR perspective, so swap for us: my greens = their `theirs`.
      if (data.timeUp) {
        finishByGreens(Number(data.timeUp.theirs) || 0, Number(data.timeUp.mine) || 0);
        return;
      }
      const r = Number(data.row) - 1;
      if (Number.isInteger(r) && r >= 0 && r < 6 && Array.isArray(data.colors)) {
        let greens = 0;
        data.colors.slice(0, 5).forEach((col, c) => {
          if (col === 'g' || col === 'y' || col === 'b') {
            theirBoard.tiles[r][c].classList.add(col);
          }
          if (col === 'g') greens++;
        });
        if (greens > theirBestGreens) theirBestGreens = greens;
        theirStatus.textContent = `${r + 1} / 6 guesses`;
      }
      if (data.won) {
        // Their instant solve. Honour it even if it crosses the time-up
        // boundary: cancel any pending verdict and finish 'lose' normally.
        status.textContent = `They got it first! The word was "${word.toUpperCase()}".`;
        finishNow('lose');
        return;
      }
      if (data.out) {
        theyAreOut = true;
        theirStatus.textContent = 'Out of guesses!';
        checkBothOut();
      }
    },
    destroy() {
      clearResolveTimers();
      stopClock();
      document.removeEventListener('keydown', onKeydown);
      wrap.remove();
    },
  };
}
