// Connect Four. 7 columns x 6 rows, click a column to drop a disc.
const COLS = 7;
const ROWS = 6;

export function create(container, ctx) {
  // grid[col][row], row 0 = bottom
  const grid = Array.from({ length: COLS }, () => []);
  let myTurn = ctx.first;
  let over = false;

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
        drop(c, 'me');
        ctx.sendMove({ c });
      });
      cellEls[r].push(cell);
      boardEl.appendChild(cell);
    }
  }
  render();

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
        cell.classList.toggle('mine', who === 'me');
        cell.classList.toggle('theirs', who === 'them');
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
    destroy() {
      wrap.remove();
    },
  };
}
