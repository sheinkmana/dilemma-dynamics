# Final evaluation

## Completed result and scope

The sole public evaluation completed **7,104/7,104 episodes**: **3,552 at each
temperature**, **6,144 known-policy benchmark episodes** and **960 autonomous
dyads**. The scientific stage ran from **24 October 2026 14:10 UTC to 25 October
06:20 UTC**, taking **16.16 hours** including interruption and recovery. No further
paid inference is required. Report, app, replay and website use this campaign only.
Historical development evidence is retained privately and never pooled.

The strongest finding is conditional: **Draft lowers pooled exact benchmark
loss in all four planned model/temperature comparisons, yet worsens loss against
Tit-for-Tat and produces less cooperation in autonomous self-play.** Recognising
simple exploitation opportunities and sustaining contingent reciprocity emerge
as distinct capabilities.

Earlier outcomes informed this prospective design, so this is not an
outcome-naive first study. The primary contrasts and uncertainty rule were fixed
before this campaign's scientific outcomes; the additional diagnostic slices and
hypotheses below were chosen after completion.

## Findings and uncertainty

| Model | Temperature | Direct loss | Draft loss | Draft − Direct | Approximate 98.75% interval |
| ----- | ----------: | ----------: | ---------: | -------------: | --------------------------- |
| Nano  |           0 |      0.6462 |     0.5374 |        −0.1088 | [−0.1640, −0.0577]          |
| Super |           0 |      0.4616 |     0.3720 |        −0.0896 | [−0.1212, −0.0591]          |
| Nano  |           1 |      0.6541 |     0.4861 |        −0.1680 | [−0.2172, −0.1209]          |
| Super |           1 |      0.5988 |     0.3741 |        −0.2246 | [−0.2795, −0.1742]          |

Each mean contains 768 benchmark episodes. All four planned intervals are below
zero. Relative reductions in loss are 16.8%, 19.4%, 25.7% and 37.5%; these are not
percentage gains in earned reward. Use the balanced 16-condition, four-stratum
estimand rather than selecting a favourable opponent or presentation.

### Opponent-specific conclusions

| Opponent         | Nano 0 effect | Super 0 effect | Nano 1 effect | Super 1 effect |
| ---------------- | ------------: | -------------: | ------------: | -------------: |
| Always Cooperate |       −0.5865 |        −0.2094 |       −0.6042 |        −0.5167 |
| Always Defect    |       +0.0068 |        −0.2083 |       −0.1984 |        −0.3385 |
| Grim             |       −0.0958 |        −0.1511 |       −0.1919 |        −0.2151 |
| Tit-for-Tat      |       +0.2404 |        +0.2103 |       +0.3225 |        +0.1717 |

These exploratory effects are Draft minus Direct, averaging four conditions and
192 episodes per arm/opponent/temperature. Gains against Always Cooperate mean
more effective exploitation: D is optimal against its unresponsive C. Super
Draft also nearly eliminates loss against Always Defect. TFT reversals occur at
continuation .6 and .9 and at an announced ten rounds, while .4 improves in all
four comparisons. The .6 oracle alternates; the .9 oracle sustains cooperation.
A single cooperation/defection tendency cannot explain all these errors.
All 16 condition means appear in the app, `conditions.csv` and `diagnostics.json`.

### Temperature

The six planned secondary contrasts are temperature zero minus one:

| Comparison                     |  Change | Nominal approximate 95% interval |
| ------------------------------ | ------: | -------------------------------- |
| Nano Direct                    | −0.0080 | [−0.0480, +0.0316]               |
| Nano Draft                     | +0.0513 | [+0.0199, +0.0815]               |
| Super Direct                   | −0.1372 | [−0.1814, −0.0942]               |
| Super Draft                    | −0.0022 | [−0.0193, +0.0147]               |
| Nano change in Draft − Direct  | +0.0592 | [+0.0099, +0.1084]               |
| Super change in Draft − Direct | +0.1350 | [+0.0876, +0.1849]               |

Super Direct improves at zero; Nano Draft worsens; two arm changes remain near
zero relative to their uncertainty. Both drafting advantages narrow at zero.
These six intervals are nominal, without a secondary-family correction. There
is no uniform preferred temperature across procedures.

### Autonomous cooperation and return

Across all pairings, CC occurs in **330/3,760 rounds (8.8%) at zero** and
**353/3,760 (9.4%) at one**. The means of within-episode CC fractions are 8.9% and
9.8%. Rounds are dependent. Every pairing has 48 dyads and 376 realised rounds.

| Self-play arm | CC rounds at 0 | Joint return at 0 | CC rounds at 1 | Joint return at 1 |
| ------------- | -------------: | ----------------: | -------------: | ----------------: |
| Nano Direct   |         61/376 |            2.7500 |         87/376 |            3.3729 |
| Nano Draft    |         29/376 |            2.5083 |         15/376 |            2.3854 |
| Super Direct  |        124/376 |            3.2063 |         58/376 |            3.1500 |
| Super Draft   |          3/376 |            1.8667 |          9/376 |            2.0792 |

Changing both agents to Draft lowers CC and joint-return point estimates for
each model/temperature. Super's zero-temperature joint-return difference is
−1.3396, with exploratory nominal 95% paired-block interval [−1.8375, −0.9042].
The corresponding differences are −0.2417 [−0.5458, +0.0271] for Nano at zero,
−0.9875 [−1.3063, −0.6958] for Nano at one, and −1.0708 [−1.4208, −0.7521] for
Super at one. These post-viewing self-play comparisons have no multiplicity
correction and change both players together.

Super Direct self-play at zero has no first-round CC, then recovers CC in 82/218
eligible transitions. Super Draft has three CC rounds, 329 DD rounds, and no CC
recovery in 325 opportunities. Initial cooperation and later repair are different
behaviours. All ten pairings, joint-action counts and opportunity denominators
are in `crossplay.csv`, the app and the numeric summary.

The shared realised stopping schedule averages 7.833 rounds, compared with the
geometric population expectation of ten. Constant CC on this schedule gives mean
normalised joint return 4.7000; constant DD gives 1.5667. This explains the scale
of realised returns without treating a sample average as a population bound.

### Presentation and planning diagnostics

At temperature zero, Nano's Draft − Direct effects are −0.4652 and −0.2558 when
X means cooperate, versus +0.1427 and +0.1431 when X means defect, across the two
seats. Each stratum has 12 blocks. All Super stratum effects and Nano's
temperature-one effects favour Draft. Strata have different stopping draws;
this mapping-associated pattern motivates a fully crossed follow-up rather than
isolating a causal label effect.

Only **one of 768** announced-ten-round TFT/Grim episodes follows the optimal
nine-C-then-D path (Super Draft / Grim / zero). Super Draft at zero plays C in
TFT round nine in 43/48 episodes and D in round ten in all 48, but never follows
the complete optimal TFT path. The local endgame pattern coexists with earlier
payoff losses. At continuation .9 against Grim, Super Draft starts with the
optimal C in only 26/48 zero-temperature episodes and 17/48 at one. Full first-action,
finite-path and presentation tables are in `diagnostics.json` and the app.

### Resource and serving observations

Each arm makes 5,236 decisions per temperature across both tracks. Direct has
one successful request per decision; Draft has two. Draft costs approximately
10–12 times Direct within each model. Whole-campaign arm costs include benchmark
and autonomous episodes, so they are not benchmark-only cost-effectiveness ratios.

Successful thinking drafts hit the 1,024-token cap in 1,322/5,236 Nano-zero
requests (25.2%), 2,148/5,236 Nano-one (41.0%), 1,941/5,236 Super-zero (37.1%) and
2,938/5,236 Super-one (56.1%). This is an evaluation of a frequently capped
procedure. Cap status is endogenous and cannot establish the benefit of a larger
budget. Missing provider reasoning-token details are not measured zero reasoning.

Direct request medians range from .36 to .69 seconds; Draft's mixed-phase
request medians range from .96 to 1.98 seconds. A mixed per-request median does
not measure full decision delay or wall-clock throughput. Queueing, both phases,
recovery and cooldowns matter.

Successful responses consistently report the requested model ID and one
fingerprint per model during this campaign. They do not pin weights or hidden
serving state. Models have different listed serving regions and quantisations,
so absolute between-model differences combine model and deployment differences.
Transport-segment loss means are disclosed in `diagnostics.json`; composition
differs, and two episodes span the interruption, preventing a causal recovery comparison.

## Hypotheses and useful next tests

These are explanations to investigate, not established mechanisms. No additional
inference is needed or authorised by this analysis.

1. **Local optimisation outruns contingent planning.** Gains against unresponsive
   policies coexist with TFT reversals and rare optimal finite paths. Compare
   explicit state-transition planning depths at fixed compute; score early and
   continuation choices separately.
2. **Independent defensive play blocks reciprocal repair.** Super Draft's
   zero-temperature self-play never returns to CC in 325 opportunities. Test
   controlled forgiving partners that create known repair opportunities.
3. **Drafting changes presentation habits.** Nano's mapping-associated sign
   reversal motivates crossing every stopping seed with every mapping and seat.
4. **Truncation interacts with sampling and conditioning.** Randomise draft caps
   and add an equal-compute Direct control. Current cap/performance associations
   cannot separate request difficulty, sampling and the two-stage intervention.

## Completion, recovery and accounting

The original session stopped at 3,406 episodes after HTTP 529 overload. An
explicitly approved recovery preserved the entire ledger prefix and completed
the remaining schedule, using six total attempts, one durable 30-minute decision
window, a shared five-minute cooldown, and two sample workers/four requests.
Prompts, models, seeds, scoring, budget and original deadline were retained.
The final record contains **62,832 successful requests plus 20 additional
transmissions**: 17 HTTP 529 responses, one HTTP 502 and two attempts without a
durable HTTP response. No scheduled observation is missing.

| Accounting item                                         |         USD |
| ------------------------------------------------------- | ----------: |
| Final usage-priced inference estimate                   | 17.15200728 |
| Engineering usage-priced estimate                       |  0.63490812 |
| Total recorded campaign inference estimate              | 17.78691540 |
| Unresolved maximum exposure for 20 transmitted attempts |  0.32479584 |
| Total campaign inference maximum exposure               | 18.11171124 |
| Other-charge reserve plus contingency allocation        |        4.00 |
| Authorised additional campaign ceiling                  |       40.00 |

These are recorded-rate estimates and exposure bounds, not provider invoices.
The $40 is additional to historical campaigns; old unused allowances are not
added. No GPU, VM or new cloud resource was provisioned.

On **25 October 2026**, the user approved publication with the $0.32479584 retained
as explicitly uncertain maximum billing exposure. It is neither confirmed paid
nor confirmed free. The original ledger and frozen zero-unresolved-reservations
check remain unchanged. `publication-review.json` records its accounting-only
exception plus the approved head/amount-bound authority; all scientific gates
passed. No reservation was cleared or successful output regenerated.

The campaign is `output/preparation/final-joint-2026-10-24/`; the recovery is
`output/preparation/final-joint-recovery-2026-10-24/`. Their immutable identities:

| Record                            | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| Specification                     | `047b9a5ab172ffb907781aa4601bce01138c434409d97ca362e98fa4944be4bc` |
| Original source index             | `1ed37c1db467149166c32e8ff008fbb552cb2e4741e17af7f38fd5576f261ceb` |
| Recovery amendment                | `6276f6ff189c399a67dba8dc248a8fc8a5031e2e47cd96c3909e99441d604aa8` |
| Recovery source index             | `16d15ecf916d06a0818e8c0ac2e008e8f729de48f73da69f3319532279f6cce4` |
| Completed canonical evidence head | `2c1b475f1e4c5a0c4581072e19a7c7b939cc2be1ca107c10e45c4e1e7b513053` |

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
| ---------- | ------------ | ---------: | -----------: |
| Cooperate  | Cooperate    |          3 |            3 |
| Cooperate  | Defect       |          0 |            5 |
| Defect     | Cooperate    |          5 |            0 |
| Defect     | Defect       |          1 |            1 |

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

Continuation is already in Q\*, and stopping supplies survival weighting; do not
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

| Artifact                                                       | What it provides                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `engineering/events.jsonl`, `final/events.jsonl`               | Authoritative append-only request, accounting, response and joint-reveal chains.                                        |
| Stage `inspect/*.eval`                                         | Native samples, model events, private traces, scored outcomes and joint-reveal events linked to canonical event hashes. |
| `tracking.sqlite`, `tracking-artifacts/`                       | Local MLflow identities, parameters, costs, contrasts and derived artifacts.                                            |
| `export-<head>/summary.json`, `report.md`                      | Reconstructed completion, primary/secondary comparisons, limits and provenance.                                         |
| `episodes.json`                                                | Revealed histories, exact scores, statuses and missingness bounds.                                                      |
| `decisions.csv`, `decisions.parquet`                           | Action, state, payoff, exact gap, cap indicator, estimated cost and measured request durations.                         |
| `requests.csv`, `requests.parquet`                             | Usage, phase, attempt, requested/reported model, provider fingerprint when returned and timing.                         |
| `arms.csv`, `conditions.csv`, `crossplay.csv`, `contrasts.csv` | Complete arm/condition/pairing summaries and uncertainty.                                                               |
| `primary-contrasts.png`, `manifest.json`                       | Rendered primary comparisons and derived-file checksums.                                                                |

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

| Locked dependency    |        Version | Actual role                                                   |
| -------------------- | -------------: | ------------------------------------------------------------- |
| Inspect AI           |        0.3.282 | Native tasks, samples, model events and exact custom scorers. |
| HTTPX                |         0.28.1 | Audited provider HTTP transport and public price check.       |
| NumPy                |          2.5.4 | Deterministic whole-block resampling and diagnostics.         |
| PyArrow              |         26.0.0 | Verified numeric Parquet exports.                             |
| Matplotlib           |         3.11.2 | Primary, condition and autonomous-interaction figures.        |
| MLflow Skinny        |         3.17.1 | Local run parameters, metrics and artifacts.                  |
| SQLAlchemy / Alembic | 2.1.5 / 1.20.0 | Local MLflow database access and schema.                      |

`uv.lock` pins the complete dependency resolution; `runtime.json` records the
actual interpreter, platform and installed distributions. Preserve that environment and its lock for reproduction. No model weights are trained or hosted locally.

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

## Reproduce and inspect

From a new checkout, install the locked Python 3.12 environment, restore the
byte-preserved protocol input, then verify all released action-based results:

```sh
uv sync --frozen --all-extras
uv run python tools/restore_frozen_protocol.py
uv run python tools/verify_public_results.py
```

The verifier reproduces all 7,104 scores, schedule pairing, four primary and six
secondary comparisons, exploratory diagnostics, 41,888 decisions, 62,852 request
records, token-price arithmetic and source/manifest hashes. CSV telemetry is gzip
compressed; Parquet carries the same records. It makes no inference calls.

For the retained private evidence, these read-only commands reconstruct and
check original/recovery provenance, native logs and local MLflow:

```sh
.venv/bin/python -m evaluation_recovery verify output/preparation/final-joint-recovery-2026-10-24
.venv/bin/python -m evaluation_recovery analyse output/preparation/final-joint-recovery-2026-10-24
.venv/bin/python -m evaluation_recovery release-check output/preparation/final-joint-recovery-2026-10-24
```

The last command intentionally still reports unresolved accounting. The explicit
publication amendment was checked separately with `tools/release_final_results.py`
and its private approval record. `public/research/publication-review.json` retains
the resulting review, including the original gate's exact reason. Never clear
reservations to make the original command green. Do not launch completed runs.

`public/research/` contains only this final campaign's numerical package, figures
and TeX/PDF. `summary.json` covers both temperatures;
`temperature-zero/episodes.json` and `temperature-one/episodes.json` contain the
separate action histories. `diagnostics.json` includes post-viewing slices and
nominal exploratory intervals, clearly separated from the planned contrasts.
`schedule.json`, `spec.json`, source indices and provenance identify the design.

A root pytest fixture reconstructs one frozen legacy test’s plan contract in a
temporary directory after the final public-path cutover. It preserves the test
source and introduces no historical observations into public data.

The private evidence retains native model events and traces across both sessions;
checkpoint replay may reappear in a later log while original calls remain in the
earlier session. Scored coverage is verified across the final native record.
Original and recovery tracking receipts bind completed artifacts to the same
final evidence head. MLflow is a repairable projection of the canonical ledger.

A new checkout restores `docs/FINAL_EVALUATION_V2.md` from the immutable
`evaluation_v2/frozen/protocol-2026-10-24.snapshot`. That file is an ignored runtime
compatibility input, not another maintained guide. Preserve both executed source
indices and protocol bytes even after completion.

Reproducibility covers exact saved-action scoring, deterministic offline
resampling, frozen design/source/dependencies and an independent-replication
procedure. Hosted outputs are not guaranteed byte-identical, including at zero.
Public hashes verify integrity; they do not independently authenticate private
provider identity, request history or invoices.

## Interpretation and related work

The findings concern these bounded procedures, prompts, sampled environments
and hosted service window. Approximate primary uncertainty does not guarantee
coverage. Six secondary contrasts and the post-viewing opponent, presentation,
finite-planning, self-play and transport analyses have no family correction.
All scheduled episodes completed, so completion-based missingness bounds collapse
to observed values; bounds on missing schedules are not population intervals.

Rasmusen's _Games and Information_ supplies the repeated-game, best-response and
commitment foundations. The notes retain the book reference and related LLM-game
literature: Akata et al. on repeated games and social chain of thought, Fontana
et al. on model-specific cooperation, Pal et al. on strategies across repeated
game settings, and Taylor and Bergen on communication and deception in other
protocols. The final scientific protocol has no communication or elicited beliefs.
Full citations, mathematical definitions and probability/forecast derivations
remain in the [TeX notes](public/research/paper/main.tex) and
[report (PDF)](public/research/paper/report.pdf).

The app's optional forecasts and recreational Dots & Boxes/Tic-tac-toe features
have separate protocols. Their search/forecast checks provide educational
examples alongside the cooperation results.

References: [Inspect logs](https://inspect.aisi.org.uk/eval-logs.html),
[custom scorers](https://inspect.aisi.org.uk/custom-scorers.html),
[MLflow tracking](https://mlflow.org/docs/latest/tracking/),
[Rasmusen's book materials](https://rasmusen.org/GI/), and the
[provider catalog](https://tokenfactory.nebius.com/api/public/models_info).
