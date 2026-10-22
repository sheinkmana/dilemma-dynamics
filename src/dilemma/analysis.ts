import type { Action, DecisionAnalysis, DilemmaSession, Forecast } from './types.js';
import { expectedImmediate } from './spec.js';
export const ANALYSIS_VERSION = 'expected-points/1';
export function analyze(
  action: Action,
  opponent: Action,
  forecast: Forecast | null,
  delta: number,
): DecisionAnalysis {
  const immediateGain = (p: number) => expectedImmediate('D', p) - expectedImmediate('C', p);
  const gain: [number, number] = forecast
    ? [immediateGain(forecast.pOpponentC), immediateGain(forecast.pOpponentC)]
    : [Math.min(immediateGain(0), immediateGain(1)), Math.max(immediateGain(0), immediateGain(1))];
  const expectedC = forecast
    ? expectedImmediate('C', forecast.pOpponentC) + delta * forecast.futureIfC
    : null;
  const expectedD = forecast
    ? expectedImmediate('D', forecast.pOpponentC) + delta * forecast.futureIfD
    : null;
  const loss =
    expectedC === null || expectedD === null
      ? null
      : Math.max(0, Math.max(expectedC, expectedD) - (action === 'C' ? expectedC : expectedD));
  return {
    immediateGainFromD: gain,
    requiredFutureAdvantage: delta ? [gain[0] / delta, gain[1] / delta] : null,
    knownFinalRound: delta === 0,
    expectedC,
    expectedD,
    reportedLoss: loss !== null && loss < 1e-9 ? 0 : loss,
    brier: forecast ? (forecast.pOpponentC - Number(opponent === 'C')) ** 2 : null,
    finding:
      delta === 0
        ? action === 'C'
          ? 'Known final round: D strictly dominates C under the assigned points objective.'
          : 'Known final round: D maximises own points for either opponent action.'
        : forecast
          ? loss! > 1e-9
            ? 'Choice forgoes expected points according to the player’s own submitted forecasts.'
            : 'Choice is consistent with the player’s submitted forecasts; forecast accuracy is a separate question.'
          : action === 'C'
            ? 'Cooperation requires a sufficient future benefit. The player’s expectations were not elicited.'
            : 'Defection improves the immediate payoff. Its future consequences depend on the opponent’s responses.',
  };
}
export function sessionAnalysis(session: DilemmaSession) {
  return {
    version: ANALYSIS_VERSION,
    objective: 'Maximise expected own cumulative game points.',
    players: ([0, 1] as const).map((seat) => {
      const rows = session.rounds;
      const reports = rows.map((r) => r.analysis[seat]).filter((a) => a.reportedLoss !== null);
      const afterD = rows.slice(1).filter((_, i) => rows[i].actions[1 - seat] === 'D');
      return {
        name: session.config.players[seat].name,
        points: session.scores[seat],
        rounds: rows.length,
        cooperations: rows.filter((r) => r.actions[seat] === 'C').length,
        reportedDecisions: reports.length,
        consistentChoices: reports.filter((a) => a.reportedLoss === 0).length,
        meanReportedLoss: reports.length
          ? reports.reduce((s, a) => s + a.reportedLoss!, 0) / reports.length
          : null,
        meanBrier: reports.length
          ? reports.reduce((s, a) => s + a.brier!, 0) / reports.length
          : null,
        responsesAfterD: afterD.length,
        defectionsAfterD: afterD.filter((r) => r.actions[seat] === 'D').length,
        knownFinalDominanceViolations: rows.filter(
          (r) => r.analysis[seat].knownFinalRound && r.actions[seat] === 'C',
        ).length,
        knownFinalOpportunities: rows.filter((r) => r.analysis[seat].knownFinalRound).length,
      };
    }),
    outcomes: Object.fromEntries(
      ['CC', 'CD', 'DC', 'DD'].map((pair) => [
        pair,
        session.rounds.filter((r) => r.actions.join('') === pair).length,
      ]),
    ),
    note: 'Reported consistency is not verified internal rationality. Forecast errors and realised points are separate measures. No exact best response to an unspecified autonomous policy is claimed.',
  };
}
