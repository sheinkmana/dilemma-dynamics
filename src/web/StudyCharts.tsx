import { diagnostics, summary } from './studyData.js';

const policies = [
  ['allc', 'Always cooperate'],
  ['alld', 'Always defect'],
  ['grim', 'Grim trigger'],
  ['tft', 'Tit-for-Tat'],
] as const;
const models = ['nano', 'super'] as const;
const temperatures = [0, 1] as const;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(4)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const modelName = (model: string) => (model === 'nano' ? 'Nano' : 'Super');

function Axis({
  min,
  max,
  ticks,
  percent: isPercent = false,
}: {
  min: number;
  max: number;
  ticks: number[];
  percent?: boolean;
}) {
  return (
    <div className="study-chart-axis" aria-hidden="true">
      {ticks.map((tick) => (
        <span key={tick} style={{ left: `${((tick - min) / (max - min)) * 100}%` }}>
          {isPercent ? `${Math.round(tick * 100)}%` : tick.toFixed(1)}
        </span>
      ))}
    </div>
  );
}

function DifferenceMark({
  estimate,
  min,
  max,
  interval,
}: {
  estimate: number;
  min: number;
  max: number;
  interval?: readonly number[];
}) {
  const position = (value: number) => ((value - min) / (max - min)) * 100;
  const zero = position(0);
  return (
    <div className="study-chart-track" aria-hidden="true">
      <span className="study-chart-zero" style={{ left: `${zero}%` }} />
      {interval ? (
        <>
          <span
            className="study-chart-interval"
            style={{
              left: `${position(interval[0]!)}%`,
              width: `${position(interval[1]!) - position(interval[0]!)}%`,
            }}
          />
          <span className="study-chart-point" style={{ left: `${position(estimate)}%` }} />
        </>
      ) : (
        <span
          className={`study-chart-bar ${estimate > 0 ? 'increase' : 'decrease'}`}
          style={{
            left: `${Math.min(zero, position(estimate))}%`,
            width: `${Math.abs(position(estimate) - zero)}%`,
          }}
        />
      )}
    </div>
  );
}

export function AverageDraftingChart() {
  const primary = summary.contrasts
    .filter((row) => row.family === 'primary')
    .toSorted(
      (a, b) =>
        String(a.model).localeCompare(String(b.model)) ||
        Number(a.temperature) - Number(b.temperature),
    );
  const min = Math.floor(Math.min(...primary.flatMap((row) => row.interval)) * 20) / 20;
  const max = 0.05;
  const ticks = [min, -0.2, -0.1, 0].filter(
    (tick, index, all) => tick >= min && tick <= max && all.indexOf(tick) === index,
  );
  return (
    <figure
      className="study-chart"
      aria-labelledby="average-chart-title"
      aria-describedby="average-chart-description"
    >
      <figcaption>
        <h3 id="average-chart-title">Average drafting effect</h3>
        <p id="average-chart-description">
          Draft − Direct in mean benchmark decision loss. All four estimates and their approximate
          98.75% intervals are below zero, favouring Draft.
        </p>
      </figcaption>
      <div className="study-forest">
        {primary.map((row) => (
          <div className="study-forest-row" key={`${row.model}-${row.temperature}`}>
            <div className="study-chart-row-label">
              <strong>{modelName(row.model!)}</strong>
              <span>Temperature {row.temperature}</span>
            </div>
            <DifferenceMark estimate={row.estimate} interval={row.interval} min={min} max={max} />
            <div className="study-chart-value">
              <strong>{signed(row.estimate)}</strong>
              <span>[{row.interval.map(signed).join(', ')}]</span>
            </div>
          </div>
        ))}
        <div className="study-forest-axis">
          <Axis min={min} max={max} ticks={ticks} />
        </div>
      </div>
      <p className="study-chart-unit">
        Change in horizon-normalised payoff forgone · negative favours Draft
      </p>
    </figure>
  );
}

export function OpponentEffectsChart() {
  const bound =
    Math.ceil(
      Math.max(
        ...diagnostics.policyEffects.flatMap((row) => [
          Math.abs(row.nanoEffect),
          Math.abs(row.superEffect),
        ]),
      ) * 10,
    ) / 10;
  return (
    <figure
      className="study-chart"
      aria-labelledby="opponent-chart-title"
      aria-describedby="opponent-chart-description"
    >
      <figcaption>
        <h3 id="opponent-chart-title">The opponent changes the effect</h3>
        <p id="opponent-chart-description">
          Exploratory Draft − Direct differences in mean benchmark decision loss. Draft increases
          loss against Tit-for-Tat for both models at both temperatures.
        </p>
      </figcaption>
      <div className="study-chart-panels">
        {models.map((model) => (
          <section
            className="study-chart-panel"
            key={model}
            aria-label={`${modelName(model)} opponent differences`}
          >
            <h4>{modelName(model)}</h4>
            {policies.map(([policy, label]) => (
              <div
                className={`study-opponent-group ${policy === 'tft' ? 'study-chart-reversal' : ''}`}
                key={policy}
              >
                <h5>
                  {label}
                  {policy === 'tft' && <span>Reversal</span>}
                </h5>
                {temperatures.map((temperature) => {
                  const row = diagnostics.policyEffects.find(
                    (item) => item.temperature === temperature && item.policy === policy,
                  )!;
                  const value = model === 'nano' ? row.nanoEffect : row.superEffect;
                  return (
                    <div className="study-effect-row" key={temperature}>
                      <span className="study-chart-temperature">T{temperature}</span>
                      <DifferenceMark estimate={value} min={-bound} max={bound} />
                      <strong className="study-chart-value">{signed(value)}</strong>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="study-effect-axis">
              <Axis min={-bound} max={bound} ticks={[-bound, 0, bound]} />
            </div>
          </section>
        ))}
      </div>
      <p className="study-chart-unit">
        Change in horizon-normalised payoff forgone · negative favours Draft, positive favours
        Direct · T = temperature
      </p>
    </figure>
  );
}

export function SelfPlayCooperationChart() {
  const rows = models.flatMap((model) =>
    temperatures.map((temperature) => ({
      model,
      temperature,
      direct: summary.cooperation.find(
        (row) =>
          row.temperature === temperature && row.cell === `B/${model}-direct/${model}-direct`,
      )!,
      draft: summary.cooperation.find(
        (row) => row.temperature === temperature && row.cell === `B/${model}-draft/${model}-draft`,
      )!,
    })),
  );
  const max =
    Math.ceil(
      Math.max(
        ...rows.flatMap((row) => [row.direct.episodeWeightedCC, row.draft.episodeWeightedCC]),
      ) * 10,
    ) / 10;
  return (
    <figure
      className="study-chart"
      aria-labelledby="cooperation-chart-title"
      aria-describedby="cooperation-chart-description"
    >
      <figcaption>
        <h3 id="cooperation-chart-title">Mutual cooperation in self-play</h3>
        <p id="cooperation-chart-description">
          Mean within-episode share of rounds in which both players cooperate. Each comparison
          changes both players from Direct to Draft; Draft has a lower share in all four cases.
        </p>
      </figcaption>
      <div className="study-chart-legend">
        <span>
          <i className="direct" />
          Direct / Direct
        </span>
        <span>
          <i className="draft" />
          Draft / Draft
        </span>
      </div>
      <div className="study-chart-panels">
        {models.map((model) => (
          <section
            className="study-chart-panel"
            key={model}
            aria-label={`${modelName(model)} self-play cooperation`}
          >
            <h4>{modelName(model)}</h4>
            {rows
              .filter((row) => row.model === model)
              .map((row) => (
                <div className="study-cooperation-group" key={row.temperature}>
                  <h5>Temperature {row.temperature}</h5>
                  {(['direct', 'draft'] as const).map((procedure) => (
                    <div className="study-cooperation-row" key={procedure}>
                      <span>{procedure === 'direct' ? 'Direct' : 'Draft'}</span>
                      <div className="study-chart-track cooperation" aria-hidden="true">
                        <span
                          className={`study-chart-bar ${procedure}`}
                          style={{
                            width: `${(row[procedure].episodeWeightedCC / max) * 100}%`,
                          }}
                        />
                      </div>
                      <strong className="study-chart-value">
                        {percent(row[procedure].episodeWeightedCC)}
                      </strong>
                    </div>
                  ))}
                </div>
              ))}
            <div className="study-cooperation-axis">
              <Axis min={0} max={max} ticks={[0, max / 3, (2 * max) / 3, max]} percent />
            </div>
          </section>
        ))}
      </div>
      <p className="study-chart-unit">
        Episode-weighted mutual cooperation · 48 episodes per pairing and temperature · each episode
        has equal weight
      </p>
    </figure>
  );
}
