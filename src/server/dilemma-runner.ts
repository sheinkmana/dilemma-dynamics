import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { analyze, ANALYSIS_VERSION } from '../dilemma/analysis.js';
import { CONTINUATION_PROBABILITY } from '../dilemma/spec.js';
import { observation, parseDecision } from '../dilemma/observations.js';
import {
  configSchema,
  continuationWeight,
  payoff,
  PROTOCOL_VERSION,
  RULES_VERSION,
} from '../dilemma/rules.js';
import type {
  Decision,
  DilemmaConfig,
  DilemmaSession,
  PendingRound,
  Seat,
  StoredSession,
} from '../dilemma/types.js';
import type { AttemptRecord, ModelInfo } from '../shared/types.js';
import { Runner } from './runner.js';
import { ProviderError } from './provider.js';
import { estimateReservation, PRICING_DATE, usageCost } from './models.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const seats: Seat[] = [0, 1];
// Independent domains make request order and retries irrelevant to gameplay randomness.
export function draw(seed: string, domain: string, round: number): number {
  // Rejection sampling yields ten equally likely outcomes, so .9 and .5 are exact ratios.
  for (let retry = 0; ; retry++) {
    const value = createHmac('sha256', seed)
      .update(`${domain}:${round}:${retry}`)
      .digest()
      .readUInt32BE(0);
    if (value < 4294967290) return (value % 10) / 10;
  }
}
function beforeHash(s: StoredSession) {
  return hash({ config: s.config, scores: s.scores, rounds: s.rounds.map((r) => r.actions) });
}
export function publicSession(s: StoredSession): DilemmaSession {
  return structuredClone({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    config: s.config,
    rounds: s.rounds,
    scores: s.scores,
    status: s.status,
    message: s.message,
    endReason: s.endReason,
    received: s.received,
    pendingRound: s.pendingRound,
    spentUsd: s.spentUsd,
    reservedUsd: s.reservedUsd,
    attempts: s.attempts,
    invalidAttempts: s.invalidAttempts,
    version: s.version,
    rulesVersion: s.rulesVersion,
    protocolVersion: s.protocolVersion,
    analysisVersion: s.analysisVersion,
    endpoint: s.endpoint,
    pricingDate: s.pricingDate,
  });
}
export class DilemmaRunner extends EventEmitter {
  private active = new Map<
    string,
    { abort: AbortController; pause: boolean; promise: Promise<void> }
  >();
  constructor(public board: Runner) {
    super();
    this.setMaxListeners(100);
  }
  get store() {
    return this.board.store;
  }
  private model(id: string): ModelInfo {
    if (!this.board.provider.configured)
      throw new Error('Configure the server key before selecting autonomous models.');
    const m = this.board.models().find((m) => m.id === id && m.available);
    if (!m || m.inputRate === null || m.outputRate === null)
      throw new Error('Model is unavailable or has no reviewed price. Refresh models.');
    return m;
  }
  private validate(c: DilemmaConfig) {
    for (const p of c.players) if (p.kind === 'model') this.model(p.model);
  }
  create(input: unknown, creationKey: string = randomUUID()): DilemmaSession {
    const config = configSchema.parse(input);
    const prior = this.store.dilemmas().find((s) => s.creationKey === creationKey);
    if (prior) {
      if (hash(prior.config) !== hash(config))
        throw new Error('Creation key was already used with different settings.');
      return publicSession(prior);
    }
    this.validate(config);
    const s: StoredSession = {
      id: randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      config,
      environmentSeed: randomBytes(32).toString('hex'),
      creationKey,
      rounds: [],
      scores: [0, 0],
      status: 'ready',
      message: 'Ready. Both choices will remain private until joint reveal.',
      endReason: null,
      received: [false, false],
      pendingRound: null,
      spentUsd: 0,
      reservedUsd: 0,
      attempts: 0,
      invalidAttempts: 0,
      version: 0,
      rulesVersion: RULES_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      endpoint: this.board.provider.baseUrl,
      pricingDate: PRICING_DATE,
    };
    this.store.saveDilemma(s);
    return publicSession(s);
  }
  get(id: string) {
    return publicSession(this.store.getDilemma(id));
  }
  list() {
    return this.store.dilemmas().map((s) => {
      const { rounds, ...summary } = publicSession(s);
      return { ...summary, roundCount: rounds.length };
    });
  }
  private publish(id: string) {
    this.emit(id, this.get(id));
  }
  start(id: string, step = false): Promise<void> {
    const existing = this.active.get(id);
    if (existing) return existing.promise;
    const s = this.store.getDilemma(id);
    if (!['ready', 'paused', 'interrupted'].includes(s.status))
      throw new Error('This interaction cannot be resumed. Start a new session.');
    this.validate(s.config);
    const control = { abort: new AbortController(), pause: false, promise: Promise.resolve() };
    this.active.set(id, control);
    s.status = 'running';
    s.endReason = null;
    s.message = 'Choosing privately. Both players see only completed rounds.';
    this.store.saveDilemma(s);
    this.publish(id);
    control.promise = this.run(id, control, step).finally(() => this.active.delete(id));
    return control.promise;
  }
  pause(id: string) {
    const control = this.active.get(id),
      s = this.store.getDilemma(id);
    if (control) {
      control.pause = true;
      s.message = 'Pause requested; the current joint round will finish.';
    } else if (s.status === 'ready') {
      s.status = 'paused';
      s.message = 'Paused before the first round.';
    } else return;
    this.store.saveDilemma(s);
    this.publish(id);
  }
  stop(id: string) {
    const s = this.store.getDilemma(id);
    if (!['ready', 'running', 'paused', 'interrupted', 'budget'].includes(s.status)) return;
    this.active.get(id)?.abort.abort();
    s.status = 'stopped';
    s.endReason = 'user-stop';
    s.message =
      'Stopped. Unresolved choices earned no points; incurred request costs remain recorded.';
    this.store.saveDilemma(s);
    this.publish(id);
  }
  async idle() {
    await Promise.all([...this.active.values()].map((c) => c.promise));
  }
  // This is the only route from validated private responses into public gameplay.
  private commit(id: string) {
    this.store.transaction(() => {
      const s = this.store.getDilemma(id),
        p = this.store.pendingDilemma(id);
      if (s.status !== 'running' || !p?.sealed[0] || !p.sealed[1])
        throw new Error('The joint round is not ready to resolve.');
      if (p.beforeHash !== beforeHash(s) || p.index !== s.rounds.length + 1)
        throw new Error('Stale joint round.');
      const decisions = [p.sealed[0].decision, p.sealed[1].decision] as [Decision, Decision];
      const actions = decisions.map((d) => d.action) as ['C' | 'D', 'C' | 'D'];
      const points = payoff(...actions),
        forecasts = decisions.map((d) => d.forecast) as [
          Decision['forecast'],
          Decision['forecast'],
        ];
      const delta = continuationWeight(s.config, p.index);
      const ended =
        s.config.horizon.kind === 'fixed'
          ? p.index === s.config.horizon.rounds
          : draw(s.environmentSeed, 'stop', p.index) >= CONTINUATION_PROBABILITY;
      const attempts = p.sealed.map(
        (d) => this.store.dilemmaAttempts(id).find((a) => a.id === d!.attemptId)!,
      );
      if (attempts.some((a) => !a || a.outcome !== 'accepted'))
        throw new Error('A validated decision record is missing.');
      s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
      s.rounds.push({
        index: p.index,
        beforeHash: p.beforeHash,
        actions,
        payoffs: points,
        scores: [...s.scores],
        forecasts,
        analysis: [
          analyze(actions[0], actions[1], forecasts[0], delta),
          analyze(actions[1], actions[0], forecasts[1], delta),
        ],
        attemptIds: [p.sealed[0].attemptId, p.sealed[1].attemptId],
        costUsd: this.store
          .dilemmaAttempts(id)
          .filter((a) => a.moveIndex === p.index - 1)
          .reduce((sum, a) => sum + a.costUsd, 0),
        telemetry: [0, 1].map((i) => ({
          latencyMs: attempts[i].latencyMs,
          usage: attempts[i].usage,
          costUsd: attempts[i].costUsd,
        })) as (typeof s.rounds)[number]['telemetry'],
        continuation: ended
          ? s.config.horizon.kind === 'fixed'
            ? 'fixed-final'
            : 'geometric-stop'
          : 'continued',
        resolvedAt: now(),
      });
      s.received = [false, false];
      s.pendingRound = null;
      if (ended) {
        s.status = 'completed';
        s.endReason = s.config.horizon.kind === 'fixed' ? 'fixed-final' : 'geometric-stop';
        s.message =
          s.config.horizon.kind === 'fixed'
            ? 'The scheduled final round completed.'
            : `Interaction ended by the stopping draw after round ${p.index}.`;
      } else s.message = `Round ${p.index} revealed. Another round follows.`;
      this.store.clearPendingDilemma(id);
      this.store.refreshDilemmaCosts(s);
      this.store.saveDilemma(s);
    });
    this.publish(id);
  }
  private async decide(id: string, seat: Seat, a: AttemptRecord, signal: AbortSignal) {
    let decision: Decision | null = null;
    const initial = this.store.getDilemma(id),
      pending = this.store.pendingDilemma(id)!;
    const player = initial.config.players[seat];
    try {
      if (player.kind === 'model') {
        // Prices were reviewed and snapshotted before the pair was reserved.
        // Discovery changes must not reclassify an already reserved request.
        const guard = new AbortController();
        try {
          const completion = await this.board.provider.complete(
            a.request,
            AbortSignal.any([signal, guard.signal]),
            (kind, text) => {
              if (kind === 'reasoning' && text.trim()) guard.abort();
            },
          );
          Object.assign(a, completion);
          if (completion.reasoning.trim() || (completion.usage?.reasoningTokens ?? 0) > 0)
            throw new ProviderError(
              'Provider exposed reasoning despite reasoning off. No choice was applied.',
              completion,
            );
          if (completion.finishReason !== 'stop')
            throw new Error('Provider did not finish a complete decision. No choice was applied.');
          decision = parseDecision(completion.raw, initial.config, pending.index);
        } catch (error) {
          if (guard.signal.aborted && error instanceof ProviderError)
            throw new ProviderError(
              'Provider exposed reasoning despite reasoning off. No choice was applied.',
              error.partial,
            );
          throw error;
        } finally {
          a.costUsd = a.usage ? usageCost(a.usage, a.pricing!) : a.reservedUsd;
          a.costKind = a.usage ? 'reported' : 'upper-bound';
        }
      } else {
        const previous = initial.rounds.at(-1);
        decision = {
          action:
            player.kind === 'demo-random'
              ? draw(initial.environmentSeed, `demo-${seat}`, pending.index) < 0.5
                ? 'C'
                : 'D'
              : (previous?.actions[1 - seat] ?? 'C'),
          forecast: null,
        };
        a.raw = `Local demo action: ${decision.action}`;
        a.finishReason = 'stop';
      }
      a.outcome = signal.aborted ? 'cancelled' : 'accepted';
    } catch (error) {
      if (error instanceof ProviderError) {
        Object.assign(a, error.partial);
        a.costUsd = a.usage ? usageCost(a.usage, a.pricing!) : a.reservedUsd;
        a.costKind = a.usage ? 'reported' : 'upper-bound';
        a.outcome = signal.aborted ? 'cancelled' : 'error';
        a.error = error.message;
      } else {
        a.outcome = signal.aborted ? 'cancelled' : 'invalid';
        a.error = error instanceof Error ? error.message : 'Decision validation failed.';
      }
    }
    a.finishedAt = now();
    this.store.transaction(() => {
      this.store.saveAttempt(a);
      const s = this.store.getDilemma(id),
        p = this.store.pendingDilemma(id);
      if (
        decision &&
        a.outcome === 'accepted' &&
        s.status === 'running' &&
        p?.beforeHash === pending.beforeHash &&
        beforeHash(s) === pending.beforeHash
      ) {
        p.sealed[seat] = { decision, attemptId: a.id };
        this.store.savePendingDilemma(id, p);
        s.received[seat] = true;
      }
      this.store.refreshDilemmaCosts(s);
      this.store.saveDilemma(s);
    });
    this.publish(id);
  }
  private async run(id: string, c: { abort: AbortController; pause: boolean }, step: boolean) {
    try {
      while (!c.abort.signal.aborted) {
        let s = this.store.getDilemma(id);
        if (s.status !== 'running') return;
        if (c.pause) {
          s.status = 'paused';
          s.message = 'Paused at a joint-round boundary.';
          this.store.saveDilemma(s);
          this.publish(id);
          return;
        }
        let p = this.store.pendingDilemma(id);
        if (!p) {
          p = {
            index: s.rounds.length + 1,
            beforeHash: beforeHash(s),
            messages: [observation(s, 0), observation(s, 1)],
            sealed: [null, null],
          };
          this.store.savePendingDilemma(id, p);
        }
        s.pendingRound = p.index;
        s.message = `Round ${p.index}: choosing privately from the same completed history.`;
        this.store.saveDilemma(s);
        if (p.beforeHash !== beforeHash(s))
          throw new Error('The pending round no longer matches committed history.');
        // A conservative byte guard prevents silently losing early history on long runs.
        if (
          p.messages.some((messages) => Buffer.byteLength(JSON.stringify(messages), 'utf8') > 48000)
        ) {
          s.status = 'interrupted';
          s.endReason = 'context';
          s.message = 'History reached the local context guard. No history was truncated.';
          this.store.saveDilemma(s);
          this.publish(id);
          return;
        }
        const attempts = seats
          .filter((seat) => !p!.sealed[seat])
          .map((seat) => {
            const player = s.config.players[seat],
              model = player.kind === 'model' ? this.model(player.model) : undefined;
            const body = {
              model: model?.id ?? `local/${player.kind}`,
              messages: p!.messages[seat],
              temperature: 0,
              max_tokens: s.config.protocol === 'actions' ? 128 : 256,
              chat_template_kwargs: { enable_thinking: false },
            };
            const a: AttemptRecord = {
              id: randomUUID(),
              dilemmaId: id,
              matchId: null,
              moveIndex: p!.index - 1,
              player: seat,
              startedAt: now(),
              model: body.model,
              endpoint: s.endpoint,
              stateHash: p!.beforeHash,
              promptHash: hash(body.messages),
              prompt: body.messages,
              request: body,
              raw: '',
              reasoning: '',
              outcome: 'pending',
              usage: null,
              reservedUsd: model ? estimateReservation(body, model) : 0,
              costUsd: 0,
              costKind: 'local',
              latencyMs: 0,
              firstTokenMs: null,
              finishReason: null,
              providerRequestId: null,
              pricing: model
                ? {
                    inputRate: model.inputRate,
                    outputRate: model.outputRate,
                    date: model.pricingDate,
                  }
                : undefined,
            };
            return a;
          });
        try {
          this.store.reserveDilemma(attempts, id, s.config.maxUsd);
        } catch (error) {
          s = this.store.getDilemma(id);
          s.status = 'budget';
          s.endReason = 'budget';
          s.message = (error as Error).message;
          this.store.saveDilemma(s);
          this.publish(id);
          return;
        }
        this.publish(id);
        const results = await Promise.allSettled(
          attempts.map((a) => this.decide(id, a.player as Seat, a, c.abort.signal)),
        );
        if (results.some((r) => r.status === 'rejected'))
          throw new Error(
            'Decision settlement failed; review the interrupted round before resuming.',
          );
        s = this.store.getDilemma(id);
        if (s.status !== 'running' || c.abort.signal.aborted) return;
        const failed =
          attempts.find((a) => a.outcome === 'invalid') ??
          attempts.find((a) => a.outcome !== 'accepted');
        if (failed) {
          s.status = failed.outcome === 'invalid' ? 'invalid' : 'interrupted';
          s.endReason = failed.outcome === 'invalid' ? 'protocol' : 'provider';
          s.message = `Player ${failed.player === 0 ? 'A' : 'B'}: ${failed.error ?? 'Decision failed. No joint payoff was applied.'}`;
          this.store.saveDilemma(s);
          this.publish(id);
          return;
        }
        this.commit(id);
        s = this.store.getDilemma(id);
        if (s.status !== 'running') return;
        if (step || c.pause) {
          s.status = 'paused';
          s.message = 'Paused at a joint-round boundary.';
          this.store.saveDilemma(s);
          this.publish(id);
          return;
        }
        if (s.config.delayMs) await wait(s.config.delayMs, undefined, { signal: c.abort.signal });
        else await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      const s = this.store.getDilemma(id);
      if (s.status === 'running') {
        s.status = 'interrupted';
        s.endReason = 'execution';
        s.message = (error as Error).message;
        this.store.saveDilemma(s);
        this.publish(id);
      }
    }
  }
  audit(id: string) {
    const s = this.store.getDilemma(id),
      committed = new Set(s.rounds.flatMap((r) => r.attemptIds));
    return this.store.dilemmaAttempts(id).map((a) =>
      committed.has(a.id)
        ? a
        : {
            id: a.id,
            player: a.player,
            moveIndex: a.moveIndex,
            outcome: a.outcome,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            costUsd: a.costUsd,
            reservedUsd: a.reservedUsd,
            costKind: a.costKind,
            usage: a.usage,
            note: 'Uncommitted response remains private and earned no points.',
          },
    );
  }
}
