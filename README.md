# Game Field

A local app for repeated Prisoner's Dilemma play and decision analysis, with
Dots & Boxes and Tic-tac-toe under **Recreational**. The app runs on your CPU;
Nebius Token Factory serves model requests remotely.

## Study results

All 1,776 episodes completed across 24 blocks. Drafting reduced mean benchmark
loss for Nano (−0.1947) and Super (−0.2371), but increased average loss against
Tit-for-Tat. Mutual cooperation occurred in 189/2,060 autonomous rounds (9.2%).
These descriptive results follow an amended run; they are not a general model
ranking.

Read the [report (PDF)](public/research/paper/report.pdf) or its
[LaTeX source](public/research/paper/main.tex).
[Methods and amendments](public/research/protocol.md) and
[reproducible data](public/research/README.md) are separate. The app's **Results**
tab displays saved findings without inference requests.

## Run

Requires Node 22.18+ or Node 24 and npm.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. After building, `npm start` is enough.
For development, run `npm run dev` and `npm run dev:web` in separate terminals.

For model play, copy `.env.example` to `.env`, set `NEBIUS_API_KEY`, and restart.
The key stays on the server. Models must have reviewed catalog prices.
Without a key, **Run free local demo** uses two labelled local policies.

## Use the app

- **Dilemma:** choose two models, a decision protocol, a horizon and a session
  limit, then start. Actions remain private until both players have chosen.
- **Analysis:** inspect incentives, reported forecasts and completed rounds.
- **Results:** read the completed study and download its report and data.
- **Recreational:** play or replay Dots & Boxes and Tic-tac-toe.

Dilemma payoffs are CC = 3/3, CD = 0/5, DC = 5/0 and DD = 1/1. Players maximise
expected own points. With 90% continuation, ten rounds is the expected length,
not an announced final round. The fixed ten-round option announces its end.

**Action only** records a choice; **Action + forecasts** also records reported
expectations before reveal. Forecasts are not verified internal beliefs. The
live app uses temperature zero and reasoning requested off; the scientific
study uses a different protocol. See the [game contract](docs/DILEMMA_PROTOCOL.md)
and [analysis methods](docs/AUTONOMOUS_DILEMMA_ANALYSIS.md).

Pause waits for a joint-round boundary. Stop cancels pending work without
awarding partial-round points. Saved interactions support replay and offline
HTML, JSON and JSONL export. Restarting never resumes paid activity automatically.

## Storage, cost and security

Games, prompts, responses and estimated costs persist in SQLite under `data/`.
The default Dilemma session limit is $0.05; a new shared ledger defaults to $5.
Reservations cover concurrent requests. Missing usage retains a conservative
charge. These are local estimates, not provider-enforced invoice caps.

The app binds to **127.0.0.1**, checks Host/Origin and requires a local mutation
token. It has no multi-user authentication. Publishing this repository does not
deploy the app; do not expose it through a public proxy as-is.
[SECURITY.md](SECURITY.md) covers reporting and sharing precautions.

## Verify

```sh
npm test
npm run build
npm run verify:public
uv sync --frozen --all-extras
uv run pytest -q
uv run python tools/verify_public_results.py
```

Research requires Python 3.12 and uv. Verification uses saved data and mocked
responses; it makes no inference requests. Raw evidence, private drafts,
credentials, operational archives and supplied reference PDFs stay local.

The Dots & Boxes evaluator supports the chain/loop endgames in
[Buzzard and Ciere](https://arxiv.org/abs/1305.2156v2) and bounded exhaustive
search elsewhere. It is not a general optimal solver. See the
[methods](docs/RECREATIONAL_METHODS.md) and [documentation index](docs/README.md).

Before the next commit and public release, follow the
[publication notes](docs/PUBLICATION.md), including the lease-bound push after
the approved history cleanup.

## License

[MIT](LICENSE) covers project code, original documentation and released data.
Dependencies and referenced works retain their own licenses; reference books
and papers are not redistributed.
