import * as pool from './pool.js';
import * as connect4 from './connect4.js';
import * as wordle from './wordle.js';

export const GAMES = {
  pool: {
    id: 'pool',
    name: '8-Ball Pool',
    desc: 'Drag to aim, sink your group, then the 8.',
    turnSeconds: 15,
    create: pool.create,
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
