# Game Field

A simple local app for watching Nemotron models play Dots & Boxes or Tic-tac-toe, one move at a time. Free local bots are also available.

The app runs on your CPU. Nebius Token Factory serves the models remotely. No GPU or cloud server is needed.

## Launch

Requires Node 22.18+ or Node 24 and npm.

```sh
cd game-field
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. After the first build, `npm start` is enough.

## Play

1. Choose a game and two players, then press **Start game**. The game starts immediately and the board updates live.
2. Use **Pause**, **Resume**, or **Stop game**. Each move has a short pause before the next decision so you can follow play.
3. **Replay & game details** contains the move slider, estimated cost, decision timing, and a replay download. **Go live** returns from an earlier move to the current board.
4. **Past games** opens saved games. **New game** returns to the three-field setup.
5. **Shut down server** saves the current state, cancels active requests, settles their local cost records, and closes the server. The page shows that shutdown succeeded. To start again, run `npm start` and reload.

The visible cost panel shows **This game**, **Last move** (or the viewed move during replay), and **Total spend** across the app. Amounts are labeled as estimated USD and retain up to six decimal places so small model charges stay visible. Total spend refreshes after moves; local bots are labeled free. Expand **How it works** below the board for the explanation of reasoning off, the token cap, live updates and cost accounting.

Use **Light / Dark** in the header to switch between the cream/teal/coral and deep-teal/mint/peach palettes. The choice is saved in this browser; the first visit follows the system preference. Both modes use stronger typography and clearer board lines.

All new browser games use the same fixed setup: a 3×3 board, rules-only context, reasoning explicitly off, a single action line with no rationale, a 128-token output cap, temperature zero, and 0.7 seconds between moves. The local match cost cap is $0.05. No probes or advanced configuration are needed. Existing games keep their original records; games using older settings can be viewed and replayed, with New game available to switch to quick play.

## Connect Nebius

Create `.env` from `.env.example`, add your key, then restart:

```dotenv
NEBIUS_API_KEY=your_token_factory_key
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
PORT=4317
GAMEFIELD_DATA_DIR=./data
GAMEFIELD_SESSION_CAP_USD=5
```

The app automatically discovers models. **Refresh models** retries discovery. The player selectors show the verified Nano and Super models when available on your key, plus Simple bot and Random bot for free play. The key stays on the server.

Reasoning off sends `chat_template_kwargs: { enable_thinking: false }`. If the provider exposes a reasoning trace despite that request, the runner cancels it and interrupts the game without applying a move. Reported reasoning tokens also trigger interruption. An in-flight request may still be billed; missing usage retains its reservation. The absence of reasoning telemetry cannot prove the absence of internal computation.

Live acceptance on 18 October 2026: a 3×3 Nano/Super match completed all 24 moves with no invalid attempts. Each response used 9 output tokens and contained only its action. Neither model exposed a reasoning trace; Super reported zero reasoning tokens, while Nano did not report that detail. Estimated total cost was $0.00242. This verifies the action-only protocol on that endpoint at that time, not comparative playing strength.

## Saved games and costs

Games, attempts, prompts, responses and estimated costs persist in SQLite under `data/`. Restarting does not reset spend or automatically resume billable work. The persistent local ledger starts with a $5 cap for a new database. Costs use the dated catalog rates and provider-reported usage where available; they are estimates, not provider-enforced billing ceilings. Missing usage retains the conservative reservation. The environment cap initializes new databases only.

One drawn edge is one move. Capturing a box keeps the turn, and an edge may capture two boxes. Legality, captures and scores are enforced by the local rules engine.

The old experimental controls, analysis overlays and capability probes have been removed from the browser workflow. Their underlying API and CLI functionality, including paired comparisons, exact evaluation, and JSON exports, remains available for development. Experiments use separate group caps. The generic CLI match cap defaults to $0.25; browser quick play uses $0.05. CLI model configuration: `experiments/nano-super-action-only.json`.

## The paper and exactness

The attached Buzzard–Ciere paper (`1305.2156v2.pdf`) concerns simple loony endgames of disconnected long chains and even loops. It is not a general opening or middle-game solver.

This implementation recognizes unopened chains of at least three boxes and even loops of at least four boxes. It applies the paper's component recurrence with memoization rather than claiming the full closed-form algorithm. The recurrence's value is from the opener's opponent's perspective; the evaluator converts it to the current player's final margin, including already owned boxes. Other positions use exhaustive edge minimax only within the configured budget: at most 16 remaining edges, 120,000 search nodes, and approximately 60 ms. The clock is checked every 1,024 nodes, so this is not a hard real-time deadline. Incomplete search yields no exact values. The exact baseline interrupts when outside that scope.

One drawn edge is one move. A capture grants another move. A single edge may capture two boxes. Declining a capture is legal and necessary for a double-cross; the engine never automatically collects a chain.

The component recurrence has been cross-checked against an independent exhaustive edge solver on overlapping chain and loop fixtures. The test suite also checks conservation/turn invariants across 300 seeded games and compares the edge solver with full-state recursion across every reachable 1×2 position. The paper's Figure 5 prose/diagram score discrepancy is not used as a fixture.

## Persistence, export and terminal use

SQLite stores match snapshots, attempt records, prompt/request hashes, raw responses, usage, estimated costs, experiment schedules and event IDs under `data/`. One process owns a database at a time. The browser can disconnect without stopping a match. SSE reconnection loads the full persisted snapshot; it cannot resubmit an action. An in-progress stream's uncommitted text may be lost on a crash, but its request reservation survives. Restarted matches are interrupted and experiment schedules paused; nothing billable resumes automatically.

JSON exports contain the immutable setup, initial board, recorded states and all attempts. JSONL exports include a match record and separate attempt records. Standalone HTML is a replay with no network/API dependency. Exports contain model prompts and responses, but no API key or authorization headers.

```sh
# Stop the web server first, or use a different GAMEFIELD_DATA_DIR.
npm run cli -- match
npm run cli -- match experiments/nano-super.json
npm run cli -- tournament experiments/local-paired.json
npm run cli -- list
npm run cli -- export MATCH_ID replay.html
```

CLI defaults are free local baselines. A model config uses the exact model ID and the same discovery, validation, accounting and persistence as the browser. Exports refuse to overwrite an existing file.

## Development and boundaries

```sh
npm test
npm run check
npm run build
```

For development, use `npm run dev` for the API and `npm run dev:web` for Vite in another terminal. Normal use needs one process after building. The production frontend uses local system fonts, SVG and CSS; no remote assets or UI framework is required.

The game boundary is `src/engine/game.ts`. Add rules, observation encoding, an optional evaluator, fixtures and a renderer; the coordinator, provider adapter, ledger, replay and scheduler remain shared. The present contract is deterministic, turn-based, two-player, perfect-information play. Hidden information, chance, simultaneous turns and more players require explicit changes.

The app binds to **127.0.0.1**, checks Host/Origin, and requires a local token on mutations. It is a personal local app, not an authenticated multi-user service. Do not expose it through a public proxy as-is. Cloud deployment, serverless batch packaging, container distribution, arbitrary user-supplied game plugins and human-vs-model interaction are outside this release. No cloud resources were created.

Reference material and design decisions are preserved in `IMPLEMENTATION_PLAN.md`. The planning document's acceptance gate for a real small Nemotron match was satisfied by the action-only live check described above.
