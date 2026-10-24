# Devpost submission preparation

Updated 24 October 2026. Author: **Alisa Sheinkman**.
Suggested category: **Best Apps and Agents**.

Repository: [Dilemma Dynamics](https://github.com/sheinkmana/dilemma-dynamics).
Public visibility and the final remote revision must be checked before submission.
Hosted demo/public repository revision: **not verified for this release**.
Public YouTube video URL: **not supplied**.
The [local test build and judge walkthrough](JUDGE_WALKTHROUGH.md) are ready for use.

The author confirmed that Dilemma Dynamics began after 26 August 2026, the start of
the submission period. No pre-period project work is claimed.

## Description draft

### Inspiration and audience

An agent can earn more points while cooperating less. Dilemma Dynamics makes that
distinction visible for students learning strategic incentives and AI builders
examining agent decisions. It is an interactive laboratory, with explicit limits
on what one observed interaction can tell us about a model's strategy or beliefs.
Educational outcomes and performance in real-world negotiations remain untested.

### What it does

Watch simultaneous Prisoner's Dilemma decisions, inspect payoffs and reported
forecasts, replay any of 3,552 published episodes across temperatures 1 and 0, and explore results with
opponent-level breakdowns and procedure costs. An introductory ten-round local
demo and lessons work without a key. Live Nemotron play uses a server-side key
and explicit estimated spending limits.

A separate recreational side project offers Dots & Boxes and Tic-tac-toe for
exploring competitive tactics and search. Those games have visible sequential
moves and opposing objectives: a fixed set of boxes to divide, or a win/loss/draw.
The dilemma instead uses private simultaneous choices each round and permits
mutual gains from cooperation. The two published 1,776-episode studies concern the
dilemma; board-game sessions are outside that evaluation.

### How it works

The React interface connects to a local Fastify coordinator and SQLite store.
Nebius Token Factory serves NVIDIA Nemotron 3 Nano and Super. The coordinator
validates structured decisions, keeps current actions private until both are
ready, reserves estimated costs and retains request accounting across interruptions.
A separate Python pipeline implements frozen evaluation schedules, exact scoring
against committed opponents and offline reproduction of published results.

### What we found

Two matched 24-block evaluations completed, with 1,776 episodes at each of
temperatures 1 and 0. Drafting lowered average benchmark loss for both models at
both temperatures: Nano's Draft-minus-Direct loss was −0.1947 at 1 and −0.1545
at 0; Super's was −0.2371 and −0.0956. Super's drafting advantage narrowed as
Direct improved at zero while Draft was nearly unchanged. Nano's change in the
advantage was uncertain. Against Tit-for-Tat, drafting worsened average loss
at both temperatures. Autonomous mutual cooperation was 189/2,060 rounds (9.2%)
at 1 and 244/2,060 (11.8%) at 0; dependent rounds are not independent trials.

These are descriptive amended studies after inspection of interrupted outcomes.
Interrupted and engineering episodes are excluded. Different dates, backend
windows and recovery policies confound causal temperature attribution. Drafting
changes compute, request count, thinking settings and conditioning together.
The report includes approximate intervals, matched changes and limitations.

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
Earlier HTTP 502 and 529 responses interrupted separate evaluations; recovery required durable responses,
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

## Requirements checked 24 October 2026

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) list the
submission deadline as **30 October 2026, 10:00 a.m. Pacific Time**. Best Apps
and Agents remains the suggested track. The project must make a runtime Token
Factory call or run on eligible Nebius compute and use an NVIDIA open model;
Serverless deployment is encouraged, not required for this track. The released
local app implements runtime Token Factory calls; the static replay is a free
viewing path. Provide a public open-source repository, a working demo/test-build
URL, project description, tool feedback and a public YouTube demonstration shorter
than three minutes. Confirm the actual URLs and final form before submission.

## Final submission checklist

- Confirm the selected category in Devpost.
- Review [current requirements](https://nebiusglobalaihackathon.devpost.com/) and
  [official rules](https://nebiusglobalaihackathon.devpost.com/rules) before submitting.
- Publish only the intended repository branch/history using [publication notes](PUBLICATION.md).
  Confirm anonymous access, visible MIT license, and the intended final revision.
- Supply a working demo or test-build URL with the free testing instructions.
  A public static recording/results site is an optional viewing convenience;
  the current localhost server must not be exposed as a public service.
- Record and publish a public YouTube video shorter than three minutes showing the project
  and how NVIDIA models and Nebius were used. Follow the [script](JUDGE_WALKTHROUGH.md).
- Add the real demo/test-build and video URLs to the README and submission.
- Include the technology feedback above after author review.
- Include the author-confirmed development timing: Dilemma Dynamics began after
  26 August 2026. The project includes the initial game app, autonomous Dilemma,
  both completed temperature evaluations, and subsequent presentation improvements.
- Review screenshots and video for private material. Do not include private raw
  evidence, account-specific handoffs, or reference PDFs.

This file is a prepared draft and checklist, not a claim that Devpost submission,
hosting, video publication or repository visibility changes have occurred.
