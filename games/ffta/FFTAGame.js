import { ABILITIES } from './abilities.js';
import { JOB_DEFS, createUnit } from './units.js';
import { createMap, renderMap, getTile } from './map.js';
import { getReachable, getInRange, manhattan } from './grid.js';

// ── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = {
  standard: {
    p1: [
      { job: 'soldier',   pos: { x: 1, y: 1 } },
      { job: 'whiteMage', pos: { x: 2, y: 1 } },
      { job: 'archer',    pos: { x: 1, y: 2 } },
      { job: 'thief',     pos: { x: 2, y: 2 } },
    ],
    p2: [
      { job: 'fighter',   pos: { x: 10, y: 8 } },
      { job: 'blackMage', pos: { x: 9,  y: 8 } },
      { job: 'archer',    pos: { x: 10, y: 7 } },
      { job: 'soldier',   pos: { x: 9,  y: 7 } },
    ],
  },
  ambush: {
    p1: [
      { job: 'soldier',   pos: { x: 4, y: 1 } },
      { job: 'whiteMage', pos: { x: 3, y: 1 } },
      { job: 'archer',    pos: { x: 3, y: 2 } },
    ],
    p2: [
      { job: 'fighter',   pos: { x: 8, y: 7 } },
      { job: 'fighter',   pos: { x: 9, y: 7 } },
      { job: 'soldier',   pos: { x: 9, y: 6 } },
      { job: 'archer',    pos: { x: 8, y: 6 } },
      { job: 'blackMage', pos: { x: 7, y: 7 } },
    ],
  },
  jagd: {
    p1: [
      { job: 'fighter',  pos: { x: 2, y: 1 } },
      { job: 'ninja',    pos: { x: 2, y: 2 } },
      { job: 'dragoon',  pos: { x: 1, y: 2 } },
      { job: 'assassin', pos: { x: 1, y: 1 } },
    ],
    p2: [
      { job: 'fighter',  pos: { x: 9,  y: 7 } },
      { job: 'fighter',  pos: { x: 10, y: 7 } },
      { job: 'dragoon',  pos: { x: 10, y: 8 } },
      { job: 'ninja',    pos: { x: 9,  y: 8 } },
    ],
  },
  magicCouncil: {
    p1: [
      { job: 'whiteMage', pos: { x: 2, y: 2 } },
      { job: 'blackMage', pos: { x: 3, y: 2 } },
      { job: 'timeMage',  pos: { x: 2, y: 1 } },
    ],
    p2: [
      { job: 'blackMage',   pos: { x: 8, y: 7 } },
      { job: 'summoner',    pos: { x: 9, y: 7 } },
      { job: 'illusionist', pos: { x: 8, y: 6 } },
    ],
  },
  honorGuard: {
    p1: [
      { job: 'soldier',   pos: { x: 2, y: 1 } },
      { job: 'paladin',   pos: { x: 3, y: 1 } },
      { job: 'whiteMage', pos: { x: 2, y: 2 } },
      { job: 'archer',    pos: { x: 4, y: 1 } },
    ],
    p2: [
      { job: 'soldier',  pos: { x: 8,  y: 7 } },
      { job: 'soldier',  pos: { x: 9,  y: 7 } },
      { job: 'soldier',  pos: { x: 8,  y: 6 } },
      { job: 'fighter',  pos: { x: 9,  y: 6 } },
      { job: 'fighter',  pos: { x: 10, y: 7 } },
      { job: 'archer',   pos: { x: 10, y: 6 } },
    ],
  },
  desertReckoning: {
    p1: [
      { job: 'archer',       pos: { x: 2, y: 1 } },
      { job: 'redMage',      pos: { x: 2, y: 2 } },
      { job: 'elementalist', pos: { x: 1, y: 2 } },
      { job: 'assassin',     pos: { x: 1, y: 1 } },
    ],
    p2: [
      { job: 'fighter',  pos: { x: 9,  y: 7 } },
      { job: 'dragoon',  pos: { x: 10, y: 7 } },
      { job: 'fighter',  pos: { x: 9,  y: 8 } },
      { job: 'dragoon',  pos: { x: 10, y: 8 } },
    ],
  },
};

// ── Turn queue ────────────────────────────────────────────────────────────────

function effectiveSpd(u) {
  let spd = u.stats.spd;
  if (u.statusEffects.includes('slow'))  spd = Math.floor(spd * 0.5);
  if (u.statusEffects.includes('haste')) spd = Math.floor(spd * 1.5);
  return spd;
}

function buildTurnQueue(units) {
  return units
    .filter(u => u.alive)
    .sort((a, b) => effectiveSpd(b) - effectiveSpd(a) || a.id.localeCompare(b.id))
    .map(u => u.id);
}

// ── Damage/heal ───────────────────────────────────────────────────────────────

function calcDamage(attacker, defender, ability, board, rng) {
  const atkH = getTile(board, attacker.position.x, attacker.position.y).height;
  const defH = getTile(board, defender.position.x, defender.position.y).height;
  const heightMult = 1 + 0.2 * Math.max(0, atkH - defH);

  let atk, def;
  if (ability.type === 'magic') {
    atk = attacker.stats.mag;
    def = defender.stats.res;
  } else {
    atk = attacker.stats.atk;
    def = defender.stats.def;
    if (attacker.statusEffects.includes('atk-break')) atk = Math.floor(atk * 0.75);
    if (defender.statusEffects.includes('armor-break')) def = Math.floor(def * 0.75);
    if (defender.statusEffects.includes('protect')) def = Math.floor(def * 1.25);
  }
  if (attacker.statusEffects.includes('blind')) atk = Math.floor(atk * 0.7);

  const base = Math.max(1, Math.floor(atk * ability.power * heightMult - def * 0.5));
  return Math.max(1, Math.floor(base * (0.85 + rng() * 0.3)));
}

function calcHeal(caster, ability, rng) {
  const base = Math.floor(caster.stats.mag * ability.power);
  return Math.max(1, Math.floor(base * (0.9 + rng() * 0.2)));
}

// ── Apply ability ─────────────────────────────────────────────────────────────

function applyAbility(state, casterId, targetId, abilityName, rng) {
  const units = state.units.map(u => ({ ...u, statusEffects: [...u.statusEffects] }));
  const caster = units.find(u => u.id === casterId);
  const target = units.find(u => u.id === targetId);
  const ability = ABILITIES[abilityName];

  caster.mp -= ability.mpCost;
  caster.acted = true;

  const { effect } = ability;

  if (effect === 'damage' || effect === 'damage+status' || effect === 'damage+steal-mp') {
    const dmg = calcDamage(caster, target, ability, state.board, rng);
    target.hp = Math.max(0, target.hp - dmg);
    target.alive = target.hp > 0;

    if (effect === 'damage+status' && ability.status && target.alive) {
      if (!target.statusEffects.includes(ability.status)) target.statusEffects.push(ability.status);
    }
    if (effect === 'damage+steal-mp') {
      const stolen = Math.min(target.mp, 8);
      target.mp -= stolen;
      caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
    }
  } else if (effect === 'heal') {
    const healAmt = calcHeal(caster, ability, rng);
    target.hp = Math.min(target.maxHp, target.hp + healAmt);
  } else if (effect === 'status' && ability.status) {
    if (!target.statusEffects.includes(ability.status)) target.statusEffects.push(ability.status);
  } else if (effect === 'steal-mp') {
    const stolen = Math.min(target.mp, 8);
    target.mp -= stolen;
    caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
  }

  return units;
}

// ── Advance to next unit's turn ───────────────────────────────────────────────

function advanceTurn(state) {
  let units = state.units.map(u => ({ ...u }));
  let { activeUnitId, turnQueue, roundNumber } = state.gameSpecific;
  let { turnNumber } = state;

  units = units.map(u => u.id === activeUnitId ? { ...u, moved: true, acted: true } : u);

  let remaining = turnQueue.filter(id => units.find(u => u.id === id)?.alive);

  let nextId;
  if (remaining.length > 0) {
    [nextId, ...remaining] = remaining;
  } else {
    roundNumber += 1;
    turnNumber += 1;
    const order = buildTurnQueue(units);
    units = units.map(u => u.alive ? { ...u, moved: false, acted: false } : u);
    [nextId, ...remaining] = order;
  }

  const nextOwner = units.find(u => u.id === nextId)?.ownerId ?? state.players[0].id;

  return {
    units,
    turnNumber,
    activePlayers: [nextOwner],
    gameSpecific: { activeUnitId: nextId, turnQueue: remaining, roundNumber },
  };
}

// ── Ability preview (damage/heal range estimate) ──────────────────────────────

function abilityPreview(caster, target, ability, board) {
  const { effect } = ability;

  if (effect === 'damage' || effect === 'damage+status' || effect === 'damage+steal-mp') {
    const atkH = getTile(board, caster.position.x, caster.position.y).height;
    const defH = getTile(board, target.position.x, target.position.y).height;
    const heightMult = 1 + 0.2 * Math.max(0, atkH - defH);

    let atk, def;
    if (ability.type === 'magic') {
      atk = caster.stats.mag;
      def = target.stats.res;
    } else {
      atk = caster.stats.atk;
      def = target.stats.def;
      if (caster.statusEffects.includes('atk-break')) atk = Math.floor(atk * 0.75);
      if (target.statusEffects.includes('armor-break')) def = Math.floor(def * 0.75);
      if (target.statusEffects.includes('protect')) def = Math.floor(def * 1.25);
    }
    if (caster.statusEffects.includes('blind')) atk = Math.floor(atk * 0.7);

    const base = Math.max(1, Math.floor(atk * ability.power * heightMult - def * 0.5));
    const lo = Math.max(1, Math.floor(base * 0.85));
    const hi = Math.max(1, Math.floor(base * 1.15));
    let p = lo === hi ? `~${lo} dmg` : `${lo}-${hi} dmg`;
    if (effect === 'damage+status' && ability.status) p += ` + ${ability.status}`;
    if (effect === 'damage+steal-mp') p += ` + steal MP`;
    return p;
  }

  if (effect === 'heal') {
    const base = Math.floor(caster.stats.mag * ability.power);
    const lo = Math.max(1, Math.floor(base * 0.9));
    const hi = Math.max(1, Math.floor(base * 1.1));
    return lo === hi ? `~${lo} heal` : `${lo}-${hi} heal`;
  }

  if (effect === 'status' && ability.status) return `→ ${ability.status}`;
  if (effect === 'steal-mp') return `steal ≤8 MP`;

  return null;
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { activeUnitId } = state.gameSpecific;
  const unit = state.units.find(u => u.id === activeUnitId && u.alive);

  if (!unit || unit.ownerId !== playerId) {
    return [{ type: 'end-turn', unitId: '__player__' }];
  }

  const actions = [];

  if (!unit.moved) {
    const { moveRange } = JOB_DEFS[unit.job];
    for (const to of getReachable(state.board, unit.position, moveRange, state.units)) {
      actions.push({ type: 'move', unitId: unit.id, to });
    }
  }

  if (!unit.acted) {
    for (const abilityName of unit.abilities) {
      const ability = ABILITIES[abilityName];
      if (!ability || ability.mpCost > unit.mp) continue;

      if (ability.target === 'self') {
        const prev = abilityPreview(unit, unit, ability, state.board);
        actions.push({ type: 'ability', unitId: unit.id, abilityName, targetId: unit.id, ...(prev ? { preview: prev } : {}) });
      } else {
        const targets = getInRange(unit.position, ability.range, state.units, ability.target, playerId);
        for (const t of targets) {
          const prev = abilityPreview(unit, t, ability, state.board);
          actions.push({ type: 'ability', unitId: unit.id, abilityName, targetId: t.id, ...(prev ? { preview: prev } : {}) });
        }
        if (ability.target === 'ally') {
          const prev = abilityPreview(unit, unit, ability, state.board);
          actions.push({ type: 'ability', unitId: unit.id, abilityName, targetId: unit.id, ...(prev ? { preview: prev } : {}) });
        }
      }
    }
  }

  actions.push({ type: 'end-turn', unitId: unit.id });
  return actions;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { action } = playerActions[0];

  if (action.type === 'end-turn') {
    const next = advanceTurn(state);
    return { ...state, ...next, lastActions: playerActions };
  }

  if (action.type === 'move') {
    const units = state.units.map(u =>
      u.id === action.unitId ? { ...u, position: action.to, moved: true } : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'ability') {
    const units = applyAbility(state, action.unitId, action.targetId, action.abilityName, rng);
    return { ...state, units, lastActions: playerActions };
  }

  return state;
}

// ── Win condition ─────────────────────────────────────────────────────────────

function getResult(state) {
  for (const player of state.players) {
    if (!state.units.some(u => u.alive && u.ownerId === player.id)) {
      const winner = state.players.find(p => p.id !== player.id);
      return { outcome: 'win', winnerId: winner?.id, reason: 'all-units-eliminated' };
    }
  }
  return null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, activePlayers, units, players, gameSpecific, board } = state;
  const { activeUnitId, roundNumber } = gameSpecific ?? {};
  const activeUnit = units.find(u => u.id === activeUnitId);

  const fmtUnit = u => {
    if (!u.alive) return null;
    const st = u.statusEffects.length ? `[${u.statusEffects.join(',')}]` : '';
    const flags = `${u.moved ? 'M' : '.'}${u.acted ? 'A' : '.'}`;
    return `${u.symbol}(${u.hp}/${u.maxHp}hp ${u.mp}mp ${flags})${st}`;
  };

  const lines = [
    `═══ Round ${roundNumber}  Turn ${turnNumber}  ―  Active: ${activeUnit ? `${activeUnit.id}(${activeUnit.job}) → ${activePlayers[0]}` : 'none'} ═══`,
    renderMap(board, units),
    `Map: #=wall .=grass 1=elevated(+1atk) 2=high(+2atk) | Uppercase=P1 Lowercase=P2`,
    '',
  ];

  for (const p of players) {
    const row = units.filter(u => u.ownerId === p.id).map(fmtUnit).filter(Boolean).join('  ');
    lines.push(`${p.id}: ${row || '(all dead)'}`);
  }

  if (activeUnit) {
    lines.push('');
    lines.push(`Active: ${activeUnit.id}  ${activeUnit.job} (${activeUnit.race})  pos(${activeUnit.position.x},${activeUnit.position.y})  HP:${activeUnit.hp}/${activeUnit.maxHp}  MP:${activeUnit.mp}/${activeUnit.maxMp}`);
    lines.push(`  Abilities: ${activeUnit.abilities.map(a => ABILITIES[a]?.name ?? a).join(' · ')}`);
    lines.push(`  Flags: ${activeUnit.moved ? 'MOVED' : 'can-move'}  ${activeUnit.acted ? 'ACTED' : 'can-act'}`);
  }

  return lines.join('\n');
}

// ── Create initial state ──────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const board = createMap();
  const [p1, p2] = players;
  let idCtr = 0;

  const scenId = config.scenario ?? 'standard';
  const scen = SCENARIOS[scenId] ?? SCENARIOS.standard;

  const units = [
    ...scen.p1.map(({ job, pos }) => createUnit(`u${idCtr++}`, job, p1.id, pos)),
    ...scen.p2.map(({ job, pos }) => createUnit(`u${idCtr++}`, job, p2.id, pos)),
  ];

  const order = buildTurnQueue(units);
  const [activeUnitId, ...turnQueue] = order;
  const activeOwner = units.find(u => u.id === activeUnitId)?.ownerId ?? p1.id;

  return {
    gameName: 'FFTA',
    turnNumber: 1,
    activePlayers: [activeOwner],
    currentPhase: 'action',
    players,
    units,
    board,
    lastActions: null,
    gameSpecific: { activeUnitId, turnQueue, roundNumber: 1 },
  };
}

// ── Fog of war ────────────────────────────────────────────────────────────────

function getVisibleState(state, playerId) {
  const VISION = 2;
  const myUnits = state.units.filter(u => u.alive && u.ownerId === playerId);
  return {
    ...state,
    units: state.units.filter(u =>
      u.ownerId === playerId ||
      myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION)
    ),
  };
}

const JOB_LABELS = {
  soldier: 'Soldier', whiteMage: 'White Mage', blackMage: 'Black Mage',
  archer: 'Archer', thief: 'Thief', fighter: 'Fighter',
  paladin: 'Paladin', ninja: 'Ninja', dragoon: 'Dragoon',
  elementalist: 'Elementalist', redMage: 'Red Mage', timeMage: 'Time Mage',
  summoner: 'Summoner', illusionist: 'Illusionist', assassin: 'Assassin',
};

// ── Export ────────────────────────────────────────────────────────────────────

function getActionDuration(state, action) {
  if (action.type === 'move') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const from = unit.position;
    const dist = Math.max(Math.abs(action.to.x - from.x), Math.abs(action.to.y - from.y));
    // Faster units (higher spd) move more quickly
    const speed = (unit.stats?.spd ?? 5) / 5;
    return dist / (speed * (JOB_DEFS[unit.job]?.moveRange ?? 3));
  }
  if (action.type === 'ability') {
    const unit = state.units.find(u => u.id === action.unitId);
    if (!unit) return 1;
    const speed = (unit.stats?.spd ?? 5) / 5;
    return 1 / speed;
  }
  return 1;
}

export const FFTAGame = {
  name: 'Final Fantasy Tactics Advance',
  scenarios: [
    { id: 'standard',        name: 'Standard Battle',       description: '4v4 balanced job-class combat on a height-based grid', config: { scenario: 'standard' } },
    { id: 'ambush',          name: 'Ambush in the Pass',    description: '3 defenders hold elevated ground against 5 attackers', config: { scenario: 'ambush' } },
    { id: 'jagd',            name: 'Jagd Helje',            description: 'Lawless all-melee skirmish — no Laws, no healers, pure combat', config: { scenario: 'jagd' } },
    { id: 'magicCouncil',    name: 'Magic Council Dispute', description: 'Nu Mou scholars clash — Time Mage and Summoner face off', config: { scenario: 'magicCouncil' } },
    { id: 'honorGuard',      name: 'Honor Guard',           description: '4-unit disciplined guard holds against a 6-unit clan assault', config: { scenario: 'honorGuard' } },
    { id: 'desertReckoning', name: 'Desert Reckoning',      description: 'Viera agility and magic vs Bangaa brute strength — 4v4', config: { scenario: 'desertReckoning' } },
  ],
  colors: { floor: '#8a9c70', elevated: '#a07858', 'elevated-high': '#b89060', wall: '#2a2018' },
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,

  toGrid(state) {
    const { board, units = [] } = state;
    const { width, height, tiles } = board;
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const umap = {};
    for (const u of units) if (u.alive) umap[`${u.position.x},${u.position.y}`] = u;
    const activeUnitId = state.gameSpecific?.activeUnitId;
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[`${x},${y}`] ?? {};
        const t = !tile.passable ? 'wall' : tile.height === 2 ? 'elevated-high' : tile.height === 1 ? 'elevated' : 'floor';
        const u = umap[`${x},${y}`];
        cells.push({
          x, y,
          glyph:    u ? (u.symbol ?? u.job?.[0]?.toUpperCase() ?? '?') : '',
          owner:    u ? (pidIdx[u.ownerId] ?? 0) : 0,
          color:    this.colors[t] ?? '#808070',
          hp: u?.hp, maxHp: u?.maxHp,
          unitId:        u?.id,
          unitName:      u ? JOB_LABELS[u.job] ?? u.job : null,
          mp:            u?.mp,    maxMp: u?.maxMp,
          stats:         u?.stats  ? { ...u.stats } : null,
          abilities:     u?.abilities ? u.abilities.map(k => ({ key: k, name: ABILITIES[k]?.name ?? k })) : null,
          statusEffects: u?.statusEffects ? [...u.statusEffects] : null,
          moved:         u?.moved,
          acted:         u?.acted,
          isActive:      u ? u.id === activeUnitId : false,
        });
      }
    }
    return { width, height, cells };
  },
};
