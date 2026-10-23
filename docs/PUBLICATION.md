# Public repository preparation

The public project name is **Dilemma Dynamics**, with the subtitle
*Exploring AI strategies, incentives and cooperation.* Repository links and the
standalone demo base use `dilemma-dynamics`. The 23 October branding revision
changes presentation only: the active temperature-zero run's Python source,
deployment templates, fixtures, dependency files, preparation and historical
evidence retain their original names and bytes. Research commands and local
app persistence/settings remain compatible. See the README's compatibility
note before considering any internal package rename.

Updated 23 October 2026. Publishing source and recorded results does not deploy
the local app or authorise another paid evaluation. The project uses MIT; linked
reference works and dependencies retain their own rights and licenses.

The user has separately approved preparation of the full
[temperature-zero extension](TEMPERATURE_ZERO_EVALUATION.md) within the existing
$30 total. The user reports that local bundle is now running; the branding work
does not launch or control it. Public results and
their frozen package remain the temperature-one study. The original design is
retained byte for byte in `python/gamefield_research/design_v1.py`, which the
public verifier checks against the original executed-source hash; the current
entry point adds validation for a separately identified temperature-zero plan.

## Included

The application has Dilemma, Analysis, Study replay, Results and a separately
labelled **Board games · side project** section. The main project studies
cooperation and incentives in the repeated Prisoner's Dilemma; the recreational
games explore competitive tactics and search with visible moves. The
[game-type guide](GAME_TYPES.md) explains their different information and reward
structures. Results
uses a bundled, static snapshot of the completed study. Its filters and downloads
make no inference calls. The live educational protocol differs from the study.

The [public results package](../public/research/README.md) includes a complete
LaTeX report and compiled PDF, methods and amendments, the executed plan, all 1,776 revealed episode
records, numeric CSVs, figures and checksums. Offline verification recomputes
scores and estimates, including the two bootstrap intervals. Limitations are
displayed with the findings.

The 23 October revisions add author attribution, related work, a worked loss
example, all ten autonomous pairings and per-procedure costs from retained audit
aggregates. Study replay uses the existing public episode actions. A checksum
refresh covers these public presentation revisions; frozen plans, source archives,
claims, scoring code and raw evidence are not rewritten.

## Kept local

Git ignores credentials, game databases, research output, account-specific
handoffs, operational launchers, evidence archives, the private study audit and
its renderer, historical migration material, reference PDFs and extracted paper
text. These files remain on disk. Do not force-add ignored files for publication.

Frozen executed source and raw evidence remain preserved in the private packet.
The public source removes personal cloud profile/project defaults; blank
templates fail closed and still require source-bound engineering, verified
deployment details and an explicit plan-bound receipt. The recorded executed
source hash refers to the archived study, not the evolving public checkout.
Existing claims, clocks and guards have not been cleared or renewed.

Public episode actions support score reproduction. They cannot independently
authenticate provider identity, raw request history or billing. Raw responses,
private drafts and receipts are intentionally absent from public downloads.

## Validation before committing

The game-type clarification adds a shared app comparison, a distinct
**Board games · side project** navigation label, and a guide to the different
reward and information structures. The README, teaching/method notes and website
post state which evidence belongs to each project. Existing app tests (54), both
builds, offline public-result reproduction and publication checks passed.
The main and recreational views were inspected in the browser, including a
320-pixel layout with no horizontal page overflow. The website's Jekyll build,
PurgeCSS step and 22-file demo/link/checksum verifier passed. No research
execution files, runtime, prepared run, claims or evidence were edited by this
presentation work.

The 23 October presentation update passed 54 app tests (including replay score
and invalid-record checks), TypeScript and the production build, publication
checks, Ruff for the revised verifier, and offline result/cost verification.
The ten-round local demo, matched recording selection, and connection-loss warning
were checked in an isolated browser instance with no API key. Static replay and
Results were checked without an API server. The app was checked at desktop
and 320-pixel widths with no page-level horizontal overflow;
wide Results tables retain their own scrolling region. The revised report was
compiled and every page visually inspected. No scientific inference was launched.
The broader 22 October checks below remain dated records, not a claim that all
dependency audits or container checks were rerun for this presentation update.

Verified locally on 22 October 2026: 52 app tests and 106 Python tests passed,
including MLflow with all locked optional dependencies installed; TypeScript and the production build
passed. Public results verification reproduced all scores, both intervals and
all four CSVs. Ruff, whitespace and publication checks passed. The browser's
Results navigation, opponent filter, light/dark themes and layouts at 320 CSS
pixels and desktop width were checked; only the wide condition table scrolls
horizontally inside its container.

The npm audit and pip-audit of all 119 installed Python dependencies reported no
known vulnerabilities at the time of checking. This is a dated registry check,
not a guarantee. The research container built successfully and its help command
passed with networking disabled. The private completed-run preservation packet
also verified all 68 original members against the current retained evidence.

```sh
npm test
npm run check
npm run build
npm run verify:public
npm audit
uv run ruff check python python_tests tools
uv run pytest -q
uv run python tools/verify_public_results.py
git diff --check
```

CI runs the app tests/build, publication checks, Python tests/lint, public-results
verification and a network-disabled container help smoke check. No CI workflow
receives provider keys or runs hosted inference. The public-file checker scans
tracked plus unignored candidates and HEAD/branch/tag history for selected patterns,
checks relative Markdown links and reports locations without printing secret
values. It does not read ignored credential/evidence files and is not a complete
secret scanner.

Review `git diff` and `git status` before your next commit. Commit only the
intended public files. Keep the local evidence backup separately from Git. The
app remains bound to localhost; see [SECURITY.md](../SECURITY.md) for hosting
boundaries.

## History and the later push

The original single commit contained a personal folder path. With user approval,
the local root commit is replaced by a copy with that path made generic. Current
files and all private research evidence remain intact. An ignored local Git
bundle preserves the original commit. No public release or remote push is made
by this preparation.

The local feature commit `fbcee6e` already contains autonomous Dilemma and public
results, following cleaned root `cb73ff4`. The 23 October presentation fixes must
be reviewed and committed separately. Remote state and public visibility are not
established by this document. Inspect the current remote before publishing:

```sh
git ls-remote origin refs/heads/main
```

If the remote still points to the original root below, update only `main` with
the previously approved, explicit lease. If it already contains the cleaned
history, use a normal push when possible. If it differs unexpectedly, inspect it
before proceeding. Repository visibility is a separate publication action.

```sh
git push --force-with-lease=refs/heads/main:865b89dd8b75c351e1d9e3c2cb5ef8ca5cc214b1 origin main
```

If the remote has changed, the lease refuses the push; inspect that change before
proceeding. Do not use a mirror push or push app-managed `refs/codex` checkpoints.
Those local checkpoint trees can contain private working material. The public
checker covers intended commit history, not private checkpoint refs or reflogs.
