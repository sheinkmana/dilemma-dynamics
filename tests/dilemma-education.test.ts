import test from 'node:test';
import assert from 'node:assert/strict';
import {
  continuationExample,
  continuationObservation,
  decisionInformation,
} from '../src/dilemma/education.js';
import { analyze } from '../src/dilemma/analysis.js';
import { ACTIONS, expectedImmediate, payoff, futureBound } from '../src/dilemma/spec.js';
import type { DilemmaConfig, Round } from '../src/dilemma/types.js';

const near = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('teaching values agree with independently summed contingent trajectories', () => {
  for (const delta of [0, 0.25, 0.5, 0.9, 0.95]) {
    for (const response of ['grim', 'unresponsive'] as const) {
      const example = continuationExample(delta, response);
      for (const action of ACTIONS) {
        let total = action === 'C' ? 3 : 5;
        // Directly sum stage payoffs from the disclosed paths, without the closed-form evaluator.
        const later = response === 'unresponsive' ? 5 : action === 'C' ? 3 : 1;
        for (let t = 1; t < 2000; t++) total += delta ** t * later;
        const branch = action === 'C' ? example.cooperate : example.defect;
        near(branch.total, total);
        near(branch.now + branch.future, branch.total);
      }
    }
  }
});

test('the cooperation threshold is conditional on the response, including boundary cases', () => {
  near(continuationExample(0.9, 'grim').cooperate.total, 30);
  near(continuationExample(0.9, 'grim').defect.total, 14);
  near(continuationExample(0.5, 'grim').difference, 0);
  assert(continuationExample(0.45, 'grim').difference < 0);
  assert(continuationExample(0.55, 'grim').difference > 0);
  for (const delta of [0, 0.5, 0.9, 0.95]) {
    near(continuationExample(delta, 'unresponsive').difference, -2);
    assert.equal(continuationExample(delta, 'unresponsive').threshold, null);
  }
  for (const delta of [-0.1, 1, NaN, Infinity])
    assert.throws(() => continuationExample(delta, 'grim'));
});

test('shared payoffs preserve dominance for either seat and the analyst expectation threshold', () => {
  for (const opponent of ACTIONS) {
    assert(payoff('D', opponent)[0] > payoff('C', opponent)[0]);
    assert(payoff(opponent, 'D')[1] > payoff(opponent, 'C')[1]);
  }
  for (const p of [0, 0.25, 0.5, 0.8, 1]) {
    near(expectedImmediate('D', p) - expectedImmediate('C', p), 1 + p);
    const a = analyze('C', 'D', { pOpponentC: p, futureIfC: 20, futureIfD: 16 }, 0.9);
    near(a.expectedC!, 3 * p + 0.9 * 20);
    near(a.expectedD!, 1 + 4 * p + 0.9 * 16);
  }
  const result = payoff('C', 'C');
  result[0] = 999;
  assert.deepEqual(payoff('C', 'C'), [3, 3]);
  // Preserve the existing exact prompt bound when consolidating the rules.
  assert.equal(futureBound({ horizon: { kind: 'geometric' } } as DilemmaConfig, 1), 50);
});

const rows: Pick<Round, 'index' | 'actions' | 'payoffs'>[] = [
  { index: 1, actions: ['C', 'C'], payoffs: [3, 3] },
  { index: 2, actions: ['D', 'C'], payoffs: [5, 0] },
  { index: 3, actions: ['D', 'D'], payoffs: [1, 1] },
];
test('decision information is invariant to current and later choices and later stopping', () => {
  const config = { horizon: { kind: 'geometric' as const } };
  const info = decisionInformation({ config, rounds: rows }, 2);
  assert.deepEqual(info.previousActions, ['C', 'C']);
  assert.equal(info.completedRounds, 1);
  assert.equal(info.knownFinalRound, false);
  assert.equal(info.continuation, 0.9);
  assert.deepEqual(info, decisionInformation({ config, rounds: rows.slice(0, 1) }, 2));
  assert.deepEqual(
    info,
    decisionInformation(
      { config, rounds: [rows[0], { index: 2, actions: ['C', 'D'], payoffs: [0, 5] }] },
      2,
    ),
  );
  assert.equal(decisionInformation({ config, rounds: rows }, 3).knownFinalRound, false);
  assert.match(
    continuationObservation({ config, rounds: rows }, { index: 3, continuation: 'geometric-stop' }),
    /Neither player knew/,
  );
});

test('announced finality and retrospective observations remain separate', () => {
  const history = { config: { horizon: { kind: 'fixed' as const, rounds: 3 } }, rounds: rows };
  assert.equal(decisionInformation(history, 2).knownFinalRound, false);
  assert.equal(decisionInformation(history, 2).continuation, 1);
  assert.equal(decisionInformation(history, 3).knownFinalRound, true);
  assert.equal(decisionInformation(history, 3).continuation, 0);
  assert.match(
    continuationObservation(history, { index: 2, continuation: 'continued' }),
    /round 3, A chose D and B chose D/,
  );
  assert.match(
    continuationObservation(history, { index: 3, continuation: 'fixed-final' }),
    /Both players knew/,
  );
  assert.match(
    continuationObservation(
      { ...history, rounds: rows.slice(0, 2) },
      { index: 2, continuation: 'continued' },
    ),
    /No later completed round/,
  );
});
