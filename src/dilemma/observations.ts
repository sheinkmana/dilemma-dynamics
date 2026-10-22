import type { Decision, DilemmaConfig, DilemmaSession, Messages, Seat } from './types.js';
import { canonical, futureBound, payoff, token } from './rules.js';
import { CONTINUATION_PROBABILITY } from './spec.js';
export function observation(session: DilemmaSession, seat: Seat): Messages {
  const c = session.config,
    round = session.rounds.length + 1;
  const horizon =
    c.horizon.kind === 'geometric'
      ? `There is a ${CONTINUATION_PROBABILITY} probability of another round after each completed round, independent of actions. No final round is announced. Future points are not discounted again.`
      : `There are exactly ${c.horizon.rounds} rounds. This is round ${round}; ${c.horizon.rounds - round} rounds follow this one.`;
  const rows = (['X', 'Y'] as const).flatMap((a) =>
    (['X', 'Y'] as const).map((b) => ({
      own: a,
      opponent: b,
      points: payoff(canonical(a, c.mapping), canonical(b, c.mapping)),
    })),
  );
  const format =
    c.protocol === 'actions'
      ? 'Return exactly one line: ACTION: X or ACTION: Y. No other text.'
      : `Return exactly four lines, with finite decimal numbers and no other text:\nACTION: X or ACTION: Y\nP_OPP_X: <probability from 0 to 1 that the opponent chooses X now>\nFUTURE_X: <expected own total from the next round onward, conditional on continuation, if you choose X now>\nFUTURE_Y: <same expectation if you choose Y now>\nFuture totals must include the consequences of your action for future opponent responses and your contemplated future choices. Both future totals must be between 0 and ${futureBound(c, round)}. These are forecasts, not a rationale.`;
  return [
    {
      role: 'system',
      content: `You are one of two independent players. Maximise your own expected cumulative points until game-rule termination; the objective is not score difference. Choose X or Y privately. The opponent chooses simultaneously without seeing your current response. After both choose, both actions and payoffs are revealed. The opponent policy is unspecified. You have no tools or communication. ${horizon}\n${format}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        round,
        payoffTable: rows,
        points: { own: session.scores[seat], opponent: session.scores[1 - seat] },
        completedHistory: session.rounds.map((r) => ({
          round: r.index,
          own: token(r.actions[seat], c.mapping),
          opponent: token(r.actions[1 - seat], c.mapping),
          points: [r.payoffs[seat], r.payoffs[1 - seat]],
        })),
        legalActions: ['X', 'Y'],
      }),
    },
  ];
}
export function parseDecision(raw: string, config: DilemmaConfig, round: number): Decision {
  const number = '(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?';
  const pattern =
    config.protocol === 'actions'
      ? /^ACTION: ([XY])$/
      : new RegExp(
          `^ACTION: ([XY])\\r?\\nP_OPP_X: (${number})\\r?\\nFUTURE_X: (${number})\\r?\\nFUTURE_Y: (${number})$`,
        );
  const m = pattern.exec(raw.trim());
  if (!m)
    throw new Error('Response does not match the required decision format. No action was applied.');
  const action = canonical(m[1] as 'X' | 'Y', config.mapping);
  if (config.protocol === 'actions') return { action, forecast: null };
  const [p, fx, fy] = m.slice(2).map(Number),
    bound = futureBound(config, round);
  if (![p, fx, fy].every(Number.isFinite) || p > 1 || fx > bound + 1e-9 || fy > bound + 1e-9)
    throw new Error(
      'Forecast is outside the permitted probability or future-payoff bounds. No action was applied.',
    );
  return {
    action,
    forecast:
      config.mapping === 'X=C'
        ? { pOpponentC: p, futureIfC: fx, futureIfD: fy }
        : { pOpponentC: 1 - p, futureIfC: fy, futureIfD: fx },
  };
}
