import { gameFor } from '../games/registry.js';
import { geometry, boxEdges } from '../games/dots-boxes.js';
import { evaluate } from '../games/evaluate.js';
import { rng } from '../engine/game.js';
import type { GameState, PlayerConfig } from '../shared/types.js';
export function baselineMove(
  state: GameState,
  kind: PlayerConfig['kind'],
  seed: number,
): { action: string; explanation: string } {
  const game = gameFor(state.game),
    actions = game.legalActions(state),
    random = rng(seed + state.ply * 7919);
  if (!actions.length) throw new Error('No legal move remains.');
  const pick = (xs: string[]) => xs[Math.floor(random() * xs.length)];
  if (kind === 'random')
    return {
      action: pick(actions),
      explanation: 'Chosen uniformly from the legal actions by a seeded local baseline.',
    };
  if (kind === 'solver') {
    const result = evaluate(state);
    if (result.status !== 'exact')
      throw new Error(
        'Exact solver is outside its supported search budget. Choose a small endgame or another player.',
      );
    return {
      action: pick(result.optimalActions),
      explanation: `Exact ${result.method}: this action preserves the best achievable final margin (${result.value}).`,
    };
  }
  if (state.game === 'tic-tac-toe') {
    const wins = actions.filter((a) => game.apply(state, a).outcome?.winner === state.player);
    if (wins.length) return { action: pick(wins), explanation: 'Takes an immediate win.' };
    const opponent = { ...state, player: (1 - state.player!) as 0 | 1 };
    const blocks = actions.filter(
      (a) => game.apply(opponent, a).outcome?.winner === opponent.player,
    );
    return {
      action: pick(blocks.length ? blocks : actions.includes('C:1:1') ? ['C:1:1'] : actions),
      explanation: blocks.length
        ? 'Blocks an immediate opponent win.'
        : 'Prefers the centre, then chooses a legal cell.',
    };
  }
  const ratings = actions.map((action) => {
    const edge = geometry(state.rows, state.cols).find((e) => e.id === action)!;
    const counts = edge.boxes.map(
      (i) =>
        boxEdges(Math.floor(i / state.cols), i % state.cols).filter(
          (e) => state.drawn[e] !== undefined,
        ).length,
    );
    return {
      action,
      captures: counts.filter((n) => n === 3).length,
      thirds: counts.filter((n) => n === 2).length,
    };
  });
  const maxCapture = Math.max(...ratings.map((r) => r.captures));
  const candidates = maxCapture
    ? ratings.filter((r) => r.captures === maxCapture)
    : ratings.filter((r) => r.thirds === Math.min(...ratings.map((r) => r.thirds)));
  return {
    action: pick(candidates.map((r) => r.action)),
    explanation: maxCapture
      ? `Greedy baseline: captures ${maxCapture} ${maxCapture === 1 ? 'box' : 'boxes'} immediately.`
      : 'Heuristic baseline: minimizes newly exposed third sides, then breaks ties with a seeded choice.',
  };
}
