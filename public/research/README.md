# Dilemma Dynamics: two completed temperature studies

*Exploring AI strategies, incentives and cooperation.*

Project: [Dilemma Dynamics](https://github.com/sheinkmana/dilemma-dynamics). Report revised 24 October 2026, by Alisa Sheinkman.

Both matched **24-block / 1,776-episode studies** completed: temperature **1** on
22 October and **0** on 23 October. The package contains **3,552 episodes** in total:
3,072 committed-opponent benchmark episodes and 480 autonomous dyads. It covers the
repeated Prisoner's Dilemma only; the app's board games are a separate side project.

| Model | Temperature | Direct loss | Draft loss | Draft − direct | Approx. 95% interval |
| --- | ---: | ---: | ---: | ---: | --- |
| Nano | 1 | 0.6889 | 0.4942 | −0.1947 | [−0.3077, −0.0983] |
| Super | 1 | 0.6150 | 0.3779 | −0.2371 | [−0.3095, −0.1735] |
| Nano | 0 | 0.7161 | 0.5616 | −0.1545 | [−0.2230, −0.0935] |
| Super | 0 | 0.4718 | 0.3763 | −0.0956 | [−0.1280, −0.0635] |

Lower normalised oracle loss is better. Drafting lowered average loss for both
models at both temperatures, but increased average loss against Tit-for-Tat.
Super Direct improved at zero while Super Draft was nearly unchanged; Super's
Draft advantage narrowed. Nano's change in drafting advantage was uncertain.
Autonomous mutual cooperation was 189/2,060 rounds (9.2%) at 1 and 244/2,060 (11.8%)
at 0. Dependent rounds are not independent trials.

These amended studies and the post-viewing temperature sensitivity analysis are
**descriptive**. Interrupted and engineering observations are excluded. Execution
dates, provider/backend windows and recovery policies differed, confounding
causal attribution to temperature. No general model ranking, universal preferred
temperature or equal-cost reasoning comparison is established. Temperature zero
does not guarantee deterministic hosted inference.

## Public file map

The original temperature-1 data remain byte-preserved at this directory's root.
The additive temperature-0 dataset is in `temperature-zero/`.

| File | Temperature 1 | Temperature 0 |
| --- | --- | --- |
| Summary | [JSON](summary.json) | [JSON](temperature-zero/summary.json) |
| Executed plan | [JSON](plan.json) | [JSON](temperature-zero/plan.json) |
| Revealed episode actions | [JSON](episodes.json) | [JSON](temperature-zero/episodes.json) |
| Condition means | [CSV](condition-losses.csv) | [CSV](temperature-zero/condition-losses.csv) |
| Paired block contrasts | [CSV](block-contrasts.csv) | [CSV](temperature-zero/block-contrasts.csv) |
| Opponent differences | [CSV](policy-effects.csv) | [CSV](temperature-zero/policy-effects.csv) |
| All ten autonomous pairings | [CSV](crossplay.csv) | [CSV](temperature-zero/crossplay.csv) |
| Usage/cost aggregates, both tracks | [JSON](execution-costs.json) | [JSON](temperature-zero/execution-costs.json) |
| Executed source index | [JSON](executed-source-index.json) | [JSON](temperature-zero/executed-source-index.json) |

- [Combined report (PDF)](paper/report.pdf) and [LaTeX source](paper/main.tex)
- [Methods, amendments and limitations](protocol.md)
- Matched temperature changes and drafting interactions: [JSON](temperature-comparison.json), [CSV](temperature-comparison.csv), [figure](figures/temperature-comparison.png)
- [Public file checksums](manifest.json), covering both datasets and the combined report

Episode IDs recur across the matched studies. Use **temperature + episode ID** as
the observation identifier. Each study has 24 blocks, six in each presentation
stratum; do not pool them as 48 independent blocks. The app's Results and Replay
selectors switch temperature, including costs, downloads and provenance. The
default is the latest completed study, temperature 0; its starting replay is
selected by metadata, not outcome. Viewing/filtering makes no inference calls.

## Offline reproduction

From the repository root, with Python 3.12 and uv:

```sh
uv sync --frozen
uv run python tools/verify_public_results.py
```

The verifier reproduces all 3,552 episode scores, four within-temperature primary
intervals, six matched temperature intervals and nine CSVs. It checks the entire
public file set and hashes, schedule identity across temperatures, and scoring,
analysis, design and dependency bytes against each executed source index. The
original design is retained as `python/gamefield_research/design_v1.py`; the
current design validates the separately identified temperature amendment.

Intervals use 20,000 stratified whole-block bootstrap draws, six blocks per
stratum. Within-temperature seeds are `{planSha256}/{model}`. Temperature-change
seeds are `temperature-comparison/1/{plan0Sha256}/{plan1Sha256}/{arm}`; interaction
seeds replace `{arm}` with `{model}/interaction`. Differences are temperature 0
minus 1. A positive interaction means a smaller drafting advantage at zero.
Coverage and power are not established; no multiplicity correction is applied.

The verifier also checks usage-cost arithmetic at the recorded 20 October prices
and request counts against episode decisions. Both successful final runs had
17,124 recorded successful requests and zero retries/failures. Final inference
estimates are $4.92776508 at temperature 1 and $4.47913740 at 0 ($9.40690248 combined),
excluding engineering and failed predecessors. These are usage estimates, not
invoices or benchmark-only cost-effectiveness estimates. Public actions cannot
authenticate provider token counts or billing.

Compile the plain LaTeX report from the repository root:

```sh
latexmk -pdf -outdir=output/paper -jobname=report public/research/paper/main.tex
```

Plans and episode files are unchanged copies from verified exports. Raw provider
responses, private drafts, receipts, source archives and operational records
remain private. Public actions reproduce scores but cannot independently
authenticate provider identity, raw transport or event chains. Checksums detect
changes; they are not signatures. Presentation revisions do not replace frozen
execution evidence. Reference works are cited, not redistributed.
