import { unitStrengthEval } from '../evalHelpers.js';
import { MAP_WIDTH, MAP_HEIGHT, RENDER_SHAPES, LOS_OPEN_SHAPES, hasLOS, getReachable, renderMap, isWalkableContinuous } from './map.js';
import { WEAPONS, AMMO_CAPS, WEAPON_RANK } from './weapons.js';
import { createMarine, createMonster } from './units.js';
import { getDoomBelief, DOOM_VISION } from './belief.js';
import { hasClearLine, isClearOfUnits, latticeActions } from '../continuousMove.js';
import { filterVisibleUnits, orientToEnemies } from '../vision.js';
import { parsePos, num, tileNum, posToWire } from '../coord.js';
import { MAP_ZOOM_OPTION } from '../renderOptions.js';

const ROTATE_COST = 1;  // flat AP tax for a 'rotate' action (turn in place, no move)

// ── Default item placement ─────────────────────────────────────────────────────

function defaultItems() {
  return [
    // Start room
    { id: 'i0',  type: 'medkit',                x:  4, y:  3, pickedUp: false },
    // NE first-encounter room
    { id: 'i1',  type: 'shotgun-pickup',        x: 28, y:  3, pickedUp: false },
    { id: 'i2',  type: 'shell-box',             x: 31, y:  4, pickedUp: false },
    { id: 'i3',  type: 'health-bonus',          x: 20, y:  3, pickedUp: false },
    // Central spine / courtyard
    { id: 'i4',  type: 'bullet-box',            x: 20, y:  7, pickedUp: false },
    { id: 'i5',  type: 'armor-bonus',           x: 12, y:  9, pickedUp: false },
    // Armour platform in the nukage moat (the prize you wade for)
    { id: 'i6',  type: 'armor-vest',            x: 18, y: 12, pickedUp: false },
    // West store room + arena
    { id: 'i7',  type: 'chaingun-pickup',       x:  3, y: 14, pickedUp: false },
    { id: 'i8',  type: 'rocketlauncher-pickup', x: 24, y: 20, pickedUp: false },
    { id: 'i9',  type: 'rocket-box',            x: 26, y: 20, pickedUp: false },
    { id: 'i11', type: 'cell-pack',             x: 10, y: 20, pickedUp: false },
    { id: 'i12', type: 'medkit',                x: 11, y: 14, pickedUp: false },
    // Secret plasma room (east)
    { id: 'i10', type: 'plasma-pickup',         x: 34, y: 12, pickedUp: false },
  ];
}

// ── Apply a pickup item to a unit ──────────────────────────────────────────────

function applyPickup(unit, item) {
  const t = item.type;
  if (t === 'health-bonus') return { ...unit, hp: Math.min(unit.maxHp, unit.hp + 5) };
  if (t === 'medkit')       return { ...unit, hp: Math.min(unit.maxHp, unit.hp + 25) };
  if (t === 'armor-bonus')  return { ...unit, armor: Math.min(200, unit.armor + 5) };
  if (t === 'armor-vest')   return { ...unit, armor: Math.min(200, unit.armor + 100) };
  if (t === 'bullet-box')   return { ...unit, ammo: { ...unit.ammo, bullet: Math.min(AMMO_CAPS.bullet, unit.ammo.bullet + 20) } };
  if (t === 'shell-box')    return { ...unit, ammo: { ...unit.ammo, shell:  Math.min(AMMO_CAPS.shell,  unit.ammo.shell  + 10) } };
  if (t === 'rocket-box')   return { ...unit, ammo: { ...unit.ammo, rocket: Math.min(AMMO_CAPS.rocket, unit.ammo.rocket + 5) } };
  if (t === 'cell-pack')    return { ...unit, ammo: { ...unit.ammo, cell:   Math.min(AMMO_CAPS.cell,   unit.ammo.cell   + 40) } };
  // Weapon pickups — upgrade weapon + grant starter ammo
  const wpnPickups = {
    'shotgun-pickup':      ['shotgun',       { shell:  4  }],
    'chaingun-pickup':     ['chaingun',      { bullet: 20 }],
    'rocketlauncher-pickup': ['rocketlauncher', { rocket: 2 }],
    'plasma-pickup':       ['plasma',        { cell:  40  }],
  };
  if (wpnPickups[t]) {
    const [wpn, extraAmmo] = wpnPickups[t];
    const rank = WEAPON_RANK[wpn] ?? 0;
    const newAmmo = { ...unit.ammo };
    for (const [at, qty] of Object.entries(extraAmmo))
      newAmmo[at] = Math.min(AMMO_CAPS[at], newAmmo[at] + qty);
    // Only switch weapon if the pickup is better than current
    const newWeapon = rank > (WEAPON_RANK[unit.weapon] ?? 0) ? wpn : unit.weapon;
    return { ...unit, weapon: newWeapon, ammo: newAmmo };
  }
  return unit;
}

// ── Damage application (armor absorbs ~1/3) ────────────────────────────────────

function applyDamage(unit, dmg) {
  const absorbed = unit.armor > 0 ? Math.min(unit.armor, Math.floor(dmg / 3)) : 0;
  const newArmor = unit.armor - absorbed;
  const newHp    = Math.max(0, unit.hp - (dmg - absorbed));
  return { ...unit, hp: newHp, armor: newArmor, alive: newHp > 0 };
}

// ── getLegalActions (internal, called with team ID) ────────────────────────────

function getLegalActions(state, teamId) {
  const myUnits  = state.units.filter(u => u.alive && u.ownerId === teamId && u.perTurn.ap > 0);
  const enemies  = state.units.filter(u => u.alive && u.ownerId !== teamId);
  const actions  = [];

  for (const unit of myUnits) {
    // Move — remaining AP is a continuous movement budget (1 AP = 1 tile, spent by
    // exact distance in applyActions), so the discrete candidate set below — used only
    // by AI search — is capped at however many whole tiles are left, not a fixed stat.
    const reachable = getReachable(unit.position, Math.floor(num(unit.perTurn.ap)), state.units);
    for (const to of reachable)
      actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });

    // Shoot / Attack — costs a flat AP amount, no max range: a shot travels in a
    // straight line until it hits a wall or a unit (see applyActions/isShootLegal), so
    // only ammo/AP and line of sight gate it, not distance.
    const hasAmmo = teamId === 'marine'
      ? unit.ammo[WEAPONS[unit.weapon].ammoType] >= WEAPONS[unit.weapon].ammoPerShot
      : true;

    if (hasAmmo && unit.perTurn.ap >= unit.attrs.shootCost) {
      // Free-aim template: always offered while the weapon is loaded, even with no
      // enemy currently in LOS — the human aims a direction via the map-click overlay
      // (field.ui.aimedActionTypes) and applyActions resolves whichever enemy (if any)
      // lines up with the shot. Pushed first so the panel's per-unit dedup
      // (ActionsPanel.vue's aimedActions) picks this one as the representative button.
      actions.push({ type: 'shoot', unitId: unit.id });

      for (const enemy of enemies) {
        if (hasLOS(unit.position.x, unit.position.y, enemy.position.x, enemy.position.y))
          actions.push({ type: 'shoot', unitId: unit.id, targetId: enemy.id });
      }
    }

    // Rotate in place: face any point without moving, at a flat AP tax (ROTATE_COST) —
    // see applyActions and isRotateLegal. One untargeted template per unit; the human UI
    // aims freely at any point via the aiming overlay (field.ui.aimedActionTypes) and
    // the AI's search lattice (getSearchActions) expands it into concrete directions.
    if (unit.perTurn.ap >= ROTATE_COST)
      actions.push({ type: 'rotate', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── isMoveLegal (internal, called with team ID) ─────────────────────────────────
// Geometric fallback for the human UI's continuous click-to-move (see
// engine/ActionValidator.js): getLegalActions above still enumerates a discrete
// candidate set for AI search, but a player's move can target any point their click
// resolves to — legality here is a straight-line range/wall/occupancy check against
// the real room geometry instead of exact membership in that candidate set.
function isMoveLegal(state, teamId, action) {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.ap <= 0) return false;
  // The continuous geometry runs in float64 (see games/coord.js §2): convert the
  // authoritative BigNumber position and the incoming wire coordinate to Number here.
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.to.x), y = num(action.to.y);
  if (!isWalkableContinuous(x, y)) return false;
  if (Math.hypot(px - x, py - y) > num(unit.perTurn.ap)) return false;
  if (!hasClearLine(px, py, x, y, (qx, qy) => !isWalkableContinuous(qx, qy))) return false;
  if (!isClearOfUnits(x, y, state.units, unit.id)) return false;
  return true;
}

// Geometric fallback for a human continuous rotate (turn in place, no move): aim at
// any exact point and the unit faces it — no LOS/wall requirement, matching FFTA's
// untargeted facing choice.
function isRotateLegal(state, teamId, action) {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId || unit.perTurn.ap < ROTATE_COST) return false;
  const px = num(unit.position.x), py = num(unit.position.y);
  const x = num(action.target.x), y = num(action.target.y);
  if (Math.hypot(px - x, py - y) === 0) return false; // no direction to face
  return true;
}

// Free-aim shoot: legality only gates who/whether the unit may fire, not whether the
// aimed point/enemy will actually connect — a miss into empty space is still a legal
// shot (matches isThrowLegal's target-optional shape; applyActions resolves the hit).
function isShootLegal(state, teamId, action) {
  const unit = state.units.find(u => u.id === action.unitId);
  if (!unit || !unit.alive || unit.ownerId !== teamId) return false;
  const hasAmmo = teamId === 'marine'
    ? unit.ammo[WEAPONS[unit.weapon].ammoType] >= WEAPONS[unit.weapon].ammoPerShot
    : true;
  if (!hasAmmo || unit.perTurn.ap < unit.attrs.shootCost) return false;
  if (action.targetId) {
    const target = state.units.find(u => u.id === action.targetId);
    if (!target || !target.alive || target.ownerId === teamId) return false;
    return hasLOS(unit.position.x, unit.position.y, target.position.x, target.position.y);
  }
  if (action.target) {
    const x = num(action.target.x), y = num(action.target.y);
    return Math.hypot(num(unit.position.x) - x, num(unit.position.y) - y) > 0; // needs a direction to aim
  }
  return true; // bare "shoot" template with neither target — a no-op miss
}

// Dispatcher for the engine's continuous-action fallback (engine/ActionValidator.js):
// 'move'/'rotate' carry a continuous, not-pre-enumerated destination/aim point; 'shoot'
// may arrive as a free-aim point instead of one of getLegalActions' enumerated targetIds.
function isActionLegal(state, teamId, action) {
  if (action.type === 'move')   return isMoveLegal(state, teamId, action);
  if (action.type === 'rotate') return isRotateLegal(state, teamId, action);
  if (action.type === 'shoot')  return isShootLegal(state, teamId, action);
  return false;
}

// Stable identity for the ObscuroAgent's search tree — the generic defaultActionKey
// (games/types.js) doesn't cover `target`, so distinct rotate aim points would all
// collide onto the same key. Coordinates go through num() so continuous points key
// consistently (see games/coord.js).
function doomActionKey(a) {
  const pt = p => (p && typeof p === 'object') ? [num(p.x), num(p.y)] : null;
  return JSON.stringify([a.type ?? null, a.unitId ?? null, a.targetId ?? null, pt(a.to), pt(a.target)]);
}

// Continuous action set for the ObscuroAgent's tree search: each mover's discrete tile
// moves are replaced by a lattice of exact reachable points, so the AI positions freely
// like a human clicking the board (see games/continuousMove.js). Non-move actions
// (shoot/skip/end-turn) pass through unchanged.
function getSearchActions(state, teamId, res) {
  const units = state.units;
  let out = latticeActions(getLegalActions(state, teamId), {
    type: 'move', point: 'to',
    origin: a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y), range: num(u.perTurn.ap) } : null; },
    isLegal: (a, x, y) => isMoveLegal(state, teamId, { unitId: a.unitId, to: { x, y } }),
  }, res);
  // Rotate has no meaningful "range" (only the bearing matters) — a small fixed radius
  // just gives the lattice generator a nonzero ring to place candidate directions on.
  out = latticeActions(out, {
    type: 'rotate', point: 'target',
    origin: a => { const u = units.find(x => x.id === a.unitId); return u ? { x: num(u.position.x), y: num(u.position.y), range: 1 } : null; },
    isLegal: (a, x, y) => isRotateLegal(state, teamId, { unitId: a.unitId, target: { x, y } }),
  }, res);
  return out;
}

// ── applyActions (internal, called with team ID in playerActions) ──────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let { units } = state;
  let gs = state.gameSpecific;

  // ── end-turn ────────────────────────────────────────────────────────────────
  if (action.type === 'end-turn') {
    const other = playerId === 'marine' ? 'demon' : 'marine';
    const nextPlayerId = gs.teamPlayerMap[other];
    const isNewRound   = other === 'marine';
    units = units.map(u => u.ownerId === other ? { ...u, perTurn: { ap: u.attrs.maxAP } } : u);
    return {
      ...state, units,
      activePlayers: [nextPlayerId],
      currentPhase:  other === 'marine' ? 'marine-turn' : 'demon-turn',
      turnNumber:    isNewRound ? state.turnNumber + 1 : state.turnNumber,
      lastActions:   playerActions,
      gameSpecific:  gs,
    };
  }

  // ── move ─────────────────────────────────────────────────────────────────────
  if (action.type === 'move') {
    // action.to arrives from the wire as decimal strings (human continuous click) or
    // integer tiles (AI candidate); store it as the authoritative BigNumber position.
    const to = parsePos(action.to);
    units = units.map(u => {
      if (u.id !== action.unitId) return u;
      // AP is a continuous budget: moving costs exactly the distance travelled (1 AP
      // per tile), not a flat per-action price — see units.js for the stat rationale.
      const dist = Math.hypot(num(u.position.x) - num(to.x), num(u.position.y) - num(to.y));
      // Movement-derived heading: a unit faces where it last moved, driving its vision
      // cone (see games/vision.js). A zero-length move keeps the old facing.
      const facing = dist > 0
        ? Math.atan2(num(to.y) - num(u.position.y), num(to.x) - num(u.position.x))
        : u.facing;
      return { ...u, position: to, facing, perTurn: { ap: Math.max(0, u.perTurn.ap - dist) } };
    });

    // Marines auto-collect an item when they end their move on its tile.
    if (playerId === 'marine') {
      const tx = tileNum(to.x), ty = tileNum(to.y);
      const item = gs.items.find(it => !it.pickedUp && it.x === tx && it.y === ty);
      if (item) {
        units = units.map(u => u.id === action.unitId ? applyPickup(u, item) : u);
        gs = { ...gs, items: gs.items.map(it => it.id === item.id ? { ...it, pickedUp: true } : it) };
      }
    }

    return { ...state, units, gameSpecific: gs, lastActions: playerActions };
  }

  // ── shoot / attack ───────────────────────────────────────────────────────────
  if (action.type === 'shoot') {
    const shooter = units.find(u => u.id === action.unitId);
    if (!shooter) return state;

    let target = action.targetId ? units.find(u => u.id === action.targetId) : null;

    // Free-aim: no locked target arrived on the wire — walk the aimed ray out
    // indefinitely (no max range) and hit whichever enemy (if any) lines up with it
    // first; hasLOS already stops the ray at the first wall in the way, since a wall
    // between the shooter and a farther enemy breaks that enemy's LOS check. A bare
    // template with no aim point either is a pure no-op.
    if (!target && action.target) {
      const sx = num(shooter.position.x), sy = num(shooter.position.y);
      const t  = parsePos(action.target);
      const dx = num(t.x) - sx, dy = num(t.y) - sy;
      const aimDist = Math.hypot(dx, dy) || 1;
      const dirx = dx / aimDist, diry = dy / aimDist;
      const HIT_RADIUS = 0.6;
      let hitAlong = Infinity;
      for (const e of units) {
        if (!e.alive || e.ownerId === shooter.ownerId) continue;
        const ex = num(e.position.x), ey = num(e.position.y);
        const along = (ex - sx) * dirx + (ey - sy) * diry;
        if (along < 0) continue;
        const px = sx + dirx * along, py = sy + diry * along;
        if (Math.hypot(ex - px, ey - py) > HIT_RADIUS) continue;
        if (!hasLOS(sx, sy, ex, ey)) continue;
        if (along < hitAlong) { hitAlong = along; target = e; }
      }
    }

    // Determine shot parameters (also spends ammo/AP on a miss — a shot fired into
    // empty space still consumes the round, same as surviv's isMelee-guarded fire()).
    let accuracy, pellets, dmgRange, isSplash = false;
    if (playerId === 'marine') {
      const wpn = WEAPONS[shooter.weapon];
      accuracy  = wpn.accuracy;
      pellets   = wpn.pellets;
      dmgRange  = wpn.damage;
      isSplash  = wpn.splash ?? false;
      units = units.map(u => u.id === shooter.id
        ? { ...u, perTurn: { ap: Math.max(0, u.perTurn.ap - u.attrs.shootCost) }, ammo: { ...u.ammo, [wpn.ammoType]: u.ammo[wpn.ammoType] - wpn.ammoPerShot } }
        : u);
    } else {
      accuracy = shooter.attrs.accuracy;
      pellets  = shooter.attrs.pellets;
      dmgRange = shooter.attrs.damage;
      units    = units.map(u => u.id === shooter.id ? { ...u, perTurn: { ap: Math.max(0, u.perTurn.ap - u.attrs.shootCost) } } : u);
    }

    if (!target) {
      const enriched = { playerId, action: { ...action, hits: 0, totalDamage: 0 } };
      return { ...state, units, gameSpecific: gs, lastActions: [enriched] };
    }

    // Roll each pellet
    let totalDamage = 0;
    let hits = 0;
    for (let p = 0; p < pellets; p++) {
      if (Math.floor(rng() * 100) + 1 <= accuracy) {
        hits++;
        totalDamage += dmgRange[0] + Math.floor(rng() * (dmgRange[1] - dmgRange[0] + 1));
      }
    }

    // Apply damage to primary target
    if (totalDamage > 0) {
      units = units.map(u => u.id === target.id ? applyDamage(u, totalDamage) : u);
    }

    // Splash damage (rocket launcher) — half damage to adjacent units
    if (isSplash) {
      const tpx = num(target.position.x), tpy = num(target.position.y);
      const splashUnits = units.filter(u =>
        u.alive && u.id !== target.id &&
        Math.abs(num(u.position.x) - tpx) <= 1 && Math.abs(num(u.position.y) - tpy) <= 1
      );
      for (const su of splashUnits) {
        const splashDmg = Math.floor((dmgRange[0] + Math.floor(rng() * (dmgRange[1] - dmgRange[0] + 1))) / 2);
        units = units.map(u => u.id === su.id ? applyDamage(u, splashDmg) : u);
      }
    }

    const enriched = { playerId, action: { ...action, targetId: target.id, hits, totalDamage } };
    return { ...state, units, gameSpecific: gs, lastActions: [enriched] };
  }

  // ── rotate ───────────────────────────────────────────────────────────────────
  if (action.type === 'rotate') {
    const target = parsePos(action.target);
    units = units.map(u => {
      if (u.id !== action.unitId) return u;
      const dx = num(target.x) - num(u.position.x), dy = num(target.y) - num(u.position.y);
      return { ...u, facing: Math.atan2(dy, dx), perTurn: { ap: Math.max(0, u.perTurn.ap - ROTATE_COST) } };
    });
    return { ...state, units, gameSpecific: gs, lastActions: playerActions };
  }

  return state;
}

// ── withTeam adapter ──────────────────────────────────────────────────────────

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

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(state) {
  const { teamPlayerMap } = state.gameSpecific;
  const marineAlive = state.units.some(u => u.ownerId === 'marine' && u.alive);
  const demonAlive  = state.units.some(u => u.ownerId === 'demon'  && u.alive);
  if (!marineAlive) return { outcome: 'win', winnerId: teamPlayerMap['demon'],  reason: 'rip-and-tear (marine down)' };
  if (!demonAlive)  return { outcome: 'win', winnerId: teamPlayerMap['marine'], reason: 'demons-eliminated' };
  if (state.turnNumber > 80) return { outcome: 'win', winnerId: teamPlayerMap['marine'], reason: 'survived' };
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, gameSpecific: gs } = state;
  const phase = activePlayers[0] === gs.teamPlayerMap['marine'] ? 'MARINE' : 'DEMON';

  const marines = units.filter(u => u.ownerId === 'marine');
  const demons  = units.filter(u => u.ownerId === 'demon' && u.alive);

  const marineStr = marines.map(u => {
    if (!u.alive) return '@(dead)';
    const wpn = WEAPONS[u.weapon];
    const ammoStr = `${u.ammo[wpn.ammoType]}${wpn.ammoType[0]}`;
    return `@(${u.hp}hp${u.armor ? ` ${u.armor}arm` : ''} ${u.weapon}:${ammoStr} AP:${u.perTurn.ap.toFixed(1)})`;
  }).join(' ');

  const demonStr = demons.map(u => `${u.attrs.symbol}[${u.id}](${u.hp}hp)`).join('  ') || '(all dead)';

  let lastStr = '';
  if (state.lastActions?.length) {
    const { action } = state.lastActions[0];
    if (action?.type === 'shoot') {
      const src = units.find(u => u.id === action.unitId);
      const tgt = units.find(u => u.id === action.targetId);
      const hit = action.hits > 0 ? `${action.hits} hit${action.hits !== 1 ? 's' : ''}, ${action.totalDamage} dmg` : 'MISS';
      lastStr = `>> ${src?.type ?? action.unitId} → ${tgt?.type ?? action.targetId}: ${hit}`;
    }
  }

  return [
    `═══ Turn ${turnNumber} — ${phase} turn ═══`,
    renderMap(state),
    `Legend: @=Marine  z=Zombie g=Shotgunner i=Imp D=Demon C=Cacodemon B=Baron`,
    `        +=health  a=armor  s=shotgun  c=chaingun  r=rocket  p=plasma  $=ammo`,
    '',
    `Marine: ${marineStr}`,
    `Demons: ${demonStr}`,
    lastStr,
  ].filter(Boolean).join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const [p1, p2] = players;
  const teamMap       = { [p1.id]: 'marine', [p2.id]: 'demon' };
  const teamPlayerMap = { marine: p1.id, demon: p2.id };

  const marines = [
    createMarine('marine-1', { x: 4, y: 4 }), // NW start room
  ];

  const demons = [
    // NE first-encounter room — ranged hitscanners
    createMonster('zombie-1',    'zombieman',  { x: 26, y: 4 }),
    createMonster('zombie-2',    'zombieman',  { x: 30, y: 5 }),
    createMonster('shotgunner-1','shotgunner', { x: 28, y: 8 }),
    // Courtyard / nukage channel — imp ambush
    createMonster('imp-1',       'imp',        { x: 25, y: 12 }),
    createMonster('imp-2',       'imp',        { x: 14, y: 18 }),
    // Secret plasma room — imp guard
    createMonster('imp-3',       'imp',        { x: 33, y: 11 }),
    // South arena — melee brute + bosses
    createMonster('demon-1',     'demon',      { x: 12, y: 21 }),
    createMonster('cacodemon-1', 'cacodemon',  { x: 20, y: 21 }),
    createMonster('baron-1',     'baron',      { x: 24, y: 21 }),
  ];

  // Orient each side toward the enemy at spawn so vision cones point at the action from
  // turn 1 (facing then follows movement — see the move handler and games/vision.js).
  const units = orientToEnemies([...marines, ...demons], p => [num(p.x), num(p.y)]);

  return {
    gameName: 'Doom',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'marine-turn',
    players,
    board: { width: MAP_WIDTH, height: MAP_HEIGHT },
    units,
    lastActions: null,
    gameSpecific: {
      teamMap, teamPlayerMap, items: defaultItems(),
      fogOfWar: config.fogOfWar ?? false,
      // Common-knowledge starting deployment, used to seed the fog belief
      // tracker (belief.js).
      startRoster: units.map(u => ({
        id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position },
        hp: u.hp, maxAP: u.attrs.maxAP,
      })),
    },
  };
}

// ── toGrid (design UI) ──────────────────────────────────────────────────────────
// Non-grid terrain like CsGame/CombatMissionGame: the E1M1 level is authored as shapes
// (rects + ovals — see map.js), drawn over a uniform rock backdrop. RENDER_SHAPES layers
// the floor rooms/corridors (tinted per kind) then the solid props on top (nukage pools,
// crates, computer banks, columns, barrels) — 100+ terrain objects in all.

// Side-panel portraits (single sprite frame each, sourced from doom.fandom.com).
const UNIT_PORTRAITS = new Set(['doomguy', 'zombieman', 'shotgunner', 'imp', 'demon', 'cacodemon', 'baron']);

// Marine loadout for the design UI's SelectedUnitDetail equipment list (weapon,
// ammo for that weapon, and armor) — monsters carry no inventory to show.
function equipmentList(u) {
  const wpn = WEAPONS[u.weapon];
  return [
    { label: 'Weapon', value: wpn.label ?? u.weapon },
    { label: 'Ammo',   value: `${u.ammo[wpn.ammoType]} ${wpn.ammoType}` },
    { label: 'Armor',  value: u.armor > 0 ? `${u.armor}` : 'None' },
  ];
}

function toGrid(state) {
  const { units, gameSpecific: gs } = state;
  const pidIdx = {};
  state.players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

  // Terrain-only cells (uniform rock backdrop). Unit positions travel in the
  // continuous `units` channel below, not by exact-match into this integer grid.
  const cells = [];
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++)
      cells.push({ x, y, color: '#23262b' });

  // Continuous unit channel: real (possibly non-integer) positions as decimal
  // strings (see games/coord.js), built directly from state.units — no cell-grid
  // indexing, so a unit's exact point always reaches the client.
  const unitList = units.filter(u => u.alive).map(u => {
    const p = posToWire(u.position);
    return {
      id: u.id, x: p.x, y: p.y,
      glyph:     u.attrs.symbol,
      unitName:  u.type,
      facing:    u.facing,
      owner:     pidIdx[gs.teamPlayerMap[u.ownerId]] ?? 0,
      hp:        u.hp,
      maxHp:     u.maxHp,
      job:       u.weapon,
      // Remaining AP *is* the remaining move reach now (1 AP = 1 tile) — sending it
      // here instead of a fixed stat is what makes the client's move-range circle
      // actually shrink as AP is spent across a turn.
      moveRange: num(u.perTurn.ap),
      apNow: num(u.perTurn.ap),
      apMax: u.attrs.maxAP,
      portraitPath: UNIT_PORTRAITS.has(u.type) ? `/images/doom/units/${u.type}` : undefined,
      equipment: u.ownerId === 'marine' ? equipmentList(u) : undefined,
    };
  });

  // Exact occluder geometry for the client's fog/reach renderer: the floor is the union
  // of the authored floor shapes (LOS_OPEN_SHAPES), walls (incl. every solid prop, which
  // sits on an un-floored cell) are the complement. Sending the true shapes (not a
  // rasterized tile grid) lets vision respect a room's real entrance — e.g. an oval room
  // whose mouth is a narrow cusp stays almost fully hidden from the hallway.
  const openShapes = LOS_OPEN_SHAPES;

  return {
    width: MAP_WIDTH, height: MAP_HEIGHT, locationType: 'continuous',
    cells, units: unitList, shapes: RENDER_SHAPES,
    // Hand the veil the SAME sight range + cone the engine reveals with (DOOM_VISION), so
    // the drawn vision circle/cone matches getVisibleState exactly (both Euclidean now).
    ui: { hideGridLines: true, visionRange: DOOM_VISION.range, fovDegrees: DOOM_VISION.fovDegrees,
          aimedActionTypes: ['move', 'shoot', 'rotate'] },
    los: { openShapes },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

function getVisibleState(state, teamId) {
  // Own units + any enemy an own unit can see (range + LOS + facing cone). DOOM_VISION is
  // shared with belief.js so the observation and the fog sampler stay in lockstep.
  return {
    ...state,
    units: filterVisibleUnits(state.units, teamId, DOOM_VISION, p => [num(p.x), num(p.y)]),
  };
}

// ── Fog belief sampler (internal, called with team ID via withTeam) ────────────
function makeEnemyUnit(id, ownerId, type, x, y) {
  return ownerId === 'marine' ? createMarine(id, { x, y }) : createMonster(id, type, { x, y });
}

function sampleWorlds(observation, myTeam, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getDoomBelief(observation, myTeam);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng, makeEnemyUnit);
}

export const DoomGame = {
  // Heuristic leaf value for the generic ObscuroAgent: own surviving strength
  // minus the enemy's. See games/evalHelpers.js.
  // Team game: withTeam translates the player id to its team ownerId (T/CT,
  // marine/demon) before the material eval. See games/evalHelpers.js.
  evaluateState: withTeam((state, teamId) => unitStrengthEval(state, teamId)),
  name: 'Doom',
  scenarios: [
    { id: 'e1m1', name: 'Hangar (E1M1)', description: 'The UAC hangar — survive waves of hell-spawned demons', config: {} },
  ],
  gameOptions: [
    MAP_ZOOM_OPTION,
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemies within sight and line of sight', type: 'boolean', default: true },
  ],
  createInitialState,
  actionKey:        doomActionKey,
  getLegalActions:  withTeam(getLegalActions),
  isActionLegal:    withTeam(isActionLegal),
  getSearchActions: withTeam(getSearchActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  toGrid,
  getVisibleState:  withTeam(getVisibleState),
  sampleWorlds:     withTeam(sampleWorlds),
};
