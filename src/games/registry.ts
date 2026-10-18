import { dots } from './dots-boxes.js';
import { tic } from './tic-tac-toe.js';
import type { GameId } from '../shared/types.js';
export const games = { 'dots-boxes': dots, 'tic-tac-toe': tic };
export const gameFor = (id: GameId) => games[id];
