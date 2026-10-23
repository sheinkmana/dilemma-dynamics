import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Evaluation,
  GameState,
  Health,
  MatchConfig,
  MatchRecord,
  ModelInfo,
  PlayerConfig,
} from '../shared/types.js';
import { defaultConfig, isActionOnly, simpleMatchConfig } from '../shared/config.js';
import { geometry } from '../games/dots-boxes.js';
import { gameFor } from '../games/registry.js';
import './style.css';
import { DilemmaPage } from './Dilemma.js';
import { StudyResults } from './StudyResults.js';
import { StudyReplay } from './StudyReplay.js';

let token = '';
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${url}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gamefield-Token': token },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const money = (n: number) => (n > 0 && n < 0.000001 ? '<$0.000001' : usd.format(n));
const gameName = (game: GameState['game']) =>
  game === 'dots-boxes' ? 'Dots & Boxes' : 'Tic-tac-toe';
type SavedGame = Omit<MatchRecord, 'state' | 'initialState' | 'moves'> & {
  moveCount: number;
  scores: [number, number];
};
const workingModels = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/nemotron-3-super-120b-a12b',
];
function availablePlayers(models: ModelInfo[]): PlayerConfig[] {
  return [
    ...workingModels.flatMap((id) => {
      const model = models.find(
        (m) => m.id === id && m.available && m.inputRate !== null && m.outputRate !== null,
      );
      return model
        ? [{ ...defaultConfig.players[0], kind: 'nebius' as const, model: id, name: model.name }]
        : [];
    }),
    { ...defaultConfig.players[0], kind: 'heuristic' as const, name: 'Simple bot' },
    { ...defaultConfig.players[1], kind: 'random' as const, name: 'Random bot' },
  ];
}
const playerId = (p: PlayerConfig) => (p.kind === 'nebius' ? p.model : p.kind);
function initialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('game-field-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
function Board({
  state,
  action,
  optimal,
  parts,
}: {
  state: GameState;
  action?: string;
  optimal?: string[];
  parts?: Evaluation['components'];
}) {
  if (state.game === 'tic-tac-toe')
    return (
      <svg
        className="board tic"
        viewBox="0 0 360 360"
        role="img"
        aria-label={`Tic-tac-toe board, ${state.cells.filter((x) => x !== null).length} cells played`}
      >
        {[1, 2].map((i) => (
          <g key={i}>
            <path d={`M${i * 100 + 30} 30 V330 M30 ${i * 100 + 30} H330`} className="grid-line" />
          </g>
        ))}
        {state.cells.map((p, i) =>
          p === null ? (
            <rect
              key={i}
              x={(i % 3) * 100 + 42}
              y={Math.floor(i / 3) * 100 + 42}
              width="76"
              height="76"
              rx="9"
              className={
                optimal?.includes(`C:${Math.floor(i / 3)}:${i % 3}`) ? 'optimal-cell' : 'empty-cell'
              }
            />
          ) : (
            <text
              key={i}
              x={(i % 3) * 100 + 80}
              y={Math.floor(i / 3) * 100 + 101}
              textAnchor="middle"
              className={`tic-mark p${p}`}
            >
              {p === 0 ? '×' : '○'}
            </text>
          ),
        )}
      </svg>
    );
  const k = 88,
    pad = 45,
    w = state.cols * k + 2 * pad,
    h = state.rows * k + 2 * pad;
  return (
    <svg
      className="board"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Dots and Boxes, ${state.rows} by ${state.cols} boxes. Scores ${state.scores.join(' to ')}.`}
    >
      {Array.from({ length: state.cols + 1 }, (_, c) => (
        <text className="coordinate" key={`c${c}`} x={pad + c * k} y="18" textAnchor="middle">
          {c}
        </text>
      ))}
      {Array.from({ length: state.rows + 1 }, (_, r) => (
        <text className="coordinate" key={`r${r}`} x="15" y={pad + r * k + 4} textAnchor="middle">
          {r}
        </text>
      ))}
      {state.owners.map((owner, i) => {
        const part = parts?.findIndex((c) => c.boxes.includes(i)) ?? -1;
        return (
          <g key={i}>
            <rect
              x={pad + (i % state.cols) * k + 7}
              y={pad + Math.floor(i / state.cols) * k + 7}
              width={k - 14}
              height={k - 14}
              rx="8"
              className={
                owner !== null ? `box p${owner}` : part >= 0 ? 'component-box' : 'empty-cell'
              }
            />
            {(owner !== null || part >= 0) && (
              <text
                x={pad + (i % state.cols) * k + k / 2}
                y={pad + Math.floor(i / state.cols) * k + k / 2 + 5}
                textAnchor="middle"
                className={`box-label ${owner !== null ? `p${owner}` : ''}`}
              >
                {owner !== null
                  ? owner === 0
                    ? 'A'
                    : 'B'
                  : `${parts![part].kind === 'chain' ? 'C' : 'L'}${part + 1}`}
              </text>
            )}
          </g>
        );
      })}
      {geometry(state.rows, state.cols).map((e) => {
        const owner = state.drawn[e.id],
          d = `M${pad + e.c * k} ${pad + e.r * k} ${e.horizontal ? `h${k}` : `v${k}`}`,
          isOptimal = optimal?.includes(e.id);
        return (
          <g key={e.id}>
            <title>
              {e.id}
              {owner === undefined
                ? ' · unplayed'
                : owner === -1
                  ? ' · starting edge'
                  : ` · Player ${owner === 0 ? 'A' : 'B'}`}
            </title>
            {action === e.id && <path d={d} className="last-glow" />}
            <path
              d={d}
              className={`edge ${owner === undefined ? (isOptimal ? 'optimal' : 'available') : owner === -1 ? 'preset' : `p${owner}`} ${action === e.id ? 'latest' : ''}`}
            />
          </g>
        );
      })}
      {Array.from({ length: state.rows + 1 }, (_, r) =>
        Array.from({ length: state.cols + 1 }, (_, c) => (
          <circle key={`${r}:${c}`} cx={pad + c * k} cy={pad + r * k} r="4" className="dot" />
        )),
      )}
    </svg>
  );
}

function Recreation({
  navigation,
  theme,
  setTheme,
}: {
  navigation: React.ReactNode;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [history, setHistory] = useState<SavedGame[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [game, setGame] = useState<GameState['game']>('dots-boxes');
  const [selections, setSelections] = useState<[string, string]>(['heuristic', 'random']);
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [server, setServer] = useState<'running' | 'stopping' | 'off'>('running');
  const players = availablePlayers(models);
  const running = match?.status === 'running';
  const quickSettings =
    !match ||
    (isActionOnly(match.config) &&
      match.config.players.every((p) => p.knowledge === 'rules' && p.maxTokens <= 128));
  const anotherRunning = history.some((m) => m.status === 'running' && m.id !== match?.id);
  const shownIndex =
    cursor === null ? (match?.moves.length ?? 0) : Math.min(cursor, match?.moves.length ?? 0);
  const move = match?.moves[shownIndex - 1];
  const state = match ? (move?.state ?? match.initialState) : gameFor(game).create(3, 3);
  const freeGame = (
    match?.config.players ?? selections.map((id) => players.find((p) => playerId(p) === id))
  ).every((p) => p && p.kind !== 'nebius');

  const refresh = async () => {
    const [h, games] = await Promise.all([api<Health>('/health'), api<SavedGame[]>('/matches')]);
    token = h.token;
    setHealth(h);
    setHistory(games);
    return games;
  };
  const select = (next: MatchRecord) => {
    setMatch(next);
    setGame(next.config.game);
    setCursor(null);
    setShowHistory(false);
    setError('');
  };
  const update = (next: MatchRecord) =>
    setMatch((current) =>
      current?.id === next.id && current.lastEventId > next.lastEventId ? current : next,
    );
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [h, games, discovered] = await Promise.all([
          api<Health>('/health'),
          api<SavedGame[]>('/matches'),
          api<ModelInfo[]>('/models'),
        ]);
        if (cancelled) return;
        token = h.token;
        setHealth(h);
        setHistory(games);
        let currentModels = discovered;
        if (h.keyConfigured && !discovered.some((m) => m.available)) {
          try {
            currentModels = await api<ModelInfo[]>('/models/refresh', {});
          } catch {
            setError('Could not load models. You can play with the free bots or refresh models.');
          }
        }
        if (cancelled) return;
        setModels(currentModels);
        const options = availablePlayers(currentModels);
        setSelections([playerId(options[0]), playerId(options[1] ?? options[0])]);
        const active =
          games.find((m) => m.status === 'running') ??
          games.find(
            (m) =>
              ['paused', 'interrupted', 'ready'].includes(m.status) &&
              isActionOnly(m.config) &&
              m.config.players.every((p) => p.knowledge === 'rules' && p.maxTokens <= 128),
          );
        if (active) {
          const saved = await api<MatchRecord>(`/matches/${active.id}`);
          if (!cancelled) select(saved);
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
    if (server !== 'running') return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [server]);
  useEffect(() => {
    if (match && server === 'running') void refresh().catch(() => {});
  }, [match?.id, match?.moves.length, match?.status, server]);
  useEffect(() => {
    if (!match || server !== 'running') return;
    const id = match.id;
    const events = new EventSource(`/api/matches/${id}/events`);
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === 'snapshot')
        setMatch((current) =>
          current?.id === id && current.lastEventId <= event.match.lastEventId
            ? event.match
            : current,
        );
    };
    return () => events.close();
  }, [match?.id, server]);
  useEffect(() => {
    if (!showHistory) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const items = () => [
      ...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? []),
    ];
    items()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowHistory(false);
      if (event.key === 'Tab') {
        const controls = items(),
          first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [showHistory]);

  const start = () =>
    void act(async () => {
      const selected = selections.map((id) => players.find((p) => playerId(p) === id));
      if (!selected[0] || !selected[1]) throw new Error('Choose two available players.');
      const config = simpleMatchConfig(game, selected as MatchConfig['players']);
      const created = await api<MatchRecord>('/matches', config);
      select(created);
      update(await api<MatchRecord>(`/matches/${created.id}/start`, {}));
    });
  const command = (action: 'start' | 'pause' | 'stop') =>
    match &&
    void act(async () => {
      if (action === 'start') setCursor(null);
      update(await api<MatchRecord>(`/matches/${match.id}/${action}`, {}));
    });
  const shutdown = async () => {
    setServer('stopping');
    setError('');
    try {
      await api('/shutdown', {});
      setServer('off');
    } catch (e) {
      setError((e as Error).message);
      setServer('running');
    }
  };

  if (server === 'off')
    return (
      <main className="shutdown-screen">
        <Mark />
        <h1>Server shut down.</h1>
        <p>Your games are saved. You can close this tab.</p>
        <p className="muted">
          To play again, run <code>npm start</code> in the project folder and reload this page.
        </p>
      </main>
    );
  const status = !match
    ? 'Choose your players, then start a game.'
    : running
      ? `${match.config.players[match.state.player!].name}’s turn`
      : match.status === 'completed' && match.outcome
        ? match.outcome.winner === null
          ? 'The game is a draw.'
          : `${match.config.players[match.outcome.winner].name} wins.`
        : match.status === 'paused'
          ? 'Game paused.'
          : match.status === 'ready'
            ? 'Ready to play.'
            : match.message;

  return (
    <div className="simple-app">
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <Mark />
          <span>
            Game Field<span className="brand-period">.</span>
          </span>
        </a>
        {navigation}
        <div className="header-actions">
          <div className="theme-toggle" role="group" aria-label="Color mode">
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <span aria-hidden="true">☀</span> Light
            </button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
              <span aria-hidden="true">☾</span> Dark
            </button>
          </div>
          <button
            className="quiet"
            disabled={busy || running || anotherRunning || server !== 'running'}
            onClick={() => setShowHistory(true)}
          >
            Past games
          </button>
          <button
            className="quiet shutdown-button"
            disabled={busy || server !== 'running'}
            onClick={() => void shutdown()}
          >
            {server === 'stopping' ? 'Shutting down…' : 'Shut down server'}
          </button>
        </div>
      </header>
      <main className="game-page" aria-busy={busy || server === 'stopping'}>
        <div className="page-heading">
          <div>
            <span className="eyebrow">WATCH THEM PLAY</span>
            <h1>{gameName(match?.config.game ?? game)}</h1>
            <p>Short decisions. One move at a time.</p>
          </div>
          {match && (
            <button
              className="outline"
              disabled={busy || running || anotherRunning || server !== 'running'}
              onClick={() => {
                setMatch(null);
                setCursor(null);
                setError('');
              }}
            >
              New game
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {match && !quickSettings && !running && (
          <p className="notice">
            This saved game uses earlier settings. Choose New game for quick play.
          </p>
        )}
        {anotherRunning && (
          <p className="notice">
            A game is already running.{' '}
            <button
              className="text-button"
              onClick={() =>
                void act(async () => {
                  const current = history.find((m) => m.status === 'running');
                  if (current) select(await api<MatchRecord>(`/matches/${current.id}`));
                })
              }
            >
              Watch it live →
            </button>
          </p>
        )}
        {!match && (
          <form
            className="quick-setup"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="setup-fields">
              <label>
                Game
                <select
                  value={game}
                  disabled={busy}
                  onChange={(e) => setGame(e.target.value as GameState['game'])}
                >
                  <option value="dots-boxes">Dots & Boxes</option>
                  <option value="tic-tac-toe">Tic-tac-toe</option>
                </select>
              </label>
              {selections.map((id, i) => (
                <label key={i}>
                  Player {i + 1}
                  <select
                    value={id}
                    disabled={busy}
                    onChange={(e) => {
                      const next = [...selections] as [string, string];
                      next[i] = e.target.value;
                      setSelections(next);
                    }}
                  >
                    {players.map((p) => (
                      <option key={playerId(p)} value={playerId(p)}>
                        {p.name}
                        {p.kind !== 'nebius' ? ' · free' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="primary"
                type="submit"
                disabled={busy || anotherRunning || server !== 'running'}
              >
                {busy ? 'Loading…' : 'Start game →'}
              </button>
            </div>
            <div className="setup-caption">
              <small>Reasoning off · live board · automatic move pacing</small>
              {health?.keyConfigured && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => setModels(await api<ModelInfo[]>('/models/refresh', {})))
                  }
                >
                  Refresh models
                </button>
              )}
            </div>
            {!health?.keyConfigured && (
              <p className="muted">
                Free bots are ready to play. To use Nemotron, add your Nebius key to the project’s
                .env file and restart.
              </p>
            )}
          </form>
        )}
        <section className="cost-summary" aria-label="Game costs">
          <div className="cost-item game-cost">
            <span>This game</span>
            <strong>
              {money(match?.spentUsd ?? 0)} <small>USD</small>
            </strong>
            <small>
              {freeGame
                ? 'Free · local bots'
                : `Local limit ${money(match?.config.maxUsd ?? 0.05)}`}
            </small>
          </div>
          <div className="cost-item">
            <span>{cursor === null ? 'Last move' : 'Viewed move'}</span>
            <strong>
              {move ? money(move.costUsd) : '—'}
              {move && <small> USD</small>}
            </strong>
            <small>
              {move
                ? move.explanationSource === 'baseline'
                  ? 'Free local move'
                  : move.usage
                    ? `${move.usage.completionTokens} output tokens`
                    : 'Usage unavailable'
                : 'Updates with each move'}
            </small>
          </div>
          <div className="cost-item">
            <span>Total spend</span>
            <strong>
              {health ? money(health.sessionSpentUsd) : '—'}
              {health && <small> USD</small>}
            </strong>
            <small>Across this app{health ? ` · limit ${money(health.sessionCapUsd)}` : ''}</small>
          </div>
          <p className="cost-caption">
            Estimated from model usage, including retries.
            {(health?.reservedUsd ?? 0) > 0 && ` In-flight reserve: ${money(health!.reservedUsd)}.`}
          </p>
        </section>
        <section className="game-card" aria-label="Live game">
          <div className="scoreboard">
            {(
              match?.config.players ??
              selections.map((id) => players.find((p) => playerId(p) === id)!)
            ).map((p, i) => (
              <div
                key={i}
                className={`player-card player-${i} ${match && state.player === i ? 'to-move' : ''}`}
              >
                <span className={`player-dot ${i === 0 ? 'a' : 'b'}`}>{i + 1}</span>
                <div>
                  <h2>{p?.name ?? 'Choose a player'}</h2>
                  <small>{match && state.player === i ? 'To move' : `Player ${i + 1}`}</small>
                </div>
                <strong>{state.scores[i]}</strong>
              </div>
            ))}
          </div>
          <div className="board-wrap">
            <Board state={state} action={move?.action} />
          </div>
          <div className="live-status" role="status">
            <span className={`live-dot ${running && cursor === null ? 'active' : ''}`} />
            <span>
              {cursor !== null
                ? `Replay · move ${shownIndex} of ${match?.moves.length ?? 0}`
                : status}
            </span>
            <small>{match ? `Move ${shownIndex}` : '3 × 3'}</small>
          </div>
          {match && (
            <div className="game-controls">
              {running ? (
                <button
                  className="primary"
                  disabled={busy || server !== 'running'}
                  onClick={() => command('pause')}
                >
                  Pause
                </button>
              ) : quickSettings && ['paused', 'interrupted', 'ready'].includes(match.status) ? (
                <button
                  className="primary"
                  disabled={busy || anotherRunning || server !== 'running'}
                  onClick={() => command('start')}
                >
                  {match.status === 'ready' ? 'Start game' : 'Resume'}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || anotherRunning || server !== 'running'}
                  onClick={() => {
                    setMatch(null);
                    setCursor(null);
                  }}
                >
                  Play again →
                </button>
              )}
              {['running', 'paused', 'interrupted', 'ready'].includes(match.status) && (
                <button
                  className="quiet"
                  disabled={busy || server !== 'running'}
                  onClick={() => command('stop')}
                >
                  Stop game
                </button>
              )}
              {cursor !== null && (
                <button className="text-button" onClick={() => setCursor(null)}>
                  {running ? 'Go live →' : 'Latest position →'}
                </button>
              )}
              <small>
                {move
                  ? `${match!.config.players[move.player].name} played ${move.action}${move.captured.length ? ` · +${move.captured.length} ${move.captured.length === 1 ? 'box' : 'boxes'}` : ''}`
                  : 'The first move will appear here.'}
              </small>
            </div>
          )}
        </section>
        {match && (
          <details className="game-details">
            <summary>Replay & game details</summary>
            {match.moves.length > 0 && (
              <label>
                View a move
                <input
                  aria-label="Replay position"
                  type="range"
                  min={0}
                  max={match.moves.length}
                  value={shownIndex}
                  onChange={(e) => setCursor(+e.target.value)}
                />
              </label>
            )}
            <div className="details-row">
              <span>
                {match.moves.length} moves · {money(match.spentUsd)} estimated cost
              </span>
              <a href={`/api/matches/${match.id}/export/html`} download>
                Download replay ↓
              </a>
            </div>
            {move && (
              <p className="muted">
                Last decision: {(move.latencyMs / 1000).toFixed(2)} seconds
                {move.usage ? ` · ${move.usage.completionTokens} output tokens` : ''}.
              </p>
            )}
          </details>
        )}
        <details className="how-it-works">
          <summary>How it works</summary>
          <div className="explanation-copy">
            <p>
              <strong>One move at a time.</strong> The server sends the current board and legal
              moves to the player. The local game engine checks the response, updates the score, and
              shows the move immediately. A short pause keeps play easy to follow.
            </p>
            <p>
              <strong>Thinking off.</strong> For Nano and Super, we send{' '}
              <code>enable_thinking: false</code> and ask for one action line, with a 128-token
              output cap and no written rationale. The model gets a fresh board each move. If the
              provider exposes reasoning anyway, the game pauses. This setting does not measure
              internal computation.
            </p>
            <p>
              <strong>Costs stay visible.</strong> This game includes all its requests and retries;
              Last move shows the displayed move’s cost. Total spend includes saved activity in this
              app and survives restarts. These are USD estimates from input and output tokens and
              catalog prices. Missing usage keeps a conservative reserved estimate; local limits
              apply inside this app.
            </p>
            <p>
              <strong>Free bots.</strong>{' '}
              {state.game === 'dots-boxes'
                ? 'Simple bot captures boxes and avoids exposing third sides.'
                : 'Simple bot takes a win, blocks immediate losses, and prefers the centre.'}{' '}
              Random bot picks a legal move. Both run on your computer and use no model tokens.
            </p>
          </div>
        </details>
        <footer className="app-footer">
          <span>{health?.keyConfigured ? 'Nebius connected' : 'Free local play'}</span>
          <span>Games save automatically.</span>
        </footer>
      </main>
      {showHistory && (
        <div className="modal-backdrop">
          <section
            className="history-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Past games"
          >
            <header>
              <h2>Past games</h2>
              <button
                className="quiet"
                aria-label="Close past games"
                onClick={() => setShowHistory(false)}
              >
                Close
              </button>
            </header>
            {history.length ? (
              <div className="history-list">
                {history.slice(0, 30).map((saved) => (
                  <button
                    key={saved.id}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => select(await api<MatchRecord>(`/matches/${saved.id}`)))
                    }
                  >
                    <span>
                      <strong>{gameName(saved.config.game)}</strong>
                      <small>{saved.config.players.map((p) => p.name).join(' vs ')}</small>
                    </span>
                    <span>
                      {saved.scores.join(' : ')}
                      <small>
                        {saved.status} · {saved.moveCount} moves
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Your saved games will appear here.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
type Page = 'dilemma' | 'analysis' | 'replay' | 'results' | 'recreational';
function pageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  return ['analysis', 'replay', 'results', 'recreational'].includes(hash)
    ? (hash as Page)
    : 'dilemma';
}
function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [visitedRecreation, setVisitedRecreation] = useState(page === 'recreational');
  const [visitedDilemma, setVisitedDilemma] = useState(page === 'dilemma' || page === 'analysis');
  useEffect(() => {
    const navigate = () => {
      const next = pageFromHash();
      setPage(next);
      if (next === 'recreational') setVisitedRecreation(true);
      if (next === 'dilemma' || next === 'analysis') setVisitedDilemma(true);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0c1225' : '#e9eaf0');
    try {
      localStorage.setItem('game-field-theme', theme);
    } catch {}
  }, [theme]);
  const navigation = (
    <nav className="domain-nav" aria-label="Project sections">
      {(['dilemma', 'analysis', 'replay', 'results', 'recreational'] as const).map((p) => (
        <button
          key={p}
          aria-pressed={page === p}
          onClick={() => {
            window.location.hash = p;
          }}
        >
          {p === 'dilemma'
            ? 'Dilemma'
            : p === 'analysis'
              ? 'Analysis'
              : p === 'replay'
                ? 'Study replay'
                : p === 'results'
                  ? 'Results'
                  : 'Recreational'}
        </button>
      ))}
    </nav>
  );
  return (
    <>
      {visitedDilemma && (
        <div hidden={page !== 'dilemma' && page !== 'analysis'}>
          <DilemmaPage
            navigation={navigation}
            analysisOnly={page === 'analysis'}
            theme={theme}
            setTheme={setTheme}
          />
        </div>
      )}
      {page === 'replay' && (
        <StudyReplay navigation={navigation} theme={theme} setTheme={setTheme} />
      )}
      {page === 'results' && (
        <StudyResults navigation={navigation} theme={theme} setTheme={setTheme} />
      )}
      {visitedRecreation && (
        <div hidden={page !== 'recreational'}>
          <Recreation navigation={navigation} theme={theme} setTheme={setTheme} />
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
