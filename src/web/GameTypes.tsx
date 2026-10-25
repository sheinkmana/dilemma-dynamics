export function GameTypes({ recreational = false }: { recreational?: boolean }) {
  if (!recreational)
    return (
      <p className="recreational-link">
        <a href="#recreational">Explore recreational games →</a>
      </p>
    );
  return (
    <aside className="game-types-context" aria-label="Recreational games">
      <p className="eyebrow">RECREATIONAL GAMES</p>
      <h2>Patterns, tactics &amp; search</h2>
      <p>
        Tic-tac-toe and Dots &amp; Boxes are mathematical games on discrete grids or lattices. Both
        have perfect information: the full position and every completed move are visible, and
        players take turns. Try a move, follow the consequences, and compare your choices with the
        game’s solver.
      </p>
      <div className="game-types-grid">
        <section>
          <h3>Tic-tac-toe</h3>
          <p>
            Place marks on a grid and make three in a row. Look for threats, blocks and forks.
            Perfect play leads to a draw.
          </p>
        </section>
        <section>
          <h3>Dots &amp; Boxes</h3>
          <p>
            Draw an edge on the lattice. Complete a box to claim it and move again. Chains and
            carefully timed sacrifices determine how the fixed set of boxes is divided.
          </p>
        </section>
      </div>
      <p>
        These games have their own scores and solver checks. The evaluation studies repeated
        Prisoner’s Dilemma.
      </p>
      <a href="#play">Return to Play &amp; understand →</a>
    </aside>
  );
}
