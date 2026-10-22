# Autonomous Dilemma: decision-theoretic analysis

Methodological reference, updated 19 October 2026. The main experience is **two autonomous models, analysed during and after play**. The core action-only and forecast protocols, live and retrospective analysis, joint-round engine, persistence, and exports are implemented. Scripted opponents are explicitly labelled local demonstrations. A separate completed scientific study provides repeated comparisons and exact-policy benchmarks. Learned observer models and counterfactual branch experiments remain future work. See the [protocol contract](DILEMMA_PROTOCOL.md) for execution rules, [implementation verification](DILEMMA_VERIFICATION.md) for tested scope and live results, and the [cooperation study](../public/research/protocol.md) for the separate completed study design.

## 1. What the product evaluates

Each model chooses its own action from the rules and completed interaction history. No fixed policy, recommended move, evaluator output, or analyst feedback is supplied to either player. The analysis runs beside the game, with a separate data path.

The assigned utility is own cumulative game points. The analysis asks whether actions are defensible under that objective, the information available at the time, and stated assumptions about future responses. It does not equate rationality with being cooperative, winning a particular encounter, or conforming to a named strategy.

Use three clearly labelled forms of evidence:

- **Verified:** payoff arithmetic, observations actually available, stopping rules, and mathematical implications of those rules.
- **Reported:** a player's optional forecasts recorded with its action before joint reveal. These are public experimental reports, not verified internal beliefs.
- **Estimated:** predictions or counterfactuals from an explicit analyst model or repeated branch experiment. They are not the true opponent policy.

Keep decision quality, forecast accuracy, and realised success separate. A good decision can have an unlucky outcome; an internally consistent choice can still rest on poor forecasts.

## 2. Useful analysis without asking players for explanations

The default autonomous protocol can remain action-only. The passive analyst receives committed histories and rule metadata, never controls the players, and makes no additional model requests.

For each player and round, it can report:

- observed action, payoff, and cumulative earnings;
- immediate payoff differences under either opponent action;
- the future-payoff advantage needed to justify cooperation;
- history-based patterns, with the relevant observation counts;
- whether a known final round makes the immediate dominance result decisive;
- collective payoff loss relative to a specified joint outcome, clearly a payoff comparison rather than a causal claim about what a unilateral deviation would achieve.

It cannot infer a unique subjective belief or future-value estimate from one binary action. It can state the conditions under which the choice would maximise expected own points.

### The central live calculation

For the 3/0/5/1 payoff matrix, let `p` be a player's probability that the opponent cooperates this round. Let `F_C` and `F_D` be expected own points from the next round onward, conditional on continuation, under choosing C or D now and the player's contemplated future behaviour. They must include the resulting changes in the opponent's future behaviour. With continuation probability `delta`:

```text
Q(C) = 3p       + delta F_C
Q(D) = 1 + 4p   + delta F_D

C is at least as good as D iff:
delta (F_C - F_D) >= 1 + p
```

The current opponent action is simultaneous: switching one's own current action cannot cause that already private current choice to change. Future responses can change. This is why continuation values depend on one's action, while the current-round probability is shared across the comparison.

At delta=.9, cooperation needs a continuation advantage of `(1+p)/.9` expected points. Without an elicited forecast, display the required threshold as a range: approximately 1.11 to 2.22 future points as p varies from zero to one. Do not invent an agent-specific p from the last observed move.

In a genuinely final round, the continuation term is zero, so D strictly dominates C under the assigned utility. In a geometric game, do not retrospectively declare a move final because the stopping draw happened to end play afterward: that outcome was unknown when choosing.

This threshold panel provides substantive rational-decision analysis even when the opponent is entirely autonomous and its policy unknown.

## 3. Optional instrumented autonomous protocol

Offer **Action only** and **Action + forecasts** as separate, immutable protocols. Action-only remains useful; choose the forecast protocol when the research question specifically concerns reported expectations and choice consistency. Neither protocol assigns a strategy.

For the forecast protocol, obtain one compact decision packet in the same response, before the opponent's choice is released. For example, when X maps to C:

```json
{
  "action": "X",
  "pOpponentX": 0.8,
  "futureIfX": 20,
  "futureIfY": 16
}
```

`futureIfX/Y` means expected own future total, conditional on another round occurring, given that current action and the player's contemplated continuation. It is not this round's payoff, a probability, or an assumption that the opponent will follow a fixed script. Normalise neutral-label mappings on the server, including inversion of p when X maps to D.

The server calculates expected current-plus-future values from these submitted forecasts. In the example, `Q(C)=20.4` and `Q(D)=18.6`. Choosing C is consistent with the submitted estimates; choosing D would forgo 1.8 expected points according to those same estimates.

Label the metric **Choice consistency with reported forecasts**. A model can generate mutually convenient forecasts and actions, so this alone is weak evidence of competent decision-making. It does not reveal private chain-of-thought or establish what computation caused the action.

After reveal, score the recorded current-action forecast against the actual opponent action using the Brier score `(p-y)^2`, with y=1 for C and y=0 for D. Aggregate only across multiple recorded predictions and show counts. A single failed forecast is not evidence of irrationality. Long-term F estimates do not have an observed counterfactual ground truth in one game, so do not score them as if they did.

Use a validated structured-response capability or an explicitly versioned strict text equivalent. Set a bounded output allowance sufficient for this packet, initially 256 tokens, and keep the action-only 128-token setting distinct. Validate p in [0,1] and finite continuation values within bounds derived from the payoff and horizon. For delta=.9 and payoffs in [0,5], continuation totals lie in [0,50]. Fixed-horizon bounds use the actual number of remaining rounds.

Changing the response task can change play. Record the protocol in every result and compare protocols separately. Asking for numeric forecasts is experimental instrumentation, not a transparent window into an unmodified agent.

## 4. Observer models and counterfactual evidence

### Hypothesis-based analysis

The analyst may compare hypotheses about how the opponent will react: continuing unchanged, retaliating, forgiving, or conditioning on recent joint actions. These are hypotheses used to interpret play, not policies imposed on the opponent.

A later numerical predictor can use a predeclared memory-one response model with regularised estimates for each previous joint-action state. At round t, fit only to history through t-1 and freeze the estimate before examining the new choices. Store its prior, version, observation cutoff, and uncertainty. Unvisited response states must remain uncertain; they are not established by similar-looking observed states.

Planning against this fitted response model gives a **conditional reference under the analyst's assumptions**, not an exact best response to the autonomous model. Results must expose the response and continuation assumptions. Do not label the gap “true regret.” Do not confuse an observer's forecast with a player's reported forecast.

For the first version, the exact incentive threshold plus optional pre-reveal player forecasts is sufficient. A learned response model is an extension, not a prerequisite for useful analysis or a reason to delay autonomous play.

### Optional post-game branch experiments

For selected consequential rounds, create separate experimental branches from the same pre-round history. Compare C and D interventions for one player while keeping the other player's already simultaneous current action fixed. From the next round, both models choose autonomously in each branch.

Repeat both branches, sharing stopping streams where appropriate, because remote inference and future interactions may vary. These experiments require a separate explicit cost budget. They never rewrite the main game, supply feedback to its players, or claim an exact individual counterfactual from one rollout.

Report the estimated difference in continuation earnings, sample count, interval, and intervention. A bounded K-round branch estimates K-round consequences, not an unlimited geometric value. Select rounds by a declared rule rather than only choosing examples that support a preferred narrative.

Do not replay a different own action against an unchanged recorded sequence of all future opponent actions and call it a strategic best response. An adaptive opponent would have seen a different history. Standard retrospective payoff comparisons that freeze opponent actions must be labelled as such, not presented as the payoff a new strategy would actually have earned.

## 5. Representation during and after the game

Main navigation: **Dilemma | Analysis | Recreational**. Select two actual models as the normal setup; no model request starts until Start. If no provider is available, show that state and offer an explicitly named local demo. Never silently substitute a scripted player for a model.

During play, preserve the simultaneous round table, visible payoff matrix, history, spend, and replay controls described in the [protocol contract](DILEMMA_PROTOCOL.md). Organise analysis into three compact sections:

1. **What happened:** the resolved joint action and immediate consequences.
2. **Decision conditions:** the verified incentive threshold; reported expected values and consistency if the forecast protocol was used.
3. **What remains uncertain:** future-response assumptions and evidence counts. Missing reports are “Not elicited,” not zero or a failed score.

Do not stream forecasts or analysis while a round is pending. The current packet remains sealed with its action. Show the joint reveal first; analysis attaches to the resolved round. An analyst displayed during play must use the information available before that decision when evaluating its ex-ante justification. Later information belongs in a separately marked retrospective section.

The after-game view gives each model a decision profile: actual return, reported-choice consistency where available, forecast performance, and response patterns. It also gives an interaction timeline identifying recoveries, persistent mutual defection, unilateral exploitation, and changes in behaviour, with links to the relevant rounds. Describe those patterns without attributing emotions or intentions.

Use model-generated prose only as an optional explanation of verified analytical records. An LLM commentator is not the numerical authority. Cite rounds, state assumptions, and distinguish facts from hypotheses. The first release can render deterministic explanatory templates; no extra critic-model call is required.

Example action-only commentary: “A cooperated. That sacrifices an immediate expected gain from defection of between 1 and 2 points. With 90% continuation, cooperation requires at least 1.11–2.22 additional expected future points. The player did not submit a forecast, so its own expectation is unknown.”

Example instrumented commentary: “A's submitted forecasts favour C by 1.8 expected points, and A chose C. This choice is consistent with its reported estimates. The current-round forecast can now be checked; the future-value estimates remain assumptions.”

Repeated model comparisons should sample a declared opponent pool, reset histories, counterbalance seats/labels, and reuse environment schedules. Report expected own return per pairing and aggregate only with declared opponent weights. Keep action-only and instrumented results separate. No exact equilibrium or general rationality score is inferred from a single model-versus-model match.

## 6. Implementation requirements and acceptance

Retain the simultaneous coordinator, sealed storage, shared cost ledger and recovery requirements in the [protocol contract](DILEMMA_PROTOCOL.md). Core analysis and future extensions must preserve these requirements; the [verification record](DILEMMA_VERIFICATION.md) identifies delivered scope:

- versioned `src/dilemma/analysis.ts` for incentive arithmetic, report consistency, and forecast scoring;
- distinct action-only/forecast prompt schemas and parsers;
- per-player, pre-reveal decision reports linked to observation and attempt hashes;
- analysis records separate from game state, including provenance (`verified`, `reported`, `estimated`), protocol/analysis versions, history cutoff, assumptions, and output units;
- read-only per-round and session analysis endpoints and a replay inspector;
- optional branch experiments as separate records with parent round, intervention, budget, and their own attempts;
- analysis/export tests that prevent future information leaking into ex-ante evaluations or back into player observations.

Minimum acceptance examples:

- The threshold derives correctly for p=0, p=1, delta=.9, and a fixed final round.
- The numeric example above yields 20.4 versus 18.6, with 1.8 report-relative loss for choosing D.
- A cooperative action in a geometric game's realised last round is not retrospectively treated as a known-final-round mistake.
- Brier scores use the recorded pre-reveal forecast, not a later explanation; neutral-label inversion is correct.
- A model can be consistent with an inaccurate forecast; display both facts separately.
- Action-only sessions still receive useful incentive analysis with reports marked Not elicited.
- Instrumentation, analyst hypotheses, exact scripted references, and branch estimates cannot be mistaken for each other in records or UI.
- Every player request excludes all analyst records, forecasts from the opponent, and current sealed choices.

The implemented core is autonomous model-versus-model play, passive incentive analysis, optional instrumented decisions and an after-game audit, backed by ledger/replay guarantees. The proposed exact scripted-policy benchmark is specified in the cooperation study. Learned opponent models, extra LLM commentary and paid counterfactual branches are separate extensions.

## References

The theoretical framing is informed by Peter Hammond's [Consequentialism, Structural Rationality, and Game Theory](https://web.stanford.edu/~hammond/structRat.pdf): expected-utility assessment depends on preferences and probabilistic expectations. The caution about holding an adaptive opponent's future actions fixed is supported by Arora, Dekel, and Tewari's [Online Bandit Learning against an Adaptive Adversary: from Regret to Policy Regret](https://arxiv.org/abs/1206.6400). Neither source prescribes this app's instrumentation or interface. The payoff thresholds and numerical examples are direct calculations from the specified game.
