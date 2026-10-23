# Cooperation study and board-game side project

Dilemma Dynamics centres on **cooperation and incentives in the repeated
Prisoner's Dilemma**. The local app also includes a separate recreational side
project with **Dots & Boxes and Tic-tac-toe**, exploring tactical play, search
and decision inspection. All three involve strategy, but their incentives and
information differ.

| Question | Repeated Prisoner's Dilemma | Dots & Boxes | Tic-tac-toe |
| --- | --- | --- | --- |
| How are actions taken? | Both players choose privately, then reveal together each round. | Players draw one visible edge at a time; a capture retains the turn. | Players alternate visible moves. |
| What does a player seek? | Its own expected cumulative points across rounds. | More boxes than the opponent on the completed board. | A win; a draw is preferable to a loss. |
| Can both improve their returns together? | Yes: mutual cooperation gives 3 each, while mutual defection gives 1 each. | The completed board has a fixed number of boxes to divide. | Under standard win/draw/loss utility, one player's gain is the other's loss. |
| What is being explored? | Immediate temptation, future responses, reciprocity and whether cooperation persists. | Captures, extra turns, chains, loops and control of the endgame. | Threats, blocking, tactical search and avoiding forced losses. |

## Why the dilemma is a different strategic problem

In one Prisoner's Dilemma round, defection earns more whatever the other player
chooses: 5 instead of 3 against cooperation, or 1 instead of 0 against defection.
Yet mutual cooperation gives both players more than mutual defection. This
combination makes it a **non-zero-sum social dilemma**. In repeated play, an
opponent's future responses can make cooperation valuable to a player pursuing
its own total points. Cooperation is an outcome to examine, not the scoring
objective or an automatic sign of good play.

Each round's current choice is hidden until joint reveal; completed history is
visible. The board games instead have **perfect information**: players see the
position and earlier moves before choosing. This concerns visibility of actions,
not whether a model's policy or internal reasoning is known.

## Why a board-game sacrifice is different from cooperation

Dots & Boxes is **constant-sum at normal completion**: all boxes are claimed,
so one player's extra box is one fewer for the opponent. Expressing utility as
the final score difference makes it zero-sum. A player may deliberately give
away boxes to retain control and capture more later. That is a tactic for
improving its final result; it does not increase the fixed total available to
both players. Extra moves after captures are part of the same board game,
rather than repeated Prisoner's Dilemma rounds.

Tic-tac-toe is conventionally a **zero-sum game** with win/draw/loss utilities
of +1/0/−1. Perfect play draws. The app's displayed 1–0 win and 0–0 draw scores
are result labels; they do not create the cooperation incentives of the dilemma.

## What the evidence covers

The published **1,776-episode study** concerns the repeated Prisoner's Dilemma.
Its decision-loss and cooperation findings do not measure board-game strength.
The recreational side project's rule tests, bounded solver checks and dated
endpoint acceptance matches establish different things; they are not another
completed cooperation study or a model ranking.

The public website demo includes saved dilemma episodes and Results only.
The full local app additionally offers live dilemma sessions and the board-game
side project, labelled **Board games · side project**. Its existing
`#recreational` route remains compatible with saved links.

For details, see the [study methods](../public/research/protocol.md),
[board-game evaluation methods](RECREATIONAL_METHODS.md) and
[dated recreational checks](RECREATIONAL_VERIFICATION.md).
