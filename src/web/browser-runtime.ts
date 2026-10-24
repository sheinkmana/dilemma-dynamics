import { baselineMove } from '../players/baselines.js';
import { gameFor } from '../games/registry.js';
import { scenarioState } from '../games/scenarios.js';
import { evaluate } from '../games/evaluate.js';
import { matchSchema } from '../shared/config.js';
import {
  configSchema,
  continuationWeight,
  payoff,
  RULES_VERSION,
  PROTOCOL_VERSION,
} from '../dilemma/rules.js';
import { analyze, ANALYSIS_VERSION } from '../dilemma/analysis.js';
import type { Action, DilemmaSession } from '../dilemma/types.js';
import type { Health, MatchRecord } from '../shared/types.js';
import { replayHtml } from '../server/export.js';
import { dilemmaHtml } from '../server/dilemma-export.js';

type Record = MatchRecord | DilemmaSession;
const prefix = 'dilemma-dynamics:browser:v1:';
const now = () => new Date().toISOString();
const isDilemma = (record: Record): record is DilemmaSession => 'rounds' in record;
const recordPath = (record: Record) =>
  `${isDilemma(record) ? '/dilemma/sessions' : '/matches'}/${record.id}`;
const copy = <T>(value: T): T => structuredClone(value);

// A deliberately closed transport: no fetch, provider, credentials or server fallback.
// The storage and scheduler are injected so lifecycle behavior can be verified offline.
export class BrowserRuntime {
  private records = new Map<string, Record>();
  private listeners = new Map<string, Set<(record: never) => void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  storageWarning = '';

  constructor(
    private storage?: Storage,
    private schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = (
      callback,
      delay,
    ) => setTimeout(callback, delay),
    private cancel: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer),
  ) {
    if (!storage)
      this.storageWarning =
        'Browser storage is unavailable. Games will last for this tab only; download a replay to keep them.';
    try {
      for (let i = 0; storage && i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const record = JSON.parse(storage.getItem(key)!) as Record;
          if (!record || typeof record.id !== 'string' || key !== prefix + recordPath(record))
            throw new Error('Invalid saved game');
          if (isDilemma(record)) {
            configSchema.parse(record.config);
            if (record.config.mode !== 'demo' || !Array.isArray(record.rounds))
              throw new Error('Invalid local demo');
          } else {
            matchSchema.parse(record.config);
            if (
              record.config.players.some((p) => p.kind === 'nebius') ||
              !Array.isArray(record.moves)
            )
              throw new Error('Invalid local game');
          }
          // Reloading can never restart play. The next explicit Resume continues it.
          if (record.status === 'running') {
            record.status = 'paused';
            record.message = 'Paused when the page reloaded. Resume to continue.';
          }
          this.records.set(recordPath(record), record);
        } catch {
          this.storageWarning =
            'A saved browser game could not be read. Other games are still available; download replays to keep a copy.';
        }
      }
    } catch {
      this.storageWarning =
        'Browser storage could not be read. New games last for this tab only; download a replay to keep them.';
    }
  }

  private save(record: Record) {
    record.updatedAt = now();
    if (isDilemma(record)) record.version++;
    else record.lastEventId++;
    this.records.set(recordPath(record), record);
    try {
      this.storage?.setItem(prefix + recordPath(record), JSON.stringify(record));
    } catch {
      this.storageWarning =
        'Browser storage is full or unavailable. Recent progress is kept in this tab only; download your replay before closing it.';
    }
    for (const listener of this.listeners.get(recordPath(record)) ?? [])
      listener(copy(record) as never);
    for (const listener of this.listeners.get('storage') ?? []) listener(undefined as never);
  }

  subscribe<T>(path: string, listener: (record: T) => void) {
    const listeners = this.listeners.get(path) ?? new Set();
    listeners.add(listener);
    this.listeners.set(path, listeners);
    const record = this.records.get(path);
    if (record) listener(copy(record) as T);
    return () => {
      listeners.delete(listener);
    };
  }

  private get(path: string) {
    const record = this.records.get(path);
    if (!record) throw new Error('This browser game could not be found.');
    return record;
  }

  private tick(path: string, step: boolean) {
    this.timers.delete(path);
    const record = this.get(path);
    if (record.status !== 'running') return;
    try {
      if (isDilemma(record)) this.round(record);
      else this.move(record);
      if (step && record.status === 'running') {
        record.status = 'paused';
        record.message = 'Round revealed. Ready for the next round.';
      }
      this.save(record);
      if (record.status === 'running') this.queue(path, false);
    } catch (error) {
      record.status = 'interrupted';
      record.message = (error as Error).message;
      this.save(record);
    }
  }

  private queue(path: string, step: boolean) {
    const record = this.get(path);
    const delay = isDilemma(record) ? record.config.delayMs : (record.config.moveDelayMs ?? 700);
    this.timers.set(
      path,
      this.schedule(() => this.tick(path, step), delay),
    );
  }

  private move(record: MatchRecord) {
    const before = record.state;
    const player = before.player!;
    const decision = baselineMove(before, record.config.players[player].kind, record.config.seed);
    const evaluation = evaluate(before);
    const result = gameFor(before.game).apply(before, decision.action);
    record.state = result.state;
    record.outcome = result.outcome;
    record.attempts++;
    record.moves.push({
      index: record.moves.length + 1,
      action: decision.action,
      player,
      captured: result.captured,
      retained: result.retained,
      state: copy(result.state),
      explanation: decision.explanation,
      explanationSource: 'baseline',
      attemptId: crypto.randomUUID(),
      latencyMs: 0,
      firstTokenMs: null,
      usage: null,
      costUsd: 0,
      costKind: 'local',
      evaluation,
      regret:
        evaluation.status === 'exact'
          ? evaluation.value! - evaluation.actionValues[decision.action]
          : null,
    });
    if (result.outcome) {
      record.status = 'completed';
      record.message = result.outcome.reason;
    } else if (record.config.maxMoves && record.moves.length >= record.config.maxMoves) {
      record.status = 'stopped';
      record.message = 'Configured move limit reached.';
    } else record.message = `Move ${record.moves.length} played.`;
  }

  private round(record: DilemmaSession) {
    const index = record.rounds.length + 1;
    const previous = record.rounds.at(-1);
    // Choose both actions from the same completed history before revealing either.
    const actions = record.config.players.map((player, seat) => {
      if (player.kind === 'demo-reciprocal') return previous?.actions[1 - seat] ?? 'C';
      const draw = new Uint32Array(1);
      crypto.getRandomValues(draw);
      return draw[0] < 0x80000000 ? 'C' : 'D';
    }) as [Action, Action];
    const points = payoff(...actions);
    const scores: [number, number] = [record.scores[0] + points[0], record.scores[1] + points[1]];
    const delta = continuationWeight(record.config, index);
    const ended = record.config.horizon.kind === 'fixed' && index === record.config.horizon.rounds;
    record.rounds.push({
      index,
      beforeHash: '',
      actions,
      payoffs: points,
      scores,
      forecasts: [null, null],
      analysis: [
        analyze(actions[0], actions[1], null, delta),
        analyze(actions[1], actions[0], null, delta),
      ],
      attemptIds: [crypto.randomUUID(), crypto.randomUUID()],
      costUsd: 0,
      telemetry: [
        { latencyMs: 0, usage: null, costUsd: 0 },
        { latencyMs: 0, usage: null, costUsd: 0 },
      ],
      continuation: ended ? 'fixed-final' : 'continued',
      resolvedAt: now(),
    });
    record.scores = scores;
    record.attempts += 2;
    record.message = ended
      ? 'The scheduled final round completed.'
      : `Round ${index} revealed. Another round follows.`;
    if (ended) {
      record.status = 'completed';
      record.endReason = 'fixed-final';
    }
  }

  async request<T>(path: string, body?: unknown): Promise<T> {
    return copy(this.route(path, body)) as T;
  }

  private route(path: string, body?: unknown): unknown {
    if (path === '/health' && body === undefined)
      return {
        keyConfigured: false,
        baseUrl: 'browser-only',
        sessionCapUsd: 0,
        sessionSpentUsd: 0,
        reservedUsd: 0,
        token: '',
        version: 'browser/1',
      } satisfies Health;
    if (path === '/models' && body === undefined) return [];
    if (['/matches', '/dilemma/sessions'].includes(path)) {
      if (body === undefined)
        return [...this.records.values()]
          .filter((record) => recordPath(record).startsWith(path + '/'))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((record) => {
            if (isDilemma(record)) {
              const { rounds, ...summary } = record;
              return { ...summary, roundCount: rounds.length };
            }
            const { moves, state, initialState: _, ...summary } = record;
            return { ...summary, scores: state.scores, moveCount: moves.length };
          });
      if (
        [...this.records.values()].some(
          (record) => record.status === 'running' && recordPath(record).startsWith(path + '/'),
        )
      )
        throw new Error('Pause or stop the current game before starting another.');
      const common = {
        id: crypto.randomUUID(),
        createdAt: now(),
        updatedAt: now(),
        spentUsd: 0,
        attempts: 0,
        invalidAttempts: 0,
        endpoint: 'browser-only',
        pricingDate: 'not-applicable',
      };
      let record: Record;
      if (path === '/matches') {
        const config = matchSchema.parse(body);
        if (config.players.some((p) => !['heuristic', 'random'].includes(p.kind)))
          throw new Error('Only free simple and random bots are available in the browser.');
        const state = scenarioState(config.scenario, config.game, config.rows, config.cols);
        record = {
          ...common,
          config,
          initialState: copy(state),
          state,
          moves: [],
          status: 'ready',
          message: 'Ready to play.',
          outcome: null,
          promptVersion: 'browser-baselines/1',
          lastEventId: 0,
        };
      } else {
        const config = configSchema.parse((body as { config?: unknown })?.config);
        if (
          config.mode !== 'demo' ||
          config.horizon.kind !== 'fixed' ||
          config.horizon.rounds !== 10
        )
          throw new Error('Browser Dilemma play uses the free ten-round local demo.');
        record = {
          ...common,
          config,
          rounds: [],
          scores: [0, 0],
          status: 'ready',
          message: 'Ready. Choices are revealed together.',
          endReason: null,
          received: [false, false],
          pendingRound: null,
          reservedUsd: 0,
          version: 0,
          rulesVersion: RULES_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          analysisVersion: ANALYSIS_VERSION,
        };
      }
      this.save(record);
      return record;
    }
    const match = path.match(
      /^(\/matches\/[^/]+|\/dilemma\/sessions\/[^/]+)(?:\/(start|step|pause|stop))?$/,
    );
    if (!match) throw new Error('This operation is unavailable in the browser app.');
    const [, key, action] = match;
    const record = this.get(key);
    if (!action && body === undefined) return record;
    if (body === undefined || !action) throw new Error('Unsupported browser operation.');
    if (action === 'start' || action === 'step') {
      if (record.status === 'running') return record;
      if (!['ready', 'paused', 'interrupted'].includes(record.status))
        throw new Error('Start a new game; this game has ended.');
      if (
        [...this.records.values()].some(
          (other) =>
            other.id !== record.id &&
            other.status === 'running' &&
            isDilemma(other) === isDilemma(record),
        )
      )
        throw new Error('Pause or stop the current game first.');
      record.status = 'running';
      record.message = 'Playing locally in this browser…';
      this.save(record);
      this.queue(key, action === 'step');
    } else {
      const timer = this.timers.get(key);
      if (timer !== undefined) this.cancel(timer);
      this.timers.delete(key);
      if (!['ready', 'running', 'paused', 'interrupted'].includes(record.status))
        throw new Error('This game has already ended.');
      record.status = action === 'pause' ? 'paused' : 'stopped';
      record.message =
        action === 'pause'
          ? 'Paused. Resume when ready.'
          : 'Stopped. Completed moves and rounds are saved.';
      if (isDilemma(record) && action === 'stop') record.endReason = 'user-stop';
      this.save(record);
    }
    return record;
  }

  export(path: string) {
    const match = path.match(
      /^(\/matches\/[^/]+|\/dilemma\/sessions\/[^/]+)\/export\/(html|json|jsonl)$/,
    );
    if (!match) throw new Error('Unsupported replay download.');
    const record = this.get(match[1]);
    const format = match[2];
    const content =
      format === 'html'
        ? isDilemma(record)
          ? dilemmaHtml(record)
          : replayHtml(record)
        : format === 'jsonl'
          ? (isDilemma(record) ? record.rounds : record.moves)
              .map((row) => JSON.stringify(row))
              .join('\n') + '\n'
          : JSON.stringify(record, null, 2);
    return {
      content,
      type:
        format === 'html'
          ? 'text/html'
          : format === 'json'
            ? 'application/json'
            : 'application/x-ndjson',
      filename: `dilemma-dynamics-${record.id}.${format}`,
    };
  }

  dispose() {
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    this.listeners.clear();
  }
}
