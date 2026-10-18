import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDots, assertDots, createDots, geometry, legalDots } from '../src/games/dots-boxes.js';
import { components, evaluateDots, evaluateTic } from '../src/games/evaluate.js';
import { chains, loop, scenarioState } from '../src/games/scenarios.js';
import { createTic, applyTic, legalTic } from '../src/games/tic-tac-toe.js';
import { demonstrations, parseAction } from '../src/players/prompts.js';
import { rng } from '../src/engine/game.js';
import type { DotsState, TicState } from '../src/shared/types.js';
test('rules conserve scores, edges and turns across 300 seeded games', () => {
  for (let seed = 0; seed < 300; seed++) {
    let s = createDots(1 + (seed % 4), 1 + (seed % 3));
    const random = rng(seed);
    let edges = 0;
    while (s.player !== null) {
      const legal = legalDots(s),
        p = s.player,
        before = JSON.stringify(s),
        a = legal[Math.floor(random() * legal.length)],
        t = applyDots(s, a),
        next = t.state as DotsState;
      assert.equal(JSON.stringify(s), before);
      assert.equal(Object.keys(next.drawn).length, ++edges);
      assert.equal(next.scores[p] - s.scores[p], t.captured.length);
      assert.equal(next.scores[1 - p], s.scores[1 - p]);
      if (next.player !== null) assert.equal(next.player, t.captured.length ? p : 1 - p);
      assertDots(next);
      assert.throws(() => applyDots(next, a));
      s = next;
    }
    assert.equal(s.scores[0] + s.scores[1], s.rows * s.cols);
    assert.equal(edges, geometry(s.rows, s.cols).length);
  }
});
test('one edge can capture two boxes and a capture need not be taken', () => {
  let s = createDots(1, 2);
  for (const e of geometry(1, 2).filter((e) => e.id !== 'V:0:1')) s.drawn[e.id] = -1;
  const t = applyDots(s, 'V:0:1');
  assert.deepEqual(t.captured, [0, 1]);
  assert.deepEqual(t.state.scores, [2, 0]);
  assert.equal(t.state.player, null);
  s = scenarioState('handout', 'dots-boxes') as DotsState;
  assert.equal(applyDots(s, 'V:0:2').captured.length, 1);
  const handout = applyDots(s, 'V:0:3');
  assert.equal(handout.captured.length, 0);
  assert.equal(handout.state.player, 0);
  const e = evaluateDots(s, { maxMs: 5000 });
  assert.equal(e.status, 'exact');
  assert(e.optimalActions.includes('V:0:3'));
  assert(e.actionValues['V:0:3'] > e.actionValues['V:0:2']);
});
test('paper component recurrence agrees with independent edge minimax for all legal openings', () => {
  for (const s of [
    chains(1, 3),
    chains(1, 4),
    chains(2, 3),
    chains(2, 4),
    loop(2),
    loop(3),
    loop(4),
  ]) {
    const paper = evaluateDots(s),
      edges = evaluateDots(s, { components: false, maxMs: 10000, maxNodes: 2e6, maxEdges: 20 });
    assert.equal(paper.status, 'exact');
    assert.equal(edges.status, 'exact');
    assert.equal(paper.value, edges.value);
    assert.deepEqual(paper.actionValues, edges.actionValues);
  }
  assert.equal(components(createDots(3, 3)), null);
});
test('edge solver agrees with independent full-state recursion on every reachable 1×2 position', () => {
  const seen = new Map<string, number>();
  function brute(s: DotsState): number {
    if (s.player === null) return 0;
    const key = JSON.stringify(s);
    if (seen.has(key)) return seen.get(key)!;
    let value = -Infinity;
    for (const a of legalDots(s)) {
      const t = applyDots(s, a),
        n = t.state as DotsState,
        delta = t.captured.length;
      value = Math.max(value, delta ? delta + brute(n) : -brute(n));
    }
    seen.set(key, value);
    const e = evaluateDots(s, { components: false, maxMs: 5000 });
    assert.equal(e.value, value + s.scores[s.player] - s.scores[1 - s.player]);
    return value;
  }
  brute(createDots(1, 2));
  assert(seen.size > 1000);
});
test('tic-tac-toe solver never loses from the start against any legal opponent', () => {
  function visit(s: TicState) {
    if (s.player === null) {
      assert.notEqual(s.scores[1], 1);
      return;
    }
    const actions = s.player === 0 ? evaluateTic(s).optimalActions.slice(0, 1) : legalTic(s);
    for (const a of actions) visit(applyTic(s, a).state as TicState);
  }
  assert.equal(evaluateTic(createTic()).value, 0);
  visit(createTic());
});
test('practice demonstrations are valid and strict parsing rejects ambiguous actions', () => {
  for (const example of demonstrations('dots-boxes'))
    assert(example.legalActions.includes(example.response.action));
  assert.deepEqual(parseAction('ACTION: H:0:0\nTake a safe edge.', 'text', ['H:0:0']), {
    action: 'H:0:0',
    explanation: 'Take a safe edge.',
  });
  for (const raw of [
    'I choose H:0:0',
    'ACTION: H:0:0 and H:0:1',
    'ACTION: H:9:9',
    '```\nACTION: H:0:0\n```',
  ])
    assert.throws(() => parseAction(raw, 'text', ['H:0:0']));
  assert.throws(() =>
    parseAction('{"action":"H:0:0","explanation":"","other":1}', 'json_object', ['H:0:0']),
  );
});
