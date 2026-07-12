import { UNITS, COMBAT_TYPES } from './units.js';

export const MAX_MEN = 14; // a squad holds up to 14 men (the original's cap)

let _idCtr = 0;
export function resetSquadIds() { _idCtr = 0; }

/**
 * Build a squad. `men` is a map of type → count, e.g. { knight: 4, archer: 6 }.
 * A squad tracks:
 *   men     — composition (knights/barbarians/archers/spies), total ≤ 14
 *   supply  — 0..100 food/provisions. Feeds condition; drops when foraging poor land.
 *   morale  — 0..100 fighting spirit. Won battles raise it; losses and hunger sink it.
 *   position — continuous {x, y} on the map (floats)
 */
export function makeSquad(ownerId, men, x, y, extra = {}) {
  const clean = {};
  let total = 0;
  for (const t of Object.keys(UNITS)) {
    const n = Math.max(0, Math.floor(men[t] ?? 0));
    if (n > 0) { clean[t] = n; total += n; }
  }
  return {
    id: extra.id ?? `s${_idCtr++}`,
    ownerId,
    men: clean,
    position: { x, y },
    alive: total > 0,
    supply: extra.supply ?? 100,
    morale: extra.morale ?? 100,
    dest: null,          // remembered march target (for continuous move feel)
    attrs: {},
  };
}

export function totalMen(squad) {
  return Object.values(squad.men).reduce((a, b) => a + b, 0);
}

export function combatMen(squad) {
  return COMBAT_TYPES.reduce((a, t) => a + (squad.men[t] ?? 0), 0);
}

export function hasSpy(squad) {
  return (squad.men.spy ?? 0) > 0;
}

// A squad marches at the pace of its slowest present man (one knight slows the column).
export function squadSpeed(squad) {
  const present = Object.keys(squad.men).filter(t => squad.men[t] > 0);
  if (!present.length) return 0;
  return Math.min(...present.map(t => UNITS[t].speed));
}

// Raw fighting strength: men-power, scaled by condition (supply+morale). A starving,
// broken squad fights at a fraction of its paper strength.
export function squadStrength(squad) {
  let base = 0;
  for (const t of COMBAT_TYPES) base += (squad.men[t] ?? 0) * UNITS[t].power;
  const condition = 0.4 + 0.3 * (squad.supply / 100) + 0.3 * (squad.morale / 100);
  return base * condition;
}

// Count of men of the type that beats `enemyType` (rock-paper-scissors specialist bonus).
export function counterMen(squad, enemyType) {
  let n = 0;
  for (const t of COMBAT_TYPES) if (UNITS[t].beats === enemyType) n += (squad.men[t] ?? 0);
  return n;
}

// The dominant combat type in a squad — used to decide which counter the enemy needs.
export function dominantType(squad) {
  let best = null, bestN = 0;
  for (const t of COMBAT_TYPES) {
    const n = squad.men[t] ?? 0;
    if (n > bestN) { best = t; bestN = n; }
  }
  return best;
}

// Remove `n` casualties, spread proportionally across the combat men (spies captured last).
export function inflictCasualties(squad, n) {
  const men = { ...squad.men };
  let remaining = Math.min(n, combatMen({ men }) );
  // Proportional loss across combat types, largest groups first.
  const order = [...COMBAT_TYPES].sort((a, b) => (men[b] ?? 0) - (men[a] ?? 0));
  let guard = 0;
  while (remaining > 0 && combatMenObj(men) > 0 && guard++ < 100) {
    for (const t of order) {
      if (remaining <= 0) break;
      if ((men[t] ?? 0) > 0) { men[t]--; if (men[t] === 0) delete men[t]; remaining--; }
    }
  }
  // If all combat men fell, any spies are captured too.
  if (combatMenObj(men) === 0) delete men.spy;
  const total = Object.values(men).reduce((a, b) => a + b, 0);
  return { ...squad, men, alive: total > 0 };
}

function combatMenObj(men) {
  return COMBAT_TYPES.reduce((a, t) => a + (men[t] ?? 0), 0);
}

export function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}
