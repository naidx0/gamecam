import * as tictactoe from './tictactoe.js';
import * as connect4 from './connect4.js';
import * as wordle from './wordle.js';

export const GAMES = {
  ttt: {
    id: 'ttt',
    name: 'Tic-Tac-Toe',
    icon: '❌⭕',
    desc: 'The classic. 30-second rounds.',
    create: tictactoe.create,
  },
  c4: {
    id: 'c4',
    name: 'Connect 4',
    icon: '🔴🟡',
    desc: 'Drop discs, connect four, talk trash.',
    create: connect4.create,
  },
  wordle: {
    id: 'wordle',
    name: 'Wordle Race',
    icon: '🟩🟨',
    desc: 'Same word, first to crack it wins.',
    create: wordle.create,
  },
};
