// Civ1 heuristic agent. See AI-DESIGN.md for the sourcing and the rationale.
//
// This is the greedy agent's structure (demo/civ1-demo.js) with its two worst
// defects fixed: it measures distance with the metric the board actually uses,
// and it only attacks when the attack is worth making.
//
// Attack scoring follows Freeciv's kill_desire (doc/README.AI):
//   profit = shields_destroyed * P(win) - shields_risked * P(lose)
// valued in shields (unit build cost) and discounted for the turns spent getting
// there, via their amortize(). Civ1's own AI scored moves too, but the published
// reverse-engineering never recovered its weights, so we use Freeciv's.

import { UNITS } from './units.js';
import { getCombatStrengths } from './combat.js';
import { chebyshevWrapped } from './Civ1Game.js';

// Freeciv README.AI: amortize(benefit, delay) = benefit * ((MORT-1)/MORT)^delay,
// discounting a future payoff to its present value (MORT=24 ~ 4.3% per turn).
const MORT = 24;
export function amortize(benefit, delay) {
  return benefit * Math.pow((MORT - 1) / MORT, Math.max(0, delay));
}

/**
 * Probability the attacker wins the whole HP race, given per-round win chance
 * `p`. Civ1 combat is rounds of a Bernoulli trial; the loser of each round takes
 * 1 damage (firepower is always 1), so this is a race to zero. Exact, via the
 * recurrence f(a,d) = p*f(a,d-1) + (1-p)*f(a-1,d) — HP tops out at 30, so the
 * table is tiny.
 */
export function winProbability(p, atkHp, defHp) {
  if (atkHp <= 0) return 0;
  if (defHp <= 0) return 1;
  // prev[a] = f(a, d-1), cur[a] = f(a, d)
  let prev = new Array(atkHp + 1).fill(1);
  prev[0] = 0;
  let cur = prev;
  for (let d = 1; d <= defHp; d++) {
    cur = new Array(atkHp + 1);
    cur[0] = 0;
    for (let a = 1; a <= atkHp; a++) {
      cur[a] = p * prev[a] + (1 - p) * cur[a - 1];
    }
    prev = cur;
  }
  return cur[atkHp];
}

const shieldValue = unit => UNITS[unit.type]?.cost ?? 10;

/**
 * Freeciv's kill_desire, in shields: what we stand to destroy times our chance
 * of destroying it, less what we stand to lose times the chance we lose it.
 * `delay` is turns until the blow lands (0 for an attack available right now).
 */
export function killDesire(attacker, defender, state, delay = 0) {
  const { att, def } = getCombatStrengths(attacker, defender, state);
  const p = att / (att + def);
  const P = winProbability(p, attacker.hp, defender.hp);
  const profit = shieldValue(defender) * P - shieldValue(attacker) * (1 - P);
  return { want: amortize(profit, delay), P };
}

// Don't trade into a coin flip: a won fight still costs HP, and the defender is
// usually the one sitting on the terrain bonus. Tunable — see AI-DESIGN.md.
const MIN_WIN_PROB = 0.5;

// The original greedy agent, kept verbatim as the baseline to measure against:
// attack whenever legal, settle whenever legal, else close on the nearest target
// by Manhattan distance. Both of those first two are why it loses.
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function makeGreedyAgent({ id = 'greedy' } = {}) {
  return {
    id,
    chooseAction(state, legalActions) {
      const attack = legalActions.find(a => a.type === 'attack');
      if (attack) return attack;

      const found = legalActions.find(a => a.type === 'found-city');
      if (found) return found;

      const myId = state.activePlayers[0];
      const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
      const enemyCities = state.cities.filter(c => c.ownerId !== myId);
      const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length && targets.length) {
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }

        let bestMove = null, bestScore = Infinity;
        for (const [, unitMoves] of byUnit) {
          const from = unitMoves[0].from;
          const nearest = targets.reduce((b, t) => manhattan(from, t) < manhattan(from, b) ? t : b, targets[0]);
          for (const m of unitMoves) {
            const d = manhattan(m.to, nearest);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        const center = { x: state.board.width / 2, y: state.board.height / 2 };
        return moves.reduce((best, m) => manhattan(m.to, center) < manhattan(best.to, center) ? m : best);
      }

      return { type: 'end-turn', unitId: '__player__' };
    },
  };
}

export function makeCiv1Agent({ id = 'heuristic', minWinProb = MIN_WIN_PROB } = {}) {
  return {
    id,
    chooseAction(state, legalActions) {
      const W = state.board.width;
      const myId = state.activePlayers[0];
      const unitById = new Map(state.units.map(u => [u.id, u]));

      // ── Attack: only when the exchange pays for itself ──────────────────
      let bestAttack = null, bestWant = 0;
      for (const a of legalActions) {
        if (a.type !== 'attack') continue;
        const attacker = unitById.get(a.unitId);
        const defender = unitById.get(a.targetId);
        if (!attacker || !defender) continue;
        const { want, P } = killDesire(attacker, defender, state);
        if (P < minWinProb) continue;
        if (want > bestWant) { bestWant = want; bestAttack = a; }
      }
      if (bestAttack) return bestAttack;

      const found = legalActions.find(a => a.type === 'found-city');
      if (found) return found;

      // ── Move: close on the nearest target, in turns rather than tiles ────
      const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
      const enemyCities = state.cities.filter(c => c.ownerId !== myId);
      const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length && targets.length) {
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }

        let bestMove = null, bestScore = Infinity;
        for (const [, unitMoves] of byUnit) {
          const from = unitMoves[0].from;
          const goal = targets.reduce(
            (best, t) => chebyshevWrapped(from, t, W) < chebyshevWrapped(from, best, W) ? t : best,
            targets[0],
          );
          for (const m of unitMoves) {
            const d = chebyshevWrapped(m.to, goal, W);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) {
        const center = { x: state.board.width / 2, y: state.board.height / 2 };
        return moves.reduce(
          (best, m) => chebyshevWrapped(m.to, center, W) < chebyshevWrapped(best.to, center, W) ? m : best,
        );
      }

      return { type: 'end-turn', unitId: '__player__' };
    },
  };
}
