import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/server/store.js';
import { Nebius, ProviderError } from '../src/server/provider.js';
import { gameFor } from '../src/games/registry.js';
import { Runner } from '../src/server/runner.js';
import { Experiments } from '../src/server/experiments.js';
import {
  actionOnlyConfig,
  defaultConfig as appDefaultConfig,
  simpleMatchConfig,
} from '../src/shared/config.js';
import { createApp } from '../src/server/app.js';
import { replayHtml } from '../src/server/export.js';
import type { AttemptRecord, MatchConfig } from '../src/shared/types.js';
const model = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
const defaultConfig = { ...appDefaultConfig, moveDelayMs: 0 };
function response(content: string, reasoning = 'because α', usage = true, finish = 'stop') {
  const events = [
    { choices: [{ delta: { reasoning_content: reasoning } }] },
    { choices: [{ delta: { content } }] },
    { choices: [{ delta: {}, finish_reason: finish }] },
    ...(usage
      ? [
          {
            choices: [],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 40,
              completion_tokens_details: { reasoning_tokens: reasoning ? 12 : 0 },
            },
          },
        ]
      : []),
  ];
  const bytes = new TextEncoder().encode(
    events.map((x) => `data: ${JSON.stringify(x)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n',
  );
  let at = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (at >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, at + 3));
        at += 3;
      },
    }),
    { headers: { 'x-request-id': 'test-request', 'Content-Type': 'text/event-stream' } },
  );
}
const configured = (): MatchConfig => ({
  ...structuredClone(defaultConfig),
  rows: 1,
  cols: 1,
  players: [
    { ...defaultConfig.players[0], kind: 'nebius', model, name: 'Mock Nano' },
    defaultConfig.players[1],
  ],
});
const mock = (
  choose: (n: number, body: any, signal: AbortSignal) => Promise<Response> | Response,
) => {
  let calls = 0;
  return new Nebius('https://example.test/v1/', 'test-secret', (async (url, options) =>
    String(url).endsWith('models')
      ? Response.json({ data: [{ id: model }] })
      : choose(
          ++calls,
          JSON.parse(String(options?.body)),
          options?.signal as AbortSignal,
        )) as typeof fetch);
};
const legalAction = (body: any) => {
  for (const msg of [...body.messages].reverse()) {
    try {
      const b = JSON.parse(msg.content);
      if (b.legalActions) return b.legalActions[0];
    } catch {}
  }
  return 'C:0:0';
};
test('simple game setup always uses short decisions without inherited experimental settings', () => {
  const legacy = configured();
  legacy.players[0].knowledge = 'examples';
  legacy.players[0].reasoning = 'on';
  legacy.players[0].maxTokens = 16384;
  legacy.players[0].temperature = 1.5;
  const original = structuredClone(legacy);
  for (const game of ['dots-boxes', 'tic-tac-toe'] as const) {
    const config = simpleMatchConfig(game, legacy.players);
    assert.equal(config.game, game);
    assert.equal(config.format, 'text');
    assert.equal(config.explanation, false);
    assert.equal(config.scenario, 'empty');
    assert.equal(config.maxMoves, undefined);
    assert.equal(config.moveDelayMs, 700);
    assert.equal(config.maxUsd, 0.05);
    for (const player of config.players) {
      assert.equal(player.reasoning, 'off');
      assert.equal(player.maxTokens, 128);
      assert.equal(player.knowledge, 'rules');
      assert.equal(player.temperature, 0);
    }
    assert.equal(config.players[0].model, legacy.players[0].model);
  }
  assert.deepEqual(legacy, original);
});
test('SSE parser preserves split UTF-8, reasoning, usage and request IDs', async () => {
  const provider = mock(() => response('ACTION: H:0:0\nA measured move.'));
  const c = await provider.complete({}, new AbortController().signal);
  assert.equal(c.reasoning, 'because α');
  assert.match(c.raw, /ACTION/);
  assert.equal(c.usage?.completionTokens, 40);
  assert.equal(c.usage?.reasoningTokens, 12);
  assert.equal(c.providerRequestId, 'test-request');
  assert(c.firstTokenMs !== null);
});
test('provider failures are explicit and retain partial output', async () => {
  const rate = mock(() => new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
  await assert.rejects(
    rate.complete({}, new AbortController().signal),
    (e: unknown) => e instanceof ProviderError && e.status === 429 && e.retryAfter === '2',
  );
  const truncated = mock(() => new Response('data: {"choices":[{"delta":{"content":"ACT"}}]}\n\n'));
  await assert.rejects(
    truncated.complete({}, new AbortController().signal),
    (e: unknown) => e instanceof ProviderError && e.partial.raw === 'ACT',
  );
});
test('runner repairs once, charges every attempt and is idempotent on concurrent start', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock((n, body) =>
        response(n === 1 ? 'not a legal response' : `ACTION: ${legalAction(body)}`),
      ),
    );
  await runner.discover();
  const m = runner.create(configured());
  const a = runner.start(m.id, true),
    b = runner.start(m.id, true);
  assert.equal(a, b);
  await a;
  const result = store.getMatch(m.id);
  assert.equal(result.moves.length, 1);
  assert.equal(result.invalidAttempts, 1);
  assert.equal(result.attempts, 2);
  assert.equal(result.status, 'paused');
  assert(result.spentUsd > 0);
  assert.equal(store.ledger().reserved, 0);
  store.close();
});
test('live pacing publishes each move before the next request and respects pause during the gap', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const runner = new Runner(
    store,
    mock((_n, body) => {
      calls++;
      return response(`ACTION: ${legalAction(body)}`);
    }),
  );
  await runner.discover();
  const m = runner.create({ ...configured(), moveDelayMs: 30 });
  const firstMove = new Promise<void>((resolve) => {
    runner.on(m.id, (event) => {
      if (event.type === 'snapshot' && event.match.moves.length === 1) resolve();
    });
  });
  const running = runner.start(m.id);
  await firstMove;
  assert.equal(store.getMatch(m.id).status, 'running');
  assert.equal(store.getMatch(m.id).moves.length, 1);
  assert.equal(calls, 1);
  runner.pause(m.id);
  await running;
  assert.equal(store.getMatch(m.id).status, 'paused');
  assert.equal(store.getMatch(m.id).moves.length, 1);
  assert.equal(calls, 1);
  await runner.start(m.id, true);
  assert.equal(store.getMatch(m.id).moves.length, 2);
  assert.equal(store.getMatch(m.id).status, 'paused');
  store.close();
});
test('stopping during a live pacing gap cancels the wait and never schedules the next move', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(store, new Nebius('https://example.test/v1/', ''));
  const m = runner.create({ ...defaultConfig, rows: 1, cols: 1, moveDelayMs: 5000 });
  const firstMove = new Promise<void>((resolve) => {
    runner.on(m.id, (event) => {
      if (event.type === 'snapshot' && event.match.moves.length === 1) resolve();
    });
  });
  const running = runner.start(m.id);
  await firstMove;
  runner.stop(m.id);
  await running;
  assert.equal(store.getMatch(m.id).status, 'stopped');
  assert.equal(store.getMatch(m.id).moves.length, 1);
  assert.equal(store.attempts(m.id).length, 1);
  store.close();
});
test('action-only preset completes a full remote game without probing or rationale output', async () => {
  const input = configured();
  input.rows = input.cols = 3;
  input.players[0].knowledge = 'examples';
  input.players[1] = { ...input.players[0], name: 'Second mock Nano' };
  const original = structuredClone(input);
  const config = actionOnlyConfig(input);
  assert.deepEqual(input, original);
  assert.equal(config.players[0].knowledge, 'examples');
  let calls = 0;
  const store = new Store(':memory:');
  const runner = new Runner(
    store,
    mock((_n, body) => {
      calls++;
      assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
      assert.equal(body.max_tokens, 128);
      assert.equal(body.response_format, undefined);
      assert.match(body.messages[0].content, /exactly one line/);
      for (const message of body.messages.filter((m: any) => m.role === 'assistant'))
        assert.match(message.content, /^ACTION: [HV]:\d+:\d+$/);
      return response(`ACTION: ${legalAction(body)}`, '');
    }),
  );
  await runner.discover();
  const m = runner.create(config);
  await runner.start(m.id);
  const result = store.getMatch(m.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.moves.length, 24);
  assert.equal(result.invalidAttempts, 0);
  assert.equal(calls, 24);
  assert.equal(result.state.scores[0] + result.state.scores[1], 9);
  assert(result.moves.every((m) => m.explanation === ''));
  assert(store.attempts(m.id).every((a) => a.reasoning === '' && a.outcome === 'accepted'));
  assert.equal(store.ledger().reserved, 0);
  store.close();
});
test('action-only mode corrects extra rationale without enabling reasoning', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(
    store,
    mock((n, body) => {
      assert.equal(body.chat_template_kwargs.enable_thinking, false);
      return response(`ACTION: ${legalAction(body)}${n === 1 ? '\nA safe move.' : ''}`, '');
    }),
  );
  await runner.discover();
  const m = runner.create(actionOnlyConfig(configured()));
  await runner.start(m.id, true);
  const result = store.getMatch(m.id);
  assert.equal(result.status, 'paused');
  assert.equal(result.moves.length, 1);
  assert.equal(result.invalidAttempts, 1);
  assert.equal(result.attempts, 2);
  assert.match(store.attempts(m.id)[0].error!, /no rationale/);
  store.close();
});
test('reasoning off interrupts without retry when a provider emits reasoning', async () => {
  const store = new Store(':memory:');
  let requestSignal: AbortSignal | undefined;
  const runner = new Runner(
    store,
    mock((_n, body, signal) => {
      requestSignal = signal;
      return response(`ACTION: ${legalAction(body)}`, 'unexpected thinking');
    }),
  );
  await runner.discover();
  const m = runner.create(actionOnlyConfig(configured()));
  await runner.start(m.id);
  const result = store.getMatch(m.id);
  assert.equal(result.status, 'interrupted');
  assert.equal(result.moves.length, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.invalidAttempts, 0);
  assert.equal(requestSignal?.aborted, true);
  assert.match(result.message, /despite reasoning off/);
  assert.equal(store.attempts(m.id)[0].outcome, 'error');
  assert(result.spentUsd > 0);
  assert.equal(store.ledger().reserved, 0);
  store.close();
});
test('reasoning off also detects reported reasoning tokens without an exposed trace', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(
    store,
    mock((_n, body) => {
      const events = [
        {
          choices: [{ delta: { content: `ACTION: ${legalAction(body)}` }, finish_reason: 'stop' }],
        },
        {
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            completion_tokens_details: { reasoning_tokens: 12 },
          },
        },
      ];
      return new Response(
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n',
      );
    }),
  );
  await runner.discover();
  const m = runner.create(actionOnlyConfig(configured()));
  await runner.start(m.id);
  assert.equal(store.getMatch(m.id).status, 'interrupted');
  assert.equal(store.getMatch(m.id).moves.length, 0);
  assert.equal(store.attempts(m.id).length, 1);
  assert.equal(store.attempts(m.id)[0].usage?.reasoningTokens, 12);
  assert.equal(store.ledger().reserved, 0);
  store.close();
});
test('invalid output forfeits, while transport failure interrupts without retry', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock(() => response('invalid')),
    );
  await runner.discover();
  let m = runner.create(configured());
  await runner.start(m.id);
  m = store.getMatch(m.id);
  assert.equal(m.status, 'forfeit');
  assert.equal(m.attempts, 2);
  assert.equal(m.moves.length, 0);
  store.close();
  const store2 = new Store(':memory:'),
    runner2 = new Runner(
      store2,
      mock(() => new Response('', { status: 429 })),
    );
  await runner2.discover();
  const n = runner2.create(configured());
  await runner2.start(n.id);
  assert.equal(store2.getMatch(n.id).status, 'interrupted');
  assert.equal(store2.attempts(n.id).length, 1);
  assert.equal(store2.attempts(n.id)[0].costKind, 'upper-bound');
  store2.close();
});
test('cancellation never applies a late move and conservatively settles missing usage', async () => {
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock(async (_n, body) => {
        await pending;
        return response(`ACTION: ${legalAction(body)}`, '', false);
      }),
    );
  await runner.discover();
  const m = runner.create(configured());
  const work = runner.start(m.id);
  runner.stop(m.id);
  release();
  await work;
  const final = store.getMatch(m.id);
  assert.equal(final.status, 'stopped');
  assert.equal(final.moves.length, 0);
  assert.equal(store.attempts(m.id)[0].outcome, 'cancelled');
  assert.equal(store.ledger().reserved, 0);
  assert(final.spentUsd > 0);
  store.close();
});
test('budget checks include concurrent reservations and recovery handles pending requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'game-field-test-')),
    file = join(dir, 'test.sqlite');
  let store = new Store(file, 0.01);
  const attempt = {
    id: 'a',
    matchId: null,
    outcome: 'pending',
    reservedUsd: 0.008,
    costUsd: 0,
    costKind: 'local',
  } as AttemptRecord;
  store.reserve(attempt);
  assert.throws(() => store.reserve({ ...attempt, id: 'b' }), /budget/);
  assert.throws(() => new Store(file), /already open/);
  store.close();
  store = new Store(file);
  assert.equal(store.ledger().reserved, 0);
  assert.equal(store.ledger().spent, 0.008);
  assert.equal(store.attempts()[0].outcome, 'error');
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
test('paired scheduler swaps contestants and preserves opening positions', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock(() => response('')),
    ),
    experiments = new Experiments(runner);
  const e = experiments.create({
    kind: 'paired',
    pairs: 3,
    maxUsd: 1,
    match: { ...defaultConfig, rows: 1, cols: 2, openingMoves: 2 },
  });
  for (let i = 0; i < e.tasks.length; i += 2) {
    const a = store.getMatch(e.tasks[i].matchId),
      b = store.getMatch(e.tasks[i + 1].matchId);
    assert.deepEqual(a.initialState, b.initialState);
    assert.deepEqual(a.config.players, [...b.config.players].reverse());
  }
  experiments.start(e.id);
  await experiments.idle();
  const report = experiments.report(e.id);
  assert.equal(report.experiment.status, 'completed');
  assert.equal(report.completePairs, 3);
  assert(report.pairedInterval);
  assert.equal(report.rows[0].completed, 6);
  store.close();
});
test('local HTTP API enforces host, origin and mutation token; export escapes scripts', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(store, new Nebius('https://example.test/v1/', ''));
  const app = await createApp(runner, { webRoot: '/nonexistent' });
  const headers = { host: '127.0.0.1:4317' };
  assert.equal(
    (await app.inject({ url: '/api/health', headers: { host: 'evil.test' } })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/health', headers: { ...headers, origin: 'https://evil.test' } }))
      .statusCode,
    403,
  );
  const health = (await app.inject({ url: '/api/health', headers })).json();
  assert.equal(health.keyConfigured, false);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/matches', headers, payload: defaultConfig }))
      .statusCode,
    403,
  );
  const created = await app.inject({
    method: 'POST',
    url: '/api/matches',
    headers: { ...headers, 'x-gamefield-token': health.token },
    payload: defaultConfig,
  });
  assert.equal(created.statusCode, 200);
  const m = created.json();
  m.config.players[0].name = '</script><script>bad()</script>';
  const html = replayHtml(m);
  assert(!html.includes('</script><script>bad'));
  assert(html.includes('\\u003c/script>'));
  assert(!JSON.stringify(m).includes('test-secret'));
  await app.close();
  store.close();
});

test('shutdown requires the local mutation token, acknowledges once, and blocks further mutations', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(store, new Nebius('https://example.test/v1/', ''));
  let calls = 0;
  let acknowledge!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const app = await createApp(runner, {
    webRoot: '/nonexistent',
    onShutdown: async () => {
      calls++;
      acknowledge();
    },
  });
  const headers = { host: '127.0.0.1:4317' };
  const health = (await app.inject({ url: '/api/health', headers })).json();
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/shutdown', headers })).statusCode,
    403,
  );
  const authorized = { ...headers, 'x-gamefield-token': health.token };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/shutdown',
        headers: { ...authorized, origin: 'https://evil.test' },
      })
    ).statusCode,
    403,
  );
  assert.equal(calls, 0);
  const result = await app.inject({ method: 'POST', url: '/api/shutdown', headers: authorized });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), { status: 'shutting-down' });
  await acknowledged;
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/shutdown', headers: authorized })).statusCode,
    200,
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/matches',
        headers: authorized,
        payload: defaultConfig,
      })
    ).statusCode,
    503,
  );
  await app.close();
  store.close();
});

test('shutdown cancels an active decision, preserves its charge, and closes live connections', async () => {
  const store = new Store(':memory:');
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const runner = new Runner(
    store,
    mock(
      (_n, _body, signal) =>
        new Promise<Response>((_resolve, reject) => {
          requested();
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    ),
  );
  await runner.discover();
  const app = await createApp(runner, { webRoot: '/nonexistent' });
  let closed!: () => void;
  const serverClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  app.addHook('onClose', async () => {
    closed();
  });
  const headers = { host: '127.0.0.1:4317' };
  const health = (await app.inject({ url: '/api/health', headers })).json();
  const m = runner.create(configured());
  const running = runner.start(m.id);
  await requestStarted;
  const response = await app.inject({
    method: 'POST',
    url: '/api/shutdown',
    headers: { ...headers, 'x-gamefield-token': health.token },
  });
  assert.equal(response.statusCode, 200);
  await serverClosed;
  await running;
  assert.equal(store.getMatch(m.id).status, 'stopped');
  assert.equal(store.getMatch(m.id).moves.length, 0);
  assert.equal(store.attempts(m.id)[0].outcome, 'cancelled');
  assert.equal(store.attempts(m.id)[0].costKind, 'upper-bound');
  assert.equal(store.ledger().reserved, 0);
  assert(store.ledger().spent > 0);
  store.close();
});

test('pause waits for the current decision and resume never repeats its accepted action', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new Store(':memory:');
  const runner = new Runner(
    store,
    mock(async (_n, body) => {
      await pending;
      return response(`ACTION: ${legalAction(body)}`);
    }),
  );
  await runner.discover();
  const match = runner.create(configured());
  const work = runner.start(match.id);
  runner.pause(match.id);
  assert.equal(store.getMatch(match.id).status, 'running');
  release();
  await work;
  const paused = store.getMatch(match.id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.moves.length, 1);
  await runner.start(match.id);
  const done = store.getMatch(match.id);
  assert.equal(done.status, 'completed');
  assert.equal(new Set(done.moves.map((m) => m.action)).size, 4);
  assert(done.lastEventId > paused.lastEventId);
  store.close();
});

test('held-out comparisons make one decision per contestant and retain exact coverage', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock(() => response('')),
    ),
    experiments = new Experiments(runner);
  const comparison = experiments.create({
    kind: 'positions',
    pairs: 1,
    maxUsd: 1,
    match: defaultConfig,
  });
  experiments.start(comparison.id);
  await experiments.idle();
  const report = experiments.report(comparison.id);
  assert.equal(report.experiment.status, 'completed');
  assert.equal(report.matches.length, 8);
  for (const match of report.matches) {
    assert.equal(match.moves.length, 1);
    assert.equal(match.outcome, null);
  }
  for (const row of report.rows) {
    assert.equal(row.exact, 4);
    assert.equal(row.attempts, 4);
    assert.equal(row.completed, 0);
  }
  store.close();
});

test('reasoning on requires observed traces, and a probe is fully accounted', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(
    store,
    mock((_n, body) =>
      response(
        JSON.stringify({ action: 'C:0:0', explanation: 'Only legal move.' }),
        body.chat_template_kwargs?.enable_thinking ? 'exposed reasoning' : '',
      ),
    ),
  );
  await runner.discover();
  const input = configured();
  input.players[0].reasoning = 'on';
  assert.throws(() => runner.create(input), /capability check/);
  const caps = await runner.probe(model);
  assert.equal(caps.reasoningControl, 'observed');
  assert(caps.json && caps.schema && caps.usage);
  assert.equal(store.attempts().length, 3);
  assert(store.ledger().spent > 0);
  assert.equal(store.ledger().reserved, 0);
  assert.doesNotThrow(() => runner.create(input));
  store.close();
});

test('a truncated final answer cannot apply a move even when the prefix is legal', async () => {
  const store = new Store(':memory:'),
    runner = new Runner(
      store,
      mock((_n, body) => response(`ACTION: ${legalAction(body)}`, '', true, 'length')),
    );
  await runner.discover();
  const m = runner.create({ ...configured(), repairAttempts: 0 });
  await runner.start(m.id);
  assert.equal(store.getMatch(m.id).moves.length, 0);
  assert.equal(store.getMatch(m.id).status, 'forfeit');
  assert.match(store.attempts(m.id)[0].error!, /token limit/);
  store.close();
});

test('restart preserves completed match snapshots and stable library ordering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'game-field-order-')),
    file = join(dir, 'test.sqlite');
  let store = new Store(file);
  const runner = new Runner(
    store,
    mock(() => response('')),
  );
  const older = runner.create({ ...defaultConfig, rows: 1, cols: 1 });
  older.createdAt = '2026-01-01T00:00:00Z';
  store.saveMatch(older);
  await runner.start(older.id);
  const newer = runner.create({ ...defaultConfig, rows: 1, cols: 1 });
  newer.createdAt = '2026-01-02T00:00:00Z';
  store.saveMatch(newer);
  const saved = store.getMatch(older.id);
  const order = store.matches().map((m) => m.id);
  store.close();
  store = new Store(file);
  assert.deepEqual(
    store.matches().map((m) => m.id),
    order,
  );
  assert.deepEqual(store.getMatch(older.id), saved);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const game of ['tic-tac-toe', 'dots-boxes'] as const) {
  test(`server ${game} waits for human moves, rejects stale inputs and completes with a bot`, async () => {
    const store = new Store(':memory:');
    const runner = new Runner(
      store,
      new Nebius('https://example.test/v1/', '', (async () => {
        throw new Error('Human/bot play must not call a provider');
      }) as typeof fetch),
    );
    try {
      const config = simpleMatchConfig(game, structuredClone(defaultConfig.players));
      config.players[1].kind = 'human';
      config.rows = config.cols = 1;
      config.moveDelayMs = 0;
      const m = runner.create(config);
      await runner.start(m.id);
      while (store.getMatch(m.id).status === 'running') {
        const before = store.getMatch(m.id);
        assert.equal(before.state.player, 1);
        const action = gameFor(game).legalActions(before.state)[0];
        assert.throws(() => runner.submitMove(m.id, 0, before.state.ply, action), /not your turn/);
        assert.throws(() => runner.submitMove(m.id, 1, before.state.ply, 'invalid'));
        runner.submitMove(m.id, 1, before.state.ply, action);
        const after = store.getMatch(m.id);
        assert.throws(() => runner.submitMove(m.id, 1, before.state.ply, action));
        await runner.idle();
      }
      const final = store.getMatch(m.id);
      assert.equal(final.status, 'completed');
      assert.equal(final.spentUsd, 0);
      assert.ok(final.moves.some((m) => m.explanationSource === 'human'));
      assert.throws(
        () =>
          new Experiments(runner).create({ kind: 'paired', pairs: 1, match: config, maxUsd: 1 }),
        /automated players/,
      );
    } finally {
      store.close();
    }
  });
}

test('human versus mocked Nemotron calls the provider only on the model turn', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const provider = mock((_n, body) => {
    calls++;
    return response(`ACTION: ${legalAction(body)}`, '', true);
  });
  const runner = new Runner(store, provider);
  try {
    await runner.discover();
    const config = simpleMatchConfig('tic-tac-toe', [
      { ...defaultConfig.players[0], kind: 'human', name: 'You' },
      { ...defaultConfig.players[1], kind: 'nebius', name: 'Mock Nano', model },
    ]);
    config.moveDelayMs = 0;
    const m = runner.create(config);
    await runner.start(m.id);
    assert.equal(calls, 0);
    runner.pause(m.id);
    assert.throws(() => runner.submitMove(m.id, 0, 0, 'C:0:0'), /Resume/);
    await runner.start(m.id);
    runner.submitMove(m.id, 0, 0, 'C:0:0');
    await runner.idle();
    assert.equal(calls, 1);
    assert.equal(store.getMatch(m.id).moves.length, 2);
    assert.equal(store.getMatch(m.id).state.player, 0);
    runner.stop(m.id);
    assert.throws(() => runner.submitMove(m.id, 0, 2, 'C:2:2'), /Resume/);
  } finally {
    store.close();
  }
});

test('server human Dots & Boxes keeps a captured-box extra turn', async () => {
  const store = new Store(':memory:');
  const runner = new Runner(store, new Nebius('https://example.test/v1/', ''));
  try {
    const config = simpleMatchConfig('dots-boxes', structuredClone(defaultConfig.players));
    config.players[1].kind = 'human';
    config.moveDelayMs = 0;
    let initial = gameFor('dots-boxes').create(1, 2);
    for (const action of ['H:0:0', 'H:0:1', 'H:1:0', 'H:1:1', 'V:0:0'])
      initial = gameFor('dots-boxes').apply(initial, action).state;
    const m = runner.create(config, { initial });
    await runner.start(m.id);
    runner.submitMove(m.id, 1, initial.ply, 'V:0:1');
    await runner.idle();
    const after = store.getMatch(m.id);
    assert.equal(after.moves[0].retained, true);
    assert.equal(after.state.player, 1);
    runner.submitMove(m.id, 1, after.state.ply, 'V:0:2');
    await runner.idle();
    assert.equal(store.getMatch(m.id).status, 'completed');
    assert.deepEqual(store.getMatch(m.id).state.scores, [0, 2]);
  } finally {
    store.close();
  }
});
