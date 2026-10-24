# Final evaluation

## Status and scope

The joint-temperature final evaluation launched on **24 October 2026**. Fresh
hosted engineering passed, and the frozen resource-only rule selected **48
matched blocks per temperature**: **7,104 episodes**, comprising 6,144 known-policy
benchmark episodes and 960 autonomous dyads. The scientific run is paused after
a provider-overload stop; approved recovery is prepared separately. This document
contains its methods and operating instructions, not interim findings.

This is the sole intended primary evaluation for the report and app. Earlier
exploratory observations are excluded. They motivated interleaving temperatures
and durable bounded recovery; their evidence is retained privately. Prior outcome
inspection informed this prospective design, so it is not an outcome-naive first study.

The run directory is `output/preparation/final-joint-2026-10-24/`. Its specification
identity is `047b9a5ab172ffb907781aa4601bce01138c434409d97ca362e98fa4944be4bc`.
`spec.json`, `selection.json`, `source-index.json`, `runtime.json`, `prices.json`
and the stage ledgers are the operational records. Do not edit them.

### Current interruption: 24 October

The final stage stopped at **3,406/7,104 completed episodes**, exactly 1,703 at
each temperature. One Super draft request received HTTP 529, with the provider
message `System is overloaded`, on all three admitted attempts. The canonical
ledger chain, frozen source/runtime and 3,406 native Inspect scored samples
verify. No completed result has been lost or regenerated.

Recorded engineering usage is $0.63490812 and final usage is $7.54404396.
Another $0.22351224 remains conservatively reserved; it is not established as
free or as an invoiced charge. The original $40 ceiling and campaign deadline
remain in effect. No diagnostic calls used paid inference.

**Do not use the ordinary launch command for this stop.** A logical request has
exhausted its three attempts, and interrupted decisions' 600-second deadlines
have expired. A restart cannot clear either limit. Use the approved recovery
route below, rather than the original launcher.

The user approved a separately identified recovery amendment on 24 October.
It retains every successful response, failed attempt, reservation and scheduled
observation; admits at most six total attempts per logical request and one
durable 30-minute recovery window per decision; and uses a shared five-minute
overload cooldown, two sample workers and four concurrent requests. Individual
HTTP attempts remain capped at ten minutes. All retries count toward the
original $0.50 exposure ceiling. No deadline is renewed on another restart.
The original global deadline, $34 final allocation and $40 campaign ceiling
remain fixed. Prompts, models, seeds, scoring and temperatures stay fixed.

`evaluation_recovery/` reuses the frozen gateway, simultaneous-game coordinator,
exact scorer, Inspect and local MLflow. It appends an explicit amendment event
and decision-admission records; it never edits the original ledger prefix or
source. Its receipt and independently archived source are in
`output/preparation/final-joint-recovery-2026-10-24/`. Native session logs remain
under the original `final/inspect/`. The same local tracker records amendment
source, limits, sessions, completion and inherited accounting.
The immutable amendment identity is
`6276f6ff189c399a67dba8dc248a8fc8a5031e2e47cd96c3909e99441d604aa8`.
Its 15 offline checks cover exhausted-attempt recovery, saved-response/draft
replay, both temperatures' native scores, shared cooldowns, inherited exposure,
unchanged observations, deadline/cap refusal and local MLflow. Twenty original
recovery/overload regressions also pass. Preparation made no inference calls
and did not start a new clock or activate the amendment.

Disclose the interruption and transport amendment in the sole final report.
The zero-unresolved-reservations publication gate remains unchanged and still
requires accounting reconciliation. A verified private backup of evidence,
native logs and SQLite is under
`output/recovery-review/final-joint-overload-2026-10-24/`.

## Questions and treatments

1. Does a bounded draft before each action reduce exact own-payoff decision loss
   within each model and temperature?
2. Does the requested temperature change performance or the drafting effect
   under a paired, interleaved environment schedule?
3. What cooperation, returns, breakdown and recovery emerge between adaptive
   agents when neither opponent policy is disclosed?

The exact hosted model IDs are:

- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
- `nvidia/nemotron-3-super-120b-a12b`

Each model has Direct and Draft procedures. Direct requests thinking off and a
single action capped at 128 completion tokens. Draft requests a thinking-on draft
capped at 1,024 tokens, then a separate thinking-off action capped at 128 tokens.
The action request receives the original observation and that decision's draft.
Previous drafts are not carried between rounds. Only strict single-field JSON
with action X or Y determines play; malformed successful responses are not repaired.

All request phases use the episode's temperature, **0 or 1**, and top-p 1. There
are no tools, communication, coaching, forecast elicitation, examples, analyst
feedback or cross-episode memory in the final scientific protocol. Draft changes
compute, request count, thinking settings and conditioning together. This is a
bounded-procedure comparison, not an equal-cost isolation of native reasoning.

## Game and experimental conditions

Both players maximise expected own cumulative points, not score difference.
Choices remain private until joint reveal. Completed history is available.

| Own action | Other action | Own points | Other points |
|---|---|---:|---:|
| Cooperate | Cooperate | 3 | 3 |
| Cooperate | Defect | 0 | 5 |
| Defect | Cooperate | 5 | 0 |
| Defect | Defect | 1 | 1 |

Neutral X/Y labels use both mappings and both display seats. Cooperation is an
outcome to investigate, not the scoring objective. An agent can improve its own
payoff by cooperating less against an unresponsive opponent.

**Track A: known committed opponents.** AllC always cooperates; AllD always
defects; Tit-for-Tat cooperates first and then copies the subject's previous
action; Grim cooperates until a defection, then defects forever. These rules
are disclosed completely to the subject. Each policy is tested at continuation
probabilities .4, .6 and .9. One-round AllC/AllD and announced ten-round TFT/Grim
complete the **16 conditions**. The continuation settings cross the initial
cooperation thresholds of .5 for Grim and two-thirds for TFT.

The geometric game has no announced final round; its realised stopping draw is
hidden when choosing. A 90% continuation probability gives expected length ten,
not a known ten-round horizon. Against either committed retaliating policy in
the announced ten-round condition, the optimal path is nine C moves then D,
earning 32 own points. This differs from the standard equilibrium argument for
two fully strategic players in a finite repeated dilemma.

**Track B: autonomous interaction.** Test all ten unordered pairings of Nano
Direct, Nano Draft, Super Direct and Super Draft, including self-play, at .9
continuation. Neither player receives an opponent rule. There is no identified
exact best-response oracle for these adaptive opponents; report cooperation and
returns separately from Track A loss.

## Replication, pairing and order

A fresh master seed was generated once before new scientific outcomes. Each
block has a distinct derived stopping seed. Within a block, configurations and
both temperatures share environment draws and presentations. Corresponding
temperature episodes are adjacent in a frozen randomised order. Both settings
therefore run within the same campaign window, reducing the earlier time confound.
Provider sampling randomness is not assumed shared by seed.

Four label/seat strata each receive **12 blocks**. Each block contains 64 Track A
episodes and ten Track B dyads per temperature. The 48-block schedule has 20,944
model decisions and 31,416 requests per temperature before retries. Its longest
realised scheduled episode is 28 rounds; this was observed after freezing, not
used to search for a cheaper seed.

Preparation froze nested 24/32/48-block candidates. After engineering, the
largest candidate fitting measured token/latency forecasts was selected before
scientific inference. The rule reads usage and timing, never correctness,
cooperation, oracle loss or draft arguments. There is no outcome-based extension,
early superiority stop, prompt tuning or seed reroll.

## Exact scoring and inference

Against a committed policy, the engine solves finite games by backward
induction and geometric games using rational-arithmetic, Bellman-certified
values. At state s, action a has gap `V*(s) - Q*(s,a)`, allowing optimal play after
that action. Zero means no achievable expected own payoff was given up there.

- Geometric episode loss: `(1-delta) * sum(gaps)`.
- Fixed-horizon episode loss: `sum(gaps)/H`.

Continuation is already in Q*, and stopping supplies survival weighting; do not
discount geometric gaps again. Loss is measured in normalised payoff points,
not cooperation rate or a percentage of correct actions.

The **four primary contrasts** are Draft minus Direct mean Track A loss within
each model and temperature. Negative favours Draft. Weight all 16 conditions
equally within each block and all four strata equally. Use **50,000 deterministic
PCG64 stratified whole-block bootstrap draws** and report **98.75% marginal
intervals**, an approximate Bonferroni treatment of a four-comparison 5% family.
At least five complete within-model blocks in every stratum are needed for an
interval. Coverage and power are not guaranteed.

The **six secondary contrasts** are temperature 0 minus 1 for four arms and the
change in Draft-minus-Direct for each model. Resample matched whole blocks
jointly across temperatures. Their approximate 95% intervals are nominal and
do not establish multiplicity-controlled secondary discoveries.

Report all condition means and opponent reversals. For every autonomous pairing,
report first-round CC, joint return, round-weighted and episode-weighted CC,
and breakdown/recovery counts with opportunity denominators. Normalised joint
return is `(1-delta) * sum(both players' points)`, not observed mean points per
round. Rounds within a dyad are dependent observations.

Every scheduled episode retains a status. Missing episodes are not defections
or zero scores. Complete-block estimates remain conditional on completion.
Dynamic programming bounds feasible loss over the remaining scheduled length,
conditional on a committed prefix. Those schedule-specific bounds are not
population confidence intervals. An incomplete campaign cannot pass release.

## Observation and artifact inventory

| Artifact | What it provides |
|---|---|
| `engineering/events.jsonl`, `final/events.jsonl` | Authoritative append-only request, accounting, response and joint-reveal chains. |
| Stage `inspect/*.eval` | Native samples, model events, private traces, scored outcomes and joint-reveal events linked to canonical event hashes. |
| `tracking.sqlite`, `tracking-artifacts/` | Local MLflow identities, parameters, costs, contrasts and derived artifacts. |
| `export-<head>/summary.json`, `report.md` | Reconstructed completion, primary/secondary comparisons, limits and provenance. |
| `episodes.json` | Revealed histories, exact scores, statuses and missingness bounds. |
| `decisions.csv`, `decisions.parquet` | Action, state, payoff, exact gap, cap indicator, estimated cost and measured request durations. |
| `requests.csv`, `requests.parquet` | Usage, phase, attempt, requested/reported model, provider fingerprint when returned and timing. |
| `arms.csv`, `conditions.csv`, `crossplay.csv`, `contrasts.csv` | Complete arm/condition/pairing summaries and uncertainty. |
| `primary-contrasts.png`, `manifest.json` | Rendered primary comparisons and derived-file checksums. |

Truncation/error associations, provider drift, state-dependent behaviour, token
use, cost/latency and draft-content review are exploratory. Truncation is
endogenous: an association does not prove that increasing a draft budget fixes
errors. Drafts and app forecasts are generated reports, not verified beliefs.
Raw responses and private drafts remain local rather than entering public downloads.

## Engineering and dependencies

The existing local CPU coordinates remote Token Factory inference. No VM, GPU,
new cloud Job or hosted tracker is used. Inspect supplies the native evaluation
loop and model wrapper; the custom gateway owns transmission and accounting.
MLflow is a real local SQLite projection, not the authoritative evidence store.
A tracking/export failure can be repaired without regenerating successful model calls.

| Locked dependency | Version | Actual role |
|---|---:|---|
| Inspect AI | 0.3.282 | Native tasks, samples, model events and exact custom scorers. |
| HTTPX | 0.28.1 | Audited provider HTTP transport and public price check. |
| NumPy | 2.5.4 | Deterministic whole-block resampling and diagnostics. |
| PyArrow | 26.0.0 | Verified numeric Parquet exports. |
| Matplotlib | 3.11.2 | Primary comparison figure. |
| MLflow Skinny | 3.17.1 | Local run parameters, metrics and artifacts. |
| SQLAlchemy / Alembic | 2.1.5 / 1.20.0 | Local MLflow database access and schema. |

`uv.lock` pins the complete dependency resolution; `runtime.json` records the
actual interpreter, platform and installed distributions. Do not change that
environment during the active run. No model weights are trained or hosted locally.

Engineering used the existing frozen bank of 142 decisions plus 26 independent
interactive episodes **at each temperature**: 284 bank decisions and 52 episodes.
Require valid protocol/usage, draft-reasoning telemetry on both models and forced
32-token exhaustion probes. Synthetic mocks cannot unlock hosted final inference.
Engineering observations never enter scientific estimates.

The shared ledger reserves both seats and both phases before transmission. The
original segment used four sample workers/eight requests and three admitted
attempts with 15/45-second backoffs. The approved recovery uses two workers/four
requests, six total attempts and a shared five-minute 529 cooldown. Every
ambiguous transmission retains its full reservation.
Durable successful responses are replayed; invalid successful content or unknown
usage cannot be regenerated. Recovery retains the original observations and
global deadline; its explicitly amended decision admissions persist across resumes.

## Budget and unattended operation

The authorised **additional $40** is separate from historical charges:

| Allocation | USD |
|---|---:|
| Engineering, including at most $0.05 retry exposure | 2 |
| Final inference, including at most $0.50 retry exposure | 34 |
| Other-charge reserve | 2 |
| Unallocated contingency | 2 |

No automatic contingency transfer is permitted. Cost selection uses mean measured
tokens by model, temperature, procedure and phase, exact candidate counts, 50%
margin and the final retry reserve. Time selection assumes four effective workers
and 50% margin. These scenarios do not guarantee completion or provider invoices.
Hard reservations stop further dispatch if the allocation cannot accommodate it.

One campaign window is at most **36 hours**, engineering at most two hours, with
a 15-minute dispatch/shutdown margin and a separate parent watchdog. Public
unauthenticated catalog prices must match the frozen reviewed book before paid
dispatch. Price changes refuse launch rather than silently rewriting the record.

The macOS launcher uses `caffeinate -i`, preventing automatic idle sleep while
the child runs. The display may turn off and the screen may lock. Keep power,
internet, the lid and the launching terminal open; do not manually Sleep, log
out or restart. Keep at least 8 GiB free for evidence. No continuous observation
is required, but interruptions still need explicit recovery.

## Commands and reproducibility

The original and recovery directories are already prepared. **Do not prepare
them again or start concurrent launches.** Read-only recovery verification also
checks the original frozen source, runtime, ledger prefix, schedule and clocks:

```sh
.venv/bin/python -m evaluation_recovery verify output/preparation/final-joint-recovery-2026-10-24
```

To start the approved recovery, use a shell with `NEBIUS_API_KEY` privately
available. The same command supports later resumes within its persisted limits:

```sh
.venv/bin/python -m evaluation_recovery launch output/preparation/final-joint-recovery-2026-10-24
```

This makes paid calls only for missing admitted work under the original caps and
clock. It does not read `.env` or credential files. Never paste keys into chat.

After completion or interruption, reconstruct and check publication readiness:

```sh
.venv/bin/python -m evaluation_recovery analyse output/preparation/final-joint-recovery-2026-10-24
.venv/bin/python -m evaluation_recovery release-check output/preparation/final-joint-recovery-2026-10-24
```

Native logs from every session are retained; a resumed session may contain
checkpoint-only samples while earlier sessions hold original model events.
Derived CSVs, Parquet, scores and report text are regenerated and compared.
Exports stage atomically. A complete settled final can repair derived exports
without another provider completion or a renewed clock.
The analysis amendment record binds the derived export to both source packets;
retain it with the original export rather than presenting the base source alone.

The frozen source includes the original preparation protocol at
`docs/FINAL_EVALUATION_V2.md`. It is an ignored compatibility input rather than a
fourth maintained guide. The immutable `.snapshot` under `evaluation_v2/frozen/`
and `tools/restore_frozen_protocol.py` restore those exact bytes in a new checkout.
Do not alter the active file, source archive, dependency lock, seed or schedule.

Reproducibility means exact offline analysis from saved evidence, preserved
source/dependency bytes and a specified independent-replication procedure.
Hosted outputs and weights are not guaranteed byte-identical, including at
temperature zero. Checksums detect changes; they are not provider attestations.

## Release boundary

Release requires complete hosted results at both temperatures, native Inspect
scored-sample coverage, zero unresolved final reservations, successful local
MLflow export and reproducible derived artifacts. The release check itself never
publishes or pushes. Report, replay, Results, downloads and checksums must switch
together to the new verified dataset. Preserve earlier development evidence
privately and retain only the brief history needed to explain design decisions.

There is no claim of a general model ranking, unrestricted reasoning superiority,
equilibrium identification, verified latent beliefs, educational benefit or
real-world negotiation performance. Interleaving reduces time confounding but
does not pin backend weights or remove every service effect.

The app's optional forecast protocol and visible board games are separate from
the scientific treatment. Dots & Boxes uses exact small-state search or supported
chain/loop references, with incomplete searches marked unknown; Tic-tac-toe has
a complete small-game solver. A tactical box sacrifice does not create the
mutual-gain incentives of the repeated dilemma. Detailed derivations are in the
retained [TeX notes](public/research/paper/main.tex) and [PDF](public/research/paper/report.pdf).

References: [Inspect logs](https://inspect.aisi.org.uk/eval-logs.html),
[custom scorers](https://inspect.aisi.org.uk/custom-scorers.html),
[MLflow tracking](https://mlflow.org/docs/latest/tracking/),
and the [public provider catalog](https://tokenfactory.nebius.com/api/public/models_info).
