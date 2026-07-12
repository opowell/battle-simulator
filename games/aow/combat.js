import { UNITS, COMBAT_TYPES } from './units.js';
import { TERRAIN } from './terrain.js';
import { terrainAt } from './map.js';

function combatMenOf(men) {
  return COMBAT_TYPES.reduce((a, t) => a + (men[t] ?? 0), 0);
}

function dominant(men) {
  let best = null, bestN = 0;
  for (const t of COMBAT_TYPES) { const n = men[t] ?? 0; if (n > bestN) { best = t; bestN = n; } }
  return best;
}

// Effective fighting strength of `men`, given condition (supply/morale), the terrain the
// squad stands on, any fort it holds, and the composition of the enemy it faces (the
// rock-paper-scissors counter bonus: men whose type beats the enemy's dominant type hit
// far harder). This is the number attrition is rolled against.
function effStrength(men, supply, morale, board, pos, onFort, enemyMen) {
  let base = 0;
  for (const t of COMBAT_TYPES) base += (men[t] ?? 0) * UNITS[t].power;
  const enemyDom = dominant(enemyMen);
  let counter = 0;
  for (const t of COMBAT_TYPES) if (UNITS[t].beats === enemyDom) counter += (men[t] ?? 0) * UNITS[t].power;

  const condition = 0.4 + 0.3 * (supply / 100) + 0.3 * (morale / 100);
  const terr = TERRAIN[terrainAt(board, pos.x, pos.y)];
  let terrainMult = 1 + (terr.passable ? terr.defBonus : 0);
  if (onFort) terrainMult *= 1.35; // fort walls — archers especially deadly behind them
  return Math.max(0.001, (base + counter * 0.9) * condition * terrainMult);
}

function loseOneMan(men) {
  // Casualty falls on the largest combat group first.
  const order = [...COMBAT_TYPES].sort((a, b) => (men[b] ?? 0) - (men[a] ?? 0));
  for (const t of order) if ((men[t] ?? 0) > 0) { men[t]--; if (men[t] === 0) delete men[t]; return; }
}

function isOnFort(board, squad) {
  return (board.features ?? []).some(
    f => f.type === 'fort' &&
         Math.floor(f.x) === Math.floor(squad.position.x) &&
         Math.floor(f.y) === Math.floor(squad.position.y)
  );
}

/**
 * Resolve an encounter between two squads. Attrition is rolled man-by-man: each round the
 * side with less effective strength is likelier to lose a man; strengths are recomputed as
 * casualties mount. The fight ends when a side is wiped out (captured) or its strength
 * collapses below a fraction of the enemy's (it routs — survivors flee, badly shaken).
 *
 * Returns updated men objects + an outcome the game layer turns into morale/position changes:
 *   winner    'a' | 'b' | null (mutual exhaustion)
 *   aMen/bMen surviving composition
 *   aRouted/bRouted, aWiped/bWiped
 */
export function resolveEncounter(a, b, board, rng) {
  const aMen = { ...a.men }, bMen = { ...b.men };
  const aOnFort = isOnFort(board, a);
  const bOnFort = isOnFort(board, b);

  let aWiped = false, bWiped = false, aRouted = false, bRouted = false;
  let rounds = 0;
  while (rounds++ < 400) {
    const aC = combatMenOf(aMen), bC = combatMenOf(bMen);
    if (aC === 0) { aWiped = true; break; }
    if (bC === 0) { bWiped = true; break; }

    const aStr = effStrength(aMen, a.supply, a.morale, board, a.position, aOnFort, bMen);
    const bStr = effStrength(bMen, b.supply, b.morale, board, b.position, bOnFort, aMen);

    // Rout check — a heavily outmatched side breaks and runs rather than dying to the last.
    if (rounds > 3) {
      if (aStr < 0.30 * bStr) { aRouted = true; break; }
      if (bStr < 0.30 * aStr) { bRouted = true; break; }
    }

    const pB_loses = aStr / (aStr + bStr);
    if (rng() < pB_loses) loseOneMan(bMen);
    else                  loseOneMan(aMen);
  }

  const winner = (bWiped || bRouted) ? 'a' : (aWiped || aRouted) ? 'b' : null;
  return { winner, aMen, bMen, aWiped, bWiped, aRouted, bRouted, rounds };
}
