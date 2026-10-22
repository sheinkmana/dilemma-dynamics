# Autonomous Dilemma implementation verification

Verified locally on 18 October 2026. The main app now presents Dilemma and Analysis, with Dots & Boxes and Tic-tac-toe under Recreational.

This is the dated core-release record. The later [teaching and replay checks](DILEMMA_LEARNING.md#verification), performed on 19 October, report 51 passing tests; the paid endpoint checks below were not repeated for that update. See the [protocol contract](DILEMMA_PROTOCOL.md) for the consolidated execution rules.

## Delivered behaviour

- Two autonomous model requests receive the rules and completed history from their own perspectives. No fixed strategy or analysis feedback is supplied. Choices remain private until both validate and the whole round commits.
- Transparent 3/0/5/1 payoffs; own expected cumulative points as the objective; either independent 90% continuation or a disclosed fixed horizon. A realised geometric stopping round is never retrospectively classified as a known final round.
- Separate action-only and action-plus-forecasts protocols. Neutral action labels can be reversed. Forecasts are reported expectations recorded before joint reveal, not verified internal beliefs.
- Live and replay analysis separates verified immediate incentives, cooperation's required future advantage, report-relative choice consistency, forecast accuracy, observed behaviour, and realised points. There is no overall rationality ranking.
- Pause at a joint-round boundary, step, stop, explicit resume, persisted histories, public snapshot events, committed request audit, and standalone HTML/JSON/JSONL exports. Local demonstrations are labelled and cannot substitute silently for a model.
- Session and shared-ledger reservations cover both requests before either starts. Invalid output interrupts without repair or invented points. Transport recovery preserves a valid sealed response. Restart never resumes billable activity automatically.

## Automated and interface checks

`npm test`: **46 passed**, including the original board-game suite and 18 Dilemma tests. Coverage includes simultaneous observations and reveal, event-stream privacy, payoff/forecast arithmetic, label reversal, strict parsing, invalid output, cancellation, pause/idempotency, crash recovery, shared budget reservations, frozen request prices, shutdown, and escaped offline exports.

`npm run check` and `npm run build`: passed.

The actual browser was checked at desktop and 320-pixel widths, in light and dark themes. Dilemma and Recreational had no horizontal overflow. Live pause/resume, completed-round replay, analysis, and export controls were exercised. The main payoff rules are visible before starting a paid interaction.

## Live endpoint acceptance

Both checks used Nebius's discovered Nano and Super models, temperature 0, with reasoning requested off. Each session had a $0.01 estimated limit.

| Protocol           | Horizon          | Completed rounds | Accepted requests | Invalid requests | Estimated cost |
| ------------------ | ---------------- | ---------------: | ----------------: | ---------------: | -------------: |
| Action only        | One known round  |                1 |                 2 |                0 |    $0.00008598 |
| Action + forecasts | 90% continuation |               15 |                30 |                0 |    $0.00322446 |

The forecast session paused after round 3, resumed, and ended through the game's stopping draw. Combined estimated cost: **$0.00331044**. All requests supplied usage; no reservations remained. Neither model exposed reasoning; reported reasoning-token telemetry was zero or unavailable. This does not establish the absence of internal computation.

Session IDs, model IDs, costs, and acceptance metadata are retained in [the verification record](dilemma-live-verification.json). The full games can be opened from Past interactions in the app. These small acceptance checks establish working endpoint/protocol integration, not comparative model strength or general rationality.

Representative core-release screenshot: [Dilemma interaction](dilemma-live.jpg). The later teaching screenshots are linked from the teaching verification above.

## Boundaries

The app remains a personal local service. Costs are estimates from stored catalog prices and provider usage, not provider-enforced billing ceilings. Missing usage retains a conservative charge. Report-relative consistency depends on the model's submitted probabilities and continuation values; it does not establish their truth, calibration across many trials, or the model's actual reasoning process.

The release does not run repeated comparison studies, paid counterfactual branches, inferred opponent-policy models, or exact scripted-policy decision benchmarks. The [cooperation study](../public/research/protocol.md) describes the separate comparison and benchmark design; [its results](../public/research/paper/report.pdf) are now available. The free local policies currently demonstrate and verify the game mechanics.
