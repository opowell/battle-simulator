// ---------------------------------------------------------------------------
// strike.js — one blow, worked out from rules that are data.
//
// For a game whose combat is the core's but whose game is not (its economy,
// buildings and production are its own, as StarCraft's are): it hands the
// numbers of the two sides, and the rules — formulas in exact.js's language —
// say what the blow does with them.
//
//   {
//     steps:   [{ unless: 'd.air || !a.antiAir' },        // no blow at all: a miss, no die
//               { miss: 'if(a.range > 1 && d.high && !a.high, 30, 0)' }],
//                                                      // a d100, a miss when it is at
//                                                      // most this (no die when ≤ 0)
//     damage:  'a.attack + if(d.air, a.bonusAir, 0)',  // the blow
//     absorb:  { pool: 'shields', cap: 'if(d.hardened, 10, total)' },
//                                                      // what soaks it first, up to cap
//     through: 'if(left > 0, max(1, left - d.armor), 0)',
//                                                      // what of the rest reaches hit points
//   }
//
// The steps run in the order given, so a game whose own code threw its die
// before (or after) asking whether the blow could land at all keeps its dice in
// step. Every value is worked out exactly and floored to a whole number.
// ---------------------------------------------------------------------------

import { formula, whole, checkFormula } from './exact.js';

const value = (src, env) => whole(formula(src)(env));

/**
 * One blow under `rules`, between the sides in `env` (`env.a` the striker's
 * numbers, `env.d` the struck's, anything else the rules read), with `rng`
 * floats in [0, 1) for its dice. Returns
 *   { hit, roll?, total, absorbed, through }
 * — `total` the blow, `absorbed` what the pool soaked, `through` what reached
 * hit points; all 0 for a miss.
 */
export function strike(rules, env, rng = Math.random) {
  const miss = (roll) => ({ hit: false, ...(roll != null ? { roll } : {}), total: 0, absorbed: 0, through: 0 });
  let roll;
  for (const step of rules.steps ?? []) {
    if (step.unless != null && !value(step.unless, env)) return miss(roll);
    if (step.miss != null) {
      const chance = value(step.miss, env);
      if (chance > 0) {
        roll = Math.floor(rng() * 100) + 1;
        if (roll <= chance) return miss(roll);
      }
    }
  }
  const total = value(rules.damage, env);
  let absorbed = 0;
  if (rules.absorb) {
    const pool = env.d?.[rules.absorb.pool] ?? 0;
    const cap = rules.absorb.cap != null ? value(rules.absorb.cap, { ...env, total }) : total;
    absorbed = Math.max(0, Math.min(total, pool, cap));
  }
  const left = total - absorbed;
  const through = rules.through != null ? value(rules.through, { ...env, total, left }) : left;
  return { hit: true, ...(roll != null ? { roll } : {}), total, absorbed, through };
}

/** What is wrong with a set of strike rules, as messages (empty when none). */
export function checkStrike(rules) {
  const errs = [];
  const f = (where, src) => { try { checkFormula(src); } catch (e) { errs.push(`${where}: ${e.message}`); } };
  if (rules?.damage == null) errs.push('damage: missing');
  else f('damage', rules.damage);
  for (const [i, s] of (rules?.steps ?? []).entries()) {
    const keys = Object.keys(s);
    if (keys.length !== 1 || !['unless', 'miss'].includes(keys[0])) errs.push(`steps[${i}]: one of unless, miss`);
    else f(`steps[${i}].${keys[0]}`, s[keys[0]]);
  }
  if (rules?.absorb) {
    if (!rules.absorb.pool) errs.push('absorb.pool: missing');
    if (rules.absorb.cap != null) f('absorb.cap', rules.absorb.cap);
  }
  if (rules?.through != null) f('through', rules.through);
  return errs;
}
