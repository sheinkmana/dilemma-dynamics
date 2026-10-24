import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as waitBetweenMoves } from 'node:timers/promises';
import { matchSchema } from '../shared/config.js';
import type {
  AttemptRecord,
  Capabilities,
  MatchConfig,
  MatchRecord,
  ModelInfo,
  PlayerConfig,
  Player,
  GameState,
} from '../shared/types.js';
import { scenarioState } from '../games/scenarios.js';
import { gameFor } from '../games/registry.js';
import { rng, stableState } from '../engine/game.js';
import { evaluate } from '../games/evaluate.js';
import { baselineMove } from '../players/baselines.js';
import { actionSchema, makePrompt, parseAction, PROMPT_VERSION } from '../players/prompts.js';
import { Store } from './store.js';
import { Nebius, ProviderError } from './provider.js';
import {
  ADAPTER_VERSION,
  catalog,
  estimateReservation,
  PRICING_DATE,
  usageCost,
} from './models.js';
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
export class Runner extends EventEmitter {
  private active = new Map<
    string,
    { abort: AbortController; pause: boolean; promise: Promise<void> }
  >();
  private discovered: string[] = [];
  constructor(
    public store: Store,
    public provider: Nebius,
  ) {
    super();
    this.setMaxListeners(100);
  }
  models(): ModelInfo[] {
    const ids = new Set([...catalog.map((m) => m.id), ...this.discovered]);
    return [...ids].map((id) => ({
      ...(catalog.find((m) => m.id === id) ?? {
        id,
        name: id.split('/').pop()!,
        parameters: 'Not catalogued',
        inputRate: null,
        outputRate: null,
        pricingDate: PRICING_DATE,
        source: 'discovered' as const,
      }),
      available: this.discovered.includes(id),
      capabilities: this.store.capabilities(this.provider.baseUrl, id),
    }));
  }
  async discover() {
    this.discovered = await this.provider.models();
    return this.models();
  }
  private model(id: string) {
    const model = this.models().find((m) => m.id === id);
    if (!model?.available)
      throw new Error('Model is not in the current endpoint model list. Refresh model discovery.');
    if (model.inputRate === null || model.outputRate === null)
      throw new Error(
        'Uncatalogued model pricing: live play is disabled until a reviewed price is added to the server catalog.',
      );
    return model;
  }
  validate(config: MatchConfig) {
    for (const p of config.players) {
      if (p.kind !== 'nebius') continue;
      if (!this.provider.configured)
        throw new Error('Configure NEBIUS_API_KEY on the server first.');
      const model = this.model(p.model),
        caps =
          model.capabilities?.adapterVersion === ADAPTER_VERSION ? model.capabilities : undefined;
      if (
        p.reasoning === 'on' &&
        (caps?.reasoningControl !== 'observed' || caps.adapterVersion !== ADAPTER_VERSION)
      )
        throw new Error(
          'Run a successful capability check before selecting explicit reasoning on.',
        );
      if (
        (config.format === 'json_object' && !caps?.json) ||
        (config.format === 'json_schema' && !caps?.schema)
      )
        throw new Error('Selected structured format has not passed the endpoint capability check.');
    }
  }
  create(
    input: unknown,
    extra: {
      initial?: GameState;
      parent?: { id: string; move: number };
      experimentId?: string;
    } = {},
  ): MatchRecord {
    const config = matchSchema.parse(input);
    this.validate(config);
    let state = extra.initial
      ? structuredClone(extra.initial)
      : scenarioState(config.scenario, config.game, config.rows, config.cols);
    if (!extra.initial) {
      const random = rng(config.seed);
      for (let i = 0; i < config.openingMoves; i++) {
        const actions = gameFor(state.game).legalActions(state);
        if (!actions.length) break;
        state = gameFor(state.game).apply(
          state,
          actions[Math.floor(random() * actions.length)],
        ).state;
      }
    }
    if (state.player === null) throw new Error('The starting position is terminal.');
    const m: MatchRecord = {
      id: randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      config,
      initialState: state,
      state,
      moves: [],
      status: 'ready',
      message: 'Ready to play.',
      outcome: null,
      spentUsd: 0,
      attempts: 0,
      invalidAttempts: 0,
      parent: extra.parent,
      experimentId: extra.experimentId,
      promptVersion: PROMPT_VERSION,
      pricingDate: PRICING_DATE,
      endpoint: this.provider.baseUrl,
      lastEventId: 0,
    };
    this.store.saveMatch(m);
    return m;
  }
  publish(m: MatchRecord) {
    this.emit(m.id, { type: 'snapshot', match: m });
  }
  save(m: MatchRecord) {
    this.store.saveMatch(m);
    this.publish(m);
  }
  start(id: string, step = false): Promise<void> {
    const running = this.active.get(id);
    if (running) return running.promise;
    const m = this.store.getMatch(id);
    if (!['ready', 'paused', 'interrupted'].includes(m.status))
      throw new Error('This match cannot be resumed. Fork its position for a new run.');
    this.validate(m.config);
    const control = { abort: new AbortController(), pause: false, promise: Promise.resolve() };
    this.active.set(id, control);
    m.status = 'running';
    m.message = step ? 'Playing one edge.' : 'Match in progress.';
    this.save(m);
    control.promise = this.run(id, control, step).finally(() => this.active.delete(id));
    return control.promise;
  }
  pause(id: string) {
    const c = this.active.get(id);
    if (c) {
      c.pause = true;
      const m = this.store.getMatch(id);
      m.message = 'Pause requested; the current decision will finish.';
      this.save(m);
    } else {
      const m = this.store.getMatch(id);
      if (['ready', 'interrupted', 'running'].includes(m.status)) {
        m.status = 'paused';
        m.message = 'Paused.';
        this.save(m);
      }
    }
  }
  stop(id: string) {
    const c = this.active.get(id);
    c?.abort.abort();
    const m = this.store.getMatch(id);
    if (!['completed', 'forfeit', 'budget'].includes(m.status)) {
      m.status = 'stopped';
      m.message = 'Stopped by user. An in-flight request may still be billed.';
      this.save(m);
    }
  }
  submitMove(id: string, player: Player, ply: number, action: string) {
    const m = this.store.getMatch(id);
    if (m.status !== 'running' || this.active.get(id)?.pause)
      throw new Error('Resume this game before playing a move.');
    if (
      m.state.player !== player ||
      m.state.ply !== ply ||
      m.config.players[player].kind !== 'human'
    )
      throw new Error('This move is stale or it is not your turn.');
    const evaluation = evaluate(m.state);
    // Validate before recording anything, including duplicate submissions.
    const next = gameFor(m.state.game).apply(m.state, action);
    const a = this.attempt(m, { model: 'local/human', messages: [] });
    a.raw = action;
    a.outcome = 'accepted';
    a.finishedAt = now();
    a.finishReason = 'stop';
    m.moves.push({
      index: m.moves.length + 1,
      action,
      player,
      captured: next.captured,
      retained: next.retained,
      state: next.state,
      explanation: 'Chosen by the human player.',
      explanationSource: 'human',
      attemptId: a.id,
      latencyMs: 0,
      firstTokenMs: null,
      usage: null,
      costUsd: 0,
      costKind: 'local',
      evaluation,
      regret:
        evaluation.status === 'exact' ? evaluation.value! - evaluation.actionValues[action] : null,
    });
    m.state = next.state;
    m.outcome = next.outcome;
    if (next.outcome || (m.config.maxMoves && m.moves.length >= m.config.maxMoves)) {
      m.status = 'completed';
      m.message = next.outcome?.reason ?? 'Configured move limit reached.';
    } else m.message = 'Move played.';
    this.store.finish(a, m);
    this.publish(m);
    const resume = () => {
      if (this.store.getMatch(id).status !== 'running' || this.active.has(id)) return;
      const control = { abort: new AbortController(), pause: false, promise: Promise.resolve() };
      this.active.set(id, control);
      control.promise = this.run(id, control, false).finally(() => this.active.delete(id));
    };
    const active = this.active.get(id);
    if (active) void active.promise.then(resume);
    else resume();
    return this.store.getMatch(id);
  }
  async idle() {
    await Promise.all([...this.active.values()].map((c) => c.promise));
  }
  private requestBody(m: MatchRecord, p: PlayerConfig, repair?: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: p.model,
      messages: makePrompt(m.state, p, m.config, repair),
      temperature: p.temperature,
      max_tokens: p.maxTokens,
    };
    if (p.reasoning !== 'default')
      body.chat_template_kwargs = { enable_thinking: p.reasoning === 'on' };
    if (m.config.format === 'json_object') body.response_format = { type: 'json_object' };
    if (m.config.format === 'json_schema')
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'move', strict: true, schema: actionSchema },
      };
    return body;
  }
  private attempt(
    m: MatchRecord | null,
    body: Record<string, unknown>,
    reservedUsd = 0,
  ): AttemptRecord {
    return {
      id: randomUUID(),
      matchId: m?.id ?? null,
      moveIndex: m?.moves.length ?? 0,
      player: m?.state.player ?? null,
      startedAt: now(),
      model: String(body.model ?? 'local'),
      endpoint: this.provider.baseUrl,
      stateHash: hash(m ? stableState(m.state) : 'probe'),
      promptHash: hash(JSON.stringify(body.messages ?? [])),
      prompt: (body.messages ?? []) as AttemptRecord['prompt'],
      request: String(body.model).startsWith('local/')
        ? body
        : { ...body, stream: true, stream_options: { include_usage: true } },
      raw: '',
      reasoning: '',
      outcome: 'pending',
      usage: null,
      reservedUsd,
      costUsd: 0,
      costKind: 'local',
      latencyMs: 0,
      firstTokenMs: null,
      finishReason: null,
      providerRequestId: null,
      pricing: (() => {
        const model = this.models().find((x) => x.id === body.model);
        return model
          ? { inputRate: model.inputRate, outputRate: model.outputRate, date: model.pricingDate }
          : undefined;
      })(),
    };
  }
  private async run(id: string, c: { abort: AbortController; pause: boolean }, step: boolean) {
    try {
      while (!c.abort.signal.aborted) {
        let m = this.store.getMatch(id);
        if (m.status !== 'running') return;
        if (c.pause) {
          m.status = 'paused';
          m.message = 'Paused at a move boundary.';
          this.save(m);
          return;
        }
        const player = m.state.player!;
        const p = m.config.players[player];
        if (p.kind === 'human') {
          m.message = `${p.name}: choose an empty cell or an undrawn edge.`;
          this.save(m);
          return;
        }
        const evaluation = evaluate(m.state);
        let accepted = false;
        for (let retry = 0; retry <= m.config.repairAttempts; retry++) {
          m = this.store.getMatch(id);
          if (c.abort.signal.aborted || m.status !== 'running') return;
          const prior = this.store.attempts(id).at(-1);
          const body =
            p.kind === 'nebius'
              ? this.requestBody(m, p, retry ? prior?.error : undefined)
              : { model: `local/${p.kind}`, messages: [] };
          const model = p.kind === 'nebius' ? this.model(p.model) : undefined;
          const a = this.attempt(m, body, model ? estimateReservation(body, model) : 0);
          const exp = m.experimentId ? this.store.getExperiment(m.experimentId) : undefined;
          try {
            this.store.reserve(
              a,
              m.config.maxUsd,
              exp ? { id: exp.id, cap: exp.config.maxUsd } : undefined,
            );
          } catch (error) {
            m.status = 'budget';
            m.message = (error as Error).message;
            this.save(m);
            return;
          }
          this.emit(id, { type: 'request', attemptId: a.id, player, startedAt: a.startedAt });
          let choice: { action: string; explanation: string };
          try {
            if (model) {
              const reasoningOff = new AbortController();
              const completion = await this.provider
                .complete(
                  body,
                  AbortSignal.any([c.abort.signal, reasoningOff.signal]),
                  (kind, text) => {
                    this.emit(id, { type: 'delta', attemptId: a.id, kind, text });
                    if (p.reasoning === 'off' && kind === 'reasoning' && text.trim())
                      reasoningOff.abort();
                  },
                )
                .catch((error: unknown) => {
                  if (reasoningOff.signal.aborted && error instanceof ProviderError)
                    throw new ProviderError(
                      'Provider emitted reasoning despite reasoning off. Check this model and endpoint before resuming.',
                      error.partial,
                    );
                  throw error;
                });
              Object.assign(a, completion);
              a.costUsd = a.usage ? usageCost(a.usage, model) : a.reservedUsd;
              a.costKind = a.usage ? 'reported' : 'upper-bound';
              if (
                p.reasoning === 'off' &&
                (a.reasoning.trim() || (a.usage?.reasoningTokens ?? 0) > 0)
              )
                throw new ProviderError(
                  'Provider emitted reasoning despite reasoning off. Check this model and endpoint before resuming.',
                  completion,
                );
              if (completion.finishReason === 'length')
                throw new Error('Output token limit reached before a usable complete response.');
              choice = parseAction(
                a.raw,
                m.config.format,
                gameFor(m.state.game).legalActions(m.state),
                m.config.explanation,
              );
            } else {
              const started = performance.now();
              choice = baselineMove(m.state, p.kind, m.config.seed + player * 101);
              a.raw = `ACTION: ${choice.action}\n${choice.explanation}`;
              a.latencyMs = performance.now() - started;
              a.finishReason = 'stop';
            }
            if (c.abort.signal.aborted) {
              a.outcome = 'cancelled';
              a.finishedAt = now();
              this.store.finish(a, this.store.getMatch(id));
              return;
            }
            const latest = this.store.getMatch(id);
            if (hash(stableState(latest.state)) !== a.stateHash)
              throw new Error('State changed while the action was in flight.');
            m = latest;
            const next = gameFor(m.state.game).apply(m.state, choice.action);
            a.outcome = 'accepted';
            a.finishedAt = now();
            m.moves.push({
              index: m.moves.length + 1,
              action: choice.action,
              player,
              captured: next.captured,
              retained: next.retained,
              state: next.state,
              explanation: m.config.explanation ? choice.explanation : '',
              explanationSource: model ? 'model' : 'baseline',
              attemptId: a.id,
              latencyMs: a.latencyMs,
              firstTokenMs: a.firstTokenMs,
              usage: a.usage,
              costUsd: a.costUsd,
              costKind: a.costKind,
              evaluation,
              regret:
                evaluation.status === 'exact'
                  ? evaluation.value! - evaluation.actionValues[choice.action]
                  : null,
            });
            m.state = next.state;
            m.outcome = next.outcome;
            if (next.outcome) {
              m.status = 'completed';
              m.message = next.outcome.reason;
            } else if (m.config.maxMoves && m.moves.length >= m.config.maxMoves) {
              m.status = 'completed';
              m.message = 'Position test complete; the game itself has not ended.';
            } else if (step || c.pause) {
              m.status = 'paused';
              m.message = 'Paused at a move boundary.';
            }
            this.store.finish(a, m);
            this.publish(m);
            accepted = true;
            break;
          } catch (error) {
            if (error instanceof ProviderError) {
              Object.assign(a, error.partial);
              a.costUsd = a.usage && model ? usageCost(a.usage, model) : a.reservedUsd;
              a.costKind = a.usage ? 'reported' : 'upper-bound';
              a.outcome = c.abort.signal.aborted ? 'cancelled' : 'error';
              a.error =
                error.message + (error.retryAfter ? ` Retry-After: ${error.retryAfter}.` : '');
            } else {
              a.outcome = model ? 'invalid' : 'error';
              a.error = (error as Error).message;
            }
            a.finishedAt = now();
            m = this.store.getMatch(id);
            if (c.abort.signal.aborted) {
              m.status = 'stopped';
              m.message = 'Stopped. Request cost is retained in the ledger.';
            } else if (a.outcome === 'error') {
              m.status = 'interrupted';
              m.message = `${a.error} Resume explicitly to make another request.`;
            } else if (retry === m.config.repairAttempts) {
              m.status = 'forfeit';
              m.message = 'No valid action after the allowed correction attempts.';
              m.outcome = {
                winner: (1 - player) as Player,
                scores: m.state.scores,
                reason: 'Protocol forfeit',
              };
            } else
              m.message = 'Invalid action recorded. Making the one allowed correction request.';
            this.store.finish(a, m);
            this.publish(m);
            if (m.status !== 'running') return;
          }
        }
        if (!accepted || this.store.getMatch(id).status !== 'running') return;
        const delay = m.config.moveDelayMs ?? 0;
        if (delay) await waitBetweenMoves(delay, undefined, { signal: c.abort.signal });
        else await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      const m = this.store.getMatch(id);
      if (m.status === 'running') {
        m.status = 'interrupted';
        m.message = (error as Error).message;
        this.save(m);
      }
    }
  }
  async probe(id: string): Promise<Capabilities> {
    const model = this.model(id),
      caps: Capabilities = {
        checkedAt: now(),
        adapterVersion: ADAPTER_VERSION,
        endpoint: this.provider.baseUrl,
        json: false,
        schema: false,
        reasoningControl: 'unverified',
        reasoningExposed: false,
        streaming: false,
        usage: false,
        notes: [],
      };
    let on = false,
      off = false;
    for (const mode of ['schema', 'on', 'off']) {
      const body: Record<string, unknown> = {
        model: id,
        messages: [
          {
            role: 'system',
            content:
              'Return a JSON object with action and explanation strings. Pick the only legal action C:0:0. Keep the explanation to one sentence.',
          },
          { role: 'user', content: 'Legal actions: ["C:0:0"].' },
        ],
        max_tokens: 1024,
        temperature: 0,
        response_format:
          mode === 'schema'
            ? {
                type: 'json_schema',
                json_schema: { name: 'move', strict: true, schema: actionSchema },
              }
            : { type: 'json_object' },
        ...(mode === 'schema' ? {} : { chat_template_kwargs: { enable_thinking: mode === 'on' } }),
      };
      const a = this.attempt(null, body, estimateReservation(body, model));
      this.store.reserve(a);
      try {
        const result = await this.provider.complete(body, new AbortController().signal);
        Object.assign(a, result);
        a.costUsd = a.usage ? usageCost(a.usage, model) : a.reservedUsd;
        a.costKind = a.usage ? 'reported' : 'upper-bound';
        parseAction(a.raw, 'json_object', ['C:0:0']);
        if (a.finishReason === 'length') throw new Error('Probe hit output token cap.');
        caps.streaming = true;
        caps.usage ||= Boolean(a.usage);
        caps.reasoningExposed ||= Boolean(a.reasoning);
        if (mode === 'schema') caps.schema = true;
        else {
          caps.json = true;
          if (mode === 'on') on = Boolean(a.reasoning);
          else off = !a.reasoning;
        }
        a.outcome = 'probe';
      } catch (error) {
        if (error instanceof ProviderError) Object.assign(a, error.partial);
        a.costUsd = a.usage ? usageCost(a.usage, model) : a.reservedUsd;
        a.costKind = a.usage ? 'reported' : 'upper-bound';
        a.outcome = 'error';
        a.error = (error as Error).message;
        caps.notes.push(`${mode}: ${a.error}`);
      }
      a.finishedAt = now();
      this.store.finish(a);
    }
    if (on && off) caps.reasoningControl = 'observed';
    caps.notes.push(
      'Probe observations apply to this endpoint and model at this time; they are not guarantees of internal computation.',
    );
    this.store.setCapabilities(this.provider.baseUrl, id, caps);
    return caps;
  }
}
