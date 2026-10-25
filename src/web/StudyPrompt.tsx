/** Public description of the frozen evaluation inputs, shared by Results and saved recordings. */
export function StudyPrompt() {
  return (
    <aside className="study-prompt" aria-label="Evaluation instructions">
      <h3>What the models were told</h3>
      <p>
        <strong>Every decision included the full numerical payoff table.</strong> Models also
        received both cumulative scores, the complete revealed history of actions and payoffs, and
        the stopping rule. They were told to maximise their own expected cumulative points. The
        benchmark disclosed the opponent’s complete rule; autonomous pairings did not.
      </p>
      <details className="results-details">
        <summary>Prompt wording and information</summary>
        <p>The system instruction stated:</p>
        <blockquote>
          <p>
            Maximise your own expected cumulative points until game-rule termination; the objective
            is not score difference.
          </p>
        </blockquote>
        <p>
          The models chose neutral X/Y actions. Both assignments of those labels to the numerical
          payoff table were tested; cooperation and defection are the reader-facing labels here.
          Each user message supplied the current round, all four payoff combinations, both scores,
          completed actions and payoffs, and the two legal actions.
        </p>
        <p>
          In the benchmark, the full committed opponent rule was stated in X/Y terms. In autonomous
          pairings, the instruction said: “The opponent policy is unspecified.” Models received
          either the announced total, current and remaining rounds, or the continuation probability
          with no announced final round. The realised stopping draw and the opponent’s current
          choice were hidden when deciding.
        </p>
        <p>
          Direct requested only a single-field JSON action, such as <code>{'{"action":"X"}'}</code>.
          For Draft, the action-format instruction was replaced with:
        </p>
        <blockquote>
          <p>
            Develop a private draft for the requested decision. A separate request will produce the
            final action. Do not change the game objective or information.
          </p>
        </blockquote>
        <p>
          The separate action request then received the original observation and that decision’s
          draft. Earlier drafts were not carried forward. The evaluation provided no tools,
          communication or analyst feedback, and elicited no forecasts. The exact best-response
          references shown in analysis were calculated separately and were not supplied as advice to
          the players.
        </p>
        <p>
          Exact source:{' '}
          <a href="https://github.com/sheinkmana/dilemma-dynamics/blob/main/python/gamefield_research/design_v1.py#L189">
            game observation and instructions
          </a>
          {' · '}
          <a href="https://github.com/sheinkmana/dilemma-dynamics/blob/main/python/gamefield_research/gateway.py#L161">
            Direct/Draft request construction
          </a>
          .
        </p>
      </details>
    </aside>
  );
}
