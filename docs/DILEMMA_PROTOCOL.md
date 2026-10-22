# Dilemma protocol and execution contract

Implemented contract, consolidated 19 October 2026. This preserves the operative rules and reliability requirements from the earlier implementation plan. See [decision analysis](AUTONOMOUS_DILEMMA_ANALYSIS.md) for interpretation, [verification](DILEMMA_VERIFICATION.md) for evidence, and the [cooperation study](../public/research/protocol.md) for the separate completed study conditions.

## Rules, objective and horizon

Canonical actions are C and D. Each player is instructed to maximise expected own cumulative game points until game-rule termination. Score difference, winning an encounter and API expenditure are different quantities.

| Own action | Opponent action | Own points | Opponent points |
| ---------- | --------------- | ---------: | --------------: |
| C          | C               |          3 |               3 |
| C          | D               |          0 |               5 |
| D          | C               |          5 |               0 |
| D          | D               |          1 |               1 |

[The shared specification](../src/dilemma/spec.ts) supplies these payoffs, the live continuation probability of 9/10, expected length and continuation-value bounds to the engine, prompts, analysis and teaching views. Rule, protocol and analysis versions are recorded separately.

In the geometric condition, a first round always occurs. After each resolved round an independent draw continues play with probability .9, irrespective of actions. Expected length is ten rounds; no final round is announced. Random continuation already supplies discounting in expectation, so realised payoffs are not discounted again. Fixed H=1 and H=10 conditions instead disclose the number of rounds remaining.

Budget, context, provider, shutdown and user stops are operational interruptions. They are not completed geometric samples or announced final rounds. Teaching sliders change hypothetical examples, not these live rules.

## Information and response

Each request receives the numeric rules, assigned objective, announced horizon, own/opponent totals and the complete resolved history from its own perspective. The opponent policy is unspecified in autonomous play. Observations exclude current private choices, future stopping draws/seeds, analyst output, opponent raw responses, API costs and previous-session memory. The analyst never supplies feedback to either player.

Prompts use neutral X/Y tokens, with a recorded mapping to C/D visible to the viewer. They do not instruct a strategy or name the dilemma. This controls one framing factor without establishing that pretraining familiarity has been eliminated. A local environment seed reproduces stopping draws, not hosted model generation; temperature zero does not guarantee deterministic inference.

The current model protocol uses temperature zero, reasoning requested off, no tools or examples, no correction attempts, and the provider adapter's 90-second timeout. Action-only allows 128 output tokens; action-plus-forecasts allows 256. Reasoning exposure or reported reasoning tokens interrupt play. These are watch-session settings, not the broader research settings proposed in the study.

Action-only accepts exactly `ACTION: X` or `ACTION: Y`, after trimming surrounding whitespace. Forecast mode requires exactly four lines:

```text
ACTION: X
P_OPP_X: 0.8
FUTURE_X: 20
FUTURE_Y: 16
```

The numbers above illustrate formatting, not recommended forecasts. The probability must be in [0,1]; future totals must be finite, nonnegative and within the rule-derived bound. At .9 continuation that bound is 50; fixed horizons use five times the remaining rounds. Future values are conditional on continuation and include future responses to the current action. Mapping inversion applies to both probability and continuation values. These reports are experimental instrumentation, not verified beliefs or chain-of-thought. Changing the response task defines a separate condition.

## Simultaneous round and persistence

1. Freeze the resolved history and its hash; build both observations from that snapshot.
2. Persist the pending round and reserve estimated costs for both missing decisions before starting either request. If the pair does not fit the session and shared ledger, neither starts.
3. Collect and validate privately. A response that arrives first remains sealed and earns no points on its own. Request ordering must not change the other observation.
4. Settle every attempt, including a failed partner's costs. Retain an accepted decision and its original observation for recovery.
5. Once both decisions validate, atomically resolve the unique round, award both payoffs, record its stopping result and advance the public version.
6. Publish the committed joint outcome. Public snapshots, events, audits and exports must not disclose an unresolved response or stopping seed.

The stopping stream uses a private seed and a domain-separated HMAC keyed by round index. Request order, latency and retries do not change the draw. The seed becomes available only after natural completion. Attempts retain prompts, hashes, exact model/settings, frozen prices, raw responses, validation, usage and costs. Missing usage retains a conservative reservation rather than becoming zero. Costs are local estimates, not provider-enforced billing ceilings.

Pause finishes the in-flight whole round; step resolves one whole round. Stop cancels requests and awards no partial payoff. Invalid output is a strict protocol failure without repair or an invented opponent win. Transport errors are operational interruptions.

Restart interrupts active work and never resumes billable requests automatically. On explicit resume, reuse accepted sealed responses, request only missing decisions from the original observation, and resolve persisted pairs once. A committed round retains its recorded stopping result. Context guards interrupt rather than silently dropping or summarising history.

The [Dilemma coordinator](../src/server/dilemma-runner.ts) and [store](../src/server/store.ts) implement this separate joint-round domain alongside the existing sequential board runner. The shared provider, model catalog and global ledger remain common infrastructure. Inspection, replay and export do not start inference. Offline exports escape generated text and contain no API key.

## Requirements for proposed comparisons

The research scheduler, exact scripted-policy evaluator and model-versus-script research mode remain future work. Their specification must preserve the boundaries above, freeze settings and versions, share stopping streams within paired blocks while keeping blocks independent, and retain every scheduled attempt and interruption. Paired candidates must not share decision state. A paired schedule must not disclose a seed while any related episode can still use its future draws.

Known-policy optimal values, normalised returns, decision losses, missingness and statistical sampling are specified in the [cooperation study](../public/research/protocol.md). They are not inferred from one autonomous replay. Hidden opponent types require a disclosed prior and belief-based reference rather than a clairvoyant benchmark.
