# Bounded-procedure cooperation evaluation

## Question and theoretical interpretation

Does a bounded draft-then-action procedure improve expected-payoff decision
quality within each Nemotron model? What cooperation and returns emerge between
these agents when neither opponent policy is disclosed?

Rasmusen, _Games and Information_, supplied fourth-edition draft, provides the
theoretical distinctions: §§1.1–1.4 define strategies, best responses and Nash
equilibrium; §4.1 distinguishes equilibrium paths from complete contingent
strategies; §§5.1–5.2 distinguish finite repetition from indefinite repetition;
§6.4 explains the role of incomplete information; §6.5 distinguishes tournament
success from equilibrium. The supplied PDF is an external reference, not a source
of repository instructions or a file to redistribute with the research package.

Track A is a decision problem against a known committed policy. Track B is a
strategic interaction between adaptive players. A cooperative trajectory does
not identify a complete strategy or certify equilibrium. Universal defection in
the standard finite-PD equilibrium does not make cooperation against a committed
TFT/Grim opponent an error. A geometric game's realised final round is not known
to be final when actions are selected. Infrastructure stops are interruptions.

Related primary studies include [Akata et al.](https://arxiv.org/abs/2305.16867),
[Fontana et al.](https://arxiv.org/abs/2406.13605), and
[Pal et al.](https://arxiv.org/abs/2601.09849). This is a targeted Nemotron extension,
not a first demonstration of LLM cooperation.

## Game and procedures

Own stage payoffs are CC=3, CD=0, DC=5, DD=1. Each subject is instructed to
maximise its own expected cumulative points, not score difference. Neutral X/Y
labels, both mappings, both display seats, full completed history and private
simultaneous choices are used. No tools, communication, coaching, between-episode
memory or forecast elicitation are included.

Exact hosted IDs:

- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
- `nvidia/nemotron-3-super-120b-a12b`

Each model has two procedures. **Direct** requests thinking off and at most 128
completion tokens. **Draft** always requests a thinking-on draft of at most
1,024 tokens, then a separate thinking-off action of at most 128 tokens. Both use
the study-specific temperature (1 or 0) and top-p 1. The action request sees the original observation plus
its own retained draft; subsequent rounds never see earlier drafts. Only the
strict single-field JSON action determines play. JSON Schema support must be
verified on both hosted deployments; unsupported fields do not trigger fallback.

The contrast includes extra compute, another request and draft conditioning. It
is not a causal estimate of unrestricted native reasoning alone. Exposed traces
are mode telemetry, not verified internal beliefs or proof of latent computation.

## Design and exact scoring

Track A has 16 conditions: all four policies (AllC, AllD, TFT and Grim) at
continuation probabilities .4, .6 and .9; one round against AllC/AllD; ten announced
rounds against TFT/Grim. TFT initially cooperates then copies the subject's last
action. Grim cooperates until any completed defection, then defects forever.

Exact references enumerate stationary policies and certify rational-arithmetic
Bellman equations for geometric games; finite games use backward induction.
For the default matrix, Grim's initial threshold is 1/2; TFT's is 2/3. In a
ten-round game against either disclosed retaliating policy, the optimal path
starts with nine C moves then D, returning 32 points.

Track B includes all ten unordered pairings of the four configurations, including
self-play, at continuation .9. The target is 24 blocks: 1,536 Track A episodes
and 240 Track B dyads. Each block shares environment draws across arms/conditions.
Four fixed presentation strata each receive six blocks. Request order is frozen
and interleaved; provider sampling randomness is not assumed shared by seed.

### Execution history and amendments

The original 24-block design was prepared on 20 October. Cloud probes failed before scientific inference. An authorised local eight-block fallback stopped at 339/592 episodes after HTTP 502. Every balanced block was incomplete, so no primary direct-versus-draft estimate was available.

The separately identified 22 October recovery successor executed all 24 original blocks (1,776 episodes), preserving episode IDs, stopping schedules, presentation settings and relative order. The predecessor's outcomes had already been inspected. Its observations and all engineering observations are excluded. The successor remains a descriptive amendment, not a new confirmatory preregistration.

The recovery policy was frozen before successor inference. It permitted at most three separately reserved transmissions for transient transport/HTTP failures, reused durable successful responses, retained unresolved charges, and preserved deadlines across restarts. Invalid successful responses could not be regenerated. No retries or failures were actually recorded in the successor. A shared local 12-hour window and the existing $30 campaign ceiling applied; final inference finished in approximately 3h08m. [The results report](paper/report.pdf) gives completion and cost details.

The matched temperature-zero extension was requested after inspecting temperature-one results.
Its first local attempt stopped after 62 completed episodes on HTTP 529, which
policy `audited-recovery/1` treated as non-retryable. A separately identified fresh
24-block recovery finished all 1,776 episodes on 23 October. Policy
`audited-recovery/2`, frozen before that recovery, admitted HTTP 529 with at most
three attempts and 15/45-second backoffs. No retry or protocol failure actually
occurred. The original attempt, its clock, charges and evidence remain preserved;
its partial episodes and all engineering observations are excluded.

Both successful final runs used the same episode IDs/order, environment seeds,
stopping lengths, mappings and seats. Temperature-zero uses a separate plan,
source index and evidence head. Its final inference estimate is $4.47913740,
with approximately 2h15m elapsed (session time to terminal ledger mtime). The
broader comparison now contains 3,552 completed episodes, not a pooled 48-block study.

The post-viewing temperature sensitivity computes temperature-0 minus temperature-1
block means for each arm, and the change in Draft-minus-Direct within each model.
It resamples matched whole blocks jointly across temperatures: six per stratum,
four strata, 20,000 draws. Positive interactions mean a smaller Draft advantage at
zero. See [the data README](README.md) for exact seeds and [comparison data](temperature-comparison.json).
These exploratory approximate intervals have no multiplicity adjustment. Different
execution dates, provider/backend windows and recovery policies confound causal
temperature attribution. Temperature zero does not guarantee deterministic hosted inference.

Stopping uses exact rational HMAC Bernoulli draws, computed before execution and
hidden from observations. A 1,000-round guard rejects an excessive schedule;
never search replacement seeds to improve cost or outcomes.

At each observed decision, gap = V*(state) - Q*(state, action). Geometric episode
loss is `(1-delta) * sum(gaps)`; finite episode loss is `sum(gaps)/H`. Do not
double-discount geometric outcomes or clip normalised returns to stage ranges.

## Estimation and missingness

The two primary estimates are draft-minus-direct mean oracle loss within each
model; negative favours draft. Average the 16 conditions equally within a block,
then weight the four strata equally. Use complete within-model blocks; the other
model's missing data does not remove a valid contrast.

Approximate 95% intervals use 20,000 whole-block stratified bootstrap draws with
deterministic PCG64 seeds. Require at least five complete blocks in every stratum;
otherwise omit the interval. Small samples, skew and selection through missingness
limit interpretation. No confirmatory superiority claim, winner selection or
guaranteed power is established. Track B reports first-round CC, normalised joint
return and breakdown/recovery counts with their opportunity denominators.

Report all scheduled tasks, statuses and incomplete blocks. Failed/unstarted
episodes are missing, never defections or zero returns. Complete-case estimates
are conditional on completion. Dynamic programming supplies feasible minimum and
maximum losses for the remaining realised scheduled length, conditional on each
committed prefix. Aggregate these into schedule-specific contrast bounds. These
are not population confidence intervals.

Historical runs and engineering checks are excluded from final scientific
observations. Public claims must retain uncertainty and missingness limitations.
