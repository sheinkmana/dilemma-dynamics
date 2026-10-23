# Dilemma teaching guide

This guide concerns the main cooperation-and-incentives project. The separate
Dots & Boxes and Tic-tac-toe side project explores competitive tactics and
search with visible sequential moves. The dilemma uses private simultaneous
choices each round and permits both players to gain through cooperation.
See [the game-type comparison](GAME_TYPES.md) for the distinction and study scope.

The guide supports three learning outcomes: explain one-round dominance, identify when contingent future responses can support cooperation, and distinguish an observed action history from a complete strategy or an equilibrium. It opens on a new setup and can be expanded while inspecting a saved interaction. Autonomous model play remains the main interaction.

## Content and assumptions

- **One decision:** either player's perspective, both unilateral incentive comparisons, the one-shot D/D Nash equilibrium, and the Pareto comparison with C/C. A prediction question reinforces the immediate incentive.
- **The future:** a hypothetical cooperative state with a continuation probability from zero to 95%. Under grim trigger, both cooperate until either defects, then both defect forever. Compare C now followed by C/C with D now followed by D/D. Under no response, the opponent always cooperates; both branches use the optimal own D from the next round onward. The two branches therefore share their future value. The named assumptions describe the examples, not the live models.
- **What play reveals:** always cooperate, tit-for-tat, and grim trigger generate the same uninterrupted cooperative path. Their responses to other histories differ. Matching that path alone neither identifies the strategy nor establishes equilibrium. A second prediction question checks this distinction.

Let R = 3, T = 5, P = 1 and delta be the continuation probability. For the grim-trigger example, current-plus-future values are R/(1-delta) and T + delta\*P/(1-delta). Their comparison gives delta >= (T-R)/(T-P) = 0.5, including indifference at the boundary. At delta = 0.9 they are 30 and 14 expected points. Mutual defection is credible after a trigger because D is a best response to D, and always defecting remains another equilibrium. No unique cooperation prediction is claimed.

For an unresponsive cooperator, values are R + delta*T/(1-delta) and T + delta*T/(1-delta): the immediate gain T-R remains two points. This isolates the current action while giving both branches optimal future play against that disclosed opponent. Geometric continuation is already included in expected returns; realised points are not discounted a second time.

The fixed-horizon explanation derives the standard backward-induction outcome under complete information and common-knowledge rationality. It distinguishes that benchmark from best responses to an unspecified autonomous policy and from an uncertain ending. An early cooperative move is not automatically labelled a violation of that equilibrium benchmark.

The structure draws on Eric Rasmusen, _Games and Information_, sections 1.1-1.4 (rules, strategy, dominance, Nash), 4.1 (subgame perfection), 5.1-5.2 (finite and indefinite repetition), and 6.4 (incomplete information about types). [Author's companion materials](https://www.rasmusen.org/GI/).

## Relationship to the experiment

`src/dilemma/spec.ts` is the shared source for the numeric payoff table, the unchanged 9/10 live continuation rule, expected geometric length, immediate expectations, and continuation-value bounds. Resolution, observations, analysis, teaching views, and the HTML payoff table use that source. The example slider never edits session configuration or enters a player observation. Rule and protocol versions remain unchanged because numeric rules and prompt content are preserved.

Replay displays prior completed history and the announced horizon separately from after-reveal payoff alternatives and subsequent observations. A realised geometric stop is never promoted into knowledge of a final round. A later action is an observation, not proof of the consequences of an alternative earlier action. Before/after explanations are also included in offline HTML exports. Forecast consistency and forecast accuracy remain distinct metrics.

## Verification

The additional tests independently sum discounted payoff trajectories, check the threshold and its boundary, verify dominance from both seats and consistency with analyst expectations, and ensure ex-ante context is invariant to current/later choices. They also distinguish announced finality, realised geometric stopping, and missing later observations. Existing simulation, sealed-decision privacy, protocol, recovery, export, and recreational-game tests continue to apply.

Verified on 19 October 2026: all 51 tests passed, the TypeScript check and production build passed, and formatting/whitespace checks passed. Browser verification used a separate in-memory database, two free local demonstrations, and a provider that rejects remote requests. It exercised both player perspectives, prediction feedback, zero/50%/95% continuation, response assumptions, the fixed-horizon explanation, replay history cutoffs, and an offline HTML replay. The guide and replay fit at 320 pixels; light and dark appearances were inspected. No browser errors or provider calls occurred, and teaching controls issued no mutations.

Screenshots: [future-incentive guide](dilemma-learning-future.png), [replay inspector](dilemma-learning-replay.png). These show explicitly local demonstrations, not model research results.
