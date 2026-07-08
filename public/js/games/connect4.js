// Connect Four. 7 columns x 6 rows, click a column to drop a disc.
const COLS = 7;
const ROWS = 6;

const RED = '#c0453a';
const BLUE = '#3f6fb5';

export function create(container, ctx) {
  // grid[col][row], row 0 = bottom
  const grid = Array.from({ length: COLS }, () => []);
  let myTurn = ctx.first;
  let over = false;

  // First player is always RED, second is always BLUE — consistent on both
  // screens. My discs = my color, their discs = the other color.
  const myColor = ctx.first ? 'red' : 'blue';
  const theirColor = ctx.first ? 'blue' : 'red';

  ctx.setBanner(ctx.first ? 'YOU ARE RED' : 'YOU ARE BLUE', ctx.first ? RED : BLUE);

  const wrap = document.createElement('div');
  wrap.className = 'c4-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'c4-board';
  wrap.appendChild(boardEl);
  container.appendChild(wrap);

  // DOM cells indexed [row from top][col]
  const cellEls = [];
  for (let r = 0; r < ROWS; r++) {
    cellEls.push([]);
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('button');
      cell.className = 'c4-cell';
      cell.addEventListener('click', () => {
        if (over || !myTurn || grid[c].length >= ROWS) return;
        clearGhost();
        drop(c, 'me');
        ctx.sendMove({ c });
      });
      // Desktop hover drop preview: ghost disc in the landing cell of the
      // hovered column. Touch devices don't fire mouseenter, so this is a no-op
      // there and a tap still drops immediately.
      cell.addEventListener('mouseenter', () => showGhost(c));
      cellEls[r].push(cell);
      boardEl.appendChild(cell);
    }
  }
  boardEl.addEventListener('mouseleave', clearGhost);
  render();

  let ghostEl = null;
  function clearGhost() {
    if (ghostEl) {
      ghostEl.classList.remove('ghost', 'red', 'blue');
      ghostEl = null;
    }
  }
  function showGhost(col) {
    clearGhost();
    if (over || !myTurn || grid[col].length >= ROWS) return;
    const landing = grid[col].length; // 0-based from bottom
    const el = cellEls[ROWS - 1 - landing][col];
    el.classList.add('ghost', myColor);
    ghostEl = el;
  }

  function drop(col, who) {
    grid[col].push(who);
    myTurn = who === 'them';
    checkEnd(col, grid[col].length - 1, who);
    render();
  }

  function at(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return undefined;
    return grid[c][r];
  }

  function checkEnd(col, row, who) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dc, dr] of dirs) {
      const line = [[col, row]];
      for (const sign of [1, -1]) {
        let c = col + dc * sign;
        let r = row + dr * sign;
        while (at(c, r) === who) {
          line.push([c, r]);
          c += dc * sign;
          r += dr * sign;
        }
      }
      if (line.length >= 4) {
        over = true;
        line.forEach(([c, r]) => cellEls[ROWS - 1 - r][c].classList.add('win'));
        ctx.finish(who === 'me' ? 'win' : 'lose');
        return;
      }
    }
    if (grid.every((column) => column.length >= ROWS)) {
      over = true;
      ctx.finish('draw');
    }
  }

  function render() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const who = grid[c][ROWS - 1 - r]; // DOM row 0 is the top
        const cell = cellEls[r][c];
        const color = who ? (who === 'me' ? myColor : theirColor) : null;
        cell.classList.toggle('mine', who === 'me');
        cell.classList.toggle('theirs', who === 'them');
        // Ghost previews are managed by showGhost/clearGhost and only ever sit
        // on empty cells during my turn (opponent can't drop then), so a filled
        // cell never carries a ghost — safe to set disc colors directly here.
        if (who) {
          cell.classList.remove('ghost');
          cell.classList.toggle('red', color === 'red');
          cell.classList.toggle('blue', color === 'blue');
        }
        cell.classList.toggle('playable', !who && myTurn && !over && grid[c].length < ROWS);
      }
    }
    if (!over) ctx.setTurn(myTurn);
  }

  return {
    onMove(data) {
      const c = Number(data.c);
      if (over || myTurn || !Number.isInteger(c) || c < 0 || c >= COLS) return;
      if (grid[c].length >= ROWS) return;
      drop(c, 'them');
    },
    // turn timer expired: drop a disc in a random open column
    randomMove() {
      if (over || !myTurn) return;
      const open = grid.flatMap((col, c) => (col.length < ROWS ? [c] : []));
      if (!open.length) return;
      const c = open[Math.floor(Math.random() * open.length)];
      clearGhost();
      drop(c, 'me');
      ctx.sendMove({ c });
    },
    destroy() {
      wrap.remove();
    },
  };
}
