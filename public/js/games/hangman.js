// Co-op Hangman: both players share one word (chosen deterministically from the
// seed) and ALTERNATE letter guesses. Every guess — right or wrong — passes the
// turn. 6 wrong guesses complete the stickman and both lose together
// (coop_loss); revealing every letter wins together (coop_win). Fully
// deterministic: both clients apply identical guesses to identical local state,
// so no authority is needed — moves just relay the guessed letter.
import { CATEGORIES } from './hangmanWords.js';

const NS = 'http://www.w3.org/2000/svg';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const MAX_WRONG = 6;

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function create(container, ctx) {
  // ---- deterministic word selection (identical on both clients) -------------
  const catNames = Object.keys(CATEGORIES);
  const category = catNames[ctx.seed % catNames.length];
  const words = CATEGORIES[category];
  const word = words[Math.floor(ctx.seed / catNames.length) % words.length];
  const wordLetters = new Set(word.split(''));

  // ---- state ----------------------------------------------------------------
  const guessed = new Set();
  let wrong = 0;
  let myTurn = ctx.first;
  let over = false;

  ctx.setBanner(`TEAM GAME — ${category.toUpperCase()}`);

  // ---- DOM ------------------------------------------------------------------
  const wrap = document.createElement('div');
  wrap.className = 'hm-wrap';

  const cat = document.createElement('div');
  cat.className = 'hm-cat';
  cat.textContent = `CATEGORY: ${category.toUpperCase()}`;
  wrap.appendChild(cat);

  // gallows + stickman
  const svg = svgEl('svg', { viewBox: '0 0 200 220', class: 'hm-svg' });
  // gallows (always visible)
  svg.appendChild(svgEl('line', { x1: 20, y1: 210, x2: 120, y2: 210, class: 'hm-frame' }));
  svg.appendChild(svgEl('line', { x1: 40, y1: 210, x2: 40, y2: 20, class: 'hm-frame' }));
  svg.appendChild(svgEl('line', { x1: 40, y1: 20, x2: 130, y2: 20, class: 'hm-frame' }));
  svg.appendChild(svgEl('line', { x1: 130, y1: 20, x2: 130, y2: 45, class: 'hm-frame' }));
  // stickman parts, revealed one per wrong guess
  const parts = [
    svgEl('circle', { cx: 130, cy: 60, r: 15, class: 'hm-part' }),          // head
    svgEl('line', { x1: 130, y1: 75, x2: 130, y2: 140, class: 'hm-part' }),  // body
    svgEl('line', { x1: 130, y1: 90, x2: 105, y2: 115, class: 'hm-part' }),  // left arm
    svgEl('line', { x1: 130, y1: 90, x2: 155, y2: 115, class: 'hm-part' }),  // right arm
    svgEl('line', { x1: 130, y1: 140, x2: 108, y2: 178, class: 'hm-part' }), // left leg
    svgEl('line', { x1: 130, y1: 140, x2: 152, y2: 178, class: 'hm-part' }), // right leg
  ];
  parts.forEach((p) => { p.style.display = 'none'; svg.appendChild(p); });
  wrap.appendChild(svg);

  const count = document.createElement('div');
  count.className = 'hm-count';
  wrap.appendChild(count);

  // word blanks
  const wordRow = document.createElement('div');
  wordRow.className = 'hm-word';
  const blanks = word.split('').map((ch) => {
    const b = document.createElement('span');
    b.className = 'hm-blank';
    wordRow.appendChild(b);
    return b;
  });
  wrap.appendChild(wordRow);

  // status
  const status = document.createElement('div');
  status.className = 'hm-status';
  wrap.appendChild(status);

  // keyboard
  const kb = document.createElement('div');
  kb.className = 'hm-kb';
  const keyEls = {};
  for (const rowStr of KB_ROWS) {
    const kbRow = document.createElement('div');
    kbRow.className = 'hm-kb-row';
    for (const ch of rowStr) {
      const key = document.createElement('button');
      key.className = 'hm-key';
      key.textContent = ch;
      key.addEventListener('click', () => doGuess(ch));
      keyEls[ch] = key;
      kbRow.appendChild(key);
    }
    kb.appendChild(kbRow);
  }
  wrap.appendChild(kb);
  container.appendChild(wrap);

  // ---- rendering ------------------------------------------------------------
  function renderBlanks() {
    word.split('').forEach((ch, i) => {
      const shown = guessed.has(ch) || over;
      blanks[i].textContent = shown ? ch : '';
      blanks[i].classList.toggle('filled', shown);
    });
  }

  function renderCount() {
    count.textContent = `${wrong} / ${MAX_WRONG}`;
  }

  function renderStatus() {
    if (over) return;
    status.textContent = myTurn ? 'Your turn — pick a letter' : "Their turn…";
  }

  function updateKey(letter) {
    const key = keyEls[letter];
    if (!key) return;
    key.disabled = true;
    key.classList.add(wordLetters.has(letter) ? 'good' : 'bad');
  }

  renderBlanks();
  renderCount();
  renderStatus();
  ctx.setTurn(myTurn);

  // ---- core -----------------------------------------------------------------
  // Apply a guess to shared local state (identical on both clients).
  function applyGuess(letter) {
    if (over || guessed.has(letter)) return;
    guessed.add(letter);
    updateKey(letter);
    if (!wordLetters.has(letter)) {
      wrong++;
      if (parts[wrong - 1]) parts[wrong - 1].style.display = '';
    }
    renderBlanks();
    renderCount();

    if (wrong >= MAX_WRONG) {
      over = true;
      renderBlanks();
      status.textContent = `The word was "${word.toUpperCase()}". It got you both.`;
      ctx.setTurn(null);
      ctx.finish('coop_loss');
      return;
    }
    if ([...wordLetters].every((ch) => guessed.has(ch))) {
      over = true;
      status.textContent = 'You beat it together!';
      ctx.setTurn(null);
      ctx.finish('coop_win');
      return;
    }
    // turn strictly alternates on every applied guess
    myTurn = !myTurn;
    ctx.setTurn(myTurn);
    renderStatus();
  }

  // A guess I make on my turn: apply locally + relay to my teammate.
  function doGuess(letter) {
    if (over || !myTurn) return;
    if (!/^[a-z]$/.test(letter) || guessed.has(letter)) return;
    ctx.sendMove({ letter });
    applyGuess(letter);
  }

  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) doGuess(e.key.toLowerCase());
  }
  document.addEventListener('keydown', onKeydown);

  return {
    onMove(data) {
      if (over || !data) return;
      const letter = String(data.letter || '');
      // guard: only accept when it's the sender's turn (i.e. not mine) and unused
      if (myTurn) return;
      if (!/^[a-z]$/.test(letter) || guessed.has(letter)) return;
      applyGuess(letter);
    },
    randomMove() {
      if (over || !myTurn) return;
      const pool = LETTERS.split('').filter((ch) => !guessed.has(ch));
      if (!pool.length) return;
      doGuess(pool[Math.floor(Math.random() * pool.length)]);
    },
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      wrap.remove();
    },
  };
}
