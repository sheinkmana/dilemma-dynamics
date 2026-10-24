# Replacement final evaluation: prospective joint temperatures

Status: offline implementation and preparation, 24 October 2026. No new hosted
engineering or scientific observation is established by this document.

The user requested a new final evaluation after reviewing earlier experiments,
and authorised **$40 additional**, separate from all historical charges. This
campaign is the intended sole primary public results dataset in the report and
app once complete and verified. Earlier results informed its design: preserve
their evidence and disclose that development history rather than describing this
as an outcome-naive first study. Do not pool earlier observations into this run.

## Existing infrastructure and dependencies

Use the existing Python 3.12 environment, local CPU coordinator and exact Nebius
Token Factory endpoints for Nemotron Nano and Super. No VM, GPU, cloud Job,
registry, new account service or hosted tracking server is provisioned.

Inspect AI 0.3.282 actually runs native samples and custom deterministic scorers.
Its model wrapper calls the existing audited RecoveryGateway/RecoveryLedger.
Native `.eval` files contain per-sample model events, game-engine information,
scores and configuration. Keep all session logs on resume: a resumed session can
contain checkpoint-only samples while earlier logs retain original model events.
Inspect does not supply generic independent-round statistical errors.

MLflow Skinny 3.17.1, SQLAlchemy and Alembic are already installed. The new runner
uses them for local SQLite tracking of engineering/final stages, identity,
budgets, token limits, model IDs, completion, expenses, all primary/secondary
contrasts and derived artifacts. This is actual tracking, not an unused optional
hook. No web UI or tracking service is assumed to exist. Logs/SQLite and artifacts
are private local derivatives; the JSONL ledger is authoritative.

The exact game engine, observation builder, strict output validator, transport,
reservations and bounded-retry implementation are reused. NumPy computes block
bootstrap intervals. PyArrow produces verified numeric Parquet tables, Matplotlib
renders the primary contrast figure, and CSV/JSON use the standard library. The new path introduces
no additional dependency or unused framework. Historical launchers, archives and
lockfiles retain their audit/compatibility purpose and are not deleted as dead code.

## Frozen scientific design

Keep the payoff matrix (CC 3/3, CD 0/5, DC 5/0, DD 1/1), own-cumulative-payoff
objective, private simultaneous decisions and complete revealed history. No
communication, tools, solver assistance, forecast elicitation, cross-episode
memory or prompt tuning occurs during the final campaign.

Each model uses Direct (thinking off, action cap 128) and Draft (thinking-on draft
cap 1,024 followed by separate thinking-off action cap 128). Top-p is 1. Every
phase uses its episode's assigned temperature, either 0 or 1. Draft changes
compute, request count, thinking settings and conditioning together; claims must
refer to this bounded procedure, not isolated native reasoning or equal cost.

Track A retains 16 exact-reference conditions: AllC, AllD, TFT and Grim at
continuation .4/.6/.9; one-round AllC/AllD; announced ten-round TFT/Grim. Track B
retains all ten unordered model/procedure pairings at continuation .9.

A fresh random master seed is drawn once in offline preparation. Each block
has a distinct derived stopping seed, shared across configurations and both
temperatures. Full matches use the same stopping lengths and presentations.
Adjacent temperature pairs are assigned a frozen random order. This interleaves
temperatures in the same provider window, reducing the earlier date confounding.
It does not equate provider sampling randomness or pin immutable model weights.
Four label/seat strata are balanced. Repeated rounds are not independent trials.

Freeze nested candidates of **24, 32 or 48 whole blocks per temperature**, with
six/eight/twelve blocks per stratum. They contain respectively **3,552, 4,736 or
7,104 total episodes**. After fresh hosted engineering at both temperatures,
select the largest candidate whose predeclared usage/latency forecast fits.
Selection reads no actions, oracle losses, cooperation, expected correctness or
draft text. Save that decision before any scientific inference. There is no
optional stopping, outcome-based extension, seed search or prompt repair.

The technical gate uses the existing 142-decision bank and 26 independent
interactive episodes **at each temperature**: 284 bank decisions and 52 episodes.
Require protocol completion, exposed draft reasoning telemetry on both models,
forced 32-token exhaustion probes, valid thinking-off actions and known usage.
Technical observations never enter scientific estimates. Synthetic mocks cannot
unlock hosted final inference.

## Analyses specified before the new outcomes

Four primary contrasts: Draft minus Direct normalised exact oracle loss within
each model and temperature. Weight all 16 conditions and four strata equally.
At every observed state, the exact gap is `V*(state) - Q*(state, action)`, with
optimal continuation after that action. Geometric episode loss is
`(1-delta) * sum(gaps)`; fixed-horizon loss is `sum(gaps)/H`. Continuation is
already included in the oracle, so geometric outcomes are not discounted again.
Use 50,000 deterministic stratified whole-block bootstrap draws. Report 98.75%
marginal intervals, an approximate Bonferroni treatment of a four-comparison 5%
family. Bootstrap coverage/power remain unestablished; do not promise significance.
At least five complete within-model blocks per stratum are required for intervals.

Six prespecified secondary contrasts: temperature 0 minus 1 in each of four arms,
and two changes in Draft-minus-Direct. Resample matched whole blocks jointly across
temperatures. Report nominal approximate 95% intervals and label them secondary;
do not claim multiplicity-controlled secondary discoveries.

Report all 16 condition means, opponent reversals, both temperatures, all ten
autonomous pairings, joint returns, first-round CC, round-weighted and
episode-weighted cooperation, breakdown/recovery counts and opportunities.
Publish an action-level table with exact gap, state, payoff, prior history
identifiers, token-cap indicator, estimated cost and measured request duration.
Publish numeric request telemetry including requested/reported model identifiers
and provider fingerprint when returned. These do not authenticate model weights.

Token use, cost/latency, truncation/error associations, state-dependent behaviour,
provider drift, decision trajectories and any draft-content review are
exploratory. Truncation is endogenous, so association does not prove that a larger
budget would improve play. Drafts are reported traces, not verified beliefs.
Do not add model-graded scoring when an exact payoff reference is available.

Missing episodes are not zero scores or defections. Report every scheduled status,
complete-block eligibility and dynamic-programming bounds for unfinished scheduled
outcomes. Those bounds are not population confidence intervals. Public promotion
requires complete hosted results at both temperatures; an incomplete run stays
an incomplete final, without selecting successful fragments or a new clock.

## Budget, time and recovery

The new additional $40 is allocated as $2 engineering, $34 final inference,
$2 other-charge reserve and $2 unallocated contingency. Engineering includes
up to $0.05 retry exposure; final includes up to $0.50, not added outside caps.
Old campaign charges and reservations remain in their old records, not erased
or treated as fresh allowance. No automatic contingency transfer is allowed.

Use the existing audited-recovery/2 policy: at most three attempts, admitted
transient failures including HTTP 529, 15/45-second backoffs. Keep the entire
reservation for ambiguous transmitted attempts. Reuse durable successful responses;
invalid successful content/usage cannot be regenerated. Resume never changes
identity, prices, selected schedule, source, original deadlines or caps.

Forecast cost from engineering mean measured tokens by model, temperature and
phase, weighted by the exact candidate decision counts, with 50% margin plus
$0.50 retry exposure. Forecast time at four effective workers with 50% margin.
These are scenarios, not invoice guarantees; full histories may exceed engineering
prompt lengths. Hard reservations and deadlines can interrupt a forecast that
turns out optimistic. If no balanced candidate fits, stop before final calls.

One new campaign window is at most 36 hours, engineering at most two hours,
with a 15-minute dispatch/shutdown margin. A separate parent watchdog enforces
the overall limit. The launcher holds macOS awake. Keep at least 8 GiB free.
The public unauthenticated model catalog is checked before paid dispatch against
the preserved reviewed prices. A changed rate stops launch for a new reviewed
preparation; it never silently edits the executed price book.

## Commands and release gates

From the repository root, offline:

```sh
.venv/bin/python -m evaluation_v2 prepare output/preparation/final-joint-2026-10-24
.venv/bin/python -m evaluation_v2 verify output/preparation/final-joint-2026-10-24
```

Preparation freezes the fresh master seed, all candidate schedules, engineering
bank, source archive/index, runtime, price book, analysis specification and
additional budget. It starts no clock and reads no key. Do not repeat preparation
to search for a shorter or more favourable schedule.

Only the user's explicit launch command makes paid requests, with the existing
key privately available in their shell:

```sh
.venv/bin/python -m evaluation_v2 launch output/preparation/final-joint-2026-10-24
```

After interruption, the same command resumes under the original clock/caps.
After final completion it can retry derived exports without generating replacements.
Do not change the prepared environment with a dependency sync or uninstall.
The launcher needs the key in the user's environment; it does not read `.env`,
credential files or cloud profiles. A missing key starts no evaluation clock.

Offline reconstruction and publication-readiness inspection:

```sh
.venv/bin/python -m evaluation_v2 analyse output/preparation/final-joint-2026-10-24
.venv/bin/python -m evaluation_v2 release-check output/preparation/final-joint-2026-10-24
```

Derived CSVs and scores are regenerated and compared against their checksums.
Release requires complete hosted results, native Inspect scored-sample coverage,
zero unresolved final reservations and completed local MLflow tracking. A tracking
failure is repaired from saved evidence, without rerunning successful inference.
No release command publishes, pushes or modifies the current public dataset.

After the replacement completes, archive the current public package privately,
prepare the new combined report and replace the app/replay/download dataset as
one coherent cutover. Remove old result comparisons from the public presentation;
retain a short development-history disclosure. Until that verified cutover, the
existing results are historical completed studies, not results of this campaign.

Reproducibility means exact offline scoring/statistics from saved evidence,
preserved source/dependency bytes, and a fully specified procedure for independent
replication. Hosted temperature-zero inference is not promised byte-identical.
Private raw responses, drafts, all session logs and tracking remain retained.

Implementation references: [Inspect custom scorers](https://inspect.aisi.org.uk/custom-scorers.html),
[Inspect log files](https://inspect.aisi.org.uk/eval-logs.html),
[MLflow backend stores](https://mlflow.org/docs/latest/tracking/backend-stores/),
and the [public provider catalog](https://tokenfactory.nebius.com/api/public/models_info).
