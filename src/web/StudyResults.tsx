import React, { type ReactNode, useState } from 'react';
import study from '../../public/research/summary.json' with { type: 'json' };
import './results.css';

const number = (value: number) => value.toLocaleString('en-US');
const loss = (value: number) => value.toFixed(4);
const difference = (value: number) =>
  Math.abs(value) < 0.00005 ? '0.0000' : `${value > 0 ? '+' : ''}${loss(value)}`;
const policies: Record<string, string> = {
  allc: 'Always cooperate',
  alld: 'Always defect',
  grim: 'Grim trigger',
  tft: 'Tit-for-Tat',
};

export function StudyResults({
  navigation,
  theme,
  setTheme,
}: {
  navigation: ReactNode;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}) {
  const [policy, setPolicy] = useState('all');
  const crossplayRounds = Object.values(study.jointActionCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="simple-app pd-app">
      <header className="app-header">
        <div className="brand">
          Game Field<span aria-hidden="true">.</span>
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
          <p className="results-eyebrow">Completed study · 22 October 2026</p>
          <h1>Drafting improved average benchmark decisions.</h1>
          <p className="results-lead">
            A capped draft followed by a separate action request reduced average decision loss for
            both Nemotron models. The benefit depended on the opponent; drafting worsened
            performance against Tit-for-Tat on average.
          </p>
          <p className="results-caveat">
            Descriptive amended study. These findings apply to the tested procedures and schedule;
            they do not establish universal reasoning superiority or a general model ranking.
          </p>
          <div className="results-downloads">
            <a href="/research/paper/report.pdf" download>
              Report (PDF) ↓
            </a>
            <a href="/research/paper/main.tex" download>
              LaTeX source ↓
            </a>
            <a href="/research/protocol.md">Methods &amp; amendments</a>
            <a href="/research/README.md">Data &amp; reproduction</a>
          </div>
        </div>

        <dl className="results-stats">
          <div>
            <dt>Completed episodes</dt>
            <dd>
              {number(study.completed)} / {number(study.scheduled)}
            </dd>
          </div>
          <div>
            <dt>Balanced blocks</dt>
            <dd>
              24 <small>6 per presentation stratum</small>
            </dd>
          </div>
          <div>
            <dt>Final inference estimate</dt>
            <dd>
              ${Number(study.finalEstimatedUsd).toFixed(4)}{' '}
              <small>usage priced; not an invoice</small>
            </dd>
          </div>
          <div>
            <dt>Final-run failures / retries</dt>
            <dd>
              {study.failures} / {study.retries} <small>all scheduled episodes completed</small>
            </dd>
          </div>
        </dl>

        <section className="results-section" aria-labelledby="benchmark-title">
          <p className="results-eyebrow">Track A · Decisions against disclosed policies</p>
          <h2 id="benchmark-title">Lower loss means a better decision.</h2>
          <p>
            The reference solver finds the best expected own payoff against a known committed
            opponent. Oracle loss measures the payoff given up by a chosen action, with optimal
            continuation thereafter. Episode loss sums these gaps with the specified horizon
            normalisation. It is a point measure, not a percentage or cooperation score.
          </p>
          <div className="results-model-grid">
            {study.primary.map((result) => (
              <article className="results-model" key={result.model}>
                <h3>Nemotron {result.model === 'nano' ? 'Nano' : 'Super'}</h3>
                <div
                  className="results-loss-bars"
                  aria-label={`Mean oracle loss for ${result.model}`}
                >
                  {(
                    [
                      ['Direct', result.directMean],
                      ['Draft', result.draftMean],
                    ] as const
                  ).map(([label, value]) => (
                    <div className="results-bar-row" key={label}>
                      <span>{label}</span>
                      <div className="results-bar-track">
                        <div
                          className={label === 'Draft' ? 'results-bar draft' : 'results-bar'}
                          style={{ width: `${value * 100}%` }}
                        />
                      </div>
                      <strong>{loss(value)}</strong>
                    </div>
                  ))}
                </div>
                <p className="results-effect">
                  {difference(result.estimate)} <span>draft − direct loss</span>
                </p>
                <p className="results-interval">
                  Approx. 95% interval [{result.approximateInterval95.map(loss).join(', ')}]
                </p>
                <p className="muted">
                  384 episodes per procedure · {result.relativeReductionPercent.toFixed(1)}%
                  relative reduction in mean loss
                </p>
              </article>
            ))}
          </div>
          <p className="results-note">
            The primary contrast equally weights 16 conditions and four presentation strata.
            Approximate intervals use 20,000 stratified whole-block bootstrap draws. Only six blocks
            per stratum are available; coverage and statistical power are not established.
          </p>
        </section>

        <section className="results-section" aria-labelledby="opponents-title">
          <h2 id="opponents-title">The opponent changes the result.</h2>
          <p>
            Each group below averages four conditions. Negative differences favour drafting;
            positive differences favour direct action. These breakdowns are exploratory. Against
            unconditional opponents, improved decisions mean selecting defection more often.
          </p>
          <div
            className="results-table-wrap"
            role="region"
            aria-label="Opponent group results"
            tabIndex={0}
          >
            <table className="results-table">
              <caption>Draft minus direct mean oracle loss</caption>
              <thead>
                <tr>
                  <th scope="col">Opponent</th>
                  <th scope="col">Nano</th>
                  <th scope="col">Super</th>
                </tr>
              </thead>
              <tbody>
                {study.policyEffects.map((row) => (
                  <tr key={row.policy}>
                    <th scope="row">{policies[row.policy]}</th>
                    <td>{difference(row.nano)}</td>
                    <td>{difference(row.super)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="results-details">
            <summary>Explore all 16 benchmark conditions</summary>
            <div className="results-filter">
              <label htmlFor="results-opponent">Show opponent</label>
              <select
                id="results-opponent"
                value={policy}
                onChange={(event) => setPolicy(event.target.value)}
              >
                <option value="all">All opponents</option>
                {Object.entries(policies).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <p className="results-note">
              δ is the probability of another round. H is the announced total number of rounds. Each
              cell has 24 episodes.
            </p>
            <div
              className="results-table-wrap"
              role="region"
              aria-label="All benchmark conditions"
              tabIndex={0}
            >
              <table className="results-table results-conditions">
                <caption>Mean oracle loss by condition; difference = draft − direct</caption>
                <thead>
                  <tr>
                    <th scope="col">Condition</th>
                    <th scope="col">Nano direct</th>
                    <th scope="col">Nano draft</th>
                    <th scope="col">Nano diff.</th>
                    <th scope="col">Super direct</th>
                    <th scope="col">Super draft</th>
                    <th scope="col">Super diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {study.conditions
                    .filter((row) => policy === 'all' || row.condition.startsWith(`${policy}-`))
                    .map((row) => {
                      const [opponent, horizon] = row.condition.split('-');
                      return (
                        <tr key={row.condition}>
                          <th scope="row">
                            {policies[opponent]} ·{' '}
                            {horizon.replace('g', 'δ = ').replace('h', 'H = ')}
                          </th>
                          <td>{loss(row['nano-direct'])}</td>
                          <td>{loss(row['nano-draft'])}</td>
                          <td>{difference(row.nanoDifference)}</td>
                          <td>{loss(row['super-direct'])}</td>
                          <td>{loss(row['super-draft'])}</td>
                          <td>{difference(row.superDifference)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="results-section" aria-labelledby="cooperation-title">
          <p className="results-eyebrow">Track B · Autonomous interaction</p>
          <h2 id="cooperation-title">Better benchmark decisions did not mean more cooperation.</h2>
          <div className="results-crossplay">
            <p className="results-big-number">
              {((100 * study.jointActionCounts.CC) / crossplayRounds).toFixed(1)}%
              <span>of observed rounds had mutual cooperation</span>
            </p>
            <div>
              <p>
                <strong>
                  {study.jointActionCounts.CC} of {number(crossplayRounds)} rounds
                </strong>{' '}
                across 240 dyads and all ten pairings, including self-play. First-round mutual
                cooperation was {study.firstRoundCC}/240 (
                {((100 * study.firstRoundCC) / 240).toFixed(1)}%).
              </p>
              <p>
                Both defected in {number(study.jointActionCounts.DD)} rounds; the remaining{' '}
                {number(study.jointActionCounts.CD + study.jointActionCounts.DC)} were asymmetric.
              </p>
            </div>
          </div>
          <p className="results-note">
            Rounds within a dyad are dependent. These are descriptive counts, not{' '}
            {number(crossplayRounds)} independent trials or evidence of a Nash equilibrium. Adaptive
            opponents have no identified exact oracle here.
          </p>
        </section>

        <section className="results-section" aria-labelledby="methods-title">
          <h2 id="methods-title">What was tested</h2>
          <div className="results-method-grid">
            <div>
              <h3>The procedures</h3>
              <p>
                Direct used one thinking-off action request capped at 128 tokens. Draft used a
                thinking-on draft capped at 1,024 tokens, then a separate thinking-off action
                request capped at 128 tokens. Both used temperature 1 and full completed history.
              </p>
              <p>
                The intervention includes extra compute, an extra request, and conditioning on draft
                text. It was not an equal-cost comparison.
              </p>
            </div>
            <div>
              <h3>The game</h3>
              <p>
                Each player maximised expected own cumulative points: CC = 3/3, CD = 0/5, DC = 5/0,
                DD = 1/1. Track A tested Always Cooperate, Always Defect, Tit-for-Tat and Grim at δ
                = .4, .6, .9, plus selected fixed horizons. Track B used δ = .9.
              </p>
              <p>
                A geometric game's realised last round was hidden when choosing. It is different
                from an announced final round.
              </p>
            </div>
          </div>
          <p className="results-caveat">
            The live educational app uses a different protocol: temperature zero with optional
            forecasts. Its sessions are separate from this fixed scientific evaluation.
          </p>
        </section>

        <section className="results-section" aria-labelledby="limits-title">
          <h2 id="limits-title">Scope, history and evidence</h2>
          <ul className="results-limitations">
            <li>
              The successor followed an interrupted eight-block run whose outcomes had already been
              inspected. Predecessor and engineering observations are excluded. This is not a new
              confirmatory preregistration.
            </li>
            <li>
              One environment schedule, four committed policies, fixed payoffs, and one provider
              execution window limit generalisation. Provider sampling randomness was not matched by
              seed.
            </li>
            <li>
              The recorded model IDs do not prove an immutable provider weights version. Draft text
              does not verify internal beliefs or explain the mechanism of any improvement.
            </li>
          </ul>
          <p>
            Offline checks reproduced episode scores and bootstrap estimates, and locally verified
            raw responses, request accounting and the original event chain. The public package
            supports score and estimate reproduction from revealed actions. Raw provider responses,
            private drafts, receipts and operational records are retained privately.
          </p>
          <p className="results-note">
            The public package cannot independently authenticate provider identity, raw transport
            history or billing. All {number(study.requestCount)} final-run requests were locally
            recorded as successful; the inference cost is an estimate.
          </p>
          <div className="results-downloads">
            <a href="/research/episodes.json" download>
              Episode actions (JSON) ↓
            </a>
            <a href="/research/summary.json" download>
              Results summary (JSON) ↓
            </a>
            <a href="/research/condition-losses.csv" download>
              Condition results (CSV) ↓
            </a>
            <a href="/research/crossplay.csv" download>
              Pairing results (CSV) ↓
            </a>
          </div>
          <details className="results-details">
            <summary>Model IDs and study provenance</summary>
            <p>
              Nano: <code>nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B</code>
              <br />
              Super: <code>nvidia/nemotron-3-super-120b-a12b</code>
            </p>
            <p>
              Plan SHA-256: <code>{study.planSha256}</code>
            </p>
            <p>
              Archived executed source index: <code>{study.sourceSha256}</code>
            </p>
            <p>
              These identify the preserved study; the public application can evolve independently.
            </p>
            <a href="/research/manifest.json">Public file checksums</a>
          </details>
          <p className="results-reference">
            Theory reference: Eric Rasmusen, <cite>Games and Information</cite>, supplied
            fourth-edition draft, sections 1.2, 4.1, 5.1–5.2, 6.4–6.5. The textbook is cited in the
            write-up and is not redistributed.
          </p>
        </section>
        <p className="results-note">
          This page displays saved findings. Viewing or filtering it sends no inference requests.
        </p>
      </main>
    </div>
  );
}
