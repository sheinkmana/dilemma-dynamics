import { randomUUID } from 'node:crypto';
import { experimentSchema } from '../shared/config.js';
import { TEST_SCENARIOS } from '../games/scenarios.js';
import { rng } from '../engine/game.js';
import type { ExperimentRecord, MatchRecord, Player } from '../shared/types.js';
import { Runner } from './runner.js';
export class Experiments {
  private active = new Map<string, Promise<void>>();
  constructor(public runner: Runner) {}
  create(input: unknown) {
    const config = experimentSchema.parse(input);
    if (config.match.players.some((p) => p.kind === 'human'))
      throw new Error('Experiments require automated players. Use a regular match for human play.');
    this.runner.validate(config.match);
    if (config.kind === 'positions' && config.match.game !== 'dots-boxes')
      throw new Error('Held-out positions currently cover Dots and Boxes only.');
    if (config.kind === 'paired' && config.match.maxMoves)
      throw new Error('Paired comparisons require complete games.');
    const e: ExperimentRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      config,
      status: 'paused',
      tasks: [],
      message: 'Ready.',
    };
    // Materialize and persist the entire schedule before any billable work starts.
    this.runner.store.transaction(() => {
      this.runner.store.saveExperiment(e);
      for (
        let pair = 0;
        pair < (config.kind === 'paired' ? config.pairs : TEST_SCENARIOS.length);
        pair++
      )
        for (const contestant of [0, 1] as Player[]) {
          const match = structuredClone(config.match);
          match.seed = (match.seed + pair) % 2147483647;
          const swapped = config.kind === 'paired' && contestant === 1;
          if (config.kind === 'paired') {
            if (swapped) match.players.reverse();
          } else {
            match.scenario = TEST_SCENARIOS[pair];
            match.openingMoves = 0;
            match.maxMoves = 1;
            match.players = [config.match.players[contestant], config.match.players[contestant]];
          }
          const m = this.runner.create(match, { experimentId: e.id });
          e.tasks.push({
            matchId: m.id,
            swapped,
            pair,
            scenario: match.scenario,
            ...(config.kind === 'positions' ? { contestant } : {}),
          });
        }
      this.runner.store.saveExperiment(e);
    });
    return e;
  }
  start(id: string) {
    if (this.active.has(id)) return;
    const e = this.runner.store.getExperiment(id);
    if (['stopped', 'completed'].includes(e.status)) throw new Error('This experiment has ended.');
    e.status = 'running';
    e.message = 'Running one match at a time to bound spend and rate limits.';
    this.runner.store.saveExperiment(e);
    const task = this.run(id).finally(() => this.active.delete(id));
    this.active.set(id, task);
  }
  private async run(id: string) {
    try {
      for (const task of this.runner.store.getExperiment(id).tasks) {
        let e = this.runner.store.getExperiment(id);
        if (e.status !== 'running') return;
        const m = this.runner.store.getMatch(task.matchId);
        if (['completed', 'forfeit'].includes(m.status)) continue;
        if (!['ready', 'paused', 'interrupted'].includes(m.status)) {
          e.status = 'paused';
          e.message = `A match ended with status ${m.status}; review the run before creating another experiment.`;
          this.runner.store.saveExperiment(e);
          return;
        }
        await this.runner.start(m.id);
        e = this.runner.store.getExperiment(id);
        if (e.status !== 'running') return;
        const after = this.runner.store.getMatch(m.id);
        if (!['completed', 'forfeit'].includes(after.status)) {
          e.status = 'paused';
          e.message = after.message;
          this.runner.store.saveExperiment(e);
          return;
        }
      }
      const e = this.runner.store.getExperiment(id);
      e.status = 'completed';
      e.message = 'Scheduled runs are complete.';
      this.runner.store.saveExperiment(e);
    } catch (error) {
      const e = this.runner.store.getExperiment(id);
      e.status = 'paused';
      e.message = (error as Error).message;
      this.runner.store.saveExperiment(e);
    }
  }
  pause(id: string) {
    const e = this.runner.store.getExperiment(id);
    if (e.status !== 'running') return;
    e.status = 'paused';
    e.message = 'Paused; any active decision finishes at its move boundary.';
    this.runner.store.saveExperiment(e);
    for (const t of e.tasks)
      if (this.runner.store.getMatch(t.matchId).status === 'running') this.runner.pause(t.matchId);
  }
  stop(id: string) {
    const e = this.runner.store.getExperiment(id);
    e.status = 'stopped';
    e.message = 'Stopped by user.';
    this.runner.store.saveExperiment(e);
    for (const t of e.tasks) {
      const m = this.runner.store.getMatch(t.matchId);
      if (!['completed', 'forfeit'].includes(m.status)) this.runner.stop(m.id);
    }
  }
  async idle() {
    await Promise.all(this.active.values());
  }
  report(id: string) {
    const experiment = this.runner.store.getExperiment(id);
    const report = experimentReport(
      experiment,
      experiment.tasks.map((t) => this.runner.store.getMatch(t.matchId)),
    );
    report.matches.forEach((m, i) => {
      const task = report.experiment.tasks[i];
      for (const a of this.runner.store.attempts(m.id)) {
        const index = task.contestant ?? (task.swapped ? 1 - a.player! : a.player!);
        const row = report.rows[index];
        if (!row) continue;
        row.attempts++;
        row.invalid += a.outcome === 'invalid' ? 1 : 0;
        row.costUsd += a.costUsd;
        row.promptTokens += a.usage?.promptTokens ?? 0;
        row.completionTokens += a.usage?.completionTokens ?? 0;
        if (a.model !== 'local' && !a.model.startsWith('local/') && !a.usage) row.missingUsage++;
      }
    });
    return report;
  }
}
export function experimentReport(experiment: ExperimentRecord, matches: MatchRecord[]) {
  const rows = experiment.config.match.players.map((p, contestant) => ({
    name: p.name,
    contestant,
    wins: 0,
    draws: 0,
    losses: 0,
    completed: 0,
    positions: 0,
    exact: 0,
    optimal: 0,
    regret: 0,
    attempts: 0,
    invalid: 0,
    promptTokens: 0,
    completionTokens: 0,
    missingUsage: 0,
    costUsd: 0,
    latencies: [] as number[],
  }));
  const pairMargins = new Map<number, number[]>();
  matches.forEach((m, i) => {
    const task = experiment.tasks[i];
    for (const [ci, row] of rows.entries()) {
      if (experiment.config.kind === 'positions' && task.contestant !== ci) continue;
      const slot = (task.swapped ? 1 - ci : ci) as Player;
      const moves =
        experiment.config.kind === 'positions' ? m.moves : m.moves.filter((x) => x.player === slot);
      row.positions += moves.length;
      for (const move of moves) {
        if (move.regret !== null) {
          row.exact++;
          row.regret += move.regret;
          if (move.regret === 0) row.optimal++;
        }
        row.latencies.push(move.latencyMs);
      }
      if (experiment.config.kind === 'paired' && m.outcome) {
        row.completed++;
        if (m.outcome.winner === null) row.draws++;
        else if (m.outcome.winner === slot) row.wins++;
        else row.losses++;
      }
    }
    if (experiment.config.kind === 'paired' && m.status === 'completed' && m.outcome) {
      const margin = (m.state.scores[0] - m.state.scores[1]) * (task.swapped ? -1 : 1);
      pairMargins.set(task.pair, [...(pairMargins.get(task.pair) ?? []), margin]);
    }
  });
  const means = [...pairMargins.values()]
    .filter((x) => x.length === 2)
    .map((x) => (x[0] + x[1]) / 2);
  let interval: [number, number] | null = null;
  if (means.length >= 3) {
    const random = rng(73),
      samples = Array.from(
        { length: 2000 },
        () => means.reduce((s) => s + means[Math.floor(random() * means.length)], 0) / means.length,
      ).sort((a, b) => a - b);
    interval = [samples[49], samples[1949]];
  }
  return {
    experiment,
    matches,
    rows,
    pairedMargin: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
    pairedInterval: interval,
    completePairs: means.length,
  };
}
