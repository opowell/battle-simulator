// ---------------------------------------------------------------------------
// CS leaf evaluation — the game-specific "node heuristic" the Obscuro search
// plugs in, exactly where chess plugs in Stockfish (see the division of labour
// described at the top of games/chess/ObscuroAgent.js: a game-INDEPENDENT search
// plus a game-specific perfect-information evaluation).
//
// Everything here scores a CS position from one team's point of view, in a
// single bounded unit ("cs-points"), so the search can average values across
// belief worlds without any one term running away. The pieces, in descending
// order of how much they decide a round:
//
//   1. ROUND OUTCOME    — who has already won this round, if anyone.
//   2. OBJECTIVE        — the bomb: planted/ticking, defuse progress, and (before
//                         a plant) how close each side is to its half of the
//                         objective, plus the round clock that pressures T.
//   3. MATERIAL         — living bodies, hp, armor, and weapon quality.
//   4. ANGLES           — who currently has a shot on whom. This is the term that
//                         makes the AI play CS rather than a hp-counting skirmish:
//                         holding an angle the enemy does not hold is the whole
//                         game, and it is invisible to a pure material eval.
//
// WHY A ROUND OUTCOME LIVES IN A HEURISTIC, NOT A TERMINAL
// CsGame.getResult only fires at MATCH point (a team reaching winRounds), so the
// generic search's terminalValue hook is silent for the entire round the AI is
// actually playing — the engine just rolls a finished round into the next one.
// Without the ROUND_WIN term below, the search therefore sees no objective at
// all: planting, defusing and wiping the enemy team all read as "some hp
// changed". Scoring the round outcome here is what gives the AI something to
// play for. It is deliberately bounded (see ROUND_WIN) rather than infinite,
// because a round win is not a game win — play continues.
// ---------------------------------------------------------------------------

import {
  WEAPONS, ARMOR_REDUCTION, HELMET_EXTRA_REDUCTION, CROUCH_DAMAGE_REDUCTION,
  BOMB_TIMER, ROUND_TURN_MAX, DEFUSE_NEEDED,
} from './weapons.js';
import { isBombsite } from './map.js';
import { csVisionCfg } from './belief.js';
import { num } from '../coord.js';
import { seesPoint } from '../vision.js';

// The magnitude of a decided ROUND, on the cs-point scale below. A full five-unit
// team is worth ~2100 material points, so at 6000 (≈2.9×) a round win decisively
// outweighs any material consideration without dwarfing it by orders of
// magnitude — the same bounding discipline as chess's SEARCH_WIN (see
// games/chess/ObscuroAgent.js): under fog these values are AVERAGED across belief
// worlds, so an unbounded outcome lets a single phantom world (an imagined
// last-enemy-alive, say) swamp every real consideration and send the AI lunging.
export const ROUND_WIN = 6000;

// The magnitude of a decided MATCH — the value the search's terminalValue hook
// uses (CsGame.getResult). Strictly above ROUND_WIN so winning the match is never
// traded away for winning a round, still bounded for the same reason.
export const CS_SEARCH_WIN = 20000;

// Per-unit material. A living body is worth far more than the hp it happens to be
// carrying — in CS a 15 hp player still holds an angle, still trades, still
// defuses — so most of a unit's value is the flat survival term.
const ALIVE_VALUE  = 220;
const HP_VALUE     = 1.6;  // ×hp, so a full-health unit adds 160 on top of ALIVE_VALUE
const ARMOR_VALUE  = 45;
const HELMET_VALUE = 25;
const BLIND_PENALTY = 70;  // per remaining blinded turn — a blind unit cannot shoot
const DRY_PENALTY   = 35;  // empty magazine: must spend a turn reloading

// Weapon quality. damage×range is the natural product (an AWP is both harder
// hitting and longer reaching), but taken raw it makes an AWP worth 8× a rifle;
// the square root keeps snipers genuinely strong without letting a single weapon
// purchase outweigh a teammate's life.
const weaponQuality = (id) => {
  const w = WEAPONS[id];
  return w ? 3 * Math.sqrt(w.damage * w.range) : 0;
};

/**
 * What one living unit is worth, in cs-points — its body, condition and kit.
 * Exported so the agent's leaf evaluator can price "this unit is about to die"
 * against the same scale (see games/cs/ObscuroAgent.js).
 */
export function unitValue(u) {
  let v = ALIVE_VALUE + HP_VALUE * (u.hp ?? 0);
  if (u.armor)  v += ARMOR_VALUE;
  if (u.helmet) v += HELMET_VALUE;
  v += weaponQuality(u.weapons?.[u.active]);
  v -= BLIND_PENALTY * (u.blinded ?? 0);
  if (u.active !== 'melee' && !(u.ammo?.[u.active]?.mag > 0)) v -= DRY_PENALTY;
  return v;
}

// ── Angle / threat model ─────────────────────────────────────────────────────
// Expected damage `shooter` lands on `target` if it fires this turn. Mirrors
// applyActions' shoot formula (accuracy falls off with distance and clamps at 0;
// damage is reduced by the target's armor/helmet/crouch — see calcDamage there),
// so the eval prices a duel the way the engine will actually resolve it.
function expectedDamage(shooter, target, dist) {
  const wpn = WEAPONS[shooter.weapons[shooter.active]];
  if (!wpn) return 0;
  const accuracy = Math.max(0, 0.90 - 0.40 * (dist / wpn.range));
  if (accuracy <= 0) return 0;
  let reduction = 0;
  if (target.armor) reduction += ARMOR_REDUCTION + (target.helmet ? HELMET_EXTRA_REDUCTION : 0);
  if (target.crouched) reduction += CROUCH_DAMAGE_REDUCTION;
  return wpn.damage * (1 - reduction) * accuracy;
}

// Can `shooter` actually put rounds into `target` right now, and how much is that
// worth? Three gates, matching actionPhaseActions' shoot branch: not blinded, a
// loaded magazine (melee never needs one), and clear line of sight.
//
// Facing is a SOFT gate rather than a hard one. A unit outside its vision cone
// can't shoot this instant, but rotating costs only ROTATE_COST and doesn't
// consume the turn's action — so an enemy standing in your line but behind you is
// a real, if discounted, threat. Treating it as zero would let the AI happily
// stand in the open next to an enemy that merely happens to be looking away.
const OFF_ANGLE_DISCOUNT = 0.35;

export function threat(shooter, target, cfg) {
  if (!shooter.alive || !target.alive) return 0;
  if (shooter.blinded > 0) return 0;
  const slot = shooter.active;
  if (slot !== 'melee' && !(shooter.ammo?.[slot]?.mag > 0)) return 0;

  const sx = num(shooter.position.x), sy = num(shooter.position.y);
  const tx = num(target.position.x),  ty = num(target.position.y);
  if (cfg.hasLOS && !cfg.hasLOS(sx, sy, tx, ty)) return 0;

  const dist = Math.hypot(tx - sx, ty - sy);
  const dmg = expectedDamage(shooter, target, dist);
  if (dmg <= 0) return 0;

  const viewer = { x: sx, y: sy, facing: shooter.facing, fov: shooter.fov, visionRange: shooter.visionRange };
  const onAngle = seesPoint(viewer, tx, ty, cfg);
  return dmg * (onAngle ? 1 : OFF_ANGLE_DISCOUNT);
}

// Expected damage converts to cs-points at roughly "100 damage = one body", which
// is what it costs to actually remove one.
const DAMAGE_TO_POINTS = (ALIVE_VALUE + 100 * HP_VALUE) / 100;

// ── Objective ────────────────────────────────────────────────────────────────
const PLANTED_VALUE   = 1400; // T's reward the moment the bomb is down
const TIMER_VALUE      = 2200; // added to T as the planted bomb ticks toward zero
const DEFUSE_VALUE     = 2600; // CT's reward for defuse progress, full at completion
const APPROACH_VALUE   = 320;  // pre-plant: closing on the objective
const CLOCK_VALUE      = 900;  // pre-plant: the round clock, which runs in CT's favour

// ── Per-map caches ───────────────────────────────────────────────────────────
// This evaluation runs at every leaf of the search — thousands of times per move
// — so anything that depends only on the (immutable, shared-by-reference) map is
// computed once and reused. `gs.map` is carried unchanged through every state
// transition, which is what makes it a valid WeakMap key.

// Every bombsite tile on a map, as [x, y] pairs. Without this, each evaluation
// rescanned the whole tile grid (a few thousand tiles) looking for them.
const bombsiteCache = new WeakMap();
function bombsiteTiles(map) {
  let tiles = bombsiteCache.get(map);
  if (!tiles) {
    tiles = [];
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        if (isBombsite(map.tiles, x, y)) tiles.push([x, y]);
    bombsiteCache.set(map, tiles);
  }
  return tiles;
}

// The line-of-sight config (map walls + current smoke). The wall half is static
// per map; only smoke moves, and there is rarely any, so key the cache on the
// smoke layout. Rebuilding this per leaf meant re-walking every authored wall
// shape on the map thousands of times per move.
const visionCache = new WeakMap();
export function visionFor(gs) {
  const smoke = gs.smokeZones ?? [];
  const key = smoke.map(s => `${num(s.x)},${num(s.y)}`).join('|');
  let byKey = visionCache.get(gs.map);
  if (!byKey) { byKey = new Map(); visionCache.set(gs.map, byKey); }
  let cfg = byKey.get(key);
  if (!cfg) {
    cfg = csVisionCfg(gs.map, smoke);
    if (byKey.size > 32) byKey.clear(); // bound the per-map smoke-layout cache
    byKey.set(key, cfg);
  }
  return cfg;
}

// Distance from the closest living unit of `team` to the nearest of `points`
// ([x, y] pairs), in map units. Null when either side of that is empty.
function distanceToPoints(state, team, points) {
  if (!points.length) return null;
  let best = Infinity;
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== team) continue;
    const ux = num(u.position.x), uy = num(u.position.y);
    for (const [x, y] of points) {
      const d = Math.hypot(ux - x, uy - y);
      if (d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : null;
}

// A 1 → 0 ramp over the map's own diagonal, so "close to the objective" means the
// same thing on a small map and a large one.
function proximity(dist, map) {
  if (dist == null) return 0;
  const diag = Math.hypot(map.width, map.height);
  return Math.max(0, 1 - dist / diag);
}

function objectiveScore(state) {
  // Always scored from T's point of view; the caller flips it for CT.
  const gs = state.gameSpecific;
  const map = gs.map;
  const bomb = gs.bomb;
  let score = 0;

  if (bomb?.planted) {
    score += PLANTED_VALUE;
    // The closer to detonation, the harder it is for CT to still get there and
    // defuse — so a ticking bomb is worth progressively more to T.
    const elapsed = Math.max(0, BOMB_TIMER - (bomb.timer ?? BOMB_TIMER));
    score += TIMER_VALUE * (elapsed / BOMB_TIMER);
    // CT's counter-play: progress on the defuse, and simply being near the bomb
    // (a CT that can't reach it can't defuse it however long the timer runs).
    const needed = bomb.defuseNeeded ?? DEFUSE_NEEDED;
    score -= DEFUSE_VALUE * Math.min(1, (bomb.defuseProgress ?? 0) / needed);
    if (bomb.plantedAt) {
      const ctDist = distanceToPoints(state, 'CT', [[num(bomb.plantedAt.x), num(bomb.plantedAt.y)]]);
      score -= APPROACH_VALUE * proximity(ctDist, map);
    }
  } else {
    // Pre-plant. T must reach a bombsite; the clock is CT's ally.
    const tDist = distanceToPoints(state, 'T', bombsiteTiles(map));
    score += APPROACH_VALUE * proximity(tDist, map);
    score -= CLOCK_VALUE * Math.min(1, (gs.roundEndTurns ?? 0) / ROUND_TURN_MAX);
  }
  return score;
}

// ── Round outcome ────────────────────────────────────────────────────────────
// Mirrors CsGame's getRoundResult. Duplicated rather than imported because
// getRoundResult is private to CsGame.js and importing it would make eval.js and
// CsGame.js circular; the conditions are four lines and change with the rules,
// so keep the two in step.
function roundWinner(state) {
  const gs = state.gameSpecific;
  const tAlive  = state.units.some(u => u.ownerId === 'T'  && u.alive);
  const ctAlive = state.units.some(u => u.ownerId === 'CT' && u.alive);
  if (!tAlive)  return 'CT';
  if (!ctAlive) return 'T';
  if (gs.bomb?.planted && gs.bomb.timer <= 0) return 'T';
  if (gs.bomb?.defuseProgress >= (gs.bomb.defuseNeeded ?? DEFUSE_NEEDED)) return 'CT';
  if (!gs.bomb?.planted && (gs.roundEndTurns ?? 0) >= ROUND_TURN_MAX) return 'CT';
  return null;
}

// ── The evaluation ───────────────────────────────────────────────────────────

/**
 * Score `state` from `side`'s point of view, in cs-points.
 * Antisymmetric: csEvaluate(s, 'T') === -csEvaluate(s, 'CT').
 *
 * `side` may be a team id ('T' | 'CT') or a player id ('p1' | 'p2') — the search
 * hands out player ids (it reads state.activePlayers) while unit.ownerId is a team
 * id, and silently comparing the two makes every unit look like an enemy, which
 * returns the exact negation of the truth rather than an obvious error. Normalise
 * here so no caller can get it wrong.
 */
export function csEvaluate(state, side) {
  const teamId = state.gameSpecific.teamMap?.[side] ?? side;
  const enemyTeam = teamId === 'T' ? 'CT' : 'T';

  // 1. Round already decided — nothing else about the position matters.
  const winner = roundWinner(state);
  if (winner) return winner === teamId ? ROUND_WIN : -ROUND_WIN;

  // 2. Objective (scored for T, flipped for CT).
  let score = objectiveScore(state) * (teamId === 'T' ? 1 : -1);

  // 3. Material.
  for (const u of state.units) {
    if (!u.alive) continue;
    score += u.ownerId === teamId ? unitValue(u) : -unitValue(u);
  }

  // 4. Angles. Each unit contributes the single best shot it has available (not
  // the sum over all enemies): a unit fires once per turn, so holding an angle on
  // three enemies at once is worth about as much as holding one — and summing
  // would make walking into a crossfire look like a bonanza.
  const cfg = visionFor(state.gameSpecific);
  const mine   = state.units.filter(u => u.alive && u.ownerId === teamId);
  const theirs = state.units.filter(u => u.alive && u.ownerId === enemyTeam);
  for (const a of mine) {
    let best = 0;
    for (const e of theirs) best = Math.max(best, threat(a, e, cfg));
    score += best * DAMAGE_TO_POINTS;
  }
  for (const e of theirs) {
    let best = 0;
    for (const a of mine) best = Math.max(best, threat(e, a, cfg));
    score -= best * DAMAGE_TO_POINTS;
  }

  return score;
}
