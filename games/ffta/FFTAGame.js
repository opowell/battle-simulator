import { ABILITIES } from './abilities.js';
import { JOB_DEFS, createUnit } from './units.js';
import { createMap, renderMap, getTile } from './map.js';
import { getReachable, getInRange, getAoeTiles, manhattan } from './grid.js';

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
  bangaaWarband: {
    p1: [
      { job: 'warrior',   pos: { x: 1, y: 1 } },
      { job: 'whiteMonk', pos: { x: 2, y: 1 } },
      { job: 'bishop',    pos: { x: 1, y: 2 } },
      { job: 'templar',   pos: { x: 2, y: 2 } },
    ],
    p2: [
      { job: 'fencer',      pos: { x: 9,  y: 7 } },
      { job: 'sniper',      pos: { x: 10, y: 7 } },
      { job: 'elementalist', pos: { x: 9, y: 8 } },
      { job: 'assassin',    pos: { x: 10, y: 8 } },
    ],
  },
  moogleRaiders: {
    p1: [
      { job: 'mogKnight', pos: { x: 2, y: 1 } },
      { job: 'juggler',   pos: { x: 3, y: 1 } },
      { job: 'animist',   pos: { x: 2, y: 2 } },
      { job: 'gunner',    pos: { x: 3, y: 2 } },
    ],
    p2: [
      { job: 'blueMage',  pos: { x: 8,  y: 7 } },
      { job: 'alchemist', pos: { x: 9,  y: 7 } },
      { job: 'morpher',   pos: { x: 8,  y: 8 } },
      { job: 'hunter',    pos: { x: 9,  y: 8 } },
    ],
  },
  grandMelee: {
    p1: [
      { job: 'warrior',   pos: { x: 1, y: 1 } },
      { job: 'hunter',    pos: { x: 2, y: 1 } },
      { job: 'alchemist', pos: { x: 1, y: 2 } },
      { job: 'mogKnight', pos: { x: 2, y: 2 } },
      { job: 'gunner',    pos: { x: 3, y: 1 } },
    ],
    p2: [
      { job: 'templar',  pos: { x: 10, y: 8 } },
      { job: 'blueMage', pos: { x: 9,  y: 8 } },
      { job: 'morpher',  pos: { x: 10, y: 7 } },
      { job: 'fencer',   pos: { x: 9,  y: 7 } },
      { job: 'animist',  pos: { x: 8,  y: 8 } },
    ],
  },
};

// ── Turn queue (Charge Time system) ──────────────────────────────────────────

function effectiveSpd(u) {
  let spd = u.stats.spd;
  if (u.statusEffects.includes('slow'))  spd = Math.floor(spd * 0.5);
  if (u.statusEffects.includes('haste')) spd = Math.floor(spd * 1.5);
  return spd;
}

// Advance every alive unit's CT by their Speed each tick until ≥1 unit hits 100.
function tickToNextActor(units) {
  let updated = units.map(u => ({ ...u }));
  while (!updated.some(u => u.alive && u.ct >= 100)) {
    updated = updated.map(u => u.alive ? { ...u, ct: u.ct + effectiveSpd(u) } : u);
  }
  return updated;
}

// All units that have reached CT ≥ 100, sorted by CT desc (ties: speed desc, id asc).
function buildReadyQueue(units) {
  return units
    .filter(u => u.alive && u.ct >= 100)
    .sort((a, b) => b.ct - a.ct || effectiveSpd(b) - effectiveSpd(a) || a.id.localeCompare(b.id))
    .map(u => u.id);
}

// ── Damage/heal ───────────────────────────────────────────────────────────────

function effectiveStat(unit, stat) {
  let v = unit.stats[stat];
  if (stat === 'atk' && unit.support === 'attack-boost')  v = Math.floor(v * 1.2);
  if (stat === 'def' && unit.support === 'defense-boost') v = Math.floor(v * 1.2);
  if (stat === 'mag' && unit.support === 'magic-boost')   v = Math.floor(v * 1.2);
  if (stat === 'res' && unit.support === 'resilience')    v = Math.floor(v * 1.2);
  return v;
}

function calcDamage(attacker, defender, ability, board, rng) {
  const atkH = getTile(board, attacker.position.x, attacker.position.y).height;
  const defH = getTile(board, defender.position.x, defender.position.y).height;
  const heightMult = 1 + 0.2 * Math.max(0, atkH - defH);

  let atk, def;
  if (ability.type === 'magic') {
    atk = effectiveStat(attacker, 'mag');
    def = effectiveStat(defender, 'res');
  } else {
    atk = effectiveStat(attacker, 'atk');
    def = effectiveStat(defender, 'def');
    if (attacker.statusEffects.includes('atk-break')) atk = Math.floor(atk * 0.75);
    if (defender.statusEffects.includes('armor-break')) def = Math.floor(def * 0.75);
    if (defender.statusEffects.includes('protect')) def = Math.floor(def * 1.25);
  }
  if (attacker.statusEffects.includes('blind')) atk = Math.floor(atk * 0.7);

  const elemMult = ability.element ? (defender.elemResist?.[ability.element] ?? 1) : 1;
  const base = Math.max(1, Math.floor(atk * ability.power * heightMult * elemMult - def * 0.5));
  return Math.max(1, Math.floor(base * (0.85 + rng() * 0.3)));
}

function calcHeal(caster, ability, rng) {
  const base = Math.floor(caster.stats.mag * ability.power);
  return Math.max(1, Math.floor(base * (0.9 + rng() * 0.2)));
}

// ── Knockback ─────────────────────────────────────────────────────────────────

// Push target 1 tile away from caster along the dominant axis.
// If the destination is blocked or impassable, deal crash damage instead.
function applyKnockback(units, board, caster, target, rng) {
  const dx = target.position.x - caster.position.x;
  const dy = target.position.y - caster.position.y;
  if (dx === 0 && dy === 0) return;

  const kx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
  const ky = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
  const nx = target.position.x + kx;
  const ny = target.position.y + ky;

  const destTile = getTile(board, nx, ny);
  const blocker = units.find(u => u.alive && u.id !== target.id && u.position.x === nx && u.position.y === ny);

  if (destTile.passable && !blocker) {
    target.position = { x: nx, y: ny };
  } else {
    const crashDmg = Math.max(1, Math.floor(caster.stats.atk * 0.5 * (0.85 + rng() * 0.3)));
    target.hp = Math.max(0, target.hp - crashDmg);
    target.alive = target.hp > 0;
    if (blocker) {
      blocker.hp = Math.max(0, blocker.hp - crashDmg);
      blocker.alive = blocker.hp > 0;
    }
  }
}

// ── Apply ability ─────────────────────────────────────────────────────────────

function applyStatus(target, status) {
  const blocked = status === 'blind' && target.support === 'awareness';
  if (blocked || target.statusEffects.includes(status)) return;
  target.statusEffects.push(status);
  if (status === 'doom') target.doomCountdown = 3;
}

// Apply ability effect without reaction triggers (used for AoE hits).
function applyEffectNoReaction(caster, target, ability, board, rng) {
  const { effect } = ability;
  if (effect === 'damage' || effect === 'damage+status' || effect === 'damage+steal-mp') {
    const dmg = calcDamage(caster, target, ability, board, rng);
    target.hp = Math.max(0, target.hp - dmg);
    target.alive = target.hp > 0;
    // hitting a sleeping unit wakes it
    target.statusEffects = target.statusEffects.filter(s => s !== 'sleep');
    if (effect === 'damage+status' && ability.status && target.alive) {
      applyStatus(target, ability.status);
    }
    if (effect === 'damage+steal-mp') {
      const stolen = Math.min(target.mp, 8);
      target.mp -= stolen;
      caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
    }
  } else if (effect === 'heal') {
    const healAmt = calcHeal(caster, ability, rng);
    target.hp = Math.min(target.maxHp, target.hp + healAmt);
  } else if (effect === 'heal-fixed') {
    target.hp = Math.min(target.maxHp, target.hp + ability.healAmount);
  } else if (effect === 'heal-full') {
    target.hp = target.maxHp;
  } else if (effect === 'restore-mp') {
    target.mp = Math.min(target.maxMp, target.mp + ability.mpAmount);
  } else if (effect === 'elixir') {
    target.hp = target.maxHp;
    target.mp = target.maxMp;
  } else if (effect === 'revive') {
    target.hp = Math.max(1, Math.floor(target.maxHp * ability.reviveHpPct));
    target.alive = true;
    target.ct = 0;
    target.statusEffects = [];
    target.doomCountdown = null;
  } else if (effect === 'cleanse-one') {
    target.statusEffects = target.statusEffects.filter(s => s !== ability.status);
    if (ability.status === 'doom') target.doomCountdown = null;
  } else if (effect === 'status' && ability.status) {
    applyStatus(target, ability.status);
  } else if (effect === 'steal-mp') {
    const stolen = Math.min(target.mp, 8);
    target.mp -= stolen;
    caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
  } else if (effect === 'cleanse') {
    target.statusEffects = [];
    target.doomCountdown = null;
  }
}

function applyAbility(state, casterId, targetId, abilityName, rng, targetPos) {
  const units = state.units.map(u => ({ ...u, statusEffects: [...u.statusEffects] }));
  const caster = units.find(u => u.id === casterId);
  const ability = ABILITIES[abilityName];

  caster.mp -= ability.mpCost;
  caster.acted = true;

  if (ability.aoe && targetPos) {
    const lineRadius = ability.aoe === 'line' ? ability.range : (ability.aoeRadius ?? 1);
    const aoeTiles = getAoeTiles(ability.aoe, targetPos, caster.position, lineRadius);
    units.filter(u => {
      if (!u.alive) return false;
      if (ability.target === 'enemy') return u.ownerId !== caster.ownerId;
      if (ability.target === 'ally') return u.ownerId === caster.ownerId;
      return false;
    }).filter(u => aoeTiles.some(t => t.x === u.position.x && t.y === u.position.y))
      .forEach(t => applyEffectNoReaction(caster, t, ability, state.board, rng));
    return units;
  }

  const target = units.find(u => u.id === targetId);

  const { effect } = ability;
  const isSelf = casterId === targetId;

  if (effect === 'damage' || effect === 'damage+status' || effect === 'damage+steal-mp') {
    // ── Reaction: evasion ────────────────────────────────────────────────────
    let evaded = false;
    if (!isSelf) {
      if (ability.type === 'physical' && target.reaction === 'weapon-guard' && rng() < 0.5) evaded = true;
      if (ability.type === 'magic'    && target.reaction === 'reflex'        && rng() < 0.5) evaded = true;
    }

    if (!evaded) {
      let dmg = calcDamage(caster, target, ability, state.board, rng);

      // ── Reaction: MP Shield — half damage absorbed by MP ─────────────────
      if (!isSelf && target.reaction === 'mp-shield' && target.mp > 0) {
        const mpAbsorb = Math.min(target.mp, Math.floor(dmg / 2));
        target.mp -= mpAbsorb;
        dmg = Math.max(1, dmg - mpAbsorb);
      }

      const preHp = target.hp;
      target.hp = Math.max(0, target.hp - dmg);
      target.alive = target.hp > 0;

      // ── Reaction: Absorb HP — recover 25% of damage taken ────────────────
      if (!isSelf && target.reaction === 'absorb-hp') {
        const absorbed = Math.floor((preHp - target.hp) * 0.25);
        if (absorbed > 0) {
          target.hp = Math.min(target.maxHp, target.hp + absorbed);
          target.alive = target.hp > 0;
        }
      }

      // hitting a sleeping unit wakes it
      target.statusEffects = target.statusEffects.filter(s => s !== 'sleep');

      // ── Secondary effects ─────────────────────────────────────────────────
      if (effect === 'damage+status' && ability.status && target.alive) {
        applyStatus(target, ability.status);
      }
      if (effect === 'damage+steal-mp') {
        const stolen = Math.min(target.mp, 8);
        target.mp -= stolen;
        caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
      }

      // ── Reaction: Counter — counterattack with basic attack ───────────────
      if (!isSelf && target.alive && caster.alive &&
          target.reaction === 'counter' && ability.type === 'physical' &&
          manhattan(target.position, caster.position) <= 1) {
        const counterDmg = calcDamage(target, caster, ABILITIES['attack'], state.board, rng);
        caster.hp = Math.max(0, caster.hp - counterDmg);
        caster.alive = caster.hp > 0;
      }

      // ── Knockback ─────────────────────────────────────────────────────────
      if (!isSelf && ability.knockback && target.alive) {
        applyKnockback(units, state.board, caster, target, rng);
      }
    }
  } else if (effect === 'heal') {
    const healAmt = calcHeal(caster, ability, rng);
    target.hp = Math.min(target.maxHp, target.hp + healAmt);
  } else if (effect === 'heal-fixed') {
    target.hp = Math.min(target.maxHp, target.hp + ability.healAmount);
  } else if (effect === 'heal-full') {
    target.hp = target.maxHp;
  } else if (effect === 'restore-mp') {
    target.mp = Math.min(target.maxMp, target.mp + ability.mpAmount);
  } else if (effect === 'elixir') {
    target.hp = target.maxHp;
    target.mp = target.maxMp;
  } else if (effect === 'revive') {
    target.hp = Math.max(1, Math.floor(target.maxHp * ability.reviveHpPct));
    target.alive = true;
    target.ct = 0;
    target.statusEffects = [];
    target.doomCountdown = null;
  } else if (effect === 'cleanse-one') {
    target.statusEffects = target.statusEffects.filter(s => s !== ability.status);
    if (ability.status === 'doom') target.doomCountdown = null;
  } else if (effect === 'status' && ability.status) {
    applyStatus(target, ability.status);
  } else if (effect === 'steal-mp') {
    const stolen = Math.min(target.mp, 8);
    target.mp -= stolen;
    caster.mp = Math.min(caster.maxMp, caster.mp + stolen);
  } else if (effect === 'cleanse') {
    target.statusEffects = [];
    target.doomCountdown = null;
  }

  return units;
}

// ── Advance to next unit's turn ───────────────────────────────────────────────

function advanceTurn(state) {
  let units = state.units.map(u => ({ ...u, statusEffects: [...u.statusEffects] }));
  let { activeUnitId, turnQueue } = state.gameSpecific;
  let { turnNumber } = state;

  // End-of-turn effects for the active unit
  const activeUnit = units.find(u => u.id === activeUnitId);
  if (activeUnit?.alive) {
    if (activeUnit.statusEffects.includes('poison')) {
      activeUnit.hp = Math.max(0, activeUnit.hp - Math.max(1, Math.floor(activeUnit.maxHp * 0.1)));
      if (activeUnit.hp === 0) activeUnit.alive = false;
    }
    if (activeUnit.statusEffects.includes('doom') && activeUnit.doomCountdown !== null) {
      activeUnit.doomCountdown -= 1;
      if (activeUnit.doomCountdown <= 0) {
        activeUnit.hp = 0;
        activeUnit.alive = false;
      }
    }
  }

  // End current unit's turn: lock flags, drain 100 CT (keep overflow for next cycle)
  units = units.map(u =>
    u.id === activeUnitId
      ? { ...u, moved: true, acted: true, preMovedPosition: null, ct: Math.max(0, u.ct - 100) }
      : u
  );

  let remaining = turnQueue.filter(id => units.find(u => u.id === id)?.alive);

  let nextId;
  if (remaining.length > 0) {
    [nextId, ...remaining] = remaining;
  } else {
    units = tickToNextActor(units);
    const readyQueue = buildReadyQueue(units);
    [nextId, ...remaining] = readyQueue;
  }

  turnNumber += 1;

  // Give the incoming unit a fresh turn
  units = units.map(u =>
    u.id === nextId ? { ...u, moved: false, acted: false } : u
  );

  const nextOwner = units.find(u => u.id === nextId)?.ownerId ?? state.players[0].id;

  return {
    units,
    turnNumber,
    activePlayers: [nextOwner],
    gameSpecific: { activeUnitId: nextId, turnQueue: remaining },
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
      atk = effectiveStat(caster, 'mag');
      def = effectiveStat(target, 'res');
    } else {
      atk = effectiveStat(caster, 'atk');
      def = effectiveStat(target, 'def');
      if (caster.statusEffects.includes('atk-break')) atk = Math.floor(atk * 0.75);
      if (target.statusEffects.includes('armor-break')) def = Math.floor(def * 0.75);
      if (target.statusEffects.includes('protect')) def = Math.floor(def * 1.25);
    }
    if (caster.statusEffects.includes('blind')) atk = Math.floor(atk * 0.7);

    const elemMult = ability.element ? (target.elemResist?.[ability.element] ?? 1) : 1;
    const base = Math.max(1, Math.floor(atk * ability.power * heightMult * elemMult - def * 0.5));
    const lo = Math.max(1, Math.floor(base * 0.85));
    const hi = Math.max(1, Math.floor(base * 1.15));
    let p = lo === hi ? `~${lo} dmg` : `${lo}-${hi} dmg`;
    if (elemMult !== 1) p += elemMult > 1 ? ' (WEAK)' : ' (RESIST)';
    if (ability.type === 'physical' && target.reaction === 'weapon-guard') p += ' (50% evade)';
    if (ability.type === 'magic'    && target.reaction === 'reflex')        p += ' (50% evade)';
    if (effect === 'damage+status' && ability.status) p += ` + ${ability.status}`;
    if (effect === 'damage+steal-mp') p += ` + steal MP`;
    if (ability.knockback) p += ` + knockback`;
    return p;
  }

  if (effect === 'heal') {
    const base = Math.floor(caster.stats.mag * ability.power);
    const lo = Math.max(1, Math.floor(base * 0.9));
    const hi = Math.max(1, Math.floor(base * 1.1));
    return lo === hi ? `~${lo} heal` : `${lo}-${hi} heal`;
  }

  if (effect === 'heal-fixed')  return `+${ability.healAmount} HP`;
  if (effect === 'heal-full')   return `full HP`;
  if (effect === 'restore-mp')  return `+${ability.mpAmount} MP`;
  if (effect === 'elixir')      return `full HP+MP`;
  if (effect === 'revive')      return `revive (${Math.round(ability.reviveHpPct * 100)}% HP)`;
  if (effect === 'cleanse-one') return `cure ${ability.status}`;
  if (effect === 'status' && ability.status) return `→ ${ability.status}`;
  if (effect === 'steal-mp') return `steal ≤8 MP`;
  if (effect === 'cleanse') return `remove status effects`;

  return null;
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const { activeUnitId } = state.gameSpecific;
  const unit = state.units.find(u => u.id === activeUnitId && u.alive);

  if (!unit || unit.ownerId !== playerId) {
    return [{ type: 'end-turn', unitId: '__player__' }];
  }

  // stop/sleep: unit cannot act this turn
  if (unit.statusEffects.includes('stop') || unit.statusEffects.includes('sleep')) {
    return [{ type: 'end-turn', unitId: unit.id }];
  }

  const actions = [];

  if (!unit.moved) {
    const { moveRange } = JOB_DEFS[unit.job];
    const effectiveMoveRange = moveRange + (unit.support === 'move-plus' ? 1 : 0);
    for (const to of getReachable(state.board, unit.position, effectiveMoveRange, state.units)) {
      actions.push({ type: 'move', unitId: unit.id, to });
    }
  } else if (!unit.acted && unit.preMovedPosition) {
    actions.push({ type: 'undo-move', unitId: unit.id });
  }

  if (!unit.acted) {
    for (const abilityName of unit.abilities) {
      const ability = ABILITIES[abilityName];
      if (!ability || ability.mpCost > unit.mp) continue;

      if (ability.aoe) {
        // AoE: target a tile; blast hits all valid units within the pattern
        if (ability.aoe === 'line') {
          for (const [sx, sy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const lineTiles = [];
            for (let i = 1; i <= ability.range; i++)
              lineTiles.push({ x: unit.position.x + sx * i, y: unit.position.y + sy * i });
            const hits = state.units.filter(u => {
              if (!u.alive) return false;
              return ability.target === 'enemy' ? u.ownerId !== playerId : u.ownerId === playerId;
            }).filter(u => lineTiles.some(t => t.x === u.position.x && t.y === u.position.y));
            if (!hits.length) continue;
            const targetPos = { x: unit.position.x + sx, y: unit.position.y + sy };
            actions.push({ type: 'ability', unitId: unit.id, abilityName, targetPos, preview: `AoE line ×${hits.length}` });
          }
        } else {
          const radius = ability.aoeRadius ?? 1;
          for (let cx = 0; cx < state.board.width; cx++) {
            for (let cy = 0; cy < state.board.height; cy++) {
              const dist = Math.abs(cx - unit.position.x) + Math.abs(cy - unit.position.y);
              if (dist === 0 || dist > ability.range) continue;
              const aoeTiles = getAoeTiles(ability.aoe, { x: cx, y: cy }, null, radius);
              const hits = state.units.filter(u => {
                if (!u.alive) return false;
                return ability.target === 'enemy' ? u.ownerId !== playerId : u.ownerId === playerId;
              }).filter(u => aoeTiles.some(t => t.x === u.position.x && t.y === u.position.y));
              if (!hits.length) continue;
              actions.push({ type: 'ability', unitId: unit.id, abilityName, targetPos: { x: cx, y: cy }, preview: `AoE ×${hits.length}` });
            }
          }
        }
      } else if (ability.target === 'self') {
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
    const units = state.units.map(u => {
      if (u.id !== action.unitId) return u;
      const dx = action.to.x - u.position.x;
      const dy = action.to.y - u.position.y;
      const facing = (dx !== 0 || dy !== 0) ? Math.atan2(dy, dx) : u.facing;
      return { ...u, position: action.to, facing, moved: true, preMovedPosition: u.position };
    });
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'undo-move') {
    const units = state.units.map(u =>
      u.id === action.unitId && u.preMovedPosition
        ? { ...u, position: u.preMovedPosition, moved: false, preMovedPosition: null }
        : u
    );
    return { ...state, units, lastActions: playerActions };
  }

  if (action.type === 'ability') {
    const caster = state.units.find(u => u.id === action.unitId);
    const aimPos = action.targetPos ?? state.units.find(u => u.id === action.targetId)?.position;
    const units = applyAbility(state, action.unitId, action.targetId, action.abilityName, rng, action.targetPos)
      .map(u => {
        if (u.id !== action.unitId) return u;
        const shouldFace = caster && aimPos && (action.targetPos || action.unitId !== action.targetId);
        const facing = shouldFace
          ? Math.atan2(aimPos.y - caster.position.y, aimPos.x - caster.position.x)
          : u.facing;
        return { ...u, facing, preMovedPosition: null };
      });
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
  const { activeUnitId } = gameSpecific ?? {};
  const activeUnit = units.find(u => u.id === activeUnitId);

  const fmtUnit = u => {
    if (!u.alive) return null;
    const statusList = u.statusEffects.map(s =>
      s === 'doom' && u.doomCountdown != null ? `doom:${u.doomCountdown}` : s
    );
    const st = statusList.length ? `[${statusList.join(',')}]` : '';
    const flags = `${u.moved ? 'M' : '.'}${u.acted ? 'A' : '.'}`;
    return `${u.symbol}(${u.hp}/${u.maxHp}hp ${u.mp}mp CT:${Math.floor(u.ct)} ${flags})${st}`;
  };

  const lines = [
    `═══ Turn ${turnNumber}  ―  Active: ${activeUnit ? `${activeUnit.id}(${activeUnit.job}) CT:${Math.floor(activeUnit.ct)} → ${activePlayers[0]}` : 'none'} ═══`,
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
    lines.push(`  Reaction: ${ABILITIES[activeUnit.reaction]?.name ?? '—'}  |  Support: ${ABILITIES[activeUnit.support]?.name ?? '—'}`);
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
    ...scen.p1.map(({ job, pos }) => createUnit(`u${idCtr++}`, job, p1.id, pos, 0)),
    ...scen.p2.map(({ job, pos }) => createUnit(`u${idCtr++}`, job, p2.id, pos, Math.PI)),
  ];

  const tickedUnits = tickToNextActor(units);
  const readyQueue = buildReadyQueue(tickedUnits);
  const [activeUnitId, ...turnQueue] = readyQueue;
  const activeOwner = tickedUnits.find(u => u.id === activeUnitId)?.ownerId ?? p1.id;

  return {
    gameName: 'FFTA',
    turnNumber: 1,
    activePlayers: [activeOwner],
    currentPhase: 'action',
    players,
    units: tickedUnits,
    board,
    lastActions: null,
    gameSpecific: { activeUnitId, turnQueue },
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
  warrior: 'Warrior', whiteMonk: 'White Monk', bishop: 'Bishop', templar: 'Templar',
  alchemist: 'Alchemist', morpher: 'Morpher',
  fencer: 'Fencer', sniper: 'Sniper',
  blueMage: 'Blue Mage', hunter: 'Hunter',
  mogKnight: 'Mog Knight', juggler: 'Juggler', animist: 'Animist', gunner: 'Gunner',
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
    { id: 'bangaaWarband',   name: 'Bangaa Warband',        description: 'Bangaa warrior-monk-bishop-templar quad vs Viera agility — all-new jobs', config: { scenario: 'bangaaWarband' } },
    { id: 'moogleRaiders',   name: 'Moogle Raiders',        description: 'Four Moogle specialists raid a camp of Blue Mage, Alchemist, Morpher and Hunter', config: { scenario: 'moogleRaiders' } },
    { id: 'grandMelee',      name: 'Grand Melee',           description: '5v5 clash featuring all-new job classes across the full tactical map', config: { scenario: 'grandMelee' } },
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
          reaction:      u?.reaction ? { key: u.reaction, name: ABILITIES[u.reaction]?.name ?? u.reaction } : null,
          support:       u?.support  ? { key: u.support,  name: ABILITIES[u.support]?.name  ?? u.support  } : null,
          statusEffects: u?.statusEffects ? [...u.statusEffects] : null,
          doomCountdown: u?.doomCountdown ?? null,
          ct:            u?.ct,
          moved:         u?.moved,
          acted:         u?.acted,
          isActive:      u ? u.id === activeUnitId : false,
          facing:        u?.facing,
        });
      }
    }
    return { width, height, cells };
  },
};
