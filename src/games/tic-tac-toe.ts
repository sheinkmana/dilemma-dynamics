import type { GameDefinition } from '../engine/game.js';
import type { GameState, Outcome, Player, TicState, Transition } from '../shared/types.js';
const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
export function asTic(s: GameState): TicState {
  if (s.game !== 'tic-tac-toe') throw new Error('Expected Tic-tac-toe.');
  return s;
}
export function createTic(): TicState {
  return {
    game: 'tic-tac-toe',
    cells: Array(9).fill(null),
    player: 0,
    scores: [0, 0],
    ply: 0,
    turn: 0,
  };
}
export function ticOutcome(s: TicState): Outcome | null {
  for (const p of [0, 1] as Player[])
    if (lines.some((l) => l.every((i) => s.cells[i] === p)))
      return { winner: p, scores: p === 0 ? [1, 0] : [0, 1], reason: 'Three in a row.' };
  return s.cells.every((c) => c !== null)
    ? { winner: null, scores: [0, 0], reason: 'The board is full: draw.' }
    : null;
}
export function legalTic(s: TicState) {
  return s.player === null
    ? []
    : s.cells.flatMap((v, i) => (v === null ? [`C:${Math.floor(i / 3)}:${i % 3}`] : []));
}
export function applyTic(s: TicState, action: string): Transition {
  if (s.player === null || !legalTic(s).includes(action))
    throw new Error(`Illegal cell: ${action}`);
  const [, r, c] = action.split(':').map(Number),
    next: TicState = {
      ...s,
      cells: [...s.cells],
      scores: [...s.scores],
      ply: s.ply + 1,
      turn: s.turn + 1,
      player: (1 - s.player) as Player,
    };
  next.cells[r * 3 + c] = s.player;
  const outcome = ticOutcome(next);
  if (outcome) {
    next.player = null;
    next.scores = outcome.scores;
  }
  return { state: next, captured: [], retained: false, outcome };
}
export const tic: GameDefinition = {
  id: 'tic-tac-toe',
  name: 'Tic-tac-toe',
  version: '1',
  create: createTic,
  rules:
    'Play standard 3 by 3 Tic-tac-toe. Player 0 is X; player 1 is O. Choose one empty cell C:r:c with zero-based coordinates. Three in a row, column, or diagonal wins. A full board without a winner is a draw. Players alternate after every move.',
  apply: (s, a) => applyTic(asTic(s), a),
  legalActions: (s) => legalTic(asTic(s)),
  outcome: (s) => ticOutcome(asTic(s)),
  observe: (s, player) => ({ game: s.game, you: player, toMove: s.player, cells: asTic(s).cells }),
};
