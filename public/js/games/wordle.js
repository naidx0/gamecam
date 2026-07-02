// Wordle Race: both players race to guess the SAME word. First correct guess
// wins. You see your opponent's progress as a colors-only mini board.
import { WORDS } from './words.js';

const KB_ROWS = ['qwertyuiop', 'asdfghjkl', '⏎zxcvbnm⌫'];

export function create(container, ctx) {
  const word = WORDS[ctx.seed % WORDS.length];
  let over = false;
  let row = 0;
  let current = '';
  let iAmOut = false;
  let theyAreOut = false;

  ctx.setTurn(null); // no turns — it's a race

  const wrap = document.createElement('div');
  wrap.className = 'wordle-wrap';

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

  function submit() {
    if (current.length !== 5) {
      flashStatus('Need 5 letters!');
      return;
    }
    const guess = current;
    const colors = score(guess);
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
      over = true;
      ctx.finish('win');
      return;
    }
    if (row >= 6) {
      iAmOut = true;
      status.textContent = `Out of guesses! The word was "${word.toUpperCase()}".`;
      maybeDraw();
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

  function maybeDraw() {
    if (iAmOut && theyAreOut && !over) {
      over = true;
      ctx.finish('draw');
    } else if (iAmOut && !over) {
      status.textContent += ' Waiting to see if they crack it…';
    }
  }

  return {
    onMove(data) {
      if (over) return;
      const r = Number(data.row) - 1;
      if (Number.isInteger(r) && r >= 0 && r < 6 && Array.isArray(data.colors)) {
        data.colors.slice(0, 5).forEach((col, c) => {
          if (col === 'g' || col === 'y' || col === 'b') {
            theirBoard.tiles[r][c].classList.add(col);
          }
        });
        theirStatus.textContent = `${r + 1} / 6 guesses`;
      }
      if (data.won) {
        over = true;
        status.textContent = `They got it first! The word was "${word.toUpperCase()}".`;
        ctx.finish('lose');
        return;
      }
      if (data.out) {
        theyAreOut = true;
        theirStatus.textContent = 'Out of guesses!';
        maybeDraw();
      }
    },
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      wrap.remove();
    },
  };
}
