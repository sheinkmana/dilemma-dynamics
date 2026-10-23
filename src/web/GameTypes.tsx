export function GameTypes({ recreational = false }: { recreational?: boolean }) {
  const comparison = (
    <>
      <div className="game-types-grid">
        <section>
          <h3>Repeated Prisoner’s Dilemma</h3>
          <p>
            Both players choose privately, then reveal together. Mutual cooperation earns 3 points
            each; mutual defection earns 1 each. Defecting pays more in a single round, but future
            responses can make cooperation valuable. The total reward can grow for both players.
          </p>
        </section>
        <section>
          <h3>Dots &amp; Boxes</h3>
          <p>
            Players draw edges on a fully visible board; capturing a box earns another move. A
            completed board has a fixed number of boxes to divide. Giving up a box can be a tactic
            for winning more later, rather than a way to increase both players’ final scores.
          </p>
        </section>
        <section>
          <h3>Tic-tac-toe</h3>
          <p>
            Players alternate visible moves to make three in a row. One player’s win is the other’s
            loss, and perfect play produces a draw. The challenge is tactical search and avoiding
            mistakes, rather than sustaining mutually profitable cooperation.
          </p>
        </section>
      </div>
      <p className="game-types-scope">
        The published 1,776-episode study concerns the repeated Prisoner’s Dilemma. Board-game
        matches belong to a separate recreational side project; their scores and solver checks
        answer different questions.
      </p>
    </>
  );

  return (
    <aside className="game-types-context" aria-label="Study and side-project scope">
      {recreational && (
        <>
          <p className="eyebrow">RECREATIONAL SIDE PROJECT</p>
          <h2>Competitive board games</h2>
          <p>
            Explore tactics and search on a fully visible board. These games divide a fixed set of
            boxes or decide a win, loss or draw. The main project examines when both players can
            gain through cooperation in repeated interactions.
          </p>
          <a href="#replay">Explore the cooperation study →</a>
        </>
      )}
      <details>
        <summary>
          {recreational
            ? 'Why are these different kinds of games?'
            : 'How this study differs from the board-game side project'}
        </summary>
        {comparison}
      </details>
    </aside>
  );
}
