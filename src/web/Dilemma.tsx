import { useEffect, useState, type ReactNode } from 'react';
import type { DilemmaConfig, DilemmaSession, Round } from '../dilemma/types.js';
import type { Health, ModelInfo } from '../shared/types.js';
import { sessionAnalysis } from '../dilemma/analysis.js';
import { decisionInformation, continuationObservation } from '../dilemma/education.js';
import { CONTINUATION_PROBABILITY, EXPECTED_GEOMETRIC_ROUNDS, payoff } from '../dilemma/spec.js';
import { DilemmaLearning, PayoffTable } from './DilemmaLearning.js';
import './dilemma.css';
type Saved = Omit<DilemmaSession, 'rounds'> & { roundCount: number };
let sessionToken = '';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gamefield-Token': sessionToken },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
const money = (n: number) => `$${n.toFixed(6)}`;
const fmt = (n: number | null, digits = 2) => (n === null ? 'Not elicited' : n.toFixed(digits));
const word = (action: string) => (action === 'C' ? 'Cooperate' : 'Defect');
function Inspector({
  round,
  session,
}: {
  round: Round | undefined;
  session: DilemmaSession | null;
}) {
  if (!round || !session)
    return (
      <aside className="pd-inspector">
        <h2>Decision analysis</h2>
        <p>
          Each completed round gains an analysis of immediate incentives and future consequences.
          Optional forecasts are recorded privately with each decision.
        </p>
      </aside>
    );
  const information = decisionInformation(session, round.index);
  return (
    <aside className="pd-inspector" aria-label={`Analysis of round ${round.index}`}>
      <span className="eyebrow">ANALYSIS · ROUND {round.index}</span>
      <h2>Understand this decision</h2>
      <section className="pd-decision-information">
        <h3>Known before choosing</h3>
        <p>
          Both players saw {information.completedRounds} completed{' '}
          {information.completedRounds === 1 ? 'round' : 'rounds'}, but neither saw the other’s
          current choice. {information.horizon}
        </p>
        {information.previousActions && (
          <p>
            Last observed actions: A {information.previousActions[0]} · B{' '}
            {information.previousActions[1]}.
          </p>
        )}
        {!information.knownFinalRound && (
          <p>
            Giving up points now can pay if choosing C improves later earnings enough. The future
            advantage below compares expected returns after C and D, conditional on another round
            occurring.
          </p>
        )}
      </section>
      {round.analysis.map((a, seat) => (
        <section className="pd-player-analysis" key={seat}>
          <h3>{session.config.players[seat].name}</h3>
          <p className="pd-choice-summary">
            Chose {word(round.actions[seat])} · earned {round.payoffs[seat]} points
          </p>
          <div className="pd-immediate-comparison">
            <span className="pd-provenance">Immediate payoffs · verified after reveal</span>
            <p>Holding the other player’s revealed {round.actions[1 - seat]} fixed:</p>
            <div>
              <span>
                C would pay <strong>{payoff('C', round.actions[1 - seat])[0]}</strong>
              </span>
              <span>
                D would pay <strong>{payoff('D', round.actions[1 - seat])[0]}</strong>
              </span>
            </div>
            <small>
              The opponent’s current action was unknown when choosing. Future responses could change
              after a different choice.
            </small>
          </div>
          <h4>Future benefit needed · at the decision</h4>
          <p className="pd-finding">{a.finding}</p>
          <dl>
            <div>
              <dt>
                {round.forecasts[seat]
                  ? 'Expected immediate gain from D · reported belief'
                  : 'Immediate gain from D · either opponent action'}
              </dt>
              <dd>
                {a.immediateGainFromD[0] === a.immediateGainFromD[1]
                  ? fmt(a.immediateGainFromD[0])
                  : a.immediateGainFromD.map((n) => fmt(n)).join('–')}{' '}
                points
              </dd>
            </div>
            <div>
              <dt>Future advantage needed for C</dt>
              <dd>
                {a.requiredFutureAdvantage
                  ? a.requiredFutureAdvantage
                      .map((n) => fmt(n))
                      .filter((n, i, xs) => !i || n !== xs[0])
                      .join('–') + ' points'
                  : 'No future round'}
              </dd>
            </div>
          </dl>
          {round.forecasts[seat] ? (
            <details className="pd-forecast-details">
              <summary>Reported forecasts & consistency</summary>
              <span className="pd-provenance">Reported expectations · sealed before reveal</span>
              <dl>
                <div>
                  <dt>P(opponent C)</dt>
                  <dd>{(round.forecasts[seat]!.pOpponentC * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Expected points if C</dt>
                  <dd>{fmt(a.expectedC, 3)}</dd>
                </div>
                <div>
                  <dt>Expected points if D</dt>
                  <dd>{fmt(a.expectedD, 3)}</dd>
                </div>
                <div>
                  <dt>Loss against own forecasts</dt>
                  <dd>{fmt(a.reportedLoss, 3)}</dd>
                </div>
                <div>
                  <dt>Forecast error (Brier)</dt>
                  <dd>{fmt(a.brier, 3)}</dd>
                </div>
              </dl>
            </details>
          ) : (
            <p className="muted">
              No expectations were reported, so the player’s expected future benefit is unknown.
            </p>
          )}
        </section>
      ))}
      <section className="pd-continuation-observation">
        <h3>What followed · retrospective</h3>
        <p>{continuationObservation(session, round)}</p>
      </section>
      <p className="pd-analysis-note">
        {session.config.protocol === 'forecasts'
          ? 'Expected values use submitted forecasts, including contemplated future choices. They are not an exact best response to the other model. One forecast error is not a verdict on rationality.'
          : 'A replay shows actions along one path. It does not identify a complete strategy or establish that the players are in equilibrium.'}
      </p>
    </aside>
  );
}
function Profile({ session }: { session: DilemmaSession }) {
  const report = sessionAnalysis(session);
  return (
    <section className="pd-profile" aria-label="Session decision profile">
      <div className="pd-section-heading">
        <h2>Decision profile</h2>
        <small>
          {session.rounds.length} completed rounds ·{' '}
          {session.status === 'completed' ? 'natural completion' : 'partial or ongoing interaction'}
        </small>
      </div>
      <div className="pd-profile-grid">
        {report.players.map((p, seat) => (
          <article key={seat}>
            <h3>{p.name}</h3>
            <dl>
              <div>
                <dt>Game points</dt>
                <dd>{p.points}</dd>
              </div>
              <div>
                <dt>C choices</dt>
                <dd>
                  {p.cooperations} / {p.rounds}
                </dd>
              </div>
              <div>
                <dt>Consistent with own forecasts</dt>
                <dd>
                  {p.reportedDecisions
                    ? `${p.consistentChoices} / ${p.reportedDecisions}`
                    : 'Not elicited'}
                </dd>
              </div>
              <div>
                <dt>Mean report-relative loss</dt>
                <dd>{fmt(p.meanReportedLoss, 3)}</dd>
              </div>
              <div>
                <dt>Mean Brier forecast error ↓</dt>
                <dd>{fmt(p.meanBrier, 3)}</dd>
              </div>
              <div>
                <dt>D after opponent D</dt>
                <dd>
                  {p.responsesAfterD
                    ? `${p.defectionsAfterD} / ${p.responsesAfterD}`
                    : 'No observed opportunities'}
                </dd>
              </div>
              <div>
                <dt>Known-final-round C choices</dt>
                <dd>
                  {p.knownFinalOpportunities
                    ? `${p.knownFinalDominanceViolations} / ${p.knownFinalOpportunities}`
                    : 'No known final round'}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="pd-outcomes" aria-label="Joint outcome counts">
        {Object.entries(report.outcomes).map(([pair, n]) => (
          <span key={pair}>
            {pair}: <strong>{n}</strong>
          </span>
        ))}
      </div>
      <p className="muted">
        These are separate descriptions of decisions, forecasts, and outcomes—not an overall
        rationality score. Brier error is lower when forecasts are more accurate; few rounds give
        limited evidence. Reported future values have no observed counterfactual ground truth here.
      </p>
    </section>
  );
}
export function DilemmaPage({
  navigation,
  analysisOnly,
  theme,
  setTheme,
}: {
  navigation: ReactNode;
  analysisOnly: boolean;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [session, setSession] = useState<DilemmaSession | null>(null);
  const [selected, setSelected] = useState<[string, string]>(['', '']);
  const [protocol, setProtocol] = useState<'actions' | 'forecasts'>('actions');
  const [horizon, setHorizon] = useState('geometric');
  const [mapping, setMapping] = useState<'X=C' | 'X=D'>('X=C');
  const [cap, setCap] = useState(0.05);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const eligible = models.filter(
    (m) => m.available && m.inputRate !== null && m.outputRate !== null,
  );
  const running = session?.status === 'running';
  const anyRunning = saved.find((s) => s.status === 'running' && s.id !== session?.id);
  const index =
    cursor === null ? (session?.rounds.length ?? 0) : Math.min(cursor, session?.rounds.length ?? 0);
  const round = session?.rounds[index - 1];
  const pending =
    cursor === null &&
    session?.pendingRound !== null &&
    session?.pendingRound !== undefined &&
    !['completed', 'stopped', 'invalid', 'budget'].includes(session.status);
  const scores = round?.scores ?? [0, 0];
  const refresh = async () => {
    const [h, list] = await Promise.all([
      api<Health>('/health'),
      api<Saved[]>('/dilemma/sessions'),
    ]);
    sessionToken = h.token;
    setHealth(h);
    setSaved(list);
  };
  const select = (s: DilemmaSession) => {
    setSession(s);
    setCursor(null);
    setError('');
  };
  const update = (s: DilemmaSession) =>
    setSession((old) => (old?.id === s.id && old.version > s.version ? old : s));
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [h, list, ms] = await Promise.all([
          api<Health>('/health'),
          api<Saved[]>('/dilemma/sessions'),
          api<ModelInfo[]>('/models'),
        ]);
        sessionToken = h.token;
        let found = ms;
        if (h.keyConfigured && !ms.some((m) => m.available)) {
          try {
            found = await api<ModelInfo[]>('/models/refresh', {});
          } catch {
            if (!cancelled)
              setError(
                'Model discovery failed. Refresh models to retry; no model is silently replaced.',
              );
          }
        }
        if (cancelled) return;
        setHealth(h);
        setSaved(list);
        setModels(found);
        const ids = found
          .filter((m) => m.available && m.inputRate !== null && m.outputRate !== null)
          .map((m) => m.id);
        setSelected([ids[0] ?? '', ids[1] ?? ids[0] ?? '']);
        const last =
          list.find((s) => ['running', 'paused', 'interrupted', 'ready'].includes(s.status)) ??
          list[0];
        if (last) {
          const s = await api<DilemmaSession>(`/dilemma/sessions/${last.id}`);
          if (!cancelled) setSession(s);
        }
      } catch {
        if (!cancelled)
          setError('Could not connect to the local server. Start it with npm start, then reload.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!session || offline) return;
    const id = session.id,
      source = new EventSource(`/api/dilemma/sessions/${id}/events`);
    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as DilemmaSession;
      setSession((old) => (old?.id === id && old.version <= next.version ? next : old));
    };
    return () => source.close();
  }, [session?.id, offline]);
  useEffect(() => {
    if (offline) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [offline]);
  useEffect(() => {
    if (!offline && session) void refresh().catch(() => {});
  }, [session?.version, offline]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      if (!offline) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = (demo: boolean) =>
    void act(async () => {
      const players: DilemmaConfig['players'] = demo
        ? [
            { kind: 'demo-random', name: 'Local random demo', model: '' },
            { kind: 'demo-reciprocal', name: 'Local reciprocal demo', model: '' },
          ]
        : (selected.map((id) => {
            const m = eligible.find((m) => m.id === id);
            if (!m) throw new Error('Choose two available models.');
            return { kind: 'model' as const, name: m.name, model: m.id };
          }) as DilemmaConfig['players']);
      const config: DilemmaConfig = {
        mode: demo ? 'demo' : 'autonomous',
        players,
        protocol: demo ? 'actions' : protocol,
        horizon:
          horizon === 'geometric'
            ? { kind: 'geometric' }
            : { kind: 'fixed', rounds: Number(horizon) },
        mapping,
        maxUsd: cap,
        delayMs: 700,
      };
      const created = await api<DilemmaSession>('/dilemma/sessions', {
        config,
        creationKey: crypto.randomUUID(),
      });
      select(created);
      update(await api<DilemmaSession>(`/dilemma/sessions/${created.id}/start`, {}));
    });
  const command = (action: string) =>
    session &&
    void act(async () => {
      setCursor(null);
      update(await api<DilemmaSession>(`/dilemma/sessions/${session.id}/${action}`, {}));
    });
  const liveLabel = pending
    ? `Round ${session!.pendingRound} · choices private`
    : `Round ${index}${cursor !== null ? ' · replay' : ' · revealed'}`;
  const controlsDisabled = busy || offline;
  if (offline)
    return (
      <main className="shutdown-screen">
        <h1>Server shut down.</h1>
        <p>Sessions and costs are saved. Start it with npm start, then reload.</p>
      </main>
    );
  return (
    <div className="simple-app pd-app">
      <header className="app-header">
        <div className="brand">
          Game Field<span className="brand-period">.</span>
        </div>
        {navigation}
        <div className="header-actions">
          <div className="theme-toggle" role="group" aria-label="Color mode">
            {(['light', 'dark'] as const).map((t) => (
              <button type="button" key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <button
            className="quiet shutdown-button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api('/shutdown', {});
                setOffline(true);
              })
            }
          >
            Shut down server
          </button>
        </div>
      </header>
      <main className="game-page pd-page" aria-busy={busy}>
        <div className="page-heading">
          <div>
            <span className="eyebrow">AUTONOMOUS DECISIONS</span>
            <h1>{analysisOnly ? 'Decision analysis' : 'Trust & temptation'}</h1>
            <p>Repeated Prisoner’s Dilemma · maximise expected own points.</p>
          </div>
          {session && (
            <button
              className="outline"
              disabled={busy || running}
              onClick={() => {
                setSession(null);
                setCursor(null);
              }}
            >
              New interaction
            </button>
          )}
        </div>
        <DilemmaLearning
          key={session ? 'interaction-guide' : 'setup-guide'}
          defaultOpen={!session && !analysisOnly}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {anyRunning && (
          <p className="notice">
            An interaction is running.{' '}
            <button
              className="text-button"
              onClick={() =>
                void act(async () =>
                  select(await api<DilemmaSession>(`/dilemma/sessions/${anyRunning.id}`)),
                )
              }
            >
              Watch it live →
            </button>
          </p>
        )}
        {!session && (
          <form
            className="pd-setup"
            onSubmit={(event) => {
              event.preventDefault();
              start(false);
            }}
          >
            <div className="pd-model-fields">
              {selected.map((id, seat) => (
                <label key={seat}>
                  Player {seat === 0 ? 'A' : 'B'} · autonomous model
                  <select
                    value={id}
                    disabled={busy || !eligible.length}
                    onChange={(event) =>
                      setSelected(
                        (old) =>
                          old.map((v, i) => (i === seat ? event.target.value : v)) as [
                            string,
                            string,
                          ],
                      )
                    }
                  >
                    {!eligible.length && <option value="">No available models</option>}
                    {eligible.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="pd-settings">
              <label>
                Decision protocol
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as typeof protocol)}
                >
                  <option value="actions">Action only</option>
                  <option value="forecasts">Action + forecasts</option>
                </select>
              </label>
              <label>
                Interaction
                <select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                  <option value="geometric">{CONTINUATION_PROBABILITY * 100}% continuation</option>
                  <option value="1">One decision</option>
                  <option value="10">Known final round · 10 rounds</option>
                </select>
              </label>
              <label>
                Estimated session limit · USD
                <input
                  type="number"
                  min="0.001"
                  max="5"
                  step="0.001"
                  required
                  value={cap}
                  onChange={(e) => setCap(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="muted">
              {protocol === 'actions'
                ? 'Players submit one action. The analyst shows verified incentives without inventing beliefs.'
                : 'Players seal numeric forecasts with each action. Analysis checks reported consistency and forecast error; reports are not verified internal beliefs.'}
            </p>
            <div className="pd-payoffs pd-before-payoffs">
              <PayoffTable />
              <small>
                Each player maximises expected own total points. Choices are simultaneous and
                revealed together.{' '}
                {horizon === 'geometric'
                  ? `After each round, an independent draw continues play with probability ${CONTINUATION_PROBABILITY * 100}%. Expected length is ${EXPECTED_GEOMETRIC_ROUNDS} rounds, with no announced final round.`
                  : `Exactly ${horizon} announced ${horizon === '1' ? 'round' : 'rounds'}.`}
              </small>
            </div>
            <div className="pd-setup-actions">
              <button
                className="primary"
                type="submit"
                disabled={busy || !eligible.length || Boolean(anyRunning)}
              >
                Start autonomous interaction →
              </button>
              <button
                className="quiet"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const ms = await api<ModelInfo[]>('/models/refresh', {});
                    setModels(ms);
                    const ids = ms
                      .filter((m) => m.available && m.inputRate !== null)
                      .map((m) => m.id);
                    setSelected([
                      ids.includes(selected[0]) ? selected[0] : (ids[0] ?? ''),
                      ids.includes(selected[1]) ? selected[1] : (ids[1] ?? ids[0] ?? ''),
                    ]);
                  })
                }
              >
                Refresh models
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy || Boolean(anyRunning)}
                onClick={() => start(true)}
              >
                Run free local demo
              </button>
            </div>
            {!health?.keyConfigured && (
              <p className="notice">
                Autonomous play needs the server’s Nebius key. The explicitly local demo uses two
                simple policies, not models.
              </p>
            )}
            <details>
              <summary>Protocol details</summary>
              <p>
                Rules only · temperature 0 · reasoning requested off ·{' '}
                {protocol === 'actions' ? 128 : 256} output tokens · no corrections · completed
                history rebuilt each round. Analysis never coaches either player.
              </p>
              <label>
                Neutral action mapping
                <select
                  value={mapping}
                  onChange={(e) => setMapping(e.target.value as typeof mapping)}
                >
                  <option value="X=C">X = C, Y = D</option>
                  <option value="X=D">X = D, Y = C</option>
                </select>
              </label>
            </details>
          </form>
        )}
        {session && (
          <>
            {session.config.mode === 'demo' && (
              <p className="notice">
                Local demonstration · fixed local policies, not autonomous models. No model
                forecasts are fabricated.
              </p>
            )}
            <div className="pd-rules-line">
              <span>
                {session.config.horizon.kind === 'geometric'
                  ? `${CONTINUATION_PROBABILITY * 100}% chance of another round after each reveal · expected length ${EXPECTED_GEOMETRIC_ROUNDS}, not a fixed limit`
                  : `${session.config.horizon.rounds} announced ${session.config.horizon.rounds === 1 ? 'round' : 'rounds'}`}
              </span>
              <span>
                {session.config.protocol === 'forecasts' ? 'Action + forecasts' : 'Action only'} ·
                agents see {session.config.mapping === 'X=C' ? 'X=C, Y=D' : 'X=D, Y=C'}
              </span>
            </div>
            <section className="pd-costs" aria-label="Estimated API costs">
              <span>
                Interaction <strong>{money(session.spentUsd)} USD</strong>
              </span>
              <span>
                Reserved <strong>{money(session.reservedUsd)}</strong>
              </span>
              <span>
                Limit <strong>{money(session.config.maxUsd)}</strong>
              </span>
              <span>
                Across app <strong>{money(health?.sessionSpentUsd ?? 0)}</strong>
              </span>
            </section>
            {analysisOnly && <Profile session={session} />}
            <div className={analysisOnly ? 'pd-analysis-layout' : 'pd-layout'}>
              <div className="pd-main">
                <section className="pd-table" aria-label="Simultaneous interaction">
                  <div className="pd-table-heading">
                    <strong>{liveLabel}</strong>
                    <small>
                      {cursor !== null && running
                        ? `Live interaction continues · ${session.rounds.length} complete`
                        : session.status}
                    </small>
                  </div>
                  <div className="pd-players">
                    {session.config.players.map((p, seat) => (
                      <article className={`pd-player pd-seat-${seat}`} key={seat}>
                        <span className="eyebrow">PLAYER {seat === 0 ? 'A' : 'B'}</span>
                        <h2>{p.name}</h2>
                        <div className="pd-points">
                          {scores[seat]} <small>points</small>
                        </div>
                        <div className="pd-choice">
                          {pending ? (
                            session.received[seat] ? (
                              'Choice received · private'
                            ) : (
                              'Choosing privately…'
                            )
                          ) : round ? (
                            <>
                              <span className={`pd-action pd-${round.actions[seat]}`}>
                                {round.actions[seat]}
                              </span>{' '}
                              {word(round.actions[seat])}
                            </>
                          ) : (
                            'Before play'
                          )}
                        </div>
                        {!pending && round && <small>+{round.payoffs[seat]} this round</small>}
                      </article>
                    ))}
                  </div>
                  <div className="pd-payoffs">
                    <PayoffTable current={!pending ? round?.actions.join('') : undefined} />
                    <small>A points · B points. Actions stay private until joint reveal.</small>
                  </div>
                  <div className="pd-status" role="status">
                    {session.message}
                  </div>
                </section>
                <div className="pd-controls">
                  {running ? (
                    <button
                      className="primary"
                      disabled={controlsDisabled}
                      onClick={() => command('pause')}
                    >
                      Pause after round
                    </button>
                  ) : ['ready', 'paused', 'interrupted'].includes(session.status) ? (
                    <>
                      <button
                        className="primary"
                        disabled={controlsDisabled}
                        onClick={() => command('start')}
                      >
                        Resume
                      </button>
                      <button
                        className="outline"
                        disabled={controlsDisabled}
                        onClick={() => command('step')}
                      >
                        Next round
                      </button>
                    </>
                  ) : null}
                  {['ready', 'running', 'paused', 'interrupted', 'budget'].includes(
                    session.status,
                  ) && (
                    <button
                      className="quiet"
                      disabled={controlsDisabled}
                      onClick={() => command('stop')}
                    >
                      Stop interaction
                    </button>
                  )}
                  {cursor !== null && (
                    <button className="text-button" onClick={() => setCursor(null)}>
                      {running ? 'Go live →' : 'Latest round →'}
                    </button>
                  )}
                </div>
                <section className="pd-history">
                  <div className="pd-section-heading">
                    <h2>Round history</h2>
                    <small>
                      {cursor === null
                        ? 'Following live state'
                        : `Viewing ${index} of ${session.rounds.length}`}{' '}
                      · A / B
                    </small>
                  </div>
                  <div className="pd-history-buttons">
                    <button aria-pressed={cursor === 0} onClick={() => setCursor(0)}>
                      Before play
                    </button>
                    {session.rounds.slice(-40).map((r) => (
                      <button
                        key={r.index}
                        aria-label={`View round ${r.index}: ${r.actions.join(' / ')}`}
                        aria-pressed={!pending && index === r.index}
                        onClick={() => setCursor(r.index)}
                      >
                        <small>{r.index}</small>
                        <strong>{r.actions.join(' · ')}</strong>
                      </button>
                    ))}
                  </div>
                  {session.rounds.length > 0 && (
                    <label className="pd-replay-label">
                      Replay any completed round
                      <input
                        type="range"
                        min={0}
                        max={session.rounds.length}
                        value={index}
                        onChange={(e) => setCursor(Number(e.target.value))}
                      />
                    </label>
                  )}
                  {session.rounds.length > 40 && (
                    <small>Recent 40 shown; the slider reaches every completed round.</small>
                  )}
                </section>
              </div>
              <Inspector round={round} session={session} />
            </div>
            {!analysisOnly && <Profile session={session} />}
            <details className="pd-records">
              <summary>Replay, audit & protocol</summary>
              <p>
                {session.config.protocol === 'forecasts' ? '256' : '128'} output tokens per model
                decision · temperature 0 · reasoning requested off · no strategic feedback. Protocol
                failures and operational interruptions earn no invented points.
              </p>
              <p>
                {session.attempts} attempts · {session.invalidAttempts} invalid decisions ·{' '}
                {session.endReason ?? 'no end reason yet'}
              </p>
              {round && (
                <p>
                  Selected round:{' '}
                  {round.telemetry
                    .map(
                      (t, i) =>
                        `Player ${i ? 'B' : 'A'} ${(t.latencyMs / 1000).toFixed(2)}s${t.usage ? `, ${t.usage.completionTokens} output tokens` : ', usage unavailable'}`,
                    )
                    .join(' · ')}{' '}
                  · {money(round.costUsd)} USD including attempts for this round.
                </p>
              )}
              <div className="pd-downloads">
                <a href={`/api/dilemma/sessions/${session.id}/export/html`} download>
                  Offline replay
                </a>
                <a href={`/api/dilemma/sessions/${session.id}/export/json`} download>
                  Full JSON + committed request audit
                </a>
                <a href={`/api/dilemma/sessions/${session.id}/export/jsonl`} download>
                  JSONL
                </a>
              </div>
              <p className="muted">
                Costs are estimates from provider usage and the dated catalog; missing usage retains
                a conservative reservation. Unresolved responses remain private in exports. Stopping
                randomness is disclosed only after natural completion.
              </p>
            </details>
          </>
        )}
        <details className="pd-saved">
          <summary>Past interactions ({saved.length})</summary>
          {saved.length ? (
            saved.slice(0, 30).map((s) => (
              <button
                key={s.id}
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    select(await api<DilemmaSession>(`/dilemma/sessions/${s.id}`)),
                  )
                }
              >
                <span>{s.config.players.map((p) => p.name).join(' / ')}</span>
                <small>
                  {s.config.mode === 'demo' ? 'Local demo · ' : ''}
                  {s.roundCount} rounds · {s.status} · {new Date(s.createdAt).toLocaleString()}
                </small>
              </button>
            ))
          ) : (
            <p>No saved interactions yet.</p>
          )}
        </details>
        <footer className="app-footer">
          <span>{health?.keyConfigured ? 'Server key configured' : 'No model key configured'}</span>
          <span>Choices, rules, and analysis save automatically.</span>
        </footer>
      </main>
    </div>
  );
}
