# Temperature-zero extension

**Completed, checked 24 October 2026:** the original local attempt stopped at
62 episodes on HTTP 529. A separately identified recovery completed all
**1,776/1,776 episodes** on 23 October, with 17,124 successful requests, zero
retries/failures and $4.47913740 usage-priced final inference. Both temperatures
are now included in the [combined report](../public/research/paper/report.pdf),
[public data](../public/research/README.md), Results and Replay. Interrupted and
engineering observations are excluded. No further inference is needed.

The preparation and launch descriptions below are historical. Preserve all
source, claims, clocks and evidence; do not launch them again.

## Historical preparation and launch record

Prepared 23 October 2026. The completed 22 October study used temperature **1**
for every direct, draft and draft-conditioned action request. Its results remain
valid for that setting. Temperature sensitivity is an additional, unfinished
evaluation; no temperature-zero provider calls have been made by this preparation.

The proposed extension repeats all **24 blocks / 1,776 episodes**, comprising
1,536 benchmark episodes and 240 autonomous dyads. Both exact model IDs, all four
arms, prompts, response limits, top-p 1, mappings, seats, environment seeds,
stopping lengths and interleaved order are retained. Every request phase uses
temperature **0**, including the private draft. The reference schedule is reused
without searching seeds or choosing conditions based on earlier outcomes.

The new plan has its own semantic hash and explicitly binds the temperature-one
reference hash. Episode IDs deliberately match for comparison; evidence must live
in a separate directory. Never merge ledgers, replay old responses into the new
run, reuse an old claim, or renew an old clock. The new gateway records the actual
requested temperature and rejects a mismatch on recovery. Provider acceptance
and behavior still require a fresh temperature-zero engineering check; requesting
zero does not establish repeatability or matched provider randomness.

## Preparation and execution status

Create a new plan offline, using a new output directory:

```sh
uv run gamefield-study temperature-plan output/temperature-zero-plan \
  --reference-plan public/research/plan.json
uv run gamefield-study verify output/temperature-zero-plan/plan.json
```

For engineering, use an original engineering plan as `--reference-plan`; this
produces the same frozen 142-decision bank and 26 interactive-episode check with
temperature zero. A temperature-one engineering report cannot unlock the new
final plan. Synthetic tests are not provider validation.

`temperature-plan` creates an unapproved cloud deployment template for consistency
with the existing planning CLI. It neither claims a campaign nor makes a receipt,
and is **not a local launch bundle**. The completed campaign remains owned by
local execution, so that template cannot authorize cloud execution. No cloud
access, provisioning or GPU is needed or authorized by this extension.

The existing local/successor commands are tied to the earlier studies. Do not
point them at a new temperature plan or clear their guards. The separately
identified `prepare-temperature` / `launch-temperature` route provides the new
local bundle, cumulative accounting, source snapshot, fresh engineering gate,
explicit receipt and bounded clock. It does not reuse earlier claims.

The user approved preparing the full 24-block local bundle within $30. Its
preparation directory is `output/preparation/temperature-zero-local-2026-10-23/`.
Preparation creates an additive authority and engineering receipt, but starts no
clock and makes no provider calls. The final receipt can be created only after
new hosted engineering passes at temperature zero. A successful synthetic check
cannot unlock it. No API key is read during preparation.

From the repository root, verify the prepared bundle offline:

```sh
.venv/bin/python -m gamefield_research.cli verify-temperature \
  "$PWD/output/preparation/temperature-zero-local-2026-10-23"
```

When the user chooses to launch, with `NEBIUS_API_KEY` privately injected into
their shell, this command **makes paid provider calls**:

```sh
bash tools/run-temperature-evaluation.sh \
  "$PWD/output/preparation/temperature-zero-local-2026-10-23"
```

The launcher verifies source/runtime/evidence, runs the 142-decision bank and
26 engineering episodes, checks measured cost and timing, then runs and exports
all 1,776 final episodes. Engineering uses two episode workers to keep simultaneous
conservative draft reservations inside its small allocation. The final uses four
episode workers and at most eight concurrent requests, matching the completed
successor. The process window is at most 12 hours;
final dispatch has a nine-hour bound with a 15-minute shutdown margin. These
limits are separate from the dollar ceiling. Keep the machine awake and the
shell open. No cloud resources or GPU are provisioned.

On interruption, preserve everything. An explicit rerun of the same launcher
uses supported resume with the original clock and caps, and the existing bounded
retry policy (at most three attempts for admitted transient failures). Every
ambiguous transmitted request retains its entire reservation. Recorded successful
responses are replayed rather than requested again. A completed final checkpoint
is exported without further inference. An expired clock cannot be renewed.

The prepared full schedule has **17,124 requests / 11,416 model decisions** before
any retry allowance. The dated price snapshot and existing 2,000-input-token,
maximum-completion scenario forecast **$11.4471**, or **$14.3088** with 25% reserve.
This is an estimate, not a spending guarantee. The temperature-one run recorded
$4.9278 usage-priced inference and approximately 3 hours 8 minutes; temperature-zero
tokens, behavior, latency and cost may differ.

Retained accounting records $6.32674422 of prior campaign inference exposure,
including unresolved predecessor reservations, plus an $8 reserve for other
charges. That leaves $15.67325578 inside the existing **$30 total** before this
extension. The old $18 final-inference allocation has only $11.85418896 remaining,
so the user approved a prospective allocation change within $30 for the full
bundle: **$0.35 new engineering**, **$15.30 new final inference**, with
**$0.02325578 unallocated**. The bundle's conservative forecast uses the retained
engineering telemetry's 2,078 input tokens, giving **$14.60934060** with 25% reserve,
before the $0.50 retry allowance. Both new caps include retry exposure (up to $0.05
engineering and $0.50 final); ambiguous costs remain counted inside the caps.
The allocations and unallocated remainder sum to $30 including all recorded prior
exposure and the $8 other-charge reserve. Public rates were checked against the
[provider's Nemotron pricing](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference)
on 23 October and match the retained price book. This is not an invoice
reconciliation. Do not interpret unused past allowances as a new receipt.
Retention, invoices and independent backup remain user-managed; no charges are erased.

## Analysis fixed before new outcomes

Report direct and draft benchmark loss separately at each temperature and within
each model, retaining the existing 16-condition and four-stratum equal weights.
Estimate draft-minus-direct at temperature zero using the same whole-block
stratified bootstrap (20,000 draws). Six blocks per stratum retain the existing
minimum replication for approximate intervals.

Compare temperature zero with the matched temperature-one data for each arm.
Also report the change in drafting's effect:
`(draft0 - direct0) - (draft1 - direct1)`. For temperature comparisons, resample
the same whole blocks jointly across temperatures within each stratum. Report
opponent-specific reversals and all ten autonomous pairings, with cooperation
kept separate from oracle-loss performance. Do not pool the two temperatures into
one estimate or count the reference observations as new episodes.

These are descriptive sensitivity analyses designed after viewing the earlier
results. Endpoint or backend changes between dates can affect the comparison;
matching environments does not remove this limitation. Preserve incomplete
outcomes and bounds rather than selecting successful episodes.

## Reproducibility

The original design implementation is preserved byte for byte in
`python/gamefield_research/design_v1.py`; the current `design.py` re-exports the
original functions and validates the separately versioned temperature amendment.
The public verifier checks that v1 file against the original executed-source hash.
Scoring, analysis, the lockfile, public plans, data and checksums are unchanged.

```sh
uv run pytest -q
uv run ruff check python python_tests tools
uv run python tools/verify_public_results.py
```

The new offline regression tests exercise all four arms and both request phases,
temperature tampering, recovery refusal, the engineering bank, and complete
mocked runs and exports through both execution paths. They make no paid calls.

Final preparation checks passed on 23 October: **131 Python tests**, Ruff,
publication and whitespace checks, launcher syntax, public result reproduction,
and the original 68-member completed-evidence archive. The new source archive's
33 files match its source index; all 1,776 episodes match the reference schedule.
The dedicated bundle tests also completed a full mocked final and verified a
resume with no additional transmissions. No paid temperature-zero inference or
evaluation clock was started. The source hash is
`9b9d39ad190fbefaac27c52e0cfc84b426b3fbf7fc05423bd0107bace9ec69f1`.

A local `.bundle.tar.gz` and file-hash manifest beside the preparation directory
preserve the new preparation, additive authority, launcher and these instructions.
This copy remains on the same computer. It does not replace the retained original
evidence or an independent backup, and does not automatically restore or rebind
any path, receipt, claim or clock.
