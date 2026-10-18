import type { GameId, GameState, Outcome, Player, Transition } from '../shared/types.js';
export interface GameDefinition {
  id: GameId;
  name: string;
  version: string;
  rules: string;
  create(rows: number, cols: number): GameState;
  legalActions(state: GameState): string[];
  apply(state: GameState, action: string): Transition;
  observe(state: GameState, player: Player): Record<string, unknown>;
  outcome(state: GameState): Outcome | null;
}
export function rng(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export function stableState(state: GameState): string {
  return JSON.stringify(
    state.game === 'dots-boxes'
      ? {
          ...state,
          drawn: Object.fromEntries(
            Object.entries(state.drawn).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }
      : state,
  );
}
