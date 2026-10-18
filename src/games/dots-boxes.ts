import type { GameDefinition } from '../engine/game.js';
import type { DotsState, GameState, Outcome, Player, Transition } from '../shared/types.js';
export interface Edge {
  id: string;
  r: number;
  c: number;
  horizontal: boolean;
  boxes: number[];
}
const geometries = new Map<string, Edge[]>();
export function geometry(rows: number, cols: number): Edge[] {
  const key = `${rows}:${cols}`;
  if (geometries.has(key)) return geometries.get(key)!;
  const edges: Edge[] = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c < cols; c++)
      edges.push({
        id: `H:${r}:${c}`,
        r,
        c,
        horizontal: true,
        boxes: [r > 0 ? (r - 1) * cols + c : -1, r < rows ? r * cols + c : -1].filter(
          (i) => i >= 0,
        ),
      });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols; c++)
      edges.push({
        id: `V:${r}:${c}`,
        r,
        c,
        horizontal: false,
        boxes: [c > 0 ? r * cols + c - 1 : -1, c < cols ? r * cols + c : -1].filter((i) => i >= 0),
      });
  geometries.set(key, edges);
  return edges;
}
export function boxEdges(r: number, c: number) {
  return [`H:${r}:${c}`, `H:${r + 1}:${c}`, `V:${r}:${c}`, `V:${r}:${c + 1}`];
}
export function asDots(state: GameState): DotsState {
  if (state.game !== 'dots-boxes') throw new Error('Expected a Dots and Boxes position.');
  return state;
}
export function createDots(rows = 3, cols = 3): DotsState {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(cols) ||
    rows < 1 ||
    cols < 1 ||
    rows > 6 ||
    cols > 6
  )
    throw new Error('Board dimensions must be integers from 1 to 6.');
  return {
    game: 'dots-boxes',
    rows,
    cols,
    drawn: {},
    owners: Array(rows * cols).fill(null),
    player: 0,
    scores: [0, 0],
    ply: 0,
    turn: 0,
  };
}
export function legalDots(state: DotsState) {
  return state.player === null
    ? []
    : geometry(state.rows, state.cols)
        .filter((e) => state.drawn[e.id] === undefined)
        .map((e) => e.id);
}
export function dotsOutcome(state: DotsState): Outcome | null {
  return state.player === null
    ? {
        scores: [...state.scores],
        winner:
          state.scores[0] === state.scores[1] ? null : state.scores[0] > state.scores[1] ? 0 : 1,
        reason: 'Every box is claimed.',
      }
    : null;
}
export function applyDots(state: DotsState, action: string): Transition {
  const player = state.player;
  if (player === null) throw new Error('The game has finished.');
  const edge = geometry(state.rows, state.cols).find((e) => e.id === action);
  if (!edge || state.drawn[action] !== undefined)
    throw new Error(`Illegal or occupied edge: ${action}`);
  const next: DotsState = {
    ...state,
    drawn: { ...state.drawn, [action]: player },
    owners: [...state.owners],
    scores: [...state.scores],
    ply: state.ply + 1,
  };
  const captured = edge.boxes.filter(
    (i) =>
      next.owners[i] === null &&
      boxEdges(Math.floor(i / state.cols), i % state.cols).every(
        (id) => next.drawn[id] !== undefined,
      ),
  );
  for (const box of captured) {
    next.owners[box] = player;
    next.scores[player]++;
  }
  const terminal = next.scores[0] + next.scores[1] === state.rows * state.cols;
  next.player = terminal ? null : captured.length ? player : ((1 - player) as Player);
  next.turn += !captured.length ? 1 : 0;
  return {
    state: next,
    captured,
    retained: captured.length > 0 && !terminal,
    outcome: dotsOutcome(next),
  };
}
export function assertDots(state: DotsState) {
  const valid = new Set(geometry(state.rows, state.cols).map((e) => e.id));
  if (Object.entries(state.drawn).some(([e, p]) => !valid.has(e) || ![-1, 0, 1].includes(p)))
    throw new Error('Invalid edge map.');
  if (state.owners.length !== state.rows * state.cols) throw new Error('Invalid box count.');
  for (let i = 0; i < state.owners.length; i++) {
    const full = boxEdges(Math.floor(i / state.cols), i % state.cols).every(
      (e) => state.drawn[e] !== undefined,
    );
    if (full !== (state.owners[i] !== null))
      throw new Error('Box ownership disagrees with drawn edges.');
  }
  for (const p of [0, 1])
    if (state.scores[p] !== state.owners.filter((o) => o === p).length)
      throw new Error('Score disagrees with ownership.');
  if ((state.player === null) !== state.owners.every((o) => o !== null))
    throw new Error('Terminal status disagrees with board.');
}
export const dots: GameDefinition = {
  id: 'dots-boxes',
  name: 'Dots & Boxes',
  version: '1',
  create: createDots,
  rules:
    'Play Dots and Boxes. A board size is measured in boxes. Draw exactly one unoccupied orthogonal edge per move. H:r:c joins dots (r,c) and (r,c+1); V:r:c joins (r,c) and (r+1,c). Coordinates are zero-based. Completing a box gives it to you; one edge can complete two boxes. After any capture you MUST move again unless the board is full. You may decline an available capture. A turn can contain multiple edge moves. The player with more boxes at the end wins; equal scores draw. Maximize your final box margin. Edges marked -1 were already present in the starting position.',
  legalActions: (s) => legalDots(asDots(s)),
  apply: (s, a) => applyDots(asDots(s), a),
  outcome: (s) => dotsOutcome(asDots(s)),
  observe: (s, player) => {
    const d = asDots(s);
    return {
      game: d.game,
      rows: d.rows,
      cols: d.cols,
      you: player,
      toMove: d.player,
      scores: d.scores,
      drawn: Object.keys(d.drawn).sort(),
      boxOwners: d.owners,
    };
  },
};
