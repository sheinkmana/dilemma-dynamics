import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { analyze, sessionAnalysis } from '../src/dilemma/analysis.js';
import { observation, parseDecision } from '../src/dilemma/observations.js';
import { configSchema, continuationWeight, payoff } from '../src/dilemma/rules.js';
import { DilemmaRunner, draw } from '../src/server/dilemma-runner.js';
import { dilemmaHtml } from '../src/server/dilemma-export.js';
import { Runner } from '../src/server/runner.js';
import { Nebius } from '../src/server/provider.js';
import { Store } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { estimateReservation } from '../src/server/models.js';
import type { DilemmaConfig } from '../src/dilemma/types.js';
const nano = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
const superModel = 'nvidia/nemotron-3-super-120b-a12b';
function config(overrides: Partial<DilemmaConfig> = {}): DilemmaConfig {
  return configSchema.parse({
    players: [
      { kind: 'model', name: 'Model A', model: nano },
      { kind: 'model', name: 'Model B', model: superModel },
    ],
    horizon: { kind: 'fixed', rounds: 2 },
    delayMs: 0,
    ...overrides,
  });
}
function response(
  raw: string,
  { usage = true, reasoning = '', reasoningTokens = 0, finish = 'stop' } = {},
) {
  const events = [
    { choices: [{ delta: { content: raw, reasoning_content: reasoning } }] },
    { choices: [{ delta: {}, finish_reason: finish }] },
    ...(usage
      ? [
          {
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              completion_tokens_details: { reasoning_tokens: reasoningTokens },
            },
          },
        ]
      : []),
  ];
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n',
  );
}
function mock(choose: (n: number, body: any, signal: AbortSignal) => Response | Promise<Response>) {
  let calls = 0;
  const requests: any[] = [];
  const provider = new Nebius('https://example.test/v1/', 'private-test-key', (async (
    url,
    options,
  ) => {
    if (String(url).endsWith('models'))
      return Response.json({ data: [{ id: nano }, { id: superModel }] });
    const body = JSON.parse(String(options?.body));
    requests.push(body);
    return choose(++calls, body, options?.signal as AbortSignal);
  }) as typeof fetch);
  return { provider, requests, count: () => calls };
}
async function setup(choose: Parameters<typeof mock>[0], store = new Store(':memory:')) {
  const remote = mock(choose),
    board = new Runner(store, remote.provider),
    runner = new DilemmaRunner(board);
  await board.discover();
  return { store, board, runner, remote };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test('Dilemma payoff, perspective and mode contracts are explicit', () => {
  assert.deepEqual(payoff('C', 'C'), [3, 3]);
  assert.deepEqual(payoff('C', 'D'), [0, 5]);
  assert.deepEqual(payoff('D', 'C'), [5, 0]);
  assert.deepEqual(payoff('D', 'D'), [1, 1]);
  assert.throws(() => config({ mode: 'demo' }));
  assert.throws(() =>
    config({
      players: [{ kind: 'demo-random', name: 'Not a model', model: '' }, config().players[1]],
    }),
  );
  assert.equal(continuationWeight(config(), 2), 0);
  assert.equal(continuationWeight(config({ horizon: { kind: 'geometric' } }), 200), 0.9);
});
test('incentive analysis separates payoff, declared consistency and forecast errors', () => {
  const f = { pOpponentC: 0.8, futureIfC: 20, futureIfD: 16 };
  const a = analyze('C', 'D', f, 0.9);
  assert(Math.abs(a.expectedC! - 20.4) < 1e-12);
  assert(Math.abs(a.expectedD! - 18.6) < 1e-12);
  assert.equal(a.reportedLoss, 0);
  assert(Math.abs(a.brier! - 0.64) < 1e-12);
  assert(Math.abs(analyze('D', 'C', f, 0.9).reportedLoss! - 1.8) < 1e-12);
  const passive = analyze('C', 'D', null, 0.9);
  assert.deepEqual(passive.immediateGainFromD, [1, 2]);
  assert.deepEqual(passive.requiredFutureAdvantage, [1 / 0.9, 2 / 0.9]);
  assert.equal(passive.expectedC, null);
  assert.equal(passive.brier, null);
  assert.equal(analyze('C', 'C', null, 0).knownFinalRound, true);
});
test('strict packets normalise label inversions and reject unbounded or extra output', () => {
  const c = config({ protocol: 'forecasts', horizon: { kind: 'geometric' } });
  const packet = 'ACTION: X\nP_OPP_X: 0.8\nFUTURE_X: 20\nFUTURE_Y: 16';
  assert.deepEqual(parseDecision(packet, c, 1), {
    action: 'C',
    forecast: { pOpponentC: 0.8, futureIfC: 20, futureIfD: 16 },
  });
  const inverse = parseDecision(packet, { ...c, mapping: 'X=D' }, 1);
  assert.equal(inverse.action, 'D');
  assert(Math.abs(inverse.forecast!.pOpponentC - 0.2) < 1e-12);
  assert.equal(inverse.forecast!.futureIfC, 16);
  assert.equal(inverse.forecast!.futureIfD, 20);
  for (const invalid of [
    packet + '\nAn explanation',
    packet.replace('0.8', '1.2'),
    packet.replace('20', '51'),
    packet.replace('20', 'Infinity'),
  ])
    assert.throws(() => parseDecision(invalid, c, 1));
  assert.throws(() => parseDecision(packet, { ...c, horizon: { kind: 'fixed', rounds: 1 } }, 1));
  assert.throws(() => parseDecision('ACTION: X\nACTION: Y', config(), 1));
});
test('joint barrier keeps choices, forecasts and seeds out of every public snapshot and export', async () => {
  const second = deferred<Response>(),
    sealed = deferred<void>();
  const { runner, store, board, remote } = await setup((n) =>
    n === 1 ? response('ACTION: X\nP_OPP_X: 0.812345\nFUTURE_X: 20\nFUTURE_Y: 16') : second.promise,
  );
  const s = runner.create(config({ protocol: 'forecasts', horizon: { kind: 'geometric' } }));
  runner.on(s.id, (next) => {
    if (next.received[0] && !next.received[1]) sealed.resolve();
  });
  const run = runner.start(s.id, true);
  await sealed.promise;
  assert.equal(remote.count(), 2);
  assert.equal(store.pendingDilemma(s.id)!.sealed[0]!.decision.action, 'C');
  const visible = runner.get(s.id);
  assert.deepEqual(visible.scores, [0, 0]);
  assert.equal(visible.rounds.length, 0);
  assert.equal('environmentSeed' in visible, false);
  assert.equal('raw' in runner.audit(s.id)[0], false);
  assert.deepEqual(JSON.parse(remote.requests[1].messages[1].content).completedHistory, []);
  const app = await createApp(board);
  for (const path of ['', '/analysis', '/audit', '/export/json', '/export/jsonl', '/export/html']) {
    const result = await app.inject({
      url: `/api/dilemma/sessions/${s.id}${path}`,
      headers: { host: '127.0.0.1:4317' },
    });
    assert.equal(result.statusCode, 200);
    assert(!result.body.includes('0.812345'), path);
    assert(!result.body.includes(store.getDilemma(s.id).environmentSeed), path);
    assert(!result.body.includes('ACTION: X'), path);
  }
  second.resolve(response('ACTION: Y\nP_OPP_X: 0.5\nFUTURE_X: 10\nFUTURE_Y: 10'));
  await run;
  const after = runner.get(s.id);
  assert.equal(after.rounds.length, 1);
  assert.deepEqual(after.scores, [0, 5]);
  assert.equal('raw' in runner.audit(s.id)[0], true);
  assert.equal(after.rounds[0].forecasts[0]!.pOpponentC, 0.812345);
  await app.close();
  store.close();
});
test('pause and duplicate starts commit one whole round and observations exclude analysis', async () => {
  const gate = deferred<Response>(),
    arrived = deferred<void>();
  const { store, runner, remote } = await setup((n) => {
    if (n === 2) {
      arrived.resolve();
      return gate.promise;
    }
    return response(n === 1 ? 'ACTION: X' : 'ACTION: Y');
  });
  const s = runner.create(config());
  const a = runner.start(s.id),
    b = runner.start(s.id);
  assert.equal(a, b);
  await arrived.promise;
  runner.pause(s.id);
  gate.resolve(response('ACTION: Y'));
  await a;
  assert.equal(runner.get(s.id).status, 'paused');
  assert.equal(runner.get(s.id).rounds.length, 1);
  assert.equal(remote.count(), 2);
  const before = runner.get(s.id),
    message = observation(before, 1);
  const content = JSON.parse(message[1].content);
  assert.deepEqual(content.points, { own: 5, opponent: 0 });
  assert.deepEqual(content.completedHistory[0], {
    round: 1,
    own: 'Y',
    opponent: 'X',
    points: [5, 0],
  });
  assert(!JSON.stringify(message).includes('reportedLoss'));
  await runner.start(s.id, true);
  assert.equal(runner.get(s.id).status, 'completed');
  assert.equal(remote.count(), 4);
  assert.equal(runner.get(s.id).rounds[1].analysis[0].knownFinalRound, true);
  store.close();
});
test('whole-pair reservation prevents one-sided spend and shares the existing global ledger', async () => {
  const store = new Store(':memory:');
  const { runner, remote, board } = await setup(() => response('ACTION: X'), store);
  const s = runner.create(config());
  const reservations = s.config.players.map((p, i) =>
    estimateReservation(
      { messages: observation(s, i as 0 | 1), max_tokens: 128 },
      board.models().find((m) => m.id === p.model)!,
    ),
  );
  store.setSetting('cap', Math.max(...reservations) + Math.min(...reservations) / 2);
  await runner.start(s.id, true);
  assert.equal(runner.get(s.id).status, 'budget');
  assert.equal(remote.count(), 0);
  assert.equal(store.dilemmaAttempts(s.id).length, 0);
  assert.equal(store.ledger().spent, 0);
  store.setSetting('cap', 5);
  const next = runner.create(config({ horizon: { kind: 'fixed', rounds: 1 } }));
  await runner.start(next.id);
  assert.equal(runner.get(next.id).status, 'completed');
  assert.equal(store.ledger().spent, runner.get(next.id).spentUsd);
  assert(store.ledger().spent > 0);
  assert.equal(store.ledger().reserved, 0);
  store.close();
});
test('invalid output stops without repairs or invented points; partner costs still settle', async () => {
  const { runner, store, remote } = await setup((n) =>
    response(n === 1 ? 'I will cooperate' : 'ACTION: Y'),
  );
  const s = runner.create(config());
  await runner.start(s.id);
  const result = runner.get(s.id);
  assert.equal(result.status, 'invalid');
  assert.equal(result.endReason, 'protocol');
  assert.deepEqual(result.scores, [0, 0]);
  assert.equal(result.rounds.length, 0);
  assert.equal(result.invalidAttempts, 1);
  assert.equal(remote.count(), 2);
  assert(result.spentUsd > 0);
  assert.equal(store.ledger().reserved, 0);
  assert.throws(() => runner.start(s.id));
  store.close();
});
test('stop discards late choices and retains conservative charges with missing usage', async () => {
  const gate = deferred<Response>(),
    arrived = deferred<void>();
  const { runner, store } = await setup((n) => {
    if (n === 2) arrived.resolve();
    return gate.promise;
  });
  const s = runner.create(config());
  const run = runner.start(s.id);
  await arrived.promise;
  runner.stop(s.id);
  gate.resolve(response('ACTION: X', { usage: false }));
  await run;
  const result = runner.get(s.id);
  assert.equal(result.status, 'stopped');
  assert.equal(result.rounds.length, 0);
  assert.deepEqual(result.scores, [0, 0]);
  assert(result.spentUsd > 0);
  assert.equal(store.ledger().reserved, 0);
  assert(
    store
      .dilemmaAttempts(s.id)
      .every((a) => a.outcome === 'cancelled' && a.costKind === 'upper-bound'),
  );
  store.close();
});
test('transport failure and restart preserve a valid sealed response without resampling it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dilemma-recovery-')),
    file = join(dir, 'test.sqlite');
  let store = new Store(file);
  try {
    const first = await setup(
      (n) => (n === 1 ? response('ACTION: X') : new Response('', { status: 429 })),
      store,
    );
    const s = first.runner.create(config());
    await first.runner.start(s.id, true);
    assert.equal(first.runner.get(s.id).status, 'interrupted');
    assert.equal(store.pendingDilemma(s.id)!.sealed[0]!.decision.action, 'C');
    const accepted = store.pendingDilemma(s.id)!.sealed[0]!.attemptId;
    store.close();
    store = new Store(file);
    const second = await setup(() => response('ACTION: Y'), store);
    await second.runner.start(s.id, true);
    assert.equal(second.remote.count(), 1);
    const recovered = second.runner.get(s.id);
    assert.equal(recovered.rounds.length, 1);
    assert.deepEqual(recovered.scores, [0, 5]);
    assert.equal(recovered.rounds[0].attemptIds[0], accepted);
    assert.equal(recovered.attempts, 3);
    assert.equal(recovered.rounds[0].costUsd, recovered.spentUsd);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('restart after both sealed choices commits once with no further inference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dilemma-barrier-')),
    file = join(dir, 'test.sqlite');
  let store = new Store(file);
  try {
    const first = await setup(() => response('ACTION: X'), store);
    const s = first.runner.create(config());
    (first.runner as unknown as { commit: () => void }).commit = () => {
      throw new Error('Simulated crash before commit');
    };
    await first.runner.start(s.id, true);
    assert(store.pendingDilemma(s.id)!.sealed.every(Boolean));
    const interrupted = store.getDilemma(s.id);
    interrupted.status = 'running';
    store.saveDilemma(interrupted);
    store.close();
    store = new Store(file);
    assert.equal(store.getDilemma(s.id).status, 'interrupted');
    const second = await setup(() => response('ACTION: Y'), store);
    await second.runner.start(s.id, true);
    assert.equal(second.remote.count(), 0);
    assert.equal(second.runner.get(s.id).rounds.length, 1);
    assert.deepEqual(second.runner.get(s.id).scores, [3, 3]);
    await second.runner.start(s.id, true);
    assert.equal(second.runner.get(s.id).rounds.length, 2);
    assert.equal(second.remote.count(), 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('startup honours a recorded protocol failure even if the final status was not saved', async () => {
  const { runner, store } = await setup((n) => response(n === 1 ? 'bad' : 'ACTION: X'));
  const s = runner.create(config());
  await runner.start(s.id);
  const stale = store.getDilemma(s.id);
  stale.status = 'running';
  store.saveDilemma(stale);
  store.recover();
  assert.equal(runner.get(s.id).status, 'invalid');
  assert.throws(() => runner.start(s.id));
  store.close();
});
test('both exposed reasoning and reported reasoning tokens interrupt without applying choices', async () => {
  for (const options of [{ reasoning: 'Unexpected trace' }, { reasoningTokens: 12 }]) {
    const { runner, store } = await setup((n) => response('ACTION: X', n === 1 ? options : {}));
    const s = runner.create(config());
    await runner.start(s.id);
    assert.equal(runner.get(s.id).status, 'interrupted');
    assert.equal(runner.get(s.id).rounds.length, 0);
    assert.equal(runner.get(s.id).invalidAttempts, 0);
    assert.equal(store.ledger().reserved, 0);
    store.close();
  }
});
test('geometric last realised round is not retrospectively treated as a known final round', async () => {
  const { runner, store } = await setup(() => response('ACTION: X'));
  const s = runner.create(config({ horizon: { kind: 'geometric' } }));
  const stored = store.getDilemma(s.id);
  let seed = 0;
  while (draw(String(seed), 'stop', 1) < 0.9) seed++;
  stored.environmentSeed = String(seed);
  store.saveDilemma(stored);
  await runner.start(s.id);
  const result = runner.get(s.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.rounds.length, 1);
  assert.equal(result.endReason, 'geometric-stop');
  assert.equal(result.rounds[0].analysis[0].knownFinalRound, false);
  assert.equal(sessionAnalysis(result).players[0].knownFinalDominanceViolations, 0);
  store.close();
});
test('creation keys are idempotent and fixed final round forecasts must have zero future value', async () => {
  const { runner, store, remote } = await setup(() =>
    response('ACTION: X\nP_OPP_X: 0.8\nFUTURE_X: 0\nFUTURE_Y: 0'),
  );
  const c = config({ protocol: 'forecasts', horizon: { kind: 'fixed', rounds: 1 } }),
    key = randomUUID();
  const s = runner.create(c, key);
  assert.equal(runner.create(c, key).id, s.id);
  assert.throws(() => runner.create({ ...c, mapping: 'X=D' }, key));
  await runner.start(s.id);
  const report = sessionAnalysis(runner.get(s.id));
  assert.equal(remote.count(), 2);
  assert.equal(report.players[0].knownFinalDominanceViolations, 1);
  assert.equal(report.players[0].reportedDecisions, 1);
  assert.equal(report.players[0].consistentChoices, 0);
  assert(report.players[0].meanBrier! > 0);
  store.close();
});
test('local demonstrations stay explicitly local, persist, and export escaped offline data', async () => {
  const { runner, store, remote, board } = await setup(() => {
    throw new Error('Demo must not call a model');
  });
  const c = config({
    mode: 'demo',
    players: [
      { kind: 'demo-random', name: '</script><script>unsafe()</script>', model: '' },
      { kind: 'demo-reciprocal', name: 'Local demo', model: '' },
    ],
    horizon: { kind: 'fixed', rounds: 10 },
  });
  const s = runner.create(c);
  await runner.start(s.id);
  const result = runner.get(s.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.rounds.length, 10);
  assert.equal(remote.count(), 0);
  assert.equal(result.spentUsd, 0);
  assert.deepEqual(
    result.scores,
    result.rounds.reduce(
      (scores, r) => [scores[0] + r.payoffs[0], scores[1] + r.payoffs[1]],
      [0, 0],
    ),
  );
  const html = dilemmaHtml(result);
  assert(!html.includes('</script><script>unsafe()'));
  assert(html.includes('\\u003c/script>'));
  assert(!/fetch\(/.test(html));
  const app = await createApp(board);
  const missing = await app.inject({
    method: 'POST',
    url: '/api/dilemma/sessions',
    headers: { host: '127.0.0.1:4317' },
    payload: { config: c, creationKey: randomUUID() },
  });
  assert.equal(missing.statusCode, 403);
  const json = await app.inject({
    url: `/api/dilemma/sessions/${s.id}/export/json`,
    headers: { host: '127.0.0.1:4317' },
  });
  assert.equal(json.statusCode, 200);
  assert.equal(json.json().randomness.seed, store.getDilemma(s.id).environmentSeed);
  await app.close();
  store.close();
});

test('the real event stream reveals both decisions together and never streams private tokens', async () => {
  const gate = deferred<Response>(),
    firstSealed = deferred<void>();
  const { store, board } = await setup((n) => (n === 1 ? response('ACTION: X') : gate.promise));
  const app = await createApp(board, { port: 0 });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const host = { host: '127.0.0.1:0' };
  const h = (await app.inject({ url: '/api/health', headers: host })).json();
  const headers = { ...host, 'x-gamefield-token': h.token };
  const created = (
    await app.inject({
      method: 'POST',
      url: '/api/dilemma/sessions',
      headers,
      payload: {
        creationKey: randomUUID(),
        config: config({ horizon: { kind: 'fixed', rounds: 1 } }),
      },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/dilemma/sessions/${created.id}/start`, headers });
  for (let i = 0; i < 100; i++) {
    if (store.getDilemma(created.id).received[0]) {
      firstSealed.resolve();
      break;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await Promise.race([
    firstSealed.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('First choice did not arrive')), 1000).unref(),
    ),
  ]);
  const abort = new AbortController();
  const stream = await new Promise<IncomingMessage>((resolve, reject) => {
    httpGet(
      `http://127.0.0.1:${port}/api/dilemma/sessions/${created.id}/events`,
      {
        headers: host,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
      },
      resolve,
    ).on('error', reject);
  });
  const reader = stream[Symbol.asyncIterator]();
  try {
    let text = '';
    while (!text.includes('\n\n')) {
      const chunk = await reader.next();
      if (chunk.done) break;
      text += chunk.value.toString();
    }
    assert.equal(stream.statusCode, 200, text);
    assert(!text.includes('ACTION: X'));
    assert(!text.includes('environmentSeed'));
    assert(text.includes('"received":[true,false]'));
    assert(text.includes('"rounds":[]'));
    gate.resolve(response('ACTION: Y'));
    const end = Date.now() + 3000;
    while (!text.includes('"status":"completed"') && Date.now() < end) {
      const chunk = await reader.next();
      if (chunk.done) break;
      text += chunk.value.toString();
    }
    assert(text.includes('"status":"completed"'));
    assert(text.includes('"actions":["C","D"]'));
    assert(!text.includes('ACTION: X'));
    assert.deepEqual(store.getDilemma(created.id).scores, [0, 5]);
  } finally {
    gate.resolve(response('ACTION: Y'));
    abort.abort();
    stream.destroy();
    await app.close();
    store.close();
  }
});

test('app shutdown cancels both Dilemma decisions and settles their reservations', async () => {
  const arrived = deferred<void>();
  const { store, board } = await setup(
    (n, _body, signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        if (n === 2) arrived.resolve();
      }),
  );
  const app = await createApp(board);
  const host = { host: '127.0.0.1:4317' };
  const h = (await app.inject({ url: '/api/health', headers: host })).json();
  const headers = { ...host, 'x-gamefield-token': h.token };
  const s = (
    await app.inject({
      method: 'POST',
      url: '/api/dilemma/sessions',
      headers,
      payload: { creationKey: randomUUID(), config: config() },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/dilemma/sessions/${s.id}/start`, headers });
  await arrived.promise;
  await app.close();
  assert.equal(store.getDilemma(s.id).status, 'stopped');
  assert.equal(store.getDilemma(s.id).rounds.length, 0);
  assert.equal(store.ledger().reserved, 0);
  assert(store.ledger().spent > 0);
  assert(store.dilemmaAttempts(s.id).every((a) => a.outcome === 'cancelled'));
  store.close();
});

test('reserved decisions use their frozen prices even if discovery changes in flight', async () => {
  const { runner, store, board } = await setup(() => response('ACTION: X'));
  const s = runner.create(config({ horizon: { kind: 'fixed', rounds: 1 } }));
  runner.on(s.id, (next) => {
    if (next.reservedUsd > 0) board.models = () => [];
  });
  await runner.start(s.id);
  assert.equal(runner.get(s.id).status, 'completed');
  assert.equal(runner.get(s.id).invalidAttempts, 0);
  assert.equal(store.ledger().reserved, 0);
  const attempts = store.dilemmaAttempts(s.id);
  assert.equal(attempts[0].costUsd, (100 * 0.06 + 20 * 0.24) / 1e6);
  assert.equal(attempts[1].costUsd, (100 * 0.3 + 20 * 0.9) / 1e6);
  store.close();
});
