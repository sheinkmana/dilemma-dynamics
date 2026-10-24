import { BrandText } from './BrandText.js';
import { GameTypes } from './GameTypes.js';
import { publicAsset } from './assets.js';
import { useEffect, useState, type ReactNode } from 'react';
import {
  parseRecordedEpisodes,
  playerLabel,
  recordedScore,
  type RecordedEpisode,
} from '../dilemma/recorded.js';
import { payoff } from '../dilemma/spec.js';
import { PayoffTable } from './DilemmaLearning.js';
import { StudyTemperature } from './StudyTemperature.js';
import { studies, type StudyTemperature as Temperature } from './studyData.js';
import './results.css';

export function StudyReplay({
  navigation,
  theme,
  setTheme,
}: {
  navigation: ReactNode;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}) {
  const [temperature, setTemperature] = useState<Temperature>(0);
  const [recording, setRecording] = useState<{
    temperature: Temperature;
    rows: RecordedEpisode[];
  } | null>(null);
  const rows = recording?.temperature === temperature ? recording.rows : [];
  const { path, date } = studies[temperature];
  const [error, setError] = useState('');
  const [track, setTrack] = useState<'A' | 'B'>('A');
  const [cell, setCell] = useState('A/tft-h10/nano-direct');
  const [block, setBlock] = useState(0);
  const [round, setRound] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setRecording(null);
    void fetch(publicAsset(`${path}/episodes.json`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The recorded study could not be loaded.');
        const data = parseRecordedEpisodes(await response.json());
        if (!controller.signal.aborted) setRecording({ temperature, rows: data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load the saved study. Check the connection and try again.');
      });
    return () => controller.abort();
  }, [attempt, temperature, path]);
  const cells = [...new Set(rows.filter((r) => r.track === track).map((r) => r.cell))].sort();
  const episode = rows.find((r) => r.cell === cell && r.block === block);
  const index = Math.min(round, episode?.rounds ?? 0);
  const pair = episode?.history[index - 1];
  const scores = episode ? recordedScore(episode, index) : [0, 0];
  const choose = (next: string) => {
    setCell(next);
    setRound(0);
  };
  return (
    <div className="simple-app pd-app">
      <header className="app-header">
        <div className="brand">
          <BrandText />
        </div>
        {navigation}
        <div className="header-actions">
          <div className="theme-toggle" role="group" aria-label="Color mode">
            {(['light', 'dark'] as const).map((mode) => (
              <button key={mode} aria-pressed={theme === mode} onClick={() => setTheme(mode)}>
                {mode === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="game-page results-page">
        <div className="results-intro">
          <p className="results-eyebrow">
            Repeated Prisoner’s Dilemma · recorded studies · 22–23 October 2026
          </p>
          <h1>Replay the decisions.</h1>
          <p>
            Step through 3,552 published episodes across temperatures 0 and 1, with 1,776 in each
            study. No key or inference is needed. This is a recording, not a new model interaction.
          </p>
          <p className="results-caveat">
            One episode illustrates play; it does not estimate a procedure’s effect.{' '}
            <a href="#results">See aggregate results →</a>
          </p>
        </div>
        <StudyTemperature
          value={temperature}
          onChange={(next) => {
            setTemperature(next);
            setError('');
            setRound(0);
          }}
        />
        {error ? (
          <p role="alert">
            {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry loading</button>
          </p>
        ) : !rows.length ? (
          <p role="status">Loading published actions…</p>
        ) : (
          <>
            <details className="results-details">
              <summary>Choose another condition, model or block</summary>
              <div className="pd-setup replay-filters">
                <label>
                  Study track
                  <select
                    value={track}
                    onChange={(e) => {
                      const next = e.target.value as 'A' | 'B';
                      setTrack(next);
                      choose(next === 'A' ? 'A/tft-h10/nano-direct' : 'B/nano-direct/nano-direct');
                    }}
                  >
                    <option value="A">A · Known committed opponent</option>
                    <option value="B">B · Autonomous model pair</option>
                  </select>
                </label>
                <label>
                  Condition / pairing
                  <select value={cell} onChange={(e) => choose(e.target.value)}>
                    {cells.map((c) => (
                      <option key={c} value={c}>
                        {c.split('/').slice(1).map(playerLabel).join(' / ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Study block
                  <select
                    value={block}
                    onChange={(e) => {
                      setBlock(Number(e.target.value));
                      setRound(0);
                    }}
                  >
                    {Array.from({ length: 24 }, (_, n) => (
                      <option key={n} value={n}>
                        {n + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                Condition codes: g0.4 / g0.6 / g0.9 = chance of another round; h1 / h10 = announced
                number of rounds. TFT copies the opponent’s previous action; Grim defects forever
                after an observed defection.
              </p>
            </details>
            {episode && (
              <>
                <p>
                  {episode.horizon.kind === 'fixed'
                    ? `${episode.horizon.rounds} announced rounds`
                    : `Continuation probability ${episode.horizon.delta}; the last round was hidden when choosing`}{' '}
                  · Agents saw {episode.mapping}. Both had the completed history; neither saw the
                  other’s current choice.
                </p>
                {track === 'A' && (
                  <div className="pd-controls" role="group" aria-label="Compare matched procedures">
                    {['nano-direct', 'nano-draft', 'super-direct', 'super-draft'].map((arm) => (
                      <button
                        key={arm}
                        aria-pressed={cell.endsWith('/' + arm)}
                        onClick={() => choose(cell.split('/').slice(0, 2).join('/') + '/' + arm)}
                      >
                        {playerLabel(arm)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="pd-controls">
                  <button disabled={!index} onClick={() => setRound(index - 1)}>
                    Previous round
                  </button>
                  <button
                    className="primary"
                    disabled={index === episode.rounds}
                    onClick={() => setRound(index + 1)}
                  >
                    Reveal next round
                  </button>
                  <button onClick={() => setRound(0)}>Restart replay</button>
                </div>
                <section className="pd-table" aria-label="Recorded round">
                  <div className="pd-table-heading">
                    <strong aria-live="polite">
                      {index ? `Recorded round ${index} of ${episode.rounds}` : 'Before play'}
                    </strong>
                    <small>Saved actions · no requests</small>
                  </div>
                  <div className="pd-players">
                    {episode.players.map((player, seat) => (
                      <article className={`pd-player pd-seat-${seat}`} key={seat}>
                        <span className="eyebrow">
                          PLAYER {seat === 0 ? 'A' : 'B'}
                          {episode.subjectSeat === seat ? ' · benchmark subject' : ''}
                        </span>
                        <h2>{playerLabel(player)}</h2>
                        <div className="pd-points">
                          {scores[seat]} <small>points so far</small>
                        </div>
                        <div className="pd-choice">
                          {pair
                            ? `${pair[seat] === 'C' ? 'Cooperate' : 'Defect'} · +${payoff(...pair)[seat]} points`
                            : 'No revealed choice yet'}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="pd-payoffs">
                    <PayoffTable current={pair?.join('')} />
                    <p>Both recorded actions are revealed together. C = cooperate; D = defect.</p>
                  </div>
                </section>
                <label className="pd-replay-label">
                  Recorded round
                  <input
                    type="range"
                    min={0}
                    max={episode.rounds}
                    value={index}
                    onChange={(e) => setRound(Number(e.target.value))}
                  />
                </label>
                {index === episode.rounds && (
                  <p role="status">
                    Recording complete.{' '}
                    {episode.horizon.kind === 'fixed'
                      ? 'The announced final round ended the game.'
                      : 'The hidden stopping draw ended the game; players did not know it was their last round.'}
                    {episode.normalisedOracleLoss !== null &&
                      ` Full-episode benchmark loss: ${episode.normalisedOracleLoss.toFixed(4)} normalised payoff points forgone.`}
                  </p>
                )}
                <details className="results-details">
                  <summary>Procedure and provenance</summary>
                  <p>
                    The default is Nano Direct against Tit-for-Tat in block 1 with ten announced
                    rounds, chosen by study metadata rather than its outcome. All 1,776 episodes
                    remain selectable; this example is not a representative-effect claim.
                  </p>
                  <p>
                    Direct: one thinking-off action request, capped at 128 tokens. Draft: a
                    thinking-on draft capped at 1,024 tokens, then a separate thinking-off action
                    request capped at 128 tokens. Both used temperature {temperature} and top-p 1.
                    Only the current draft was added to the action request.
                  </p>
                  <p>
                    The live Dilemma app offers optional reported forecasts and requests reasoning
                    off. This replay contains actions only; it does not reconstruct private drafts
                    or beliefs.
                  </p>
                  <p>
                    Temperature {temperature} · {date} · episode <code>{episode.id}</code> · block{' '}
                    {episode.block + 1} (data index {episode.block}) · presentation stratum{' '}
                    {episode.stratum + 1}. A stratum groups the action-label mapping and player
                    seat; each has six study blocks.
                  </p>
                  <p>
                    <a href={publicAsset(`${path}/episodes.json`)} download>
                      Download all actions at temperature {temperature}
                    </a>{' '}
                    · <a href="#results">Methods and findings</a>. Public actions reproduce scores,
                    but cannot authenticate private provider responses or billing.
                  </p>
                </details>
              </>
            )}
          </>
        )}
        <GameTypes />
      </main>
    </div>
  );
}
