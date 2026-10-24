import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserRuntime } from '../src/web/browser-runtime.js';
import { simpleMatchConfig, defaultConfig } from '../src/shared/config.js';
import { gameFor } from '../src/games/registry.js';
import { baselineMove } from '../src/players/baselines.js';
import { payoff } from '../src/dilemma/spec.js';
import type { DilemmaConfig, DilemmaSession } from '../src/dilemma/types.js';
import type { GameId, Health, MatchRecord } from '../src/shared/types.js';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('Quota exceeded');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

function fixture(storage: Storage | undefined = new MemoryStorage()) {
  let sequence = 0;
  const callbacks = new Map<number, () => void>();
  const runtime = new BrowserRuntime(
    storage,
    (callback) => {
      callbacks.set(++sequence, callback);
      return sequence as unknown as ReturnType<typeof setTimeout>;
    },
    (timer) => {
      callbacks.delete(timer as unknown as number);
    },
  );
  return {
    runtime,
    storage,
    callbacks,
    tick: () => {
      const first = callbacks.entries().next().value;
      assert.ok(first, 'Expected a scheduled move or round');
      callbacks.delete(first[0]);
      first[1]();
    },
  };
}
const demo: DilemmaConfig = {
  mode: 'demo',
  players: [
    { kind: 'demo-random', name: 'Random', model: '' },
    { kind: 'demo-reciprocal', name: 'Reciprocal', model: '' },
  ],
  protocol: 'actions',
  horizon: { kind: 'fixed', rounds: 10 },
  mapping: 'X=C',
  maxUsd: 0.05,
  delayMs: 700,
};
const createDemo = (runtime: BrowserRuntime, config = demo) =>
  runtime.request<DilemmaSession>('/dilemma/sessions', { config });

test('browser transport rejects model runs and server operations without any network fallback', async (t) => {
  const { runtime } = fixture();
  const fetchMock = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network request');
  });
  const health = await runtime.request<Health>('/health');
  assert.equal(health.keyConfigured, false);
  assert.equal(health.sessionSpentUsd, 0);
  assert.deepEqual(await runtime.request('/models'), []);
  for (const path of ['/shutdown', '/models/refresh', '/settings']) {
    await assert.rejects(runtime.request(path, {}), /unavailable/);
  }
  await assert.rejects(
    createDemo(runtime, {
      ...demo,
      mode: 'autonomous',
      players: demo.players.map((p) => ({
        ...p,
        kind: 'model',
        model: 'nvidia/example',
      })) as DilemmaConfig['players'],
    }),
    /free ten-round/,
  );
  const config = simpleMatchConfig('tic-tac-toe', structuredClone(defaultConfig.players));
  config.players[0].kind = 'nebius';
  await assert.rejects(runtime.request('/matches', config), /Only free/);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test('Dilemma jointly reveals ten rounds, reciprocates only completed history and preserves scoring', async () => {
  const { runtime, tick, callbacks } = fixture();
  const created = await createDemo(runtime);
  const path = `/dilemma/sessions/${created.id}`;
  let notifications = 0;
  runtime.subscribe<DilemmaSession>(path, (snapshot) => {
    notifications++;
    assert.equal(snapshot.received[0], snapshot.received[1]);
  });
  await runtime.request(`${path}/start`, {});
  for (let i = 0; i < 10; i++) tick();
  const session = await runtime.request<DilemmaSession>(path);
  assert.equal(session.status, 'completed');
  assert.equal(session.rounds.length, 10);
  assert.equal(callbacks.size, 0);
  assert.equal(session.attempts, 20);
  let scores = [0, 0];
  session.rounds.forEach((round, i) => {
    assert.equal(round.actions[1], i ? session.rounds[i - 1].actions[0] : 'C');
    assert.deepEqual(round.payoffs, payoff(...round.actions));
    scores = scores.map((score, seat) => score + round.payoffs[seat]);
    assert.deepEqual(round.scores, scores);
    assert.deepEqual(round.forecasts, [null, null]);
    assert.equal(round.analysis[0].knownFinalRound, i === 9);
    assert.equal(round.costUsd, 0);
  });
  assert.deepEqual(session.scores, scores);
  assert.equal(session.rounds[9].continuation, 'fixed-final');
  assert.ok(notifications >= 12);
  await assert.rejects(runtime.request(`${path}/start`, {}), /ended/);
});

test('pause, single step, stop and page reload never repeat or silently resume Dilemma rounds', async () => {
  const storage = new MemoryStorage();
  const first = fixture(storage);
  const created = await createDemo(first.runtime);
  const path = `/dilemma/sessions/${created.id}`;
  await first.runtime.request(`${path}/start`, {});
  first.tick();
  await first.runtime.request(`${path}/pause`, {});
  assert.equal(first.callbacks.size, 0);
  await first.runtime.request(`${path}/step`, {});
  first.tick();
  const stepped = await first.runtime.request<DilemmaSession>(path);
  assert.equal(stepped.status, 'paused');
  assert.equal(stepped.rounds.length, 2);
  assert.equal(first.callbacks.size, 0);
  await first.runtime.request(`${path}/start`, {});
  first.tick();
  first.runtime.dispose();
  const second = fixture(storage);
  const restored = await second.runtime.request<DilemmaSession>(path);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.rounds.length, 3);
  assert.equal(second.callbacks.size, 0);
  await second.runtime.request(`${path}/start`, {});
  second.tick();
  await second.runtime.request(`${path}/stop`, {});
  const stopped = await second.runtime.request<DilemmaSession>(path);
  assert.equal(stopped.rounds.length, 4);
  assert.deepEqual(stopped.rounds.slice(0, 2), stepped.rounds);
  assert.equal(stopped.status, 'stopped');
  assert.equal(second.callbacks.size, 0);
});

for (const game of ['tic-tac-toe', 'dots-boxes'] as GameId[]) {
  test(`browser ${game} matches shared baseline decisions, legal transitions and final scores`, async () => {
    const { runtime, tick, callbacks } = fixture();
    const config = simpleMatchConfig(game, structuredClone(defaultConfig.players));
    const created = await runtime.request<MatchRecord>('/matches', config);
    const path = `/matches/${created.id}`;
    await runtime.request(`${path}/start`, {});
    await runtime.request(`${path}/start`, {});
    assert.equal(callbacks.size, 1, 'Repeated start must not duplicate timers');
    let guard = 0;
    while (callbacks.size && guard++ < 30) tick();
    const match = await runtime.request<MatchRecord>(path);
    assert.equal(match.status, 'completed');
    let state = created.initialState;
    for (const move of match.moves) {
      assert.equal(
        move.action,
        baselineMove(state, config.players[state.player!].kind, config.seed).action,
      );
      assert.ok(gameFor(game).legalActions(state).includes(move.action));
      const result = gameFor(game).apply(state, move.action);
      assert.deepEqual(move.state, result.state);
      assert.equal(move.retained, result.retained);
      assert.equal(move.costUsd, 0);
      state = result.state;
    }
    assert.deepEqual(match.outcome, gameFor(game).outcome(state));
    if (game === 'dots-boxes') assert.equal(state.scores[0] + state.scores[1], 9);
    assert.equal(match.spentUsd, 0);
    assert.equal(callbacks.size, 0);
  });
}

test('browser board-game pause and reload preserve the exact next move and saved library', async () => {
  const storage = new MemoryStorage();
  const first = fixture(storage);
  const config = simpleMatchConfig('dots-boxes', structuredClone(defaultConfig.players));
  const created = await first.runtime.request<MatchRecord>('/matches', config);
  const path = `/matches/${created.id}`;
  await first.runtime.request(`${path}/start`, {});
  first.tick();
  await first.runtime.request(`${path}/pause`, {});
  assert.equal(first.callbacks.size, 0);
  first.runtime.dispose();
  const second = fixture(storage);
  const loaded = await second.runtime.request<MatchRecord>(path);
  assert.equal(loaded.moves.length, 1);
  assert.equal(loaded.status, 'paused');
  const next = baselineMove(loaded.state, config.players[loaded.state.player!].kind, config.seed);
  await second.runtime.request(`${path}/start`, {});
  second.tick();
  await second.runtime.request(`${path}/stop`, {});
  const stopped = await second.runtime.request<MatchRecord>(path);
  assert.equal(stopped.moves[1].action, next.action);
  assert.equal((await second.runtime.request<unknown[]>('/matches')).length, 1);
  assert.equal(second.callbacks.size, 0);
});

test('storage failure keeps playable records in memory and exposes a warning; malformed saves are isolated', async () => {
  const storage = new MemoryStorage();
  storage.setItem('dilemma-dynamics:browser:v1:/matches/broken', 'not JSON');
  const { runtime, tick } = fixture(storage);
  assert.match(runtime.storageWarning, /could not be read/);
  storage.failWrites = true;
  const created = await createDemo(runtime);
  assert.match(runtime.storageWarning, /full or unavailable/);
  const path = `/dilemma/sessions/${created.id}`;
  await runtime.request(`${path}/step`, {});
  tick();
  assert.equal((await runtime.request<DilemmaSession>(path)).rounds.length, 1);
  assert.equal(JSON.parse(runtime.export(`${path}/export/json`).content).rounds.length, 1);
});

test('downloaded HTML, JSON and JSONL contain browser decisions without executable player labels', async () => {
  const { runtime, tick } = fixture();
  const config = structuredClone(demo);
  config.players[0].name = '</script><script>alert(1)</script>';
  const created = await createDemo(runtime, config);
  const path = `/dilemma/sessions/${created.id}`;
  await runtime.request(`${path}/step`, {});
  tick();
  const json = runtime.export(`${path}/export/json`);
  const jsonl = runtime.export(`${path}/export/jsonl`);
  const html = runtime.export(`${path}/export/html`);
  assert.equal(JSON.parse(json.content).endpoint, 'browser-only');
  assert.deepEqual(JSON.parse(jsonl.content), JSON.parse(json.content).rounds[0]);
  assert.ok(html.content.startsWith('<!doctype html>'));
  assert.ok(!html.content.includes(config.players[0].name));
  assert.equal(html.type, 'text/html');
  assert.match(json.filename, /\.json$/);
  const board = await runtime.request<MatchRecord>(
    '/matches',
    simpleMatchConfig('tic-tac-toe', structuredClone(defaultConfig.players)),
  );
  assert.match(
    runtime.export(`/matches/${board.id}/export/html`).content,
    /Replayed game position/,
  );
});

for (const game of ['tic-tac-toe', 'dots-boxes'] as const) {
  for (const human of [0, 1] as const) {
    test(`browser ${game} supports human seat ${human}, turn validation and saved progress`, async () => {
      const f = fixture();
      const config = simpleMatchConfig(game, structuredClone(defaultConfig.players));
      config.rows = config.cols = 1;
      config.players[human].kind = 'human';
      const match = await f.runtime.request<MatchRecord>('/matches', config);
      const path = `/matches/${match.id}`;
      await f.runtime.request(`${path}/start`, {});
      while (true) {
        const before = await f.runtime.request<MatchRecord>(path);
        if (before.status === 'completed') break;
        if (before.state.player !== human) {
          await assert.rejects(
            f.runtime.request(`${path}/move`, {
              player: human,
              ply: before.state.ply,
              action: 'C:0:0',
            }),
            /not your turn/,
          );
          f.tick();
          continue;
        }
        assert.equal(f.callbacks.size, 0, 'A human turn must not schedule a bot move');
        await assert.rejects(
          f.runtime.request(`${path}/move`, {
            player: human,
            ply: before.state.ply,
            action: 'invalid',
          }),
        );
        assert.equal(
          (await f.runtime.request<MatchRecord>(path)).moves.length,
          before.moves.length,
        );
        const body = {
          player: human,
          ply: before.state.ply,
          action: gameFor(game).legalActions(before.state)[0],
        };
        const after = await f.runtime.request<MatchRecord>(`${path}/move`, body);
        assert.equal(after.moves.at(-1)?.explanationSource, 'human');
        await assert.rejects(f.runtime.request(`${path}/move`, body));
      }
      const final = await f.runtime.request<MatchRecord>(path);
      assert.equal(final.spentUsd, 0);
      const reloaded = fixture(f.storage);
      assert.deepEqual((await reloaded.runtime.request<MatchRecord>(path)).state, final.state);
      assert.equal(reloaded.callbacks.size, 0);
    });
  }
}

test('browser human Dilemma reveals jointly, retains completed history and requires resume after reload', async () => {
  const f = fixture();
  const config = structuredClone(demo);
  config.mode = 'interactive';
  config.players[0] = { kind: 'human', name: 'You', model: '' };
  const created = await createDemo(f.runtime, config);
  const path = `/dilemma/sessions/${created.id}`;
  await f.runtime.request(`${path}/start`, {});
  assert.equal(f.callbacks.size, 0);
  let current = await f.runtime.request<DilemmaSession>(path);
  assert.equal(current.pendingRound, 1);
  assert.equal(current.rounds.length, 0);
  await assert.rejects(
    f.runtime.request(`${path}/choice`, { seat: 1, round: 1, action: 'D' }),
    /stale/,
  );
  const reload = fixture(f.storage);
  assert.equal((await reload.runtime.request<DilemmaSession>(path)).status, 'paused');
  await assert.rejects(
    reload.runtime.request(`${path}/choice`, { seat: 0, round: 1, action: 'D' }),
    /Resume/,
  );
  for (let i = 1; i <= 10; i++) {
    await reload.runtime.request(`${path}/start`, {});
    current = await reload.runtime.request<DilemmaSession>(`${path}/choice`, {
      seat: 0,
      round: i,
      action: i % 2 ? 'D' : 'C',
    });
    assert.deepEqual(current.rounds.at(-1)?.actions, [
      i % 2 ? 'D' : 'C',
      i === 1 || i % 2 ? 'C' : 'D',
    ]);
    assert.deepEqual(current.received, [false, false]);
    assert.equal(current.pendingRound, null);
    await assert.rejects(
      reload.runtime.request(`${path}/choice`, { seat: 0, round: i, action: 'C' }),
    );
  }
  assert.equal(current.status, 'completed');
  assert.equal(current.rounds.length, 10);
  assert.equal(current.spentUsd, 0);
  assert.equal(reload.callbacks.size, 0);
});

test('browser human Dots & Boxes retains the turn after a nonterminal capture', async () => {
  const { runtime, callbacks } = fixture();
  const config = simpleMatchConfig('dots-boxes', structuredClone(defaultConfig.players));
  config.rows = 1;
  config.cols = 2;
  config.players.forEach((p) => (p.kind = 'human'));
  let m = await runtime.request<MatchRecord>('/matches', config);
  const path = `/matches/${m.id}`;
  await runtime.request(`${path}/start`, {});
  for (const action of ['H:0:0', 'H:0:1', 'H:1:0', 'H:1:1', 'V:0:0', 'V:0:1']) {
    m = await runtime.request<MatchRecord>(`${path}/move`, {
      player: m.state.player,
      ply: m.state.ply,
      action,
    });
  }
  assert.equal(m.moves.at(-1)?.retained, true);
  assert.equal(m.state.player, 1);
  assert.deepEqual(m.state.scores, [0, 1]);
  assert.equal(callbacks.size, 0);
  m = await runtime.request<MatchRecord>(`${path}/move`, {
    player: 1,
    ply: m.state.ply,
    action: 'V:0:2',
  });
  assert.equal(m.status, 'completed');
  assert.deepEqual(m.state.scores, [0, 2]);
});
