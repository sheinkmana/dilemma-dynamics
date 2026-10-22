import { CONTINUATION_PROBABILITY, continuationWeight, payoff } from './spec.js';
import type { DilemmaConfig, Round } from './types.js';

type TeachingHistory = {
  config: Pick<DilemmaConfig, 'horizon'>;
  rounds: Pick<Round, 'index' | 'actions' | 'payoffs'>[];
};

export type ResponseAssumption = 'grim' | 'unresponsive';

// Exact values for disclosed hypothetical continuations, never estimates of a live model.
export function continuationExample(delta: number, response: ResponseAssumption) {
  if (!Number.isFinite(delta) || delta < 0 || delta >= 1)
    throw new Error(
      'Continuation probability must be between zero (inclusive) and one (exclusive).',
    );
  const reward = payoff('C', 'C')[0];
  const temptation = payoff('D', 'C')[0];
  const punishment = payoff('D', 'D')[0];
  const futureC = (delta * (response === 'grim' ? reward : temptation)) / (1 - delta);
  const futureD = (delta * (response === 'grim' ? punishment : temptation)) / (1 - delta);
  const cooperate = { now: reward, future: futureC, total: reward + futureC };
  const defect = { now: temptation, future: futureD, total: temptation + futureD };
  return {
    cooperate,
    defect,
    difference: cooperate.total - defect.total,
    expectedRounds: 1 / (1 - delta),
    threshold: response === 'grim' ? (temptation - reward) / (temptation - punishment) : null,
  };
}

export function decisionInformation(session: TeachingHistory, index: number) {
  const before = session.rounds.filter((r) => r.index < index);
  const last = before.at(-1);
  return {
    completedRounds: before.length,
    previousActions: last ? [...last.actions] : null,
    continuation: continuationWeight(session.config, index),
    knownFinalRound:
      session.config.horizon.kind === 'fixed' && index === session.config.horizon.rounds,
    horizon:
      session.config.horizon.kind === 'geometric'
        ? `${CONTINUATION_PROBABILITY * 100}% chance of another round; no final round was announced.`
        : `${session.config.horizon.rounds - index} announced rounds would follow this choice.`,
  };
}

export function continuationObservation(
  session: TeachingHistory,
  round: Pick<Round, 'index' | 'continuation'>,
) {
  if (round.continuation === 'geometric-stop')
    return 'The stopping draw ended the interaction after this choice. Neither player knew this would be the last round.';
  if (round.continuation === 'fixed-final')
    return 'The announced final round ended the interaction. Both players knew there were no future points.';
  const next = session.rounds.find((r) => r.index === round.index + 1);
  if (!next)
    return 'No later completed round is recorded yet. The consequences of an alternative choice remain unknown.';
  return `In round ${next.index}, A chose ${next.actions[0]} and B chose ${next.actions[1]}, earning ${next.payoffs[0]} and ${next.payoffs[1]} points. This observation does not show what a different choice would have caused.`;
}
