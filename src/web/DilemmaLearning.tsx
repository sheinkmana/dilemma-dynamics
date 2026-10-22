import { useId, useState } from 'react';
import { ACTIONS, CONTINUATION_PROBABILITY, payoff } from '../dilemma/spec.js';
import { continuationExample, type ResponseAssumption } from '../dilemma/education.js';
import type { Action, Seat } from '../dilemma/types.js';

const actionWord = (action: Action) => (action === 'C' ? 'cooperates' : 'defects');

export function PayoffTable({ current, perspective }: { current?: string; perspective?: Seat }) {
  return (
    <table aria-label="Game points: A first, B second">
      <thead>
        <tr>
          <th scope="col">A / B</th>
          {ACTIONS.map((b) => (
            <th scope="col" key={b}>
              B {actionWord(b)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ACTIONS.map((a) => (
          <tr key={a}>
            <th scope="row">A {actionWord(a)}</th>
            {ACTIONS.map((b) => (
              <td key={b} className={current === a + b ? 'pd-current-cell' : ''}>
                {payoff(a, b).map((n, seat) => (
                  <span key={seat}>
                    {seat > 0 && ' · '}
                    {perspective === seat ? <strong className="pd-own-payoff">{n}</strong> : n}
                  </span>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OneDecision() {
  const [seat, setSeat] = useState<Seat>(0);
  const [answer, setAnswer] = useState<Action | null>(null);
  const own = seat === 0 ? 'A' : 'B';
  const other = seat === 0 ? 'B' : 'A';
  const bothC = payoff('C', 'C')[seat];
  const bothD = payoff('D', 'D')[seat];
  return (
    <div className="pd-lesson" role="region" aria-label="One decision lesson">
      <h3>Individually tempting, jointly costly</h3>
      <p>
        Imagine two organisations choosing whether to contribute to a shared project. Each values
        its own points. Both choose privately, at the same time.
      </p>
      <div className="pd-lesson-controls" role="group" aria-label="Payoff perspective">
        <span>Follow the incentives of</span>
        {([0, 1] as const).map((s) => (
          <button type="button" key={s} aria-pressed={seat === s} onClick={() => setSeat(s)}>
            Player {s === 0 ? 'A' : 'B'}
          </button>
        ))}
      </div>
      <div className="pd-payoffs pd-lesson-payoffs">
        <PayoffTable perspective={seat} />
        <small>A points · B points. Bold values belong to player {own}.</small>
      </div>
      <div
        className="pd-incentive-comparisons"
        aria-label={`Player ${own}'s unilateral incentives`}
      >
        {ACTIONS.map((opponent) => {
          const c = payoff('C', opponent)[0];
          const d = payoff('D', opponent)[0];
          return (
            <div key={opponent}>
              <span>
                If {other} {actionWord(opponent)}
              </span>
              <strong>
                C: {c} <span aria-label="switch to">→</span> D: {d}
              </strong>
              <span>
                +{d - c} for {own} by switching alone
              </span>
            </div>
          );
        })}
      </div>
      <p>
        <strong>D strictly dominates C in one round:</strong> it pays more whichever action the
        other player chooses. At D/D, neither can improve by changing alone: this is the one-shot{' '}
        <strong>Nash equilibrium</strong>.
      </p>
      <p>
        Both would prefer C/C ({bothC} each) to D/D ({bothD} each). C/C{' '}
        <strong>Pareto dominates</strong> D/D, yet each has an incentive to leave C/C. That tension
        is the dilemma.
      </p>
      <fieldset className="pd-check">
        <legend>
          Predict: if the other player cooperates, which action earns you more in this round?
        </legend>
        <div className="pd-lesson-controls">
          {ACTIONS.map((a) => (
            <button type="button" key={a} aria-pressed={answer === a} onClick={() => setAnswer(a)}>
              {a === 'C' ? 'Cooperate' : 'Defect'}
            </button>
          ))}
        </div>
        {answer && (
          <p role="status">
            {answer === 'D' ? 'Yes.' : 'Compare the two payoffs.'} D earns {payoff('D', 'C')[0]}; C
            earns {payoff('C', 'C')[0]}. Expecting cooperation does not remove the immediate
            temptation.
          </p>
        )}
      </fieldset>
    </div>
  );
}

function FutureIncentives() {
  const id = useId();
  const [percent, setPercent] = useState(CONTINUATION_PROBABILITY * 100);
  const [response, setResponse] = useState<ResponseAssumption>('grim');
  const result = continuationExample(percent / 100, response);
  const max = Math.max(result.cooperate.total, result.defect.total);
  const same = Math.abs(result.difference) < 1e-9;
  const futureState =
    response === 'grim'
      ? ['C/C every later round', 'D/D every later round']
      : ['D/C every later round', 'D/C every later round'];
  return (
    <div className="pd-lesson" role="region" aria-label="Future incentives lesson">
      <h3>A temptation today can change tomorrow</h3>
      <p>
        Compare two choices when the opponent cooperates now. Their simultaneous current choice
        stays fixed; only later responses can depend on your action.
      </p>
      <div className="pd-lesson-controls" role="group" aria-label="Assumed opponent response">
        <button
          type="button"
          aria-pressed={response === 'grim'}
          onClick={() => setResponse('grim')}
        >
          Permanent punishment
        </button>
        <button
          type="button"
          aria-pressed={response === 'unresponsive'}
          onClick={() => setResponse('unresponsive')}
        >
          No response
        </button>
      </div>
      <p className="pd-assumption">
        <strong>Assumed plans.</strong>{' '}
        {response === 'grim'
          ? 'Both keep cooperating until either defects; after any defection, both defect forever. This is a grim-trigger strategy profile.'
          : 'The opponent always cooperates, regardless of your choice. You take the best response, D, in every later round in both branches.'}
      </p>
      <label className="pd-probability" htmlFor={id}>
        Chance of another round <output htmlFor={id}>{percent}%</output>
        <input
          id={id}
          type="range"
          min="0"
          max="95"
          step="5"
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        {percent === 0
          ? 'One decision: no future points.'
          : `Expected length: ${result.expectedRounds.toFixed(1)} rounds, with no announced last round.`}{' '}
        These controls explore an example; live-session rules stay as displayed above play.
      </p>
      <div className="pd-value-legend">
        <span>
          <i className="pd-value-now" />
          Points now
        </span>
        <span>
          <i className="pd-value-future" />
          Expected future points
        </span>
      </div>
      {(
        [
          ['Cooperate now', result.cooperate],
          ['Defect now', result.defect],
        ] as const
      ).map(([label, value], index) => (
        <div className="pd-value-row" key={label}>
          <div className="pd-value-label">
            <strong>{label}</strong>
            <span>{value.total.toFixed(2)} expected points</span>
          </div>
          <div
            className="pd-value-track"
            role="img"
            aria-label={`${label}: ${value.now} points now plus ${value.future.toFixed(2)} expected future points`}
          >
            <span className="pd-value-now" style={{ width: `${(100 * value.now) / max}%` }} />
            <span className="pd-value-future" style={{ width: `${(100 * value.future) / max}%` }} />
          </div>
          <small>
            {value.now} now + {value.future.toFixed(2)} expected later · {futureState[index]} if
            play continues
          </small>
        </div>
      ))}
      <p className="pd-example-result" role="status">
        {same
          ? 'The two choices tie.'
          : `${result.difference > 0 ? 'C' : 'D'} has ${Math.abs(result.difference).toFixed(2)} more expected points under these plans.`}
      </p>
      <p>
        {response === 'grim'
          ? `With this payoff matrix, cooperation can be sustained by these plans at continuation probabilities of at least ${result.threshold! * 100}%. After punishment begins, D is a best response to D, so the threat is credible. Always defecting is also an equilibrium; repetition does not select a unique outcome.`
          : `Because your action cannot change the opponent’s future behaviour here, C buys no future advantage. D gains ${payoff('D', 'C')[0] - payoff('C', 'C')[0]} points now, regardless of how long the relationship is expected to last.`}
      </p>
      <details className="pd-lesson-detail">
        <summary>Why ten announced rounds are different</summary>
        <ol className="pd-backward-steps">
          <li>
            <strong>Round 10:</strong> there is no future reward or punishment. D is best for both.
          </li>
          <li>
            <strong>Round 9:</strong> if both know round 10 will be D/D regardless, a choice now
            cannot buy cooperation in round 10.
          </li>
          <li>
            <strong>Back to round 1:</strong> the same reasoning repeats. Under the standard
            complete-information, common-knowledge rationality assumptions, the subgame-perfect
            outcome is D/D in every round.
          </li>
        </ol>
        <p>
          An autonomous model’s policy is unspecified. An early C is not automatically a decision
          error: expectations about a non-equilibrium or committed opponent can change its best
          response. A random ending also differs from ten announced rounds, even when its expected
          length is ten.
        </p>
      </details>
      <details className="pd-lesson-detail">
        <summary>Check the calculation and assumptions</summary>
        <p>
          Let δ be the continuation probability. With permanent punishment: Q(C) = R / (1 − δ); Q(D)
          = T + δP / (1 − δ). Here R = {payoff('C', 'C')[0]}, T = {payoff('D', 'C')[0]}, P ={' '}
          {payoff('D', 'D')[0]}. C is at least as good when δ ≥ (T − R) / (T − P).
        </p>
        <p>
          With no response, both branches use D/C from the next round onward, so they share the same
          future value. Expected points already account for the stopping probability. These are
          exact calculations for the stated plans, rather than estimates of the live models.
        </p>
      </details>
    </div>
  );
}

function ActionsAndStrategies() {
  const [answer, setAnswer] = useState<'identified' | 'unknown' | null>(null);
  return (
    <div className="pd-lesson" role="region" aria-label="Actions and strategies lesson">
      <h3>The same actions can come from different plans</h3>
      <div
        className="pd-cooperative-trace"
        aria-label="Illustrative history, three rounds of mutual cooperation"
      >
        {[1, 2, 3].map((n) => (
          <span key={n}>
            <small>Round {n}</small>
            <strong>C / C</strong>
          </span>
        ))}
      </div>
      <p>
        This is an illustrative history. Each of these plans produces the same cooperative path when
        paired with itself:
      </p>
      <div className="pd-strategy-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">On this path</th>
              <th scope="col">After a defection</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Always cooperate</th>
              <td>C</td>
              <td>Still C</td>
            </tr>
            <tr>
              <th scope="row">Tit-for-tat</th>
              <td>C</td>
              <td>Copies the opponent’s previous action; can return to C</td>
            </tr>
            <tr>
              <th scope="row">Grim trigger</th>
              <td>C</td>
              <td>D forever after either player defects</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        An <strong>action</strong> is a choice now. A <strong>strategy</strong> is a plan for every
        possible history, including ones that never happen. An <strong>equilibrium</strong> requires
        the players’ plans to be best responses to each other. Subgame perfection also checks the
        credibility of responses after departures from the observed path.
      </p>
      <fieldset className="pd-check">
        <legend>Can three cooperative rounds identify which plan a player is following?</legend>
        <div className="pd-lesson-controls">
          <button
            type="button"
            aria-pressed={answer === 'identified'}
            onClick={() => setAnswer('identified')}
          >
            Yes
          </button>
          <button
            type="button"
            aria-pressed={answer === 'unknown'}
            onClick={() => setAnswer('unknown')}
          >
            No
          </button>
        </div>
        {answer && (
          <p role="status">
            {answer === 'unknown' ? 'Correct.' : 'These examples are a counterexample.'} All three
            plans fit these actions. Their responses to other histories differ. A replay can
            describe behaviour without identifying a complete strategy or proving equilibrium.
          </p>
        )}
      </fieldset>
      <details className="pd-lesson-detail">
        <summary>Use this lens while watching the models</summary>
        <p>
          Ask what each player knew, what changing its current action could earn, and what future
          response would make the trade-off worthwhile. The replay inspector separates those
          decision conditions from later observations. Reported forecasts measure stated
          expectations; they do not reveal an entire strategy.
        </p>
      </details>
      <p className="pd-source">
        Further reading: Eric Rasmusen,{' '}
        <a href="https://www.rasmusen.org/GI/" target="_blank" rel="noreferrer">
          Games and Information
        </a>
        , §§1.1–1.4, 4.1, 5.1–5.2 and 6.4.
      </p>
    </div>
  );
}

export function DilemmaLearning({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState(0);
  const id = useId();
  const lessons = ['One decision', 'The future', 'What play reveals'];
  return (
    <details
      className="pd-learning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>Explore the dilemma</strong>
          <small>Follow the incentives, then interpret the interaction.</small>
        </span>
      </summary>
      <div className="pd-learning-body">
        <div className="pd-learning-steps" role="group" aria-label="Dilemma lessons">
          {lessons.map((label, index) => (
            <button
              type="button"
              key={label}
              aria-pressed={step === index}
              aria-controls={id}
              onClick={() => setStep(index)}
            >
              <small>{index + 1}</small>
              {label}
            </button>
          ))}
        </div>
        <div id={id}>
          {step === 0 ? (
            <OneDecision />
          ) : step === 1 ? (
            <FutureIncentives />
          ) : (
            <ActionsAndStrategies />
          )}
        </div>
      </div>
    </details>
  );
}
