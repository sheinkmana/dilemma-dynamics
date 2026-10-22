# Recreational release verification

Verified 18 October 2026 (Europe/London); consolidated 19 October. This retains the board-game release evidence from the former `VERIFICATION.md`, with superseded interface screenshots and the step-by-step design history removed. Later Dilemma and teaching checks are recorded in the [documentation index](README.md).

## Automated checks

At this release, `npm test` reported **28 passing tests**. Coverage included rule invariants across 300 seeded games; exhaustive 1×2 solver cross-checks; chain/loop recurrence agreement with edge search; an unbeatable Tic-tac-toe solver; invalid, truncated, cancelled and rate-limited provider responses; reservations; pause/resume; duplicate starts; restart recovery; library ordering; capability probes; held-out and paired scheduling; local HTTP access controls; and safe HTML serialization.

Action-only tests covered a full 24-move mocked remote game without probing, unwanted rationale, cancellation on exposed reasoning, and reasoning-token telemetry without a trace. Pacing tests checked publishing before another request, pause during the gap and Stop cancellation. Shutdown tests covered local token/origin protection, a single callback, rejection of new mutations and active-request settlement.

`npm run build` passed TypeScript checks and production frontend/backend compilation. `npm audit` reported zero vulnerabilities at that time after dependency upgrades; this is a dated registry check, not a current advisory report or security certification.

## Interface, persistence and export

- A free 3×3 game completed; step stopped after one move; replay inspected a capture; fork preserved its position. Tic-tac-toe used the same coordinator, a six-game paired comparison completed, and the exact double-cross fixture selected the non-capturing `V:0:3`.
- Live/replay selection, pause/resume/stop, fixed quick-play settings, saved games and visible estimated costs were exercised. Earlier layouts fit at 320 pixels; the comparison view fit at 390 pixels.
- Light and dark appearances were inspected, theme choice survived reload, narrow layouts preserved full player names, and measured contrast met 4.5:1 for muted text and 3:1 for empty board edges against their surfaces. Representative screenshots: [light](cheerful-light.png), [dark](cheerful-dark.png).
- Shutdown stopped an active free game after 11 moves, exited with code 0, released port 4317 and database ownership, and preserved all committed moves. A real process restart preserved saved games; regression coverage checked library ordering and completed snapshots.
- CLI local play and the example paired tournament completed with no model spend. The exported [standalone replay](example-replay.html) opened without browser errors and scrubbed to its recorded 9:0 score. It is a local-baseline game, not a Nemotron run.

## Live action-only acceptance

Match `e869104a-3abd-4277-b73b-b55222eded95`, played 18 October 2026, completed all 24 edges of a 3×3 board with Super versus Nano. Settings were seed 44, rules-only context, reasoning off, no rationale, 128 output tokens per request and a $0.01 estimated cap.

All 24 attempts were accepted first time, each with nine completion tokens and one action line. Neither model exposed a trace. Super reported zero reasoning tokens; Nano left that telemetry unavailable. Final score was 9:0 and estimated total cost was **$0.00241614**. The [completed replay screenshot](action-only-live.png) records the endpoint check. This establishes protocol integration at that time, not comparative playing strength.

Structured formats and reasoning-on behaviour were not verified on the live endpoint and retained their probe gates. Reasoning off could be requested directly; exposed reasoning or reported reasoning tokens interrupted play. Missing telemetry cannot establish absence of internal computation.

The evaluator remains bounded to recognised endgames and completed small searches, as described in [evaluation methods](RECREATIONAL_METHODS.md). Costs are local estimates and the app is a personal local service. These dated checks do not imply a completed cooperation study or a public deployment.
