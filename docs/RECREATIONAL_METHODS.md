# Recreational game evaluation methods

Consolidated 19 October 2026 from the original board-game plan. Dots & Boxes and Tic-tac-toe are secondary to the Dilemma work. This reference preserves the evaluator's mathematical scope and experimental safeguards without the completed delivery plan or old model-price scenarios. See [release verification](RECREATIONAL_VERIFICATION.md) for recorded checks and the [application README](../README.md) for current controls.

## Rules and exact evaluator

One move draws one unused orthogonal edge. Completing a box awards it to the mover and retains the turn; an edge can capture two boxes. Declining an available capture is legal and can implement a double-cross. The engine never automatically collects a chain. A board with r by c boxes has `(r+1)c + r(c+1)` edges.

Buzzard and Ciere's [Playing simple loony dots and boxes endgames optimally](https://arxiv.org/abs/1305.2156v2), especially sections 4–5, treats disconnected long chains and even loops, not arbitrary openings or middle games. The source paper and extracted text are not redistributed.

The implemented component detector treats unclaimed boxes as vertices, undrawn interior edges as connections and undrawn boundary edges as distinct external ports. Every included box has degree two. A supported chain has two ports and at least three boxes; a supported loop has no ports and an even length of at least four. Unsupported branches and open capture sequences do not receive theorem-based values.

For a component C of length n and remainder H, the memoised reference recurrence is:

```text
v(empty) = 0
chain opening value = n - 2 + abs(v(H) - 2)
loop opening value  = n - 4 + abs(v(H) - 4)
v(G) = minimum opening value over components
```

Here v is future boxes for the opener's opponent minus future boxes for the opener. The evaluator converts it to the current player's final box margin, including already owned boxes. A margin loss of two can mean one box transferred. The recurrence is not the paper's faster closed-form algorithm; it is memoised with a search budget. The chain and loop control thresholds are remainder values of two and four, with equality allowing either choice.

Other supported small positions use exhaustive edge minimax. A capture retains the same player's perspective; flipping the sign after every edge would be incorrect. Defaults allow at most 16 remaining edges, 120,000 nodes and approximately 60 ms, checked every 1,024 nodes. An incomplete search yields unknown, with no partial values represented as exact. Exact move loss is reported only when the best and selected action values are exact; report evaluation coverage alongside it. Solver assistance is a distinct player condition.

[The evaluator](../src/games/evaluate.ts) is checked against independent edge search on overlapping chain/loop fixtures and full-state recursion on every reachable 1×2 position. Rule invariants also cover 300 seeded games. The paper's Figure 5 allocation/prose discrepancy is excluded as an unverified fixture. Tic-tac-toe has its own complete small-game solver.

## Controls for comparisons and learning studies

The implemented API/CLI supports paired matches and held-out positions; the simple recreational browser does not expose research controls. A position suite compares both candidates on the same decisions, avoiding the problem that autonomous games quickly reach different states. Paired games swap starting seats while preserving the opening and protocol. Resample whole opening/pair blocks or positions, not correlated individual moves.

Separate model identity, knowledge supplied, native reasoning, solver assistance and episode memory as experimental factors. In-context examples change request information without updating weights. A meaningful learning study compares versioned example packs on held-out positions; split before rotations/reflections so equivalent boards cannot leak between demonstrations and tests. A frozen test set is separate from prompt development. Public classic-game positions may already be in pretraining, so success does not establish learning from scratch.

The current default observation is engine-generated text state, not a screenshot. Analyst labels, chain decomposition and solver values count as assistance if added to player prompts. Explanations and provider traces are generated claims, distinct from engine-verified facts. A cached model decision is not a new independent sample.

Match settings, prompts, endpoint capabilities, repairs and budgets must be recorded. Equal tokens, equal dollars and equal latency are different comparisons. The same settings and legality/repair policy apply within a controlled contrast. Report outcomes and margins, first-attempt legality, repairs/forfeits, provider interruptions, exact loss with coverage, tokens, estimated cost and latency separately. A small acceptance match is not evidence of comparative strength.

Example-count sweeps, personal episode memory, vision, reasoning-on and solver-assisted studies were ideas in the original plan, not completed research. Their settings require a separately frozen protocol and live capability evidence. The original pilot size and price scenarios were planning choices, not theoretical prescriptions or current quotes.
