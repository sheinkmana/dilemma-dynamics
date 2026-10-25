# Dilemma Dynamics

_Exploring AI strategies, incentives and cooperation._

An interactive game laboratory by **Alisa Sheinkman**. Play the repeated
Prisoner's Dilemma, inspect choices and their consequences, and explore how
NVIDIA Nemotron Nano and Super respond to changing incentives.

![Evaluation: average drafting effects](public/research/figures/primary-results.png)

The evaluation contains **7,104 episodes**, **two models** and **two temperatures**.
Drafting reduced average exact benchmark decision loss by **16.8–37.5%** across
the four planned comparisons. The opponent matters: drafting increased loss
against Tit-for-Tat and reduced cooperation in autonomous self-play. Recognising
an exploitation opportunity and sustaining a reciprocal relationship are
distinct capabilities.

Read the [evaluation guide](FINAL_EVALUATION.md) for findings and reproducibility,
or the [PDF notes](public/research/paper/report.pdf) for the study, mathematical
definitions and future work. The [TeX source](public/research/paper/main.tex) is
retained in the repository.

## Explore the app

- **Play & understand** introduces simultaneous private choices, the payoff
  matrix and the value of another encounter. Play yourself, watch free bots, or
  watch labelled saved Nemotron recordings. Inspect a completed round's payoffs
  and alternative actions beside the game. Expand lessons and advanced setup
  when useful. The local app also offers explicitly started live Nemotron play.
- **Results** presents the question, Direct/Draft procedures, key numbers and
  charts. Expand **Study replay** below the findings to follow a saved episode,
  then explore detailed tables and methods. Saved recordings make no model calls.
- **Recreational games** is a separate secondary link. Tic-tac-toe and Dots & Boxes
  are mathematical games played on discrete grids or lattices, with perfect
  information and visible sequential moves. Try their tactics and search in the
  game area. Their scores are separate from the dilemma evaluation.

Both website and local builds share this interface. The website supports free
play, analysis, saved recordings and replay exports without a key. The local
build additionally supports model play through a localhost server. Browser games
save locally when storage is available; reload pauses unfinished games until
Resume. Download a replay to keep a separate copy.

## Run locally

Requires Node **22.18+ or 24** and npm. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. Free play, lessons, recordings and Results work
without a provider key. For development, run `npm run dev` and `npm run dev:web`
in separate terminals; Vite normally serves port 5173 and proxies the API to 4317.

For live Nemotron play, copy `.env.example` to the ignored `.env`, configure
`NEBIUS_API_KEY`, restart, and choose **Refresh models**. Select the models and
session settings, then explicitly start. Calls use your own provider account.
The server keeps the key private; the public website never embeds it.

Pause waits for a joint-round boundary. Stop awards no partial-round points.
Restart never automatically resumes model requests. Accepted sealed responses
are retained for supported recovery. After a browser disconnect, check the
connection and session status before restarting.

## Build the website app

```sh
npm run build:public
npm run preview:public
```

Open **http://127.0.0.1:4173/dilemma-dynamics/**. The default is **Play & understand**
(`#play`); **Results** is `#results`, with Study replay at `#replay`.
`#recreational` opens Recreational games. Existing `#dilemma` and `#analysis`
links still open the corresponding Play section. Changing tabs keeps game state.

Free play runs in the browser. The public build excludes model configuration,
server shutdown and inference transport; its build check rejects API endpoints
or event streams in compiled scripts.

Publish the contents of `dist/web/` under the website's `dilemma-dynamics/`
directory, with `LICENSE` copied as `LICENSE.txt`. The build uses an explicit
website asset allowlist: app assets, PDF notes, required figures and viewer data,
saved action recordings, and a checksum manifest. The repository retains the
full scientific export and TeX source. Research links on the website lead to
the PDF and this repository. Each build replaces `dist/web/`; export immediately
after `build:public`. Rebuilding this repository does not publish the website.

For Jekyll, exclude `dilemma-dynamics/**` from `jekyll-minifier`; Vite already
minifies the assets. Preserve the selected research assets and checksum manifest
byte for byte. Check free play, pause/resume, browser saves, replay, Results and
research links after copying the build.

## How it works

**React interface → local Fastify coordinator → Nebius Token Factory.**
SQLite stores local sessions and request records. The public build uses a
separate browser runtime for free policies and static evidence. Analysis runs
outside the player decision loop.

The scientific pipeline uses **Python 3.12**, **Inspect AI**, **HTTPX**, **NumPy**,
**PyArrow**, **Matplotlib** and local **MLflow Skinny/SQLite** tracking. Hosted
Nemotron models choose actions; deterministic code runs the game and calculates
exact payoff references. Roles, locked versions and mathematical definitions
are in the [evaluation guide](FINAL_EVALUATION.md).

| Location | Purpose |
| --- | --- |
| `src/web/` | Shared interface, browser runtime, replay and results. |
| `src/server/` | Local API, provider calls and session persistence. |
| `src/dilemma/`, `src/games/` | Rules, observations, analysis and recreational-game solvers. |
| `evaluation_v2/`, `evaluation_recovery/` | Executed evaluation and separately frozen recovery. |
| `python/gamefield_research/`, `fixtures/` | Exact scoring, schedules and frozen reference checks. |
| `public/research/` | Released actions, numeric data, figures and TeX/PDF notes. |
| `tools/` | Offline verification, protocol restoration and website checks. |
| `tests/`, `python_tests/`, `recovery_tests/` | App and network-free research checks. |
| `package-lock.json`, `uv.lock` | Reproducible dependency resolutions. |

The `gamefield_research`, `gamefield-study` and `GAMEFIELD_*` compatibility names
preserve installed packages, sessions and provenance. Private execution evidence
remains in ignored `output/`. A root `conftest.py` isolates one frozen legacy
test's retired public paths using a temporary reconstructed plan contract.

## Verify

Application and public-build checks make no inference calls:

```sh
npm test
npm run build
npm run build:public
npm run verify:public
```

For a **new checkout**, install the locked research environment and restore its
byte-preserved protocol input before the offline checks:

```sh
uv sync --frozen --all-extras
uv run python tools/restore_frozen_protocol.py
uv run python -m pytest python_tests recovery_tests -q
uv run python tools/verify_public_results.py
```

Preserve executed source, prompts, scoring and evidence. The completed campaign
can be reconstructed offline; the [evaluation guide](FINAL_EVALUATION.md)
explains the evidence and verification paths.

## Storage, access and license

The live server binds to `127.0.0.1`, checks Host/Origin and requires a local
mutation token. Host the static public build on the website; keep credentials,
`data/`, raw drafts and operational evidence private. Report vulnerabilities
privately through repository security advisories.

[MIT](LICENSE) covers project code, original documentation and released data.
Dependencies and cited works retain their licenses. Nebius and NVIDIA marks
identify the services/models used and retain their own terms.
Logo sources: [Nebius](https://nebius.com/logo.svg) and
[NVIDIA](https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/).
Retrieved 24 October 2026. NVIDIA's `n24-nvidia-logo` symbol is wrapped as a
standalone SVG with its artwork, proportions and colours retained.
