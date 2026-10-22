import type { Action, DilemmaConfig } from './types.js';

// Numeric rules shared by resolution, prompts, analysis, and the teaching views.
export const ACTIONS = ['C', 'D'] as const;
const CONTINUATION_RATIO = [9, 10] as const;
export const CONTINUATION_PROBABILITY = CONTINUATION_RATIO[0] / CONTINUATION_RATIO[1];
export const EXPECTED_GEOMETRIC_ROUNDS =
  CONTINUATION_RATIO[1] / (CONTINUATION_RATIO[1] - CONTINUATION_RATIO[0]);
export const PAYOFFS = Object.freeze({
  CC: Object.freeze([3, 3] as const),
  CD: Object.freeze([0, 5] as const),
  DC: Object.freeze([5, 0] as const),
  DD: Object.freeze([1, 1] as const),
});
export const MAX_ROUND_PAYOFF = Math.max(...Object.values(PAYOFFS).flat());

export function payoff(a: Action, b: Action): [number, number] {
  const points = PAYOFFS[`${a}${b}` as keyof typeof PAYOFFS];
  return [points[0], points[1]];
}

export function expectedImmediate(action: Action, pOpponentC: number): number {
  return pOpponentC * payoff(action, 'C')[0] + (1 - pOpponentC) * payoff(action, 'D')[0];
}

export function continuationWeight(config: Pick<DilemmaConfig, 'horizon'>, round: number): number {
  return config.horizon.kind === 'geometric'
    ? CONTINUATION_PROBABILITY
    : round < config.horizon.rounds
      ? 1
      : 0;
}

export function futureBound(config: Pick<DilemmaConfig, 'horizon'>, round: number): number {
  return config.horizon.kind === 'geometric'
    ? MAX_ROUND_PAYOFF * EXPECTED_GEOMETRIC_ROUNDS
    : MAX_ROUND_PAYOFF * Math.max(0, config.horizon.rounds - round);
}
