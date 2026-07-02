// Tic-Tac-Toe. First player is ✕, second is ◯.
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function create(container, ctx) {
  const board = Array(9).fill(null); // 'me' | 'them' | null
  let myTurn = ctx.first;
  let over = false;

  const mySymbol = ctx.first ? '✕' : '◯';
  const theirSymbol = ctx.first ? '◯' : '✕';

  const el = document.createElement('div');
  el.className = 'ttt-board';
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('button');
    cell.className = 'ttt-cell';
    cell.addEventListener('click', () => {
      if (over || !myTurn || board[i]) return;
      place(i, 'me');
      ctx.sendMove({ i });
    });
    cells.push(cell);
    el.appendChild(cell);
  }
  container.appendChild(el);
  render();

  function place(i, who) {
    board[i] = who;
    myTurn = who === 'them';
    checkEnd();
    render();
  }

  function winningLine(who) {
    return LINES.find((line) => line.every((i) => board[i] === who)) || null;
  }

  function checkEnd() {
    const meWin = winningLine('me');
    const themWin = winningLine('them');
    if (meWin || themWin) {
      over = true;
      (meWin || themWin).forEach((i) => cells[i].classList.add('win'));
      ctx.finish(meWin ? 'win' : 'lose');
    } else if (board.every(Boolean)) {
      over = true;
      ctx.finish('draw');
    }
  }

  function render() {
    board.forEach((who, i) => {
      const cell = cells[i];
      cell.textContent = who ? (who === 'me' ? mySymbol : theirSymbol) : '';
      cell.classList.toggle('mine', who === 'me');
      cell.classList.toggle('theirs', who === 'them');
      cell.classList.toggle('playable', !who && myTurn && !over);
    });
    if (!over) ctx.setTurn(myTurn);
  }

  return {
    onMove(data) {
      const i = Number(data.i);
      if (over || myTurn || !Number.isInteger(i) || i < 0 || i > 8 || board[i]) return;
      place(i, 'them');
    },
    // turn timer expired: play a random legal move
    randomMove() {
      if (over || !myTurn) return;
      const empty = board.flatMap((v, i) => (v ? [] : [i]));
      if (!empty.length) return;
      const i = empty[Math.floor(Math.random() * empty.length)];
      place(i, 'me');
      ctx.sendMove({ i });
    },
    destroy() {
      el.remove();
    },
  };
}
