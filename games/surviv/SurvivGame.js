import { sidesEval } from '../evalHelpers.js';
import {
  WEAPONS, GRENADES, WEAPON_SVG_SIZE,
  VEST_REDUCTION, HELMET_REDUCTION,
  STARTING_HP, MOVE_RANGE, PICKUP_RANGE,
  SHOOT_ACC_MAX, SHOOT_ACC_MIN,
  GRENADE_THROW_RANGE, FRAG_RADIUS, FRAG_DAMAGE,
  BARREL_BLAST_RADIUS, BARREL_BLAST_DAMAGE,
  isMelee, fullAmmo,
} from './weapons.js';
import {
  MAPS, euclidean, getReachable, renderMap, isWalkableContinuous, isInBush,
  initialBreakableState, destroyedIdSet, destroyedCellSet,
} from './map.js';
import { getSurvivBelief, survivVisionCfg, survivLosBlockers, survivFilterVisibleUnits, spotsPoint } from './belief.js';
import { hasClearLine, isClearOfUnits, latticeActions } from '../continuousMove.js';
import { orientToEnemies } from '../vision.js';
import { segmentClearOf, nearestPointOnShape } from '../terrainShapes.js';
import { makePos, parsePos, num, posToWire } from '../coord.js';

const MOVE_EPS = 0.05; // see games/cs/CsGame.js's identical constant for why this floor exists
const DEFAULT_TURN_CAP = 100; // team-turn windows before a stalemate is scored by survivors/hp

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDamage(raw, unit) {
  const reduction = (VEST_REDUCTION[unit.vest] ?? 0) + (HELMET_REDUCTION[unit.helmet] ?? 0);
  return Math.round(raw * (1 - reduction));
}

const WEAPON_ICON = w => `/images/surviv/weapons/${w}`;
const EQUIP_ICON  = (kind, tier) => `/images/surviv/equipment/${kind}${tier}`;

// ── Unit factory ──────────────────────────────────────────────────────────────

function makeUnit(id, ownerId, pos) {
  return {
    id, ownerId, type: 'melee',
    position: makePos(pos.x, pos.y),
    alive: true,
    hp: STARTING_HP, maxHp: STARTING_HP,
    weapon: 'fists',
    ammo: fullAmmo('fists'),
    grenades: { frag: 0 },
    vest: 0, helmet: 0,
    perTurn: { hasActed: false, moveAllowance: MOVE_RANGE },
  };
}

function spawnUnits(map) {
  return orientToEnemies([
    ...map.redSpawns.map((p, i)  => makeUnit(`red-${i}`,  'red',  p)),
    ...map.blueSpawns.map((p, i) => makeUnit(`blue-${i}`, 'blue', p)),
  ], p => [num(p.x), num(p.y)]);
}

// ── Loot table ──────────────────────────────────────────────────────────────
// Concrete weapons a map's LOOT_SPAWNS tier bucket cycles through (see map.js's
// `loot` list — each entry there names a tier, not an item, so the concrete item can
// vary per spawn point deterministically). 'grenade'/'vest'/'helmet' tiers are handled
// directly in buildLoot below rather than through this table.
const LOOT_TABLE = {
  1: ['colt45', 'mp220'],
  2: ['deagle', 'vector', 'famas', 'm1014'],
  3: ['m4a1', 'scar', 'mosin'],
  4: ['awc'],
};
const GEAR_LOOT_LEVEL = 2; // vest/helmet loot points grant this tier outright

function buildLoot(map) {
  const counters = {};
  return map.loot.map((spot, i) => {
    if (spot.tier === 'grenade')
      return { id: `loot-${i}`, x: spot.x, y: spot.y, kind: 'grenade', item: 'frag', taken: false,
               name: GRENADES.frag.name, icon: WEAPON_ICON('frag') };
    if (spot.tier === 'vest')
      return { id: `loot-${i}`, x: spot.x, y: spot.y, kind: 'vest', level: GEAR_LOOT_LEVEL, taken: false,
               name: `Level ${GEAR_LOOT_LEVEL} Vest`, icon: EQUIP_ICON('vest', GEAR_LOOT_LEVEL) };
    if (spot.tier === 'helmet')
      return { id: `loot-${i}`, x: spot.x, y: spot.y, kind: 'helmet', level: GEAR_LOOT_LEVEL, taken: false,
               name: `Level ${GEAR_LOOT_LEVEL} Helmet`, icon: EQUIP_ICON('helmet', GEAR_LOOT_LEVEL) };
    const pool = LOOT_TABLE[spot.tier];
    const n = counters[spot.tier] ?? 0;
    counters[spot.tier] = n + 1;
    const item = pool[n % pool.length];
    return { id: `loot-${i}`, x: spot.x, y: spot.y, kind: 'weapon', item, taken: false,
             name: WEAPONS[item].name, icon: WEAPON_ICON(item) };
  });
}

function applyLoot(units, unitId, loot) {
  return units.map(u => {
    if (u.id !== unitId) return u;
    if (loot.kind === 'weapon') {
      const newTier = WEAPONS[loot.item].tier ?? 0;
      const curTier = WEAPONS[u.weapon].tier ?? 0;
      if (newTier <= curTier) return u; // never downgrades a held weapon
      return { ...u, weapon: loot.item, type: WEAPONS[loot.item].category, ammo: fullAmmo(loot.item) };
    }
    if (loot.kind === 'grenade') {
      if ((u.grenades.frag ?? 0) >= GRENADES.frag.maxStack) return u;
      return { ...u, grenades: { ...u.grenades, frag: (u.grenades.frag ?? 0) + 1 } };
    }
    if (loot.kind === 'vest')   return u.vest   >= loot.level ? u : { ...u, vest: loot.level };
    if (loot.kind === 'helmet') return u.helmet >= loot.level ? u : { ...u, helmet: loot.level };
    return u;
  });
}

// ── Legal actions ─────────────────────────────────────────────────────────────
// Single continuous action phase (no buy phase, no rounds — surviv is one
// life-or-death match). Ground-truth legality (range/LOS only, no facing-cone or bush
// gate) matches games/cs/CsGame.js's actionPhaseActions precedent — see belief.js's
// header comment for why fog/bush concealment instead only shapes getVisibleState.

function actionPhaseActions(state, teamId) {
  const { map } = state.gameSpecific;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  const actions = [];
  const breakables = state.gameSpecific.breakables;
  const destroyedIds = destroyedIdSet(breakables);
  const destroyedCells = destroyedCellSet(map, breakables);
  const losBlockers = survivLosBlockers(map, destroyedIds);
  const loot = state.gameSpecific.loot.filter(l => !l.taken);
  const live = breakables.filter(b => !b.destroyed);

  for (const u of myUnits) {
    if (u.perTurn.moveAllowance > MOVE_EPS) {
      for (const to of getReachable(map.tiles, u.position, u.perTurn.moveAllowance, state.units, destroyedCells))
        actions.push({ type: 'move', unitId: u.id, from: u.position, to });
    }

    if (!u.perTurn.hasActed) {
      const wpn = WEAPONS[u.weapon];
      const canFire = isMelee(u.weapon) || u.ammo.mag > 0;
      if (canFire) {
        const enemies = state.units.filter(e => e.alive && e.ownerId !== teamId);
        for (const e of enemies) {
          const d = euclidean(u.position, e.position);
          if (d <= wpn.range &&
              segmentClearOf(num(u.position.x), num(u.position.y), num(e.position.x), num(e.position.y), losBlockers))
            actions.push({
              type: 'shoot', unitId: u.id, targetId: e.id, range: wpn.range,
              damage: wpn.damage, accuracy: SHOOT_ACC_MAX - (SHOOT_ACC_MAX - SHOOT_ACC_MIN) * (d / wpn.range),
            });
        }

        // Break cover: attack a crate/barrel with whatever's in hand. Range is checked
        // to the NEAREST point on the shape (not its centre) so melee can reach a wide
        // shape's edge, and LOS excludes the target's own shape (see the id filter)
        // so the ray to its own boundary can't self-block.
        const ux = num(u.position.x), uy = num(u.position.y);
        for (const b of live) {
          const def = map.breakablesById[b.id];
          const near = nearestPointOnShape(def, ux, uy);
          const d = Math.hypot(ux - near.x, uy - near.y);
          if (d > wpn.range) continue;
          const blockers = losBlockers.filter(bl => bl.id !== b.id);
          if (!segmentClearOf(ux, uy, near.x, near.y, blockers)) continue;
          actions.push({
            type: 'break', unitId: u.id, breakableId: b.id, range: wpn.range, damage: wpn.damage,
            name: `Break ${def.kind === 'crate' ? 'Crate' : 'Barrel'}`, icon: WEAPON_ICON(u.weapon),
          });
        }
      }

      if (!isMelee(u.weapon) && u.ammo.mag < wpn.magSize && u.ammo.reserve > 0)
        actions.push({ type: 'reload', unitId: u.id });

      if (u.grenades.frag > 0)
        actions.push({
          type: 'throw', unitId: u.id, grenade: 'frag', icon: WEAPON_ICON('frag'), name: GRENADES.frag.name,
          range: GRENADE_THROW_RANGE, blastRadius: FRAG_RADIUS, previewKind: 'damage', damage: FRAG_DAMAGE,
        });

      for (const l of loot) {
        if (euclidean(u.position, l) <= PICKUP_RANGE)
          actions.push({ type: 'loot', unitId: u.id, lootId: l.id, name: l.name, icon: l.icon });
      }
    }
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

function isMoveLegal(state, teamId, action) {
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.moveAllowance <= MOVE_EPS) return false;
  const destroyedIds = destroyedIdSet(state.gameSpecific.breakables);
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.to.x), y = num(action.to.y);
  const dist = Math.hypot(px - x, py - y);
  if (dist < MOVE_EPS) return false;
  if (!isWalkableContinuous(map, x, y, destroyedIds)) return false;
  if (dist > unit.perTurn.moveAllowance) return false;
  if (!hasClearLine(px, py, x, y, (qx, qy) => !isWalkableContinuous(map, qx, qy, destroyedIds))) return false;
  if (!isClearOfUnits(x, y, state.units, unit.id)) return false;
  return true;
}

function isThrowLegal(state, teamId, action) {
  const map  = state.gameSpecific.map;
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.hasActed) return false;
  if (!(unit.grenades?.frag > 0)) return false;
  const destroyedIds = destroyedIdSet(state.gameSpecific.breakables);
  const x = num(action.target.x), y = num(action.target.y);
  if (!isWalkableContinuous(map, x, y, destroyedIds)) return false;
  if (Math.hypot(num(unit.position.x) - x, num(unit.position.y) - y) > GRENADE_THROW_RANGE) return false;
  return true;
}

function isActionLegal(state, teamId, action) {
  if (action.type === 'move')  return isMoveLegal(state, teamId, action);
  if (action.type === 'throw') return isThrowLegal(state, teamId, action);
  return false;
}

function survivActionKey(a) {
  const pt = p => (p && typeof p === 'object') ? [num(p.x), num(p.y)] : null;
  return JSON.stringify([
    a.type ?? null, a.unitId ?? null, a.lootId ?? null, a.breakableId ?? null,
    a.targetId ?? null, pt(a.to), pt(a.target),
  ]);
}

function getSearchActions(state, teamId, res) {
  const units = state.units;
  const originOf = a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y) } : null; };
  let out = latticeActions(getLegalActions(state, teamId), {
    type: 'move', point: 'to',
    origin: a => { const o = originOf(a); const u = units.find(x => x.id === a.unitId); return o && u && { ...o, range: u.perTurn.moveAllowance }; },
    isLegal: (a, x, y) => isMoveLegal(state, teamId, { unitId: a.unitId, to: { x, y } }),
  }, res);
  out = latticeActions(out, {
    type: 'throw', point: 'target',
    origin: a => { const o = originOf(a); return o && { ...o, range: GRENADE_THROW_RANGE }; },
    isLegal: (a, x, y) => isThrowLegal(state, teamId, { unitId: a.unitId, grenade: a.grenade, target: { x, y } }),
  }, res);
  return out;
}

function getLegalActions(state, playerId) {
  return actionPhaseActions(state, playerId);
}

// ── applyActions ──────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  const gs = state.gameSpecific;

  if (action.type === 'move') {
    const to = parsePos(action.to);
    units = units.map(u => {
      if (u.id !== action.unitId) return u;
      const dx = num(to.x) - num(u.position.x), dy = num(to.y) - num(u.position.y);
      const dist = Math.hypot(dx, dy);
      const facing = (dx || dy) ? Math.atan2(dy, dx) : u.facing;
      return { ...u, position: to, facing,
               perTurn: { ...u.perTurn, moveAllowance: Math.max(0, u.perTurn.moveAllowance - dist) } };
    });
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'shoot') {
    const attacker = units.find(u => u.id === action.unitId);
    const defender = units.find(u => u.id === action.targetId);
    const wpn      = WEAPONS[attacker.weapon];
    const d        = euclidean(attacker.position, defender.position);
    const accuracy = SHOOT_ACC_MAX - (SHOOT_ACC_MAX - SHOOT_ACC_MIN) * (d / wpn.range);

    units = units.map(u => u.id === action.unitId
      ? { ...u, ammo: isMelee(u.weapon) ? u.ammo : { ...u.ammo, mag: u.ammo.mag - 1 }, perTurn: { ...u.perTurn, hasActed: true } }
      : u);

    if (rng() > accuracy) return { ...state, units, lastActions: playerActions };

    const dmg   = calcDamage(wpn.damage, defender);
    const newHp = Math.max(0, defender.hp - dmg);
    units = units.map(u => u.id === action.targetId ? { ...u, hp: newHp, alive: newHp > 0 } : u);
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'throw') {
    if (!action.target) {
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);
      return { ...state, units, lastActions: playerActions };
    }
    const target = parsePos(action.target);
    units = units.map(u => u.id === action.unitId
      ? { ...u, grenades: { ...u.grenades, frag: (u.grenades.frag ?? 1) - 1 }, perTurn: { ...u.perTurn, hasActed: true } }
      : u);
    // Frag hits everyone in radius, both teams — real grenades don't check IDs.
    units = units.map(u => {
      if (!u.alive || euclidean(u.position, target) > FRAG_RADIUS) return u;
      const newHp = Math.max(0, u.hp - calcDamage(FRAG_DAMAGE, u));
      return { ...u, hp: newHp, alive: newHp > 0 };
    });
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'reload') {
    units = units.map(u => {
      if (u.id !== action.unitId) return u;
      const wpn    = WEAPONS[u.weapon];
      const needed = wpn.magSize - u.ammo.mag;
      const drawn  = Math.min(needed, u.ammo.reserve);
      return { ...u, ammo: { mag: u.ammo.mag + drawn, reserve: u.ammo.reserve - drawn },
               perTurn: { ...u.perTurn, hasActed: true } };
    });
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'loot') {
    const item = gs.loot.find(l => l.id === action.lootId);
    if (!item || item.taken) {
      units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);
      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }
    units = applyLoot(units, action.unitId, item).map(u =>
      u.id === action.unitId ? { ...u, perTurn: { ...u.perTurn, hasActed: true } } : u);
    const loot = gs.loot.map(l => l.id === action.lootId ? { ...l, taken: true } : l);
    return { ...state, units, gameSpecific: { ...gs, loot }, lastActions: playerActions };
  }

  if (action.type === 'break') {
    const def      = gs.map.breakablesById[action.breakableId];
    const attacker = units.find(u => u.id === action.unitId);
    const dmg      = WEAPONS[attacker.weapon].damage;

    units = units.map(u => u.id === action.unitId
      ? { ...u, ammo: isMelee(u.weapon) ? u.ammo : { ...u.ammo, mag: u.ammo.mag - 1 }, perTurn: { ...u.perTurn, hasActed: true } }
      : u);

    let breakables = gs.breakables.map(b => b.id === action.breakableId ? { ...b, hp: Math.max(0, b.hp - dmg) } : b);
    const target = breakables.find(b => b.id === action.breakableId);
    let loot = gs.loot;

    if (target.hp <= 0 && !target.destroyed) {
      breakables = breakables.map(b => b.id === action.breakableId ? { ...b, destroyed: true } : b);
      const cx = def.x + def.w / 2, cy = def.y + def.h / 2;

      if (def.kind === 'barrel') {
        // Barrels explode when broken — area damage to anyone nearby, either team.
        units = units.map(u => {
          if (!u.alive || Math.hypot(num(u.position.x) - cx, num(u.position.y) - cy) > BARREL_BLAST_RADIUS) return u;
          const newHp = Math.max(0, u.hp - calcDamage(BARREL_BLAST_DAMAGE, u));
          return { ...u, hp: newHp, alive: newHp > 0 };
        });
      } else {
        // Crates drop a common-to-mid weapon where they stood.
        const pool = [...LOOT_TABLE[1], ...LOOT_TABLE[2]];
        const item = pool[Math.floor(rng() * pool.length)];
        loot = [...loot, {
          id: `loot-break-${action.breakableId}`, x: cx, y: cy, kind: 'weapon', item, taken: false,
          name: WEAPONS[item].name, icon: WEAPON_ICON(item),
        }];
      }
    }

    return { ...state, units, gameSpecific: { ...gs, breakables, loot }, lastActions: playerActions };
  }

  if (action.type === 'end-turn') {
    const otherTeam = playerId === 'red' ? 'blue' : 'red';
    units = units.map(u => u.ownerId !== playerId ? u : { ...u, perTurn: { hasActed: false, moveAllowance: MOVE_RANGE } });
    return {
      ...state, units,
      activePlayers: [gs.teamPlayerMap[otherTeam]],
      turnNumber: playerId === 'blue' ? state.turnNumber + 1 : state.turnNumber,
      lastActions: playerActions,
    };
  }

  return state;
}

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(state) {
  const gs = state.gameSpecific;
  const redAlive  = state.units.filter(u => u.ownerId === 'red'  && u.alive);
  const blueAlive = state.units.filter(u => u.ownerId === 'blue' && u.alive);

  if (redAlive.length === 0 && blueAlive.length === 0)
    return { outcome: 'draw', winnerId: null, reason: 'mutual elimination' };
  if (redAlive.length === 0) return { outcome: 'win', winnerId: gs.teamPlayerMap.blue, reason: 'Blue eliminated Red' };
  if (blueAlive.length === 0) return { outcome: 'win', winnerId: gs.teamPlayerMap.red, reason: 'Red eliminated Blue' };

  if (state.turnNumber > gs.turnCap) {
    if (redAlive.length !== blueAlive.length)
      return redAlive.length > blueAlive.length
        ? { outcome: 'win', winnerId: gs.teamPlayerMap.red, reason: `Turn limit — Red ${redAlive.length} survivors vs Blue ${blueAlive.length}` }
        : { outcome: 'win', winnerId: gs.teamPlayerMap.blue, reason: `Turn limit — Blue ${blueAlive.length} survivors vs Red ${redAlive.length}` };
    const redHp  = redAlive.reduce((a, u) => a + u.hp, 0);
    const blueHp = blueAlive.reduce((a, u) => a + u.hp, 0);
    if (redHp !== blueHp)
      return redHp > blueHp
        ? { outcome: 'win', winnerId: gs.teamPlayerMap.red, reason: `Turn limit — Red ${redHp}hp vs Blue ${blueHp}hp` }
        : { outcome: 'win', winnerId: gs.teamPlayerMap.blue, reason: `Turn limit — Blue ${blueHp}hp vs Red ${redHp}hp` };
    return { outcome: 'draw', winnerId: null, reason: `Turn limit — tied ${redAlive.length}v${blueAlive.length}` };
  }
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const gs = state.gameSpecific;
  const activeTeam = gs.teamMap?.[state.activePlayers[0]] ?? state.activePlayers[0];

  const teamSummary = (tid) => {
    const teamUnits = state.units.filter(u => u.ownerId === tid);
    const uStr = teamUnits.filter(u => u.alive).map(u => {
      let s = `${u.id}:${u.weapon}`;
      if (!isMelee(u.weapon)) s += `(${u.ammo.mag}/${u.ammo.reserve})`;
      if (u.vest)   s += `+vest${u.vest}`;
      if (u.helmet) s += `+helm${u.helmet}`;
      if (u.grenades.frag) s += `[frag×${u.grenades.frag}]`;
      return `${s}(${u.hp}hp)`;
    }).join(' ');
    return `  ${tid} (${teamUnits.filter(u => u.alive).length}/${teamUnits.length} alive) | ${uStr || '(all dead)'}`;
  };

  return [
    `═══ Turn ${state.turnNumber}  |  ${activeTeam} to move  |  ${gs.loot.filter(l => !l.taken).length} loot remaining ═══`,
    renderMap(state),
    `Legend: R=Red B=Blue r=red-spawn b=blue-spawn $=loot #=wall/forest/water/crate`,
    '',
    teamSummary('red'),
    teamSummary('blue'),
  ].join('\n');
}

// ── toGrid (design UI) ──────────────────────────────────────────────────────────

// Sprite-layer geometry for the held weapon + hands (see apps/design/SchematicLayer.vue's
// generic `unit.spriteLayers` renderer). All offsets are LOCAL (unrotated, facing = +x)
// fractions of unitR(u); the game precomputes the facing-rotated world offset so the
// renderer stays a dumb "draw each layer at (dx,dy), rotated `rot` degrees" loop.
const GRIP_ANCHOR_Y = 0.78; // fraction down each gun's canvas where the hand grips it
const SUPPORT_FORWARD = { pistol: 0.15, smg: 0.45, shotgun: 0.55, rifle: 0.65, sniper: 0.85, melee: 0.3 };

function rot2(lx, ly, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { dx: lx * c - ly * s, dy: lx * s + ly * c };
}

function spriteLayers(u) {
  const rad  = u.facing ?? 0;
  const deg  = rad * 180 / Math.PI;
  const wpn  = WEAPONS[u.weapon];
  const ring = u.ownerId === 'red' ? '/images/surviv/player/ring-red' : '/images/surviv/player/ring-blue';
  const layers = [
    { src: ring, wFrac: 2.3, hFrac: 2.3, anchorX: 0.5, anchorY: 0.5, dx: 0, dy: 0, rot: 0 },
    { src: '/images/surviv/player/body', wFrac: 2.0, hFrac: 2.0, anchorX: 0.5, anchorY: 0.5, dx: 0, dy: 0, rot: 0 },
  ];

  if (u.helmet > 0) {
    const p = rot2(-0.5, 0, rad);
    layers.push({ src: `/images/surviv/equipment/helmet${u.helmet}`, wFrac: 1.0, hFrac: 1.0,
                  anchorX: 0.5, anchorY: 0.5, dx: p.dx, dy: p.dy, rot: deg });
  }
  if (u.vest > 0) {
    const p = rot2(-0.75, 0, rad);
    layers.push({ src: `/images/surviv/equipment/vest${u.vest}`, wFrac: 0.85, hFrac: 0.85,
                  anchorX: 0.5, anchorY: 0.5, dx: p.dx, dy: p.dy, rot: deg });
  }

  const supportFwd = SUPPORT_FORWARD[wpn.category] ?? 0.3;
  const back = rot2(0.20, 0.55, rad);
  layers.push({ src: '/images/surviv/player/hand', wFrac: 0.5, hFrac: 0.5, anchorX: 0.5, anchorY: 0.5, dx: back.dx, dy: back.dy, rot: 0 });

  if (u.weapon !== 'fists') {
    const sz = WEAPON_SVG_SIZE[u.weapon];
    const isKnife = wpn.category === 'melee';
    const hFrac = isKnife ? 1.1 : 2.0;
    const wFrac = hFrac * (sz.w / sz.h);
    const anchorY = isKnife ? 0.5 : GRIP_ANCHOR_Y;
    const gripLocal = isKnife ? 0.35 : (0.1 + supportFwd * 0.1);
    const grip = rot2(gripLocal, 0.05, rad);
    layers.push({ src: `/images/surviv/weapons/${u.weapon}`, wFrac, hFrac, anchorX: 0.5, anchorY,
                  dx: grip.dx, dy: grip.dy, rot: deg + 90 });
  }

  const front = rot2(0.15 + supportFwd * 0.55, -0.55, rad);
  layers.push({ src: '/images/surviv/player/hand', wFrac: 0.5, hFrac: 0.5, anchorX: 0.5, anchorY: 0.5, dx: front.dx, dy: front.dy, rot: 0 });

  return layers;
}

function equipmentList(u) {
  const wpn = WEAPONS[u.weapon];
  return [
    { label: 'Weapon', value: wpn.name, icon: WEAPON_ICON(u.weapon) },
    ...(isMelee(u.weapon) ? [] : [{ label: 'Ammo', value: `${u.ammo.mag} / ${u.ammo.reserve}` }]),
    { label: 'Vest',   value: u.vest   ? `Level ${u.vest}`   : 'None', icon: u.vest   ? EQUIP_ICON('vest', u.vest)     : undefined },
    { label: 'Helmet', value: u.helmet ? `Level ${u.helmet}` : 'None', icon: u.helmet ? EQUIP_ICON('helmet', u.helmet) : undefined },
    { label: 'Grenades', value: u.grenades.frag ? `Frag ×${u.grenades.frag}` : 'None',
      icon: u.grenades.frag ? WEAPON_ICON('frag') : undefined },
  ];
}

const TERRAIN_INFO = {
  wall:      { name: 'Terrain', description: 'Impassable, blocks line of sight.' },
  floor:     { name: 'Grass',   description: 'Open ground.' },
  redSpawn:  { name: 'Red Spawn',  description: 'Red team starting area.' },
  blueSpawn: { name: 'Blue Spawn', description: 'Blue team starting area.' },
};

function lootShapes(loot) {
  return loot.filter(l => !l.taken).map(l => ({
    shape: 'oval', x: num(l.x) - 0.35, y: num(l.y) - 0.35, w: 0.7, h: 0.7,
    fill: l.kind === 'weapon' ? '#e8c750' : l.kind === 'grenade' ? '#8a9a4a' : '#7fb0d8',
    stroke: '#2a2a2a', opacity: 0.9, name: l.name, description: `Loot — move onto it and pick it up.`,
  }));
}

// The map's static shape list, adjusted for per-match breakable state: a destroyed
// crate/barrel drops out entirely (it's gone), a damaged one fades toward its rubble
// so hitting it reads as progress even before it breaks.
function liveShapes(map, breakables) {
  const byId = new Map(breakables.map(b => [b.id, b]));
  return (map.shapes ?? []).flatMap(s => {
    if (!s.id) return [s];
    const b = byId.get(s.id);
    if (!b || b.destroyed) return [];
    if (b.hp >= b.maxHp) return [s];
    return [{ ...s, opacity: (s.opacity ?? 1) * Math.max(0.35, b.hp / b.maxHp) }];
  });
}

function toGrid(state) {
  const { units, gameSpecific: gs } = state;
  const { tiles, width, height } = gs.map;
  const destroyedIds = destroyedIdSet(gs.breakables);
  const playerIdx = {};
  (state.players ?? []).forEach((p, i) => { playerIdx[p.id] = i + 1; });

  const cells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      cells.push({ x, y, color: '#5a9450', terrain: TERRAIN_INFO[tiles[`${x},${y}`]] ?? TERRAIN_INFO.floor });

  const unitList = units.filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    return {
      id: u.id, x: p.x, y: p.y,
      glyph: 'P',
      unitName: `${u.ownerId === 'red' ? 'Red' : 'Blue'} ${u.id.split('-')[1]}`,
      facing: u.facing,
      type: WEAPONS[u.weapon].category,
      owner: playerIdx[gs.teamPlayerMap[u.ownerId]] ?? 0,
      hp: u.hp, maxHp: u.maxHp,
      job: u.weapon,
      spriteLayers: spriteLayers(u),
      moveRange: u.perTurn?.moveAllowance,
      equipment: equipmentList(u),
      moved: u.perTurn?.moveAllowance < MOVE_RANGE,
      acted: u.perTurn?.hasActed,
      damageReduction: (VEST_REDUCTION[u.vest] ?? 0) + (HELMET_REDUCTION[u.helmet] ?? 0),
    };
  });

  return {
    width, height, locationType: 'continuous', cells, units: unitList,
    shapes: [...liveShapes(gs.map, gs.breakables), ...lootShapes(gs.loot)],
    ui: { hideGrid: true, visionRange: 5, fovDegrees: 110, aimedActionTypes: ['move', 'throw', 'shoot'],
          recolorTeamSprites: false, showHpBars: false },
    los: { blockShapes: survivLosBlockers(gs.map, destroyedIds) },
  };
}

// ── createInitialState ────────────────────────────────────────────────────────

export function createInitialState(players, config = {}) {
  const turnCap = config.turnCap ?? DEFAULT_TURN_CAP;
  const map = MAPS[config.mapId ?? 'sandbar_island'] ?? MAPS.sandbar_island;

  const [p1, p2] = players;
  // Slot 0 is always colored teamA (blue) by the generic design-UI slot coloring (see
  // games/cs/CsGame.js's identical note) — map slot 0 -> blue so the ring sprite choice
  // (ring-blue/ring-red, picked by ownerId) matches the UI's own team coloring.
  const teamMap       = { [p1.id]: 'blue', [p2.id]: 'red' };
  const teamPlayerMap = { blue: p1.id, red: p2.id };

  return {
    gameName: 'Surviv',
    turnNumber: 1,
    activePlayers: [teamPlayerMap.red],
    currentPhase: 'action',
    players,
    board: { width: map.width, height: map.height },
    units: spawnUnits(map),
    lastActions: null,
    gameSpecific: {
      turnCap,
      fogOfWar: config.fogOfWar ?? false,
      map,
      loot: buildLoot(map),
      breakables: initialBreakableState(map),
      teamMap, teamPlayerMap,
    },
  };
}

// ── Adapter: translate player IDs → team IDs ─────────────────────────────────

function withTeam(fn) {
  return (state, playerIdOrActions, ...rest) => {
    const { teamMap } = state.gameSpecific;
    if (Array.isArray(playerIdOrActions)) {
      const translated = playerIdOrActions.map(pa => ({ ...pa, playerId: teamMap[pa.playerId] ?? pa.playerId }));
      return fn(state, translated, ...rest);
    }
    return fn(state, teamMap[playerIdOrActions] ?? playerIdOrActions, ...rest);
  };
}

function getVisibleState(state, teamId) {
  const destroyedIds = destroyedIdSet(state.gameSpecific.breakables);
  const cfg = survivVisionCfg(state.gameSpecific.map, destroyedIds);
  return {
    ...state,
    units: survivFilterVisibleUnits(state.units, teamId, cfg, state.gameSpecific.map, p => [num(p.x), num(p.y)]),
  };
}

const PLAYER_SPEED = MOVE_RANGE;
const BULLET_SPEED = 20;

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = action.from ?? unit.position;
    const dx = num(action.to.x) - num(from.x), dy = num(action.to.y) - num(from.y);
    return Math.sqrt(dx * dx + dy * dy) / PLAYER_SPEED;
  }
  if (action.type === 'shoot') {
    const shooter = state.units.find(u => u.id === action.unitId);
    const target  = state.units.find(u => u.id === action.targetId);
    if (!shooter || !target) return 1;
    if (isMelee(shooter.weapon)) return 0.5;
    const dx = num(target.position.x) - num(shooter.position.x);
    const dy = num(target.position.y) - num(shooter.position.y);
    return Math.sqrt(dx * dx + dy * dy) / BULLET_SPEED;
  }
  if (action.type === 'throw')  return 1.5;
  if (action.type === 'reload') return 2;
  if (action.type === 'loot')   return 1;
  if (action.type === 'break')  return 1;
  return 1;
}

// ── Fog-of-war belief sampler ───────────────────────────────────────────────

function survivSampleWorlds(observation, myTeam, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getSurvivBelief(observation, myTeam);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng, makeUnit);
}

// Heuristic leaf value: survival (hp + flat bonus) plus a gear bonus — weapon tier,
// vest/helmet tier, and held grenades — so the search actually values pushing for
// better loot, not just staying alive (see games/evalHelpers.js's sidesEval; plain
// unitStrengthEval has no notion of equipment quality, which surviv centers on).
function unitGearValue(u) {
  const tier = WEAPONS[u.weapon].tier ?? 0;
  return (u.hp ?? 0) + 10 + tier * 8 + u.vest * 6 + u.helmet * 5 + (u.grenades?.frag ?? 0) * 4;
}
function survivEval(state, teamId) {
  return sidesEval(state.units, teamId, unitGearValue);
}

export const SurvivGame = {
  evaluateState: withTeam((state, teamId) => survivEval(state, teamId)),
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each team sees only enemies near its own players (bushes conceal at close range)', type: 'boolean', default: true },
  ],
  sampleWorlds: withTeam(survivSampleWorlds),
  name: 'Surviv',
  scenarios: [
    { id: 'sandbar_island', name: 'Sandbar Island', description: '10v10 across a mirrored island — forest lanes and river crossings funnel both teams into a loot-rich central town', config: { mapId: 'sandbar_island' } },
  ],
  createInitialState,
  actionKey:        survivActionKey,
  getLegalActions:  withTeam(getLegalActions),
  isActionLegal:    withTeam(isActionLegal),
  getSearchActions: withTeam(getSearchActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  toGrid,
  getVisibleState:  withTeam(getVisibleState),
  getActionDuration,
};
