import { type ReactNode, useEffect, useState } from 'react';
import { AppAccessNote, ProviderLogos } from './AppIdentity.js';
import { BrandText } from './BrandText.js';
import { publicAsset } from './assets.js';
import { summary, diagnostics, type StudyTemperature as Temperature } from './studyData.js';
import { StudyTemperature } from './StudyTemperature.js';
import {
  AverageDraftingChart,
  OpponentEffectsChart,
  SelfPlayCooperationChart,
} from './StudyCharts.js';
import { playerLabel } from '../dilemma/recorded.js';
import './results.css';
import { StudyReplayContent } from './StudyReplay.js';

const n = (value: number) => value.toLocaleString('en-US');
const loss = (value: number) => value.toFixed(4);
const diff = (value: number) => `${value > 0 ? '+' : ''}${loss(value)}`;
const pct = (value: number) => `${(100 * value).toFixed(1)}%`;
const limits = (values: readonly number[]) => `[${values.map(diff).join(', ')}]`;
const policies: Record<string, string> = {
  allc: 'Always cooperate',
  alld: 'Always defect',
  grim: 'Grim trigger',
  tft: 'Tit-for-Tat',
};
const arms = ['nano-direct', 'nano-draft', 'super-direct', 'super-draft'] as const;
const pairing = (cell: string) => cell.split('/').slice(1).map(playerLabel).join(' / ');
const primary = summary.contrasts.filter((row) => row.family === 'primary');
const readmeUrl = 'https://github.com/sheinkmana/dilemma-dynamics#readme';

export function StudyResults({
  navigation,
  theme,
  setTheme,
}: {
  navigation: ReactNode;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}) {
  const [temperature, setTemperature] = useState<Temperature>(0);
  const [policy, setPolicy] = useState('all');
  const [replayOpen, setReplayOpen] = useState(() => window.location.hash === '#replay');
  const [replayVisited, setReplayVisited] = useState(() => window.location.hash === '#replay');
  const armRows = summary.arms.filter((row) => row.temperature === temperature);
  const crossplay = summary.cooperation.filter((row) => row.temperature === temperature);
  const pooled = diagnostics.autonomousPooled.find((row) => row.temperature === temperature)!;

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== '#replay') return;
      setReplayOpen(true);
      setReplayVisited(true);
      window.requestAnimationFrame(() =>
        document.getElementById('study-replay')?.scrollIntoView({ block: 'start' }),
      );
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  return (
    <div className="simple-app pd-app">
      <header className="app-header">
        <div className="brand">
          <BrandText />
        </div>
        <ProviderLogos />
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
        <AppAccessNote />
        <div className="results-intro">
          <p className="results-eyebrow">Evaluation</p>
          <h1>Better individual decisions. A harder path to cooperation.</h1>
          <p className="results-lead">
            An AI agent’s decisions can shape whether a partner cooperates, retaliates or helps
            rebuild a productive interaction. This evaluation examines how individual payoff
            decisions relate to cooperation over time.
          </p>
          <p>
            What changes when an AI drafts before choosing? In repeated Prisoner’s Dilemma, drafting
            reduced average payoff forgone by both Nemotron models. The opponent mattered: the
            advantage reversed against Tit-for-Tat, and autonomous self-play became less
            cooperative.
          </p>
          <div className="results-downloads">
            <a href={publicAsset('research/paper/report.pdf')}>PDF notes</a>
            <a href={readmeUrl}>Repository & README</a>
            <a
              href="#replay"
              onClick={() => {
                setReplayOpen(true);
                setReplayVisited(true);
                requestAnimationFrame(() =>
                  document.getElementById('study-replay')?.scrollIntoView({ block: 'start' }),
                );
              }}
            >
              Explore a study replay ↓
            </a>
          </div>
        </div>
        <dl className="results-stats">
          <div>
            <dt>Completed episodes</dt>
            <dd>
              {n(summary.completed)}
              <small>6,144 benchmark · 960 autonomous</small>
            </dd>
          </div>
          <div>
            <dt>Nemotron models</dt>
            <dd>
              2<small>Nano and Super</small>
            </dd>
          </div>
          <div>
            <dt>Temperatures</dt>
            <dd>
              2<small>0 and 1 · 3,552 episodes each</small>
            </dd>
          </div>
          <div>
            <dt>Average benchmark loss reduction</dt>
            <dd>
              16.8–37.5%
              <small>Draft relative to Direct, across four comparisons</small>
            </dd>
          </div>
        </dl>
        <section className="results-section results-procedures" aria-labelledby="procedure-title">
          <h2 id="procedure-title">One question, two ways to choose.</h2>
          <div className="results-method-grid">
            <article>
              <h3>Direct</h3>
              <p>One action request, with thinking switched off.</p>
            </article>
            <article>
              <h3>Draft</h3>
              <p>
                A thinking-on draft, followed by a separate thinking-off action request. The draft
                changes computation, request count and conditioning together.
              </p>
            </article>
          </div>
          <p>
            Both procedures face the same paired environments. Against a disclosed opponent rule, an
            exact payoff reference measures the expected own payoff given up by each choice.{' '}
            <strong>Lower decision loss is better.</strong> A percentage reduction in that loss
            describes less payoff forgone; it is not a percentage gain in reward.
          </p>
        </section>
        <section className="results-section" aria-labelledby="average-title">
          <p className="results-eyebrow">1 · Decision quality</p>
          <h2 id="average-title">Drafting improves the average at both temperatures.</h2>
          <p>
            All four planned comparisons favour Draft. The size of the benefit depends on the model
            and temperature; both models have a smaller drafting advantage at temperature zero.
          </p>
          <AverageDraftingChart />
          <p className="results-note">
            The independent unit is the matched block. Intervals use 50,000 deterministic stratified
            whole-block bootstrap draws; the four primary comparisons use 98.75% marginal intervals
            as an approximate Bonferroni treatment of a 5% family. These approximate intervals do
            not guarantee coverage. There are 768 benchmark episodes per procedure, model and
            temperature.
          </p>
        </section>
        <section className="results-section" aria-labelledby="opponent-title">
          <p className="results-eyebrow">2 · Strategic response</p>
          <h2 id="opponent-title">A useful average can conceal a consistent reversal.</h2>
          <p>
            Draft improves both models against Always Cooperate and Grim trigger at both
            temperatures. Against Tit-for-Tat, which responds to the previous move, Draft gives up
            more achievable payoff in all four comparisons. Against Always Cooperate, better
            individual performance includes more effective exploitation.
          </p>
          <OpponentEffectsChart />
          <p className="results-note">
            Exploratory opponent means, with 192 episodes per procedure, model, opponent and
            temperature. All four opponent policies are shown; these slices have no multiplicity
            correction.
          </p>
        </section>
        <section className="results-section" aria-labelledby="cooperation-title">
          <p className="results-eyebrow">3 · Coordination and repair</p>
          <h2 id="cooperation-title">
            Stronger benchmark decisions do not ensure mutual cooperation.
          </h2>
          <p>
            When two autonomous agents interact without a disclosed opponent rule, changing both
            agents to Draft reduces self-play cooperation and joint return for both models at both
            temperatures. Decision quality against a known rule and coordination with another
            adaptive player answer different questions.
          </p>
          <SelfPlayCooperationChart />
          <p className="results-note">
            The chart averages each episode’s mutual-cooperation fraction, giving every episode
            equal weight. Round-count fractions in the detailed tables use a different denominator.
            Self-play comparisons are exploratory and change both agents together; dependent rounds
            are not independent trials.
          </p>
          <p className="results-callout">
            Repair is visible in the trajectories. At temperature zero, Super Direct returns to
            mutual cooperation in <strong>82 of 218 eligible transitions</strong>; Super Draft does
            so in <strong>0 of 325</strong>. These transition counts describe relationship dynamics,
            rather than the episode-weighted percentage in the chart.
          </p>
        </section>

        <details
          id="study-replay"
          className="results-details results-replay"
          open={replayOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setReplayOpen(open);
            if (open) setReplayVisited(true);
          }}
        >
          <summary>Study replay · inspect the choices behind the results</summary>
          <p>
            Browse saved evaluation episodes, follow the revealed moves, and inspect decision loss
            against the exact payoff reference. These are recorded observations.
          </p>
          {replayVisited && <StudyReplayContent />}
        </details>

        <section className="results-section results-evidence" aria-labelledby="evidence-title">
          <h2 id="evidence-title">Detailed results and methods</h2>
          <p>
            Inspect the numbers supporting the charts and the finer patterns in presentation,
            planning and resource use. Select a temperature for the tables below; the charts above
            always show both.
          </p>
          <StudyTemperature value={temperature} onChange={setTemperature} />
          <details className="results-details">
            <summary>Average effects and temperature comparisons</summary>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Four planned primary comparisons · horizon-normalised benchmark decision loss
                </caption>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Temperature</th>
                    <th>Direct loss</th>
                    <th>Draft loss</th>
                    <th>Draft − Direct</th>
                    <th>Approx. 98.75% interval</th>
                    <th>Relative loss reduction</th>
                  </tr>
                </thead>
                <tbody>
                  {primary.map((row) => {
                    const direct = summary.arms.find(
                      (arm) =>
                        arm.temperature === row.temperature && arm.arm === `${row.model}-direct`,
                    )!;
                    const draft = summary.arms.find(
                      (arm) =>
                        arm.temperature === row.temperature && arm.arm === `${row.model}-draft`,
                    )!;
                    return (
                      <tr key={`${row.model}-${row.temperature}`}>
                        <th>{row.model === 'nano' ? 'Nano' : 'Super'}</th>
                        <td>{row.temperature}</td>
                        <td>{loss(direct.meanOracleLoss)}</td>
                        <td>{loss(draft.meanOracleLoss)}</td>
                        <td>{diff(row.estimate)}</td>
                        <td>{limits(row.interval)}</td>
                        <td>{pct(-row.estimate / direct.meanOracleLoss)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Six planned secondary contrasts · temperature 0 minus 1 · nominal 95% intervals
                </caption>
                <thead>
                  <tr>
                    <th>Comparison</th>
                    <th>Change</th>
                    <th>Approx. interval</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.contrasts
                    .filter((row) => row.family === 'secondary')
                    .map((row) => (
                      <tr key={`${row.contrast}-${row.arm ?? row.model}`}>
                        <th>
                          {row.arm
                            ? playerLabel(row.arm)
                            : `${row.model === 'nano' ? 'Nano' : 'Super'} · change in Draft − Direct`}
                        </th>
                        <td>{diff(row.estimate)}</td>
                        <td>{limits(row.interval)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="results-note">
              The secondary intervals have no multiplicity correction. Temperatures were interleaved
              within one campaign using paired environments.
            </p>
          </details>
          <details className="results-details">
            <summary>Opponent effects and all benchmark conditions</summary>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Exploratory opponent effects · temperature {temperature} · Draft − Direct loss
                </caption>
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th>Nano</th>
                    <th>Super</th>
                    <th>Episodes / procedure</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.policyEffects
                    .filter((row) => row.temperature === temperature)
                    .map((row) => (
                      <tr key={row.policy}>
                        <th>{policies[row.policy]}</th>
                        <td>{diff(row.nanoEffect)}</td>
                        <td>{diff(row.superEffect)}</td>
                        <td>{row.episodesPerArm}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <label className="results-filter">
              Show conditions{' '}
              <select value={policy} onChange={(event) => setPolicy(event.target.value)}>
                <option value="all">All four opponents</option>
                {Object.entries(policies).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  All 16 condition means · temperature {temperature} · 48 episodes per procedure /
                  condition
                </caption>
                <thead>
                  <tr>
                    <th>Condition</th>
                    {arms.map((arm) => (
                      <th key={arm}>{playerLabel(arm)}</th>
                    ))}
                    <th>Nano Δ</th>
                    <th>Super Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.conditions
                    .filter(
                      (row) =>
                        row.temperature === temperature &&
                        (policy === 'all' || row.condition.startsWith(policy + '-')),
                    )
                    .map((row) => (
                      <tr key={row.condition}>
                        <th>{row.condition}</th>
                        {arms.map((arm) => (
                          <td key={arm}>{loss(row[arm])}</td>
                        ))}
                        <td>{diff(row.nanoEffect)}</td>
                        <td>{diff(row.superEffect)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="results-note">
              g = geometric chance of another round; h = announced round count. At continuation .4,
              Draft improves every Tit-for-Tat mean. Reversals occur at .6, .9 and h10. At .6
              optimal play alternates; at .9 sustained cooperation is optimal.
            </p>
          </details>
          <details className="results-details">
            <summary>Autonomous pairings, cooperation and joint return</summary>
            <p>
              At temperature {temperature}, all autonomous pairings together contain {n(pooled.CC)}/
              {n(pooled.rounds)} mutually cooperative rounds ({pct(pooled.CC / pooled.rounds)}). The
              mean within-episode fraction is {pct(pooled.episodeWeightedCC)}. Each pairing has 48
              episodes and 376 realised rounds.
            </p>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  All ten autonomous pairings · temperature {temperature} · no disclosed opponent
                  rule
                </caption>
                <thead>
                  <tr>
                    <th>Pairing</th>
                    <th>CC / rounds</th>
                    <th>Mean episode CC</th>
                    <th>First CC / episodes</th>
                    <th>Joint return</th>
                    <th>Breakdown / opportunities</th>
                    <th>Recovery / opportunities</th>
                  </tr>
                </thead>
                <tbody>
                  {crossplay.map((row) => (
                    <tr key={row.cell}>
                      <th>{pairing(row.cell)}</th>
                      <td>
                        {row.CC}/{row.rounds}
                      </td>
                      <td>{pct(row.episodeWeightedCC)}</td>
                      <td>
                        {row.firstCC}/{row.completed}
                      </td>
                      <td>{loss(row.meanNormalisedJointReturn)}</td>
                      <td>
                        {row.breakdownCount}/{row.breakdownOpportunities}
                      </td>
                      <td>
                        {row.recoveryCount}/{row.recoveryOpportunities}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Exploratory Draft self-play − Direct self-play · temperature {temperature} ·
                  nominal 95% intervals
                </caption>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Metric</th>
                    <th>Difference</th>
                    <th>Interval</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.autonomousContrasts
                    .filter((row) => row.temperature === temperature)
                    .map((row) => (
                      <tr key={`${row.model}-${row.metric}`}>
                        <th>{row.model === 'nano' ? 'Nano' : 'Super'}</th>
                        <td>
                          {row.metric === 'episodeCC'
                            ? 'Mean episode CC fraction'
                            : 'Normalised joint return'}
                        </td>
                        <td>{diff(row.estimate)}</td>
                        <td>{limits(row.interval)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="results-note">
              Normalised joint return is (1 − .9) × total points earned by both players. The
              realised schedule averages 7.833 rounds: constant CC would give 4.7000, and constant
              DD 1.5667. Breakdown means CC → non-CC; recovery means non-CC → CC, only when another
              round occurs. These self-play comparisons have no multiplicity correction.
            </p>
          </details>
          <details className="results-details">
            <summary>Presentation effects and finite-horizon planning</summary>
            <p>
              Nano’s temperature-zero drafting effect changes with the action-label mapping,
              motivating a fully crossed follow-up. In the ten-round games, Super Draft at zero
              cooperates in Tit-for-Tat round nine in 43/48 episodes and defects in round ten in all
              48: local endgame adaptation is visible even when the complete optimal path is rare.
            </p>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Presentation effects · temperature {temperature} · 12 blocks per stratum · X=C in
                  0/2, X=D in 1/3
                </caption>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Stratum</th>
                    <th>Direct</th>
                    <th>Draft</th>
                    <th>Draft − Direct</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.strata
                    .filter((row) => row.temperature === temperature)
                    .map((row) => (
                      <tr key={`${row.model}-${row.stratum}`}>
                        <th>{row.model === 'nano' ? 'Nano' : 'Super'}</th>
                        <td>{row.stratum}</td>
                        <td>{loss(row.direct)}</td>
                        <td>{loss(row.draft)}</td>
                        <td>{diff(row.effect)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Announced ten-round games · temperature {temperature} · 48 episodes per row ·
                  optimal own payoff 32
                </caption>
                <thead>
                  <tr>
                    <th>Procedure / opponent</th>
                    <th>Optimal paths</th>
                    <th>C in round 9</th>
                    <th>C in round 10</th>
                    <th>Mean own payoff</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.finiteHorizon
                    .filter((row) => row.temperature === temperature)
                    .map((row) => (
                      <tr key={`${row.arm}-${row.policy}`}>
                        <th>
                          {playerLabel(row.arm)} / {policies[row.policy]}
                        </th>
                        <td>{row.optimalPaths}/48</td>
                        <td>{row.roundCooperations[8]}/48</td>
                        <td>{row.roundCooperations[9]}/48</td>
                        <td>{loss(row.meanOwnPayoff)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="results-note">
              Strata use different stopping draws. Presentation and finite-horizon slices are
              exploratory.
            </p>
          </details>
          <details className="results-details">
            <summary>Measured resources and study methods</summary>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Recorded requests · temperature {temperature} · both tracks · 5,236 decisions per
                  procedure and model
                </caption>
                <thead>
                  <tr>
                    <th>Procedure</th>
                    <th>Requests sent</th>
                    <th>Input / output tokens</th>
                    <th>Length-limit / successful drafts</th>
                    <th>Request median / p95 (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {armRows.map((row) => {
                    const request = diagnostics.requestDiagnostics.find(
                      (item) => item.temperature === temperature && item.arm === row.arm,
                    )!;
                    return (
                      <tr key={row.arm}>
                        <th>{playerLabel(row.arm)}</th>
                        <td>{n(row.requests)}</td>
                        <td>
                          {n(row.promptTokens)} / {n(row.completionTokens)}
                        </td>
                        <td>
                          {request.successfulDrafts
                            ? `${n(request.cappedDrafts)}/${n(request.successfulDrafts)} (${pct(request.cappedDrafts / request.successfulDrafts)})`
                            : '—'}
                        </td>
                        <td>
                          {row.requestMedianSeconds.toFixed(2)} / {row.requestP95Seconds.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              Draft uses a draft limit of 1,024 tokens and an action limit of 128, with the selected
              temperature used throughout. Between 25% and 56% of successful drafts reach the draft
              limit. Request latency includes draft and action requests, rather than measuring a
              complete decision’s elapsed time.
            </p>
            <p>
              The repository records measured resource use and usage-based cost estimates at the
              rates used for this evaluation. These describe the observed procedure.
            </p>
            <p>
              The evaluation pairs 48 matched blocks at each temperature across four label/seat
              strata. Its benchmark covers four disclosed opponent policies and four stopping
              conditions. Autonomous play covers all ten pairings of the four model/procedure
              combinations. Earlier development observations are excluded.
            </p>
            <p>
              Inspect AI recorded native samples, model events and scored outcomes. A local gateway
              retained sealed actions and request attempts; MLflow Skinny tracked the runs,
              parameters, metrics and evidence exports. Offline verification reconstructs scores,
              intervals and diagnostics from the retained record without model calls.
            </p>
            <p className="results-note">
              The results describe the evaluated prompts, bounded procedures and hosted models. The
              PDF notes provide the full mathematical definitions, related work and provenance.
            </p>
          </details>
        </section>
        <section className="results-section" aria-labelledby="future-title">
          <h2 id="future-title">What these patterns invite us to study next</h2>
          <div className="results-method-grid">
            <article>
              <h3>Planning across responses</h3>
              <p>
                Vary contingent planning depth to understand why local payoff gains coexist with
                Tit-for-Tat reversals and rare optimal finite paths.
              </p>
            </article>
            <article>
              <h3>Repairing a relationship</h3>
              <p>
                Use forgiving partners and controlled repair opportunities to learn when agents can
                rebuild mutually beneficial cooperation.
              </p>
            </article>
            <article>
              <h3>Communication and uncertainty</h3>
              <p>
                Add messages and noisy observations to test how agents communicate intentions and
                distinguish mistakes from deliberate defection.
              </p>
            </article>
            <article>
              <h3>Longer, more varied interactions</h3>
              <p>
                Vary horizons, incentives and populations to examine which decision and coordination
                patterns persist beyond these paired encounters.
              </p>
            </article>
          </div>
          <div className="results-downloads">
            <a href={publicAsset('research/paper/report.pdf')}>Read the PDF notes</a>
            <a href={readmeUrl}>Methods, data & verification in the repository</a>
          </div>
        </section>
      </main>
    </div>
  );
}
