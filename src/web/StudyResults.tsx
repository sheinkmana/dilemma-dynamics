import { AppAccessNote, ProviderLogos } from './AppIdentity.js';
import { BrandText } from './BrandText.js';
import { GameTypes } from './GameTypes.js';
import { publicAsset } from './assets.js';
import { type ReactNode, useState } from 'react';
import {
  summary,
  diagnostics,
  accounting,
  provenance,
  type StudyTemperature as Temperature,
} from './studyData.js';
import { StudyTemperature } from './StudyTemperature.js';
import { playerLabel } from '../dilemma/recorded.js';
import './results.css';

const n = (v: number) => v.toLocaleString('en-US');
const loss = (v: number) => v.toFixed(4);
const diff = (v: number) => `${v > 0 ? '+' : ''}${loss(v)}`;
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const limits = (values: number[]) => `[${values.map(diff).join(', ')}]`;
const policies: Record<string, string> = {
  allc: 'Always cooperate',
  alld: 'Always defect',
  grim: 'Grim trigger',
  tft: 'Tit-for-Tat',
};
const arms = ['nano-direct', 'nano-draft', 'super-direct', 'super-draft'] as const;
const pairing = (cell: string) => cell.split('/').slice(1).map(playerLabel).join(' / ');
type Contrast = {
  family: string;
  model?: string;
  temperature?: number;
  arm?: string;
  contrast: string;
  estimate: number;
  interval: number[];
};
const contrasts: Contrast[] = summary.contrasts;
const primary = contrasts.filter((c) => c.family === 'primary');

function Download({ file, children }: { file: string; children: ReactNode }) {
  return (
    <a href={publicAsset(`research/${file}`)} download>
      {children}
    </a>
  );
}

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
  const armRows = summary.arms.filter((a) => a.temperature === temperature);
  const crossplay = summary.cooperation.filter((c) => c.temperature === temperature);
  const pooled = diagnostics.autonomousPooled.find((c) => c.temperature === temperature)!;
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
          <p className="results-eyebrow">Final evaluation · 24–25 October 2026 · complete</p>
          <h1>Drafting sharpens choices. Cooperation still breaks.</h1>
          <p className="results-lead">
            A bounded draft lowered average payoff decision loss for Nemotron Nano and Super at both
            temperatures. The gains reversed against Tit-for-Tat, while autonomous self-play became
            less cooperative. Better performance against a disclosed rule can coexist with
            difficulty sustaining reciprocity.
          </p>
          <p>
            All results below come from one completed, paired final campaign. Earlier development
            observations are excluded. Explore the conditions, replay the actions, and test the
            reported statistics offline.
          </p>
          <div className="results-downloads">
            <Download file="paper/report.pdf">Report & mathematical notes (PDF)</Download>
            <a href={publicAsset('FINAL_EVALUATION.md')}>Methods, conclusions & amendments</a>
            <a href="#replay">Replay all decisions →</a>
          </div>
        </div>
        <dl className="results-stats">
          <div>
            <dt>Completed episodes</dt>
            <dd>
              {n(summary.completed)}
              <small>3,552 at each temperature</small>
            </dd>
          </div>
          <div>
            <dt>Matched blocks</dt>
            <dd>
              48<small>12 in each label/seat stratum</small>
            </dd>
          </div>
          <div>
            <dt>Benchmark / autonomous</dt>
            <dd>
              6,144 / 960<small>disclosed rules / adaptive dyads</small>
            </dd>
          </div>
          <div>
            <dt>Scientific stage</dt>
            <dd>
              {provenance.finalElapsedHours.toFixed(2)} h
              <small>including interruption and recovery</small>
            </dd>
          </div>
        </dl>
        <section className="results-section">
          <h2>Four planned comparisons favour Draft on average.</h2>
          <p>
            Direct makes one thinking-off action request. Draft makes a thinking-on draft capped at
            1,024 tokens, then a separate thinking-off action request capped at 128. Each procedure
            uses the selected temperature throughout. The draft changes computation, request count
            and conditioning together.
          </p>
          <p>
            Benchmark loss sums exact gaps to the best achievable expected own payoff against the
            disclosed opponent, with horizon normalisation. Zero means no achievable expected payoff
            was given up. Lower is better; negative Draft − Direct favours Draft.
          </p>
          <div className="results-table-wrap">
            <table className="results-table">
              <caption>Primary results · 768 benchmark episodes per arm and temperature</caption>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Temperature</th>
                  <th>Direct loss</th>
                  <th>Draft loss</th>
                  <th>Draft − Direct</th>
                  <th>Approx. 98.75% interval</th>
                </tr>
              </thead>
              <tbody>
                {primary.map((c) => {
                  const direct = summary.arms.find(
                    (a) => a.temperature === c.temperature && a.arm === `${c.model}-direct`,
                  )!;
                  const draft = summary.arms.find(
                    (a) => a.temperature === c.temperature && a.arm === `${c.model}-draft`,
                  )!;
                  return (
                    <tr key={`${c.model}-${c.temperature}`}>
                      <th>{c.model === 'nano' ? 'Nano' : 'Super'}</th>
                      <td>{c.temperature}</td>
                      <td>{loss(direct.meanOracleLoss)}</td>
                      <td>{loss(draft.meanOracleLoss)}</td>
                      <td>{diff(c.estimate)}</td>
                      <td>{limits(c.interval)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="results-note">
            50,000 deterministic stratified whole-block bootstrap draws. Four primary comparisons
            use 98.75% marginal intervals as an approximate Bonferroni treatment of a 5% family;
            coverage is not guaranteed. The independent unit is the matched block.
          </p>
        </section>
        <section className="results-section">
          <h2>Temperature changes the benefit of drafting.</h2>
          <p>
            At zero, Super Direct improves and Super Draft stays close to its temperature-one mean.
            Nano Draft worsens, while Nano Direct changes little. Both models therefore have a
            smaller drafting advantage at zero. A single temperature recommendation would hide these
            differences.
          </p>
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
                {contrasts
                  .filter((c) => c.family === 'secondary')
                  .map((c) => (
                    <tr key={`${c.contrast}-${c.arm ?? c.model}`}>
                      <th>
                        {c.arm
                          ? playerLabel(c.arm)
                          : `${c.model === 'nano' ? 'Nano' : 'Super'} · change in Draft − Direct`}
                      </th>
                      <td>{diff(c.estimate)}</td>
                      <td>{limits(c.interval)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="results-note">
            These six intervals have no multiplicity correction. Temperatures were interleaved
            within one campaign, using paired environments; hosted model weights and sampling remain
            outside the experiment’s control.
          </p>
        </section>
        <StudyTemperature value={temperature} onChange={setTemperature} />
        <section className="results-section">
          <h2>The opponent explains the reversal.</h2>
          <p>
            Drafting improves all four means against Always Cooperate and Grim, but worsens all four
            against Tit-for-Tat. Against an opponent that always cooperates, defection maximises own
            points. These gains therefore include more effective exploitation. Nano at zero also
            shows a small loss increase against Always Defect.
          </p>
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
                  <th>Episodes / arm</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.policyEffects
                  .filter((r) => r.temperature === temperature)
                  .map((r) => (
                    <tr key={r.policy}>
                      <th>{policies[r.policy]}</th>
                      <td>{diff(r.nanoEffect)}</td>
                      <td>{diff(r.superEffect)}</td>
                      <td>{r.episodesPerArm}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <label className="results-filter">
            Show conditions{' '}
            <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
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
                All 16 condition means · 48 episodes per arm / condition / temperature
              </caption>
              <thead>
                <tr>
                  <th>Condition</th>
                  {arms.map((a) => (
                    <th key={a}>{a.replace('-', ' ')}</th>
                  ))}
                  <th>Nano Δ</th>
                  <th>Super Δ</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.conditions
                  .filter(
                    (r) =>
                      r.temperature === temperature &&
                      (policy === 'all' || r.condition.startsWith(policy + '-')),
                  )
                  .map((r) => (
                    <tr key={r.condition}>
                      <th>{r.condition}</th>
                      {arms.map((a) => (
                        <td key={a}>{loss(r[a])}</td>
                      ))}
                      <td>{diff(r.nanoEffect)}</td>
                      <td>{diff(r.superEffect)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="results-note">
            g = geometric chance of another round; h = announced round count. At continuation .4,
            drafting improves every Tit-for-Tat mean. Reversals occur at .6, .9 and h10. At .6
            optimal play alternates; at .9 sustained cooperation is optimal. All exploratory slices
            are disclosed without significance selection.
          </p>
        </section>
        <section className="results-section">
          <h2>Autonomous self-play becomes less cooperative with Draft.</h2>
          <p>
            Across all pairings at temperature {temperature}, mutual cooperation occurs in{' '}
            {n(pooled.CC)}/{n(pooled.rounds)} rounds ({pct(pooled.CC / pooled.rounds)}). The mean
            within-episode CC fraction is {pct(pooled.episodeWeightedCC)}. Every pairing shares the
            same stopping lengths: 48 dyads and 376 realised rounds. Dependent rounds are not
            separate independent trials.
          </p>
          <div className="results-table-wrap">
            <table className="results-table">
              <caption>
                All ten autonomous pairings · temperature {temperature} · no disclosed opponent rule
              </caption>
              <thead>
                <tr>
                  <th>Pairing</th>
                  <th>CC / rounds</th>
                  <th>Mean episode CC</th>
                  <th>First CC / dyads</th>
                  <th>Joint return</th>
                  <th>Breakdown / opportunities</th>
                  <th>Recovery / opportunities</th>
                </tr>
              </thead>
              <tbody>
                {crossplay.map((c) => (
                  <tr key={c.cell}>
                    <th>{pairing(c.cell)}</th>
                    <td>
                      {c.CC}/{c.rounds}
                    </td>
                    <td>{pct(c.episodeWeightedCC)}</td>
                    <td>
                      {c.firstCC}/{c.completed}
                    </td>
                    <td>{loss(c.meanNormalisedJointReturn)}</td>
                    <td>
                      {c.breakdownCount}/{c.breakdownOpportunities}
                    </td>
                    <td>
                      {c.recoveryCount}/{c.recoveryOpportunities}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Super Direct self-play at zero starts with no CC rounds, then returns to CC in 82/218
            eligible transitions. Super Draft has only three CC rounds and no recovery in 325
            opportunities. Changing both agents to Draft reduces self-play joint return for both
            models at both temperatures.
          </p>
          <details className="results-details">
            <summary>Paired self-play effects and return interpretation</summary>
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
                    .filter((r) => r.temperature === temperature)
                    .map((r) => (
                      <tr key={`${r.model}-${r.metric}`}>
                        <th>{r.model}</th>
                        <td>
                          {r.metric === 'episodeCC'
                            ? 'Mean episode CC fraction'
                            : 'Normalised joint return'}
                        </td>
                        <td>{diff(r.estimate)}</td>
                        <td>{limits(r.interval)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p>
              Normalised joint return is (1 − .9) × total points earned by both players. The
              realised schedule averages 7.833 rounds: constant CC would give 4.7000, and constant
              DD 1.5667. Breakdown is CC → non-CC; recovery is non-CC → CC, counted only when a next
              round occurs. These post-viewing self-play comparisons change both agents and have no
              multiplicity correction.
            </p>
          </details>
        </section>
        <section className="results-section">
          <h2>Two failure modes survive the average improvement.</h2>
          <div className="results-method-grid">
            <article>
              <h3>Action labels matter for Nano at zero.</h3>
              <p>
                When X means cooperate, drafting reduces loss in both seats (−.4652 and −.2558).
                When X means defect, it increases loss (+.1427 and +.1431). All Super strata favour
                Draft. The strata use different stopping draws, so this is a mapping-associated
                pattern to test with fully crossed seeds.
              </p>
            </article>
            <article>
              <h3>Local endgames exceed sustained planning.</h3>
              <p>
                Only one of 768 ten-round TFT/Grim episodes follows the optimal nine-C-then-D path.
                Super Draft at zero cooperates in TFT round nine in 43/48 episodes and defects in
                round ten in all 48, while its earlier choices still lose payoff.
              </p>
            </article>
          </div>
          <details className="results-details">
            <summary>Inspect all presentation and finite-horizon diagnostics</summary>
            <div className="results-table-wrap">
              <table className="results-table">
                <caption>
                  Presentation effects · temperature {temperature} · 12 blocks per stratum · X=C in
                  strata 0/2; X=D in 1/3
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
                    .filter((r) => r.temperature === temperature)
                    .map((r) => (
                      <tr key={`${r.model}-${r.stratum}`}>
                        <th>{r.model}</th>
                        <td>{r.stratum}</td>
                        <td>{loss(r.direct)}</td>
                        <td>{loss(r.draft)}</td>
                        <td>{diff(r.effect)}</td>
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
                    <th>Arm / opponent</th>
                    <th>Optimal paths</th>
                    <th>C in round 9</th>
                    <th>C in round 10</th>
                    <th>Mean own payoff</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.finiteHorizon
                    .filter((r) => r.temperature === temperature)
                    .map((r) => (
                      <tr key={`${r.arm}-${r.policy}`}>
                        <th>
                          {playerLabel(r.arm)} / {policies[r.policy]}
                        </th>
                        <td>{r.optimalPaths}/48</td>
                        <td>{r.roundCooperations[8]}/48</td>
                        <td>{r.roundCooperations[9]}/48</td>
                        <td>{loss(r.meanOwnPayoff)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="results-section">
          <h2>What the infrastructure reveals.</h2>
          <p>
            Inspect AI recorded native samples, model events and scored outcomes. The audited
            gateway retained sealed actions, request attempts and accounting. MLflow Skinny tracked
            the actual engineering and final runs in local SQLite, including parameters, metrics,
            sessions and head-bound exports. Both integrations were used during execution.
          </p>
          <div className="results-table-wrap">
            <table className="results-table">
              <caption>
                Recorded resources · temperature {temperature} · both tracks · 5,236 decisions per
                arm
              </caption>
              <thead>
                <tr>
                  <th>Arm</th>
                  <th>Requests sent</th>
                  <th>Input / output tokens</th>
                  <th>Capped / successful drafts</th>
                  <th>Request median / p95 (s)</th>
                  <th>Usage estimate (USD)</th>
                </tr>
              </thead>
              <tbody>
                {armRows.map((a) => {
                  const d = diagnostics.requestDiagnostics.find(
                    (r) => r.temperature === temperature && r.arm === a.arm,
                  )!;
                  return (
                    <tr key={a.arm}>
                      <th>{playerLabel(a.arm)}</th>
                      <td>{n(a.requests)}</td>
                      <td>
                        {n(a.promptTokens)} / {n(a.completionTokens)}
                      </td>
                      <td>
                        {d.successfulDrafts
                          ? `${n(d.cappedDrafts)}/${n(d.successfulDrafts)} (${pct(d.cappedDrafts / d.successfulDrafts)})`
                          : '—'}
                      </td>
                      <td>
                        {a.requestMedianSeconds.toFixed(2)} / {a.requestP95Seconds.toFixed(2)}
                      </td>
                      <td>${Number(a.estimatedUsd).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            Draft costs roughly 10–12 times Direct within the same model across both tracks. Between
            25% and 56% of successful drafts hit their cap. Request latency mixes the draft and
            action phases; it does not measure full decision or wall-clock delay. Cap hits are an
            observed feature of this bounded procedure, and their association with performance is
            confounded by request difficulty.
          </p>
          <p className="results-caveat">
            Final inference usage estimate: ${Number(accounting.finalUsageEstimate).toFixed(4)};
            engineering: ${Number(accounting.engineeringUsageEstimate).toFixed(4)}. An additional $
            {accounting.unresolvedMaximumExposure} remains uncertain maximum billing exposure for 20
            transmitted attempts. It is neither confirmed paid nor confirmed free. Publication with
            this disclosure was explicitly approved on 25 October; the ledger reservations remain
            intact under the $40 cap.
          </p>
          <details className="results-details">
            <summary>Transport recovery and provenance</summary>
            <p>
              Provider overload stopped the original session at 3,406 episodes. An approved
              amendment preserved them and allowed six total attempts, one durable 30-minute
              decision window, a shared five-minute cooldown and reduced concurrency. The original
              deadline and budget stayed fixed. There were 62,832 successful requests plus 17 HTTP
              529, one HTTP 502 and two attempts without a durable HTTP response.
            </p>
            <p>
              All successful responses reported the requested model ID and one consistent
              fingerprint per model in this campaign. Those identifiers do not pin weights or hidden
              serving state. Nano and Super also differ in listed region and quantisation.
            </p>
            <p>
              Specification: <code>{summary.specSha256}</code>
              <br />
              Final evidence head: <code>{summary.evidenceHead}</code>
            </p>
          </details>
        </section>
        <section className="results-section">
          <h2>Hypotheses for a next study.</h2>
          <p>These explanations are motivated by the observed patterns and remain untested.</p>
          <div className="results-method-grid">
            <article>
              <h3>Local optimisation outruns contingent planning.</h3>
              <p>
                Simple exploitation gains coexist with TFT reversals and rare optimal finite paths.
                Vary explicit state-transition planning depth at a fixed compute budget.
              </p>
            </article>
            <article>
              <h3>Defensive play blocks reciprocal repair.</h3>
              <p>
                Super Draft self-play at zero never returns to CC in 325 opportunities. Test
                controlled forgiving partners that create specific repair opportunities.
              </p>
            </article>
            <article>
              <h3>Drafting changes presentation habits.</h3>
              <p>
                Nano’s zero-temperature mapping reversal motivates crossing every stopping seed with
                both mappings and seats.
              </p>
            </article>
            <article>
              <h3>Truncation interacts with sampling.</h3>
              <p>
                More cap hits at temperature one accompany different model-specific effects.
                Randomise draft caps and add an equal-compute Direct control.
              </p>
            </article>
          </div>
        </section>
        <section className="results-section">
          <h2>Reproduce the final evaluation.</h2>
          <p>
            The public package contains revealed actions, exact decision gaps, request telemetry,
            the frozen schedule and source indices. The offline verifier reconstructs scores, all
            planned intervals and exploratory diagnostics without model calls. Private logs support
            execution review; public checksums establish file integrity.
          </p>
          <div className="results-downloads">
            <Download file="temperature-zero/episodes.json">Temperature 0 actions</Download>
            <Download file="temperature-one/episodes.json">Temperature 1 actions</Download>
            <Download file="contrasts.csv">Planned contrasts (CSV)</Download>
            <Download file="diagnostics.json">Exploratory diagnostics (JSON)</Download>
            <Download file="decisions.csv.gz">Decisions (CSV.gz)</Download>
            <Download file="requests.csv.gz">Requests (CSV.gz)</Download>
            <Download file="decisions.parquet">Decisions (Parquet)</Download>
            <Download file="requests.parquet">Requests (Parquet)</Download>
            <Download file="manifest.json">Checksums</Download>
            <Download file="publication-review.json">Release & accounting review</Download>
            <Download file="paper/main.tex">LaTeX source</Download>
          </div>
          <p className="results-note">
            Earlier outcomes informed this prospective replication and are not pooled. Findings
            concern these prompts, bounded procedures and hosted service window. Approximate block
            intervals do not guarantee coverage; secondary and post-viewing diagnostics have no
            family correction. The report retains related literature and Rasmusen’s repeated-game
            foundations.
          </p>
          <GameTypes />
        </section>
      </main>
    </div>
  );
}
