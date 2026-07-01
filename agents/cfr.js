// ---------------------------------------------------------------------------
// Counterfactual-regret minimisation (CFR+) for a two-player zero-sum matrix
// game — the equilibrium engine behind ObscuroAgent (generic and chess-specific).
//
// This is a deliberately small, self-contained analogue of the PCFR+ solver in
// Zhang & Sandholm's Obscuro (the superhuman Fog-of-War chess agent). The full
// system grows an extensive-form game tree and solves it with predictive CFR+;
// here we solve a single normal-form (matrix) game per move, which is enough to
// produce the paper's signature behaviour: a *mixed* strategy that randomises
// and bluffs when the opponent cannot pin down our hidden state, and collapses
// to a pure best response when it can.
//
// M[i][j] is the payoff to the ROW player (the maximiser — us) when we play row
// i and the opponent plays column j. The column player is the minimiser. Both
// players' average strategies converge to a Nash equilibrium; CFR+ (regret
// matching with regrets floored at zero) converges quickly in practice.
//
// The solver is game-agnostic — it only ever sees a numeric matrix — so it is
// shared by the chess agent and the generic, all-games ObscuroAgent.
// ---------------------------------------------------------------------------

// Strategy proportional to positive regret; uniform when no regret is positive.
function regretMatch(regret) {
  const n = regret.length;
  const s = new Float64Array(n);
  let pos = 0;
  for (let i = 0; i < n; i++) if (regret[i] > 0) { s[i] = regret[i]; pos += regret[i]; }
  if (pos > 0) for (let i = 0; i < n; i++) s[i] /= pos;
  else         for (let i = 0; i < n; i++) s[i] = 1 / n;
  return s;
}

function normalise(sum) {
  const n = sum.length;
  let tot = 0;
  for (let i = 0; i < n; i++) tot += sum[i];
  const out = new Array(n);
  if (tot > 0) for (let i = 0; i < n; i++) out[i] = sum[i] / tot;
  else         for (let i = 0; i < n; i++) out[i] = 1 / n;
  return out;
}

/**
 * Solve the zero-sum matrix game M with CFR+.
 * @param {number[][]} M  row-major payoff matrix to the row (maximising) player
 * @param {number} iterations
 * @returns {{ row: number[], col: number[], value: number }}
 *   `row` / `col` are the players' average (equilibrium) strategies; `value` is
 *   the game value to the row player under those strategies.
 */
export function solveMatrixGame(M, iterations = 400) {
  const rows = M.length;
  const cols = rows > 0 ? M[0].length : 0;
  if (rows === 0 || cols === 0) return { row: [], col: [], value: 0 };

  const regretR = new Float64Array(rows);
  const regretC = new Float64Array(cols);
  const sumR = new Float64Array(rows);
  const sumC = new Float64Array(cols);

  for (let t = 0; t < iterations; t++) {
    const sR = regretMatch(regretR);
    const sC = regretMatch(regretC);
    for (let i = 0; i < rows; i++) sumR[i] += sR[i];
    for (let j = 0; j < cols; j++) sumC[j] += sC[j];

    // Value of each row against the column strategy, the expected value of the
    // current profile, and the value of each column against the row strategy.
    const rowVal = new Float64Array(rows);
    const colVal = new Float64Array(cols);
    let ev = 0;
    for (let i = 0; i < rows; i++) {
      let v = 0;
      for (let j = 0; j < cols; j++) v += M[i][j] * sC[j];
      rowVal[i] = v;
      ev += sR[i] * v;
    }
    for (let j = 0; j < cols; j++) {
      let v = 0;
      for (let i = 0; i < rows; i++) v += M[i][j] * sR[i];
      colVal[j] = v;
    }

    // CFR+ regret update: accumulate counterfactual regret, floored at zero.
    // Row player maximises payoff; column player minimises it.
    for (let i = 0; i < rows; i++) regretR[i] = Math.max(0, regretR[i] + rowVal[i] - ev);
    for (let j = 0; j < cols; j++) regretC[j] = Math.max(0, regretC[j] + ev - colVal[j]);
  }

  const row = normalise(sumR);
  const col = normalise(sumC);
  let value = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) value += row[i] * M[i][j] * col[j];
  return { row, col, value };
}
