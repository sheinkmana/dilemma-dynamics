import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PendingRound, StoredSession } from '../dilemma/types.js';
import type {
  AttemptRecord,
  MatchRecord,
  ExperimentRecord,
  Capabilities,
} from '../shared/types.js';
export class Store {
  db: DatabaseSync;
  private owner = randomUUID();
  constructor(file: string, defaultCap = 5) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, match_id TEXT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dilemma_sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dilemma_pending(id TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    try {
      this.transaction(() => {
        const owner = this.getSetting<{ pid: number; token: string }>('__owner');
        if (owner) {
          let alive = true;
          try {
            process.kill(owner.pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
          }
          if (alive)
            throw new Error(
              'This database is already open by a Game Field process. Stop that process or choose another GAMEFIELD_DATA_DIR.',
            );
        }
        this.setSetting('__owner', { pid: process.pid, token: this.owner });
      });
      if (this.getSetting('cap') === undefined) this.setSetting('cap', defaultCap);
      this.recover();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  getSetting<T>(id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM settings WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  setSetting(id: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(id, JSON.stringify(value));
  }
  getMatch(id: string): MatchRecord {
    const row = this.db.prepare('SELECT body FROM matches WHERE id=?').get(id);
    if (!row) throw new Error('Match not found.');
    return JSON.parse(String(row.body));
  }
  matches(): MatchRecord[] {
    return this.db
      .prepare('SELECT body FROM matches ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.body)) as MatchRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  saveMatch(match: MatchRecord) {
    match.updatedAt = new Date().toISOString();
    const ev = this.db
      .prepare('INSERT INTO events(match_id,body) VALUES (?,?)')
      .run(
        match.id,
        JSON.stringify({ status: match.status, move: match.moves.length, time: match.updatedAt }),
      );
    match.lastEventId = Number(ev.lastInsertRowid);
    this.db
      .prepare('INSERT OR REPLACE INTO matches VALUES (?,?)')
      .run(match.id, JSON.stringify(match));
  }
  saveAttempt(a: AttemptRecord) {
    this.db
      .prepare('INSERT OR REPLACE INTO attempts VALUES (?,?,?)')
      .run(a.id, a.matchId, JSON.stringify(a));
  }
  attempts(matchId?: string): AttemptRecord[] {
    return (
      matchId
        ? this.db.prepare('SELECT body FROM attempts WHERE match_id=? ORDER BY rowid').all(matchId)
        : this.db.prepare('SELECT body FROM attempts ORDER BY rowid').all()
    ).map((r) => JSON.parse(String(r.body)));
  }
  ledger() {
    const attempts = this.attempts();
    return {
      spent: attempts.reduce((s, a) => s + (a.outcome === 'pending' ? 0 : a.costUsd), 0),
      reserved: attempts.reduce((s, a) => s + (a.outcome === 'pending' ? a.reservedUsd : 0), 0),
      cap: this.getSetting<number>('cap')!,
    };
  }
  reserve(a: AttemptRecord, matchCap?: number, experiment?: { id: string; cap: number }) {
    this.transaction(() => {
      const l = this.ledger();
      if (l.spent + l.reserved + a.reservedUsd > l.cap + 1e-10)
        throw new Error('Session budget cannot cover another request.');
      if (a.matchId && matchCap !== undefined) {
        const total = this.attempts(a.matchId).reduce(
          (s, x) => s + (x.outcome === 'pending' ? x.reservedUsd : x.costUsd),
          0,
        );
        if (total + a.reservedUsd > matchCap + 1e-10)
          throw new Error('Match budget cannot cover another request.');
      }
      if (experiment) {
        const ids = new Set(this.getExperiment(experiment.id).tasks.map((t) => t.matchId));
        const total = this.attempts()
          .filter((x) => x.matchId && ids.has(x.matchId))
          .reduce((s, x) => s + (x.outcome === 'pending' ? x.reservedUsd : x.costUsd), 0);
        if (total + a.reservedUsd > experiment.cap + 1e-10)
          throw new Error('Experiment budget cannot cover another request.');
      }
      this.saveAttempt(a);
    });
  }
  finish(a: AttemptRecord, match?: MatchRecord) {
    this.transaction(() => {
      this.saveAttempt(a);
      if (match) {
        match.spentUsd = this.attempts(match.id).reduce((s, x) => s + x.costUsd, 0);
        match.attempts = this.attempts(match.id).length;
        match.invalidAttempts = this.attempts(match.id).filter(
          (x) => x.outcome === 'invalid',
        ).length;
        this.saveMatch(match);
      }
    });
  }
  getDilemma(id: string): StoredSession {
    const row = this.db.prepare('SELECT body FROM dilemma_sessions WHERE id=?').get(id);
    if (!row) throw new Error('Dilemma session not found.');
    return JSON.parse(String(row.body));
  }
  dilemmas(): StoredSession[] {
    return this.db
      .prepare('SELECT body FROM dilemma_sessions ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.body)) as StoredSession);
  }
  saveDilemma(session: StoredSession) {
    session.updatedAt = new Date().toISOString();
    session.version++;
    this.db
      .prepare('INSERT OR REPLACE INTO dilemma_sessions VALUES (?,?)')
      .run(session.id, JSON.stringify(session));
  }
  pendingDilemma(id: string): PendingRound | null {
    const row = this.db.prepare('SELECT body FROM dilemma_pending WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : null;
  }
  savePendingDilemma(id: string, pending: PendingRound) {
    this.db
      .prepare('INSERT OR REPLACE INTO dilemma_pending VALUES (?,?)')
      .run(id, JSON.stringify(pending));
  }
  clearPendingDilemma(id: string) {
    this.db.prepare('DELETE FROM dilemma_pending WHERE id=?').run(id);
  }
  dilemmaAttempts(id: string): AttemptRecord[] {
    return this.attempts().filter((a) => a.dilemmaId === id);
  }
  reserveDilemma(attempts: AttemptRecord[], id: string, cap: number) {
    this.transaction(() => {
      const extra = attempts.reduce((sum, a) => sum + a.reservedUsd, 0),
        l = this.ledger();
      if (l.spent + l.reserved + extra > l.cap + 1e-10)
        throw new Error('Global budget cannot reserve both decisions. No new request was started.');
      const owned = this.dilemmaAttempts(id).reduce(
        (sum, a) => sum + (a.outcome === 'pending' ? a.reservedUsd : a.costUsd),
        0,
      );
      if (owned + extra > cap + 1e-10)
        throw new Error(
          'Session budget cannot reserve both decisions. No new request was started.',
        );
      for (const a of attempts) this.saveAttempt(a);
      const s = this.getDilemma(id);
      this.refreshDilemmaCosts(s);
      this.saveDilemma(s);
    });
  }
  refreshDilemmaCosts(s: StoredSession) {
    const attempts = this.dilemmaAttempts(s.id);
    s.spentUsd = attempts.reduce((sum, a) => sum + (a.outcome === 'pending' ? 0 : a.costUsd), 0);
    s.reservedUsd = attempts.reduce(
      (sum, a) => sum + (a.outcome === 'pending' ? a.reservedUsd : 0),
      0,
    );
    s.attempts = attempts.length;
    s.invalidAttempts = attempts.filter((a) => a.outcome === 'invalid').length;
  }
  capabilities(endpoint: string, model: string): Capabilities | undefined {
    return this.getSetting(`cap:${endpoint}:${model}`);
  }
  setCapabilities(endpoint: string, model: string, value: Capabilities) {
    this.setSetting(`cap:${endpoint}:${model}`, value);
  }
  saveExperiment(e: ExperimentRecord) {
    this.db.prepare('INSERT OR REPLACE INTO experiments VALUES (?,?)').run(e.id, JSON.stringify(e));
  }
  getExperiment(id: string): ExperimentRecord {
    const row = this.db.prepare('SELECT body FROM experiments WHERE id=?').get(id);
    if (!row) throw new Error('Experiment not found.');
    return JSON.parse(String(row.body));
  }
  experiments(): ExperimentRecord[] {
    return this.db
      .prepare('SELECT body FROM experiments ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  recover() {
    this.transaction(() => {
      for (const a of this.attempts())
        if (a.outcome === 'pending') {
          a.outcome = 'error';
          a.error =
            'Process ended before request settlement; reserved estimate charged conservatively.';
          a.costUsd = a.reservedUsd;
          a.costKind = 'upper-bound';
          this.saveAttempt(a);
        }
      for (const m of this.matches()) {
        const before = JSON.stringify(m);
        if (m.status === 'running') {
          m.status = 'interrupted';
          m.message = 'Server restarted. Review the last attempt before resuming.';
        }
        m.spentUsd = this.attempts(m.id).reduce((s, a) => s + a.costUsd, 0);
        m.attempts = this.attempts(m.id).length;
        m.invalidAttempts = this.attempts(m.id).filter((a) => a.outcome === 'invalid').length;
        if (JSON.stringify(m) !== before) this.saveMatch(m);
      }
      for (const e of this.experiments())
        if (e.status === 'running') {
          e.status = 'paused';
          e.message = 'Paused after server restart.';
          this.saveExperiment(e);
        }
      for (const s of this.dilemmas()) {
        if (s.status === 'running') {
          const invalid = this.dilemmaAttempts(s.id).some(
            (a) => a.moveIndex === s.rounds.length && a.outcome === 'invalid',
          );
          s.status = invalid ? 'invalid' : 'interrupted';
          s.endReason = invalid ? 'protocol' : 'restart';
          s.message = invalid
            ? 'A recorded invalid decision ended this interaction; no joint payoff was applied.'
            : 'Server restarted. Resume explicitly; any persisted choices remain sealed.';
        }
        this.refreshDilemmaCosts(s);
        this.saveDilemma(s);
      }
    });
  }
  close() {
    if (this.getSetting<{ token: string }>('__owner')?.token === this.owner)
      this.db.prepare('DELETE FROM settings WHERE id=?').run('__owner');
    this.db.close();
  }
}
