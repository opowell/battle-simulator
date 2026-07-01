import { unitStrengthEval } from '../evalHelpers.js';
import { MAP_WIDTH, MAP_HEIGHT, hasLOS, getReachable, manhattan, renderMap } from './map.js';
import { WEAPONS, AMMO_CAPS, WEAPON_RANK } from './weapons.js';
import { createMarine, createMonster } from './units.js';
import { getDoomBelief } from './belief.js';

// ── Default item placement ─────────────────────────────────────────────────────

function defaultItems() {
  return [
    // Room A
    { id: 'i0',  type: 'medkit',              x:  4, y:  3, pickedUp: false },
    // Room B
    { id: 'i1',  type: 'shotgun-pickup',      x: 12, y:  1, pickedUp: false },
    { id: 'i2',  type: 'shell-box',           x: 11, y:  3, pickedUp: false },
    { id: 'i3',  type: 'health-bonus',        x: 16, y:  4, pickedUp: false },
    // Room C
    { id: 'i4',  type: 'bullet-box',          x: 10, y:  7, pickedUp: false },
    { id: 'i5',  type: 'armor-bonus',         x:  6, y:  6, pickedUp: false },
    // Room D
    { id: 'i6',  type: 'armor-vest',          x:  3, y:  9, pickedUp: false },
    { id: 'i7',  type: 'chaingun-pickup',     x:  6, y: 11, pickedUp: false },
    { id: 'i8',  type: 'rocketlauncher-pickup', x: 2, y: 11, pickedUp: false },
    // Room E
    { id: 'i9',  type: 'rocket-box',          x: 15, y:  8, pickedUp: false },
    { id: 'i10', type: 'plasma-pickup',       x: 17, y:  9, pickedUp: false },
    { id: 'i11', type: 'cell-pack',           x: 14, y: 11, pickedUp: false },
    { id: 'i12', type: 'medkit',              x: 11, y: 11, pickedUp: false },
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
    // Move
    const reachable = getReachable(unit.position, unit.attrs.moveRange, state.units);
    for (const to of reachable)
      actions.push({ type: 'move', unitId: unit.id, from: unit.position, to });

    // Shoot / Attack
    const [range, hasAmmo] = teamId === 'marine'
      ? [WEAPONS[unit.weapon].range, unit.ammo[WEAPONS[unit.weapon].ammoType] >= WEAPONS[unit.weapon].ammoPerShot]
      : [unit.attrs.range, true];

    if (hasAmmo) {
      for (const enemy of enemies) {
        if (manhattan(unit.position, enemy.position) <= range &&
            hasLOS(unit.position.x, unit.position.y, enemy.position.x, enemy.position.y))
          actions.push({ type: 'shoot', unitId: unit.id, targetId: enemy.id });
      }
    }

    actions.push({ type: 'skip-unit', unitId: unit.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
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
    units = units.map(u => u.id === action.unitId
      ? { ...u, position: action.to, perTurn: { ap: u.perTurn.ap - 1 } }
      : u);

    // Marines auto-collect items when they step on them
    if (playerId === 'marine') {
      const item = gs.items.find(it => !it.pickedUp && it.x === action.to.x && it.y === action.to.y);
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
    const target  = units.find(u => u.id === action.targetId);
    if (!shooter || !target) return state;

    // Determine shot parameters
    let accuracy, pellets, dmgRange, isSplash = false;
    if (playerId === 'marine') {
      const wpn = WEAPONS[shooter.weapon];
      accuracy  = wpn.accuracy;
      pellets   = wpn.pellets;
      dmgRange  = wpn.damage;
      isSplash  = wpn.splash ?? false;
      units = units.map(u => u.id === shooter.id
        ? { ...u, perTurn: { ap: 0 }, ammo: { ...u.ammo, [wpn.ammoType]: u.ammo[wpn.ammoType] - wpn.ammoPerShot } }
        : u);
    } else {
      accuracy = shooter.attrs.accuracy;
      pellets  = shooter.attrs.pellets;
      dmgRange = shooter.attrs.damage;
      units    = units.map(u => u.id === shooter.id ? { ...u, perTurn: { ap: 0 } } : u);
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
      const tp = target.position;
      const splashUnits = units.filter(u =>
        u.alive && u.id !== target.id &&
        Math.abs(u.position.x - tp.x) <= 1 && Math.abs(u.position.y - tp.y) <= 1
      );
      for (const su of splashUnits) {
        const splashDmg = Math.floor((dmgRange[0] + Math.floor(rng() * (dmgRange[1] - dmgRange[0] + 1))) / 2);
        units = units.map(u => u.id === su.id ? applyDamage(u, splashDmg) : u);
      }
    }

    const enriched = { playerId, action: { ...action, hits, totalDamage } };
    return { ...state, units, gameSpecific: gs, lastActions: [enriched] };
  }

  // ── skip-unit ─────────────────────────────────────────────────────────────────
  if (action.type === 'skip-unit') {
    units = units.map(u => u.id === action.unitId ? { ...u, perTurn: { ap: 0 } } : u);
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
    return `@(${u.hp}hp${u.armor ? ` ${u.armor}arm` : ''} ${u.weapon}:${ammoStr} AP:${u.perTurn.ap})`;
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
    createMarine('marine-1', { x: 2, y: 2 }),
  ];

  const demons = [
    // Room B — first encounter (ranged)
    createMonster('zombie-1',   'zombieman', { x: 12, y: 2 }),
    createMonster('zombie-2',   'zombieman', { x: 16, y: 3 }),
    createMonster('imp-1',      'imp',       { x: 14, y: 4 }),
    // Room C — mid corridor (imp ambush)
    createMonster('imp-2',      'imp',       { x: 13, y: 6 }),
    // Room D — melee brute
    createMonster('demon-1',    'demon',     { x:  4, y: 10 }),
    // Room E — bosses
    createMonster('cacodemon-1','cacodemon', { x: 13, y: 10 }),
    createMonster('baron-1',    'baron',     { x: 16, y: 10 }),
  ];

  return {
    gameName: 'Doom',
    turnNumber: 1,
    activePlayers: [p1.id],
    currentPhase: 'marine-turn',
    players,
    board: { width: MAP_WIDTH, height: MAP_HEIGHT },
    units: [...marines, ...demons],
    lastActions: null,
    gameSpecific: {
      teamMap, teamPlayerMap, items: defaultItems(),
      fogOfWar: config.fogOfWar ?? false,
      // Common-knowledge starting deployment, used to seed the fog belief
      // tracker (belief.js).
      startRoster: [...marines, ...demons].map(u => ({
        id: u.id, ownerId: u.ownerId, type: u.type, position: { ...u.position },
        hp: u.hp, moveRange: u.attrs.moveRange, maxAP: u.attrs.maxAP,
      })),
    },
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

function getVisibleState(state, teamId) {
  const VISION = 6;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === teamId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === teamId ||
      myUnits.some(m =>
        Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION &&
        hasLOS(m.position.x, m.position.y, u.position.x, u.position.y)
      )
    ),
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
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only enemies within sight and line of sight', type: 'boolean', default: false },
  ],
  createInitialState,
  getLegalActions:  withTeam(getLegalActions),
  applyActions:     withTeam(applyActions),
  getResult,
  renderState,
  getVisibleState:  withTeam(getVisibleState),
  sampleWorlds:     withTeam(sampleWorlds),
};
