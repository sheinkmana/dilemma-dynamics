# Game Field: judge walkthrough

Author: Alisa Sheinkman. Suggested track: Best Apps and Agents.

## Free local test build

Use Node 22.18+ or Node 24. From the repository root:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. No API key is needed for this walkthrough.
The recordings are actual published study actions, while the local demonstration
uses labelled simple policies. Neither starts hosted inference.

1. **0:00–0:30 — Study replay.** Choose **Explore a recorded Nemotron interaction**.
   The default shows Nano Direct against Tit-for-Tat, block 1, ten announced
   rounds. Reveal two or three rounds; inspect both actions and cumulative points.
2. **0:30–0:50 — Compare procedures.** Choose **Nemotron Nano · Draft** to inspect
   the matched condition and block. This changes the recorded episode; it does not
   generate a new result. One trajectory is illustrative, not a general comparison.
3. **0:50–1:20 — Results.** Inspect the two average benchmark-loss contrasts and
   the Tit-for-Tat reversal. Open the scoring example, then inspect the full
   pairing table and procedure costs. Lower own-payoff loss is not a cooperation score.
4. **1:20–2:00 — Dilemma and Analysis.** Return to Dilemma, run the free ten-round
   local demo, then open Analysis. Inspect immediate incentives and completed
   history. The simple policies supply no model forecasts; “Not elicited” is intentional.

For a longer look, choose **Learn the game**, explore alternative study conditions
and blocks, or download the report/data. Dots & Boxes and Tic-tac-toe are secondary
recreational examples.

## Static viewing option

After the build, `npm run preview` serves the built files locally. Open
**http://127.0.0.1:4173/#replay** or **http://127.0.0.1:4173/#results**.
Those routes work without the API server. The live Dilemma/Analysis sessions need
the local server. A static build must not be described as a hosted live model service.

## Optional live Nemotron play

Set `NEBIUS_API_KEY` in the ignored `.env` using `.env.example`, restart the server,
and refresh models. Select two available priced models and an estimated session
limit, then explicitly start. This incurs Token Factory usage. The reviewer does
not need to do this to inspect the released study or complete the free walkthrough.
Live play uses temperature 0 and reasoning requested off, unlike the study.

## Public video script (target 2m45s)

Record the application, with narration in English. Do not show keys, terminal
environment dumps, personal paths, or private evidence. Add the final YouTube URL
to the README and Devpost only after the video is publicly available.

| Time | Show | Suggested narration |
| --- | --- | --- |
| 0:00–0:20 | Dilemma welcome | “Game Field is a lab for students and AI builders to examine how agents respond to incentives. We separate what a model chose, what it reported, and what the evidence can establish.” |
| 0:20–0:55 | Recorded Nano episode; reveal rounds | “These are saved NVIDIA Nemotron actions from our completed Token Factory study. Both choices were private until joint reveal. Replay requires no API key.” |
| 0:55–1:20 | Switch to matched Draft episode; procedure details | “Direct uses one action request. Draft adds a capped thinking request before a separate action. A single replay illustrates the protocol; it does not establish the average effect.” |
| 1:20–1:55 | Results and opponent table | “Across 1,776 completed episodes, drafting reduced mean benchmark loss for both models, but worsened average loss against Tit-for-Tat. These are descriptive findings from an amended run.” |
| 1:55–2:20 | Pairing table and costs | “Better own-payoff decisions are distinct from cooperation. We publish every pairing and the extra inference cost, rather than claiming a universal winner.” |
| 2:20–2:45 | Local demo/Analysis, report and verification links | “The app explains incentives, preserves replays and limits estimated spending. Nebius hosts Nano and Super inference; our CPU coordinator validates decisions and our Python pipeline reproduces the released scores offline.” |

If adding live model footage, capture a separately authorised short app session
and label it accurately. Do not relaunch the completed scientific evaluation.
