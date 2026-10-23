# Devpost submission preparation

Prepared 23 October 2026. Author: **Alisa Sheinkman**.
Suggested category: **Best Apps and Agents**.

Repository: [Game Field](https://github.com/sheinkmana/game-field).
Public visibility and the final remote revision must be checked before submission.
Hosted demo: **not yet published**. Public YouTube video: **not yet published**.
The [local test build and judge walkthrough](JUDGE_WALKTHROUGH.md) are ready for use.

The author confirmed that Game Field began after 26 August 2026, the start of
the submission period. No pre-period project work is claimed.

## Description draft

### Inspiration and audience

An agent can earn more points while cooperating less. Game Field makes that
distinction visible for students learning strategic incentives and AI builders
examining agent decisions. It is an interactive laboratory, with explicit limits
on what one observed interaction can tell us about a model's strategy or beliefs.
Educational outcomes and performance in real-world negotiations remain untested.

### What it does

Watch simultaneous Prisoner's Dilemma decisions, inspect payoffs and reported
forecasts, replay any of 1,776 published study episodes, and explore results with
opponent-level breakdowns and procedure costs. An introductory ten-round local
demo and lessons work without a key. Live Nemotron play uses a server-side key
and explicit estimated spending limits. Recreational games are secondary examples.

### How it works

The React interface connects to a local Fastify coordinator and SQLite store.
Nebius Token Factory serves NVIDIA Nemotron 3 Nano and Super. The coordinator
validates structured decisions, keeps current actions private until both are
ready, reserves estimated costs and retains request accounting across interruptions.
A separate Python pipeline implements frozen evaluation schedules, exact scoring
against committed opponents and offline reproduction of published results.

### What we found

In the completed descriptive evaluation, bounded drafting reduced average
benchmark loss for Nano and Super, but increased average loss against Tit-for-Tat.
Autonomous mutual cooperation occurred in 189 of 2,060 observed rounds. The
study was amended after an interrupted predecessor whose outcomes were inspected;
the report makes that history and the limitations explicit. The comparison changes
compute, request count, thinking settings and draft conditioning together.

### Challenges and learning

Transport failures can leave a billed request without a usable local result.
We preserved failed runs, treated missing decisions as missing, retained uncertain
charges, and separated recovery authority from prior run claims. Cloud job probes
failed before scientific inference; the completed evaluation used local CPU
coordination and remote Token Factory inference. No claim of successful Serverless
Job deployment is made.

### Technology feedback

Token Factory's common chat interface let the project compare two Nemotron models
without maintaining GPU servers. Usage reporting enabled per-request accounting.
An earlier HTTP 502 interrupted evaluation; recovery required durable responses,
bounded attempts and conservative handling of uncertain billing. Clearer request
reconciliation for interrupted calls would help budget-sensitive experiments.
The CPU Serverless path encountered quota and image/storage configuration gates;
clearer preflight diagnostics would improve the onboarding path. These observations
refer to this project's dated experience, not a general availability assessment.

### Contribution and next steps

The contribution combines inspectable agent play with exact own-payoff loss
against committed policies, matched bounded-procedure comparisons in two Nemotron
deployments, and a public action dataset with offline verification. LLM cooperation
itself is not a new research finding. Future work could evaluate learner outcomes
and broaden environments; it is not part of the completed study's claims.

## Final submission checklist

- Confirm the selected category in Devpost.
- Review [current requirements](https://nebiusglobalaihackathon.devpost.com/) and
  [official rules](https://nebiusglobalaihackathon.devpost.com/rules) before submitting.
- Publish only the intended repository branch/history using [publication notes](PUBLICATION.md).
  Confirm anonymous access, visible MIT license, and the intended final revision.
- Supply a working demo or test-build URL with the free testing instructions.
  A public static recording/results site is an optional viewing convenience;
  the current localhost server must not be exposed as a public service.
- Record and publish a YouTube video of at most three minutes showing the project
  and how NVIDIA models and Nebius were used. Follow the [script](JUDGE_WALKTHROUGH.md).
- Add the real demo/test-build and video URLs to the README and submission.
- Include the technology feedback above after author review.
- Include the author-confirmed development timing: Game Field began after
  26 August 2026. The project includes the initial game app, autonomous Dilemma,
  the completed evaluation, and subsequent presentation improvements.
- Review screenshots and video for private material. Do not include private raw
  evidence, account-specific handoffs, or reference PDFs.

This file is a prepared draft and checklist, not a claim that Devpost submission,
hosting, video publication or repository visibility changes have occurred.
