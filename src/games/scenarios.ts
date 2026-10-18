import { createDots, applyDots, assertDots } from './dots-boxes.js';
import { createTic } from './tic-tac-toe.js';
import type { DotsState, GameState, Scenario } from '../shared/types.js';
export function chains(rows: number, cols: number): DotsState {
  const s = createDots(rows, cols);
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) s.drawn[`H:${r}:${c}`] = -1;
  return s;
}
export function loop(cols = 2): DotsState {
  const s = createDots(2, cols);
  for (let c = 0; c < cols; c++) {
    s.drawn[`H:0:${c}`] = -1;
    s.drawn[`H:2:${c}`] = -1;
  }
  for (let r = 0; r < 2; r++) {
    s.drawn[`V:${r}:0`] = -1;
    s.drawn[`V:${r}:${cols}`] = -1;
  }
  for (let c = 1; c < cols - 1; c++) s.drawn[`H:1:${c}`] = -1;
  return s;
}
export const scenarios: Scenario[] = [
  {
    id: 'empty',
    name: 'Empty board',
    description: 'Play from the first edge.',
    game: 'dots-boxes',
    split: 'practice',
  },
  {
    id: 'chains-3',
    name: 'Two three-box chains',
    description: 'A small endgame about keeping control.',
    game: 'dots-boxes',
    split: 'practice',
  },
  {
    id: 'handout',
    name: 'The double-cross',
    description: 'A capture is available. Is taking it best?',
    game: 'dots-boxes',
    split: 'practice',
  },
  {
    id: 'chain-4',
    name: 'Four-box chain',
    description: 'Held-out chain opening.',
    game: 'dots-boxes',
    split: 'test',
  },
  {
    id: 'chains-4',
    name: 'Two four-box chains',
    description: 'Held-out control decision.',
    game: 'dots-boxes',
    split: 'test',
  },
  {
    id: 'loop-6',
    name: 'Six-box loop',
    description: 'Held-out loop opening.',
    game: 'dots-boxes',
    split: 'test',
  },
  {
    id: 'handout-4',
    name: 'Four-chain handout',
    description: 'A held-out position with an available capture.',
    game: 'dots-boxes',
    split: 'test',
  },
];
export const TEST_SCENARIOS = ['chain-4', 'chains-4', 'loop-6', 'handout-4'];
export function scenarioState(id: string, game: string, rows = 3, cols = 3): GameState {
  if (game === 'tic-tac-toe') {
    if (id !== 'empty') throw new Error('This scenario belongs to Dots and Boxes.');
    return createTic();
  }
  let s: DotsState;
  switch (id) {
    case 'empty':
      s = createDots(rows, cols);
      break;
    case 'chains-3':
      s = chains(2, 3);
      break;
    case 'chain-4':
      s = chains(1, 4);
      break;
    case 'chains-4':
      s = chains(2, 4);
      break;
    case 'loop-6':
      s = loop(3);
      break;
    case 'handout':
      s = applyDots(applyDots(chains(2, 3), 'V:0:0').state as DotsState, 'V:0:1')
        .state as DotsState;
      break;
    case 'handout-4':
      s = chains(2, 4);
      for (const action of ['V:0:0', 'V:0:1', 'V:0:2']) s = applyDots(s, action).state as DotsState;
      break;
    default:
      throw new Error('Unknown starting position.');
  }
  assertDots(s);
  return s;
}
