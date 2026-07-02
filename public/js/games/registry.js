import * as tictactoe from './tictactoe.js';
import * as connect4 from './connect4.js';
import * as wordle from './wordle.js';

export const GAMES = {
  ttt: {
    id: 'ttt',
    name: 'Tic-Tac-Toe',
    desc: 'The classic. Rounds in under a minute.',
    create: tictactoe.create,
  },
  c4: {
    id: 'c4',
    name: 'Connect 4',
    desc: 'Drop discs, connect four before they do.',
    create: connect4.create,
  },
  wordle: {
    id: 'wordle',
    name: 'Wordle Race',
    desc: 'Same word, first to crack it wins.',
    create: wordle.create,
  },
};
