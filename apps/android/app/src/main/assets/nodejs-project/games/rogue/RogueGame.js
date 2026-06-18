import { generateFloor, MAP_W, MAP_H } from './dungeon.js';
import { isWalkable, manhattan, hasLOS, stepToward, stepRandom, randomFloorPos, renderMap } from './map.js';
import { createHero, createMonster, spawnMonsters, MONSTER_DEFS } from './units.js';
import { spawnItems, applyPickup, useInventoryItem, dropInventoryItem, generateDisguiseMap, getDisplayName, ITEM_DEFS } from './items.js';
import { heroAttack, monsterAttack } from './combat.js';

const MAX_HUNGER           = 1500;
const AMULET_LEVEL_DEFAULT = 10;
const XP_THRESHOLDS        = [0, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120];

function heroLevelForXP(xp) {
  let lv = 1;
  while (lv < XP_THRESHOLDS.length && xp >= XP_THRESHOLDS[lv]) lv++;
  return lv;
}

// ── Floor builder ─────────────────────────────────────────────────────────────

function buildFloor(dungeonLevel, amuletLevel, heroPos, rng) {
  const floor    = generateFloor(rng, dungeonLevel);
  const items    = spawnItems(floor.rooms, dungeonLevel, rng);
  const monsters = spawnMonsters(floor.rooms, dungeonLevel, [{ position: heroPos, alive: true }], rng);

  let amuletPos = null;
  if (dungeonLevel === amuletLevel) {
    const deepRoom = floor.rooms[floor.rooms.length - 1];
    amuletPos = {
      x: deepRoom.x + Math.floor(deepRoom.w / 2),
      y: deepRoom.y + Math.floor(deepRoom.h / 2),
    };
  }

  return {
    tiles: floor.tiles, rooms: floor.rooms,
    heroPos: floor.heroPos, stairsDown: floor.stairsDown, stairsUp: floor.stairsUp,
    traps: floor.traps,
    items, monsters, amuletPos,
  };
}

// ── Passive ring effects applied to hero each turn ───────────────────────────

function applyRingEffects(hero, gs, rng) {
  const rings = [hero.attrs.leftRing, hero.attrs.rightRing].filter(Boolean);
  let h  = hero;
  let hungerMod = 0;

  for (const ring of rings) {
    switch (ring.effect) {
      case 'slow_digestion':
        hungerMod -= 1; // net: hunger decreases 1 less per turn
        break;
      case 'regeneration':
        if (h.hp < h.maxHp) h = { ...h, hp: Math.min(h.maxHp, h.hp + 1) };
        break;
      case 'add_strength':
        // Handled at equip time: +1 strength permanently (skip if already applied)
        break;
      case 'teleportation':
        // 1-in-50 chance each turn of random teleport
        if (rng() < 0.02) gs = { ...gs, _ringTeleport: true };
        break;
      default: break;
    }
  }
  return { hero: h, gs, hungerMod };
}

// ── Trap trigger ─────────────────────────────────────────────────────────────

function triggerTrap(trap, hero, units, gs, rooms, rng) {
  const msgs = [];
  let h = hero;
  let u = units;
  let g = gs;

  switch (trap.type) {
    case 'bear': {
      const dur = 2 + Math.floor(rng() * 4);
      const eff = { ...h.attrs.effects, held: (h.attrs.effects.held ?? 0) + dur };
      h = { ...h, attrs: { ...h.attrs, effects: eff } };
      msgs.push('You are caught in a bear trap!');
      break;
    }
    case 'teleport': {
      const excluded = new Set(u.filter(un => un.alive).map(un => `${un.position.x},${un.position.y}`));
      const pos = randomFloorPos(g.tiles ?? {}, rooms ?? [], rng, excluded);
      if (pos) h = { ...h, position: pos };
      msgs.push('You feel a wrenching sensation!');
      break;
    }
    case 'arrow': {
      const dmg = 1 + Math.floor(rng() * 6);
      const newHp = Math.max(0, h.hp - dmg);
      h = { ...h, hp: newHp, alive: newHp > 0 };
      msgs.push(`An arrow flies out and hits you for ${dmg}!`);
      break;
    }
    case 'sleep': {
      const dur = 3 + Math.floor(rng() * 5);
      const eff = { ...h.attrs.effects, frozen: (h.attrs.effects.frozen ?? 0) + dur };
      h = { ...h, attrs: { ...h.attrs, effects: eff } };
      msgs.push('A sleep gas surrounds you! You fall asleep!');
      break;
    }
    case 'aggravate': {
      u = u.map(un => un.ownerId === 'dungeon' && un.alive
        ? { ...un, attrs: { ...un.attrs, asleep: false } } : un);
      msgs.push('You hear a high-pitched shriek!');
      break;
    }
    case 'dart': {
      const strLoss = 1 + Math.floor(rng() * 2);
      const newStr  = Math.max(3, h.attrs.strength - strLoss);
      h = { ...h, attrs: { ...h.attrs, strength: newStr } };
      msgs.push(`A poisoned dart hits you! Str -${strLoss}.`);
      break;
    }
    case 'trapdoor': {
      msgs.push('You fall through a trap door!');
      g = { ...g, _trapdoor: true };
      break;
    }
    default: break;
  }

  return { hero: h, units: u, gs: g, msgs };
}

// ── Monster special-effect handler (after a successful hit) ──────────────────

function applyMonsterEffect(effect, monster, hero, units, gs, rng) {
  const msgs = [];
  let h = hero;
  let u = units;
  let g = gs;
  let m = monster;

  switch (effect) {
    case 'rust': {
      const newAC = Math.max(0, (h.attrs.armorClass ?? 1) - 1);
      h = { ...h, attrs: { ...h.attrs, armorClass: newAC } };
      msgs.push(`The aquator rusts your armor! (AC now ${newAC + (h.attrs.armorEnchant ?? 0)})`);
      break;
    }
    case 'freeze': {
      const dur = 2 + Math.floor(rng() * 3);
      const eff = { ...h.attrs.effects, frozen: (h.attrs.effects.frozen ?? 0) + dur };
      h = { ...h, attrs: { ...h.attrs, effects: eff } };
      msgs.push(`You are frozen in place!`);
      break;
    }
    case 'hold': {
      const dur = 3 + Math.floor(rng() * 4);
      const eff = { ...h.attrs.effects, held: (h.attrs.effects.held ?? 0) + dur };
      h = { ...h, attrs: { ...h.attrs, effects: eff } };
      msgs.push(`You are held by the flytrap!`);
      break;
    }
    case 'drain_str': {
      const newStr = Math.max(3, h.attrs.strength - 1);
      h = { ...h, attrs: { ...h.attrs, strength: newStr } };
      msgs.push(`The rattlesnake's venom saps your strength! (Str ${newStr})`);
      break;
    }
    case 'drain_hp': {
      const newMax = Math.max(1, h.maxHp - 1);
      h = { ...h, maxHp: newMax, hp: Math.min(h.hp, newMax) };
      msgs.push(`The vampire drains your life force! (MaxHP ${newMax})`);
      break;
    }
    case 'drain_level': {
      if (g.experience > 0) {
        const newXP = Math.max(0, XP_THRESHOLDS[Math.max(0, h.attrs.heroLevel - 1)] - 1);
        const newLv = heroLevelForXP(newXP);
        h = { ...h, attrs: { ...h.attrs, heroLevel: newLv } };
        g = { ...g, experience: newXP };
        msgs.push(`The wraith drains your experience! (Level ${newLv})`);
      } else {
        msgs.push('The wraith touches you, but you feel nothing.');
      }
      break;
    }
    case 'steal_gold': {
      const stolen = h.attrs.gold;
      h = { ...h, attrs: { ...h.attrs, gold: 0 } };
      // Teleport leprechaun away
      const newPos = randomFloorPos(g.tiles ?? {}, g.rooms ?? [], rng,
        new Set(u.filter(un => un.alive).map(un => `${un.position.x},${un.position.y}`)));
      if (newPos) {
        m = { ...m, position: newPos };
        u = u.map(un => un.id === m.id ? m : un);
      }
      msgs.push(stolen > 0
        ? `The leprechaun steals your ${stolen} gold pieces and vanishes!`
        : 'The leprechaun finds nothing to steal and vanishes!');
      break;
    }
    case 'steal_item': {
      if (h.attrs.inventory.length > 0) {
        const idx  = Math.floor(rng() * h.attrs.inventory.length);
        const stolen = h.attrs.inventory[idx];
        const inv  = h.attrs.inventory.filter((_, i) => i !== idx);
        h = { ...h, attrs: { ...h.attrs, inventory: inv } };
        const newPos = randomFloorPos(g.tiles ?? {}, g.rooms ?? [], rng,
          new Set(u.filter(un => un.alive).map(un => `${un.position.x},${un.position.y}`)));
        if (newPos) {
          m = { ...m, position: newPos };
          u = u.map(un => un.id === m.id ? m : un);
        }
        msgs.push(`The nymph steals your ${stolen.name} and vanishes!`);
      } else {
        msgs.push('The nymph finds nothing to steal.');
      }
      break;
    }
    case 'confuse': {
      const dur = 5 + Math.floor(rng() * 8);
      const eff = { ...h.attrs.effects, confused: (h.attrs.effects.confused ?? 0) + dur };
      h = { ...h, attrs: { ...h.attrs, effects: eff } };
      msgs.push('The medusa confuses you!');
      break;
    }
    case 'regen':
      // Handled in monster turn
      break;
    default: break;
  }

  return { hero: h, units: u, gs: g, msgs };
}

// ── Wand effect ───────────────────────────────────────────────────────────────

function applyWandEffect(wandEffect, hero, units, gs, rooms, rng) {
  const msgs = [];
  let u = units;
  let g = gs;
  const heroPos = hero.position;

  // Find nearest visible monster
  const visible = u.filter(un =>
    un.alive && un.ownerId === 'dungeon' &&
    hasLOS(g.tiles ?? {}, heroPos.x, heroPos.y, un.position.x, un.position.y)
  ).sort((a, b) => manhattan(a.position, heroPos) - manhattan(b.position, heroPos));

  const target = visible[0] ?? null;

  switch (wandEffect) {
    case 'light': {
      g = { ...g, floorMapped: true };
      msgs.push('The room is illuminated!');
      break;
    }
    case 'magic_missile': {
      if (target) {
        const dmg = 1 + Math.floor(rng() * 4);
        const newHp = Math.max(0, target.hp - dmg);
        u = u.map(un => un.id === target.id ? { ...un, hp: newHp, alive: newHp > 0 } : un);
        msgs.push(`The magic missile hits the ${target.type} for ${dmg}!`);
        if (newHp <= 0) {
          g = { ...g, experience: g.experience + target.attrs.xp };
          msgs.push(`+${target.attrs.xp} XP`);
        }
      } else {
        msgs.push('The magic missile fires into the dark.');
      }
      break;
    }
    case 'slow_monster': {
      if (target) {
        u = u.map(un => un.id === target.id
          ? { ...un, attrs: { ...un.attrs, slowed: (un.attrs.slowed ?? 0) + 10 } } : un);
        msgs.push(`The ${target.type} slows down!`);
      } else {
        msgs.push('Nothing happens.');
      }
      break;
    }
    case 'polymorph': {
      if (target) {
        const types  = Object.keys(MONSTER_DEFS);
        const newType = types[Math.floor(rng() * types.length)];
        const newMon  = createMonster(target.id, newType, target.position, rng);
        u = u.map(un => un.id === target.id ? newMon : un);
        msgs.push(`The ${target.type} transforms into a ${newType}!`);
      } else {
        msgs.push('Nothing happens.');
      }
      break;
    }
    case 'fire': {
      if (target) {
        const dmg   = 6 + Math.floor(rng() * 6);
        const newHp = Math.max(0, target.hp - dmg);
        u = u.map(un => un.id === target.id ? { ...un, hp: newHp, alive: newHp > 0 } : un);
        msgs.push(`A bolt of fire hits the ${target.type} for ${dmg}!`);
        if (newHp <= 0) {
          g = { ...g, experience: g.experience + target.attrs.xp };
          msgs.push(`+${target.attrs.xp} XP`);
        }
      } else {
        msgs.push('The fire bolt scorches the wall.');
      }
      break;
    }
    case 'cold': {
      if (target) {
        const dmg   = 6 + Math.floor(rng() * 6);
        const newHp = Math.max(0, target.hp - dmg);
        u = u.map(un => un.id === target.id ? { ...un, hp: newHp, alive: newHp > 0 } : un);
        msgs.push(`A bolt of cold hits the ${target.type} for ${dmg}!`);
        if (newHp <= 0) {
          g = { ...g, experience: g.experience + target.attrs.xp };
          msgs.push(`+${target.attrs.xp} XP`);
        }
      } else {
        msgs.push('The cold bolt shatters against the wall.');
      }
      break;
    }
    case 'drain_life': {
      if (target) {
        const newHp = Math.max(1, Math.floor(target.hp / 2));
        u = u.map(un => un.id === target.id ? { ...un, hp: newHp } : un);
        msgs.push(`The ${target.type} looks weaker!`);
      } else {
        msgs.push('Nothing happens.');
      }
      break;
    }
    default: break;
  }

  return { units: u, gs: g, msgs };
}

// ── Monster AI turn ───────────────────────────────────────────────────────────

function runMonsters(units, tiles, gs, rng) {
  const msgs = [];
  let liveUnits = units.map(u => ({ ...u }));

  const heroIdx = liveUnits.findIndex(u => u.type === 'rogue');
  if (heroIdx < 0 || !liveUnits[heroIdx].alive) return { units: liveUnits, msgs, gs };

  for (let i = 0; i < liveUnits.length; i++) {
    let mon = liveUnits[i];
    if (mon.ownerId !== 'dungeon' || !mon.alive) continue;

    let hero = liveUnits[heroIdx];
    if (!hero.alive) break;

    // Regen (troll, griffin) - 1 HP per turn
    if (mon.attrs.specialAbility === 'regen' && mon.hp < mon.maxHp) {
      mon = { ...mon, hp: Math.min(mon.maxHp, mon.hp + 1) };
      liveUnits[i] = mon;
    }

    // Slowed monsters skip every other turn
    if ((mon.attrs.slowed ?? 0) > 0) {
      mon = { ...mon, attrs: { ...mon.attrs, slowed: mon.attrs.slowed - 1 } };
      liveUnits[i] = mon;
      if (mon.attrs.slowed % 2 === 0) continue; // skip turn
    }

    const dist   = manhattan(mon.position, hero.position);
    const canSee = dist <= mon.attrs.vision &&
                   hasLOS(tiles, mon.position.x, mon.position.y, hero.position.x, hero.position.y);

    // Stealth ring: 50% chance monsters don't wake
    const heroStealth = hero.attrs.leftRing?.effect === 'stealth' || hero.attrs.rightRing?.effect === 'stealth';

    // Wake up
    if (canSee && mon.attrs.asleep && !(heroStealth && rng() < 0.5)) {
      mon = { ...mon, attrs: { ...mon.attrs, asleep: false } };
    }

    if (mon.attrs.asleep) { liveUnits[i] = mon; continue; }

    // Bat: 50% random movement
    if (mon.attrs.specialAbility === 'random_move' && rng() < 0.5) {
      const step = stepRandom(tiles, mon.position, liveUnits, rng);
      if (step) mon = { ...mon, position: step };
      liveUnits[i] = mon;
      continue;
    }

    if (dist === 1) {
      const { hit, damage, effect } = monsterAttack(mon, hero, rng);
      if (hit) {
        const newHp = Math.max(0, hero.hp - damage);
        hero = { ...hero, hp: newHp, alive: newHp > 0 };
        liveUnits[heroIdx] = hero;
        if (damage > 0) msgs.push(`${mon.type} hits you for ${damage}!`);

        if (effect) {
          const result = applyMonsterEffect(effect, mon, hero, liveUnits, gs, rng);
          hero       = result.hero;
          liveUnits  = result.units;
          gs         = result.gs;
          msgs.push(...result.msgs);
          liveUnits[heroIdx] = hero;
          // Re-sync monster in case steal effects moved it
          mon = liveUnits[i];
        }

        if (!hero.alive) msgs.push('You die...');
      } else {
        msgs.push(`${mon.type} misses.`);
      }
    } else {
      const step = stepToward(tiles, mon.position, hero.position, liveUnits);
      if (step) mon = { ...mon, position: step };
    }

    liveUnits[i] = mon;
  }

  return { units: liveUnits, msgs, gs };
}

// ── Status effect tick ────────────────────────────────────────────────────────

function tickEffects(hero) {
  const eff = hero.attrs.effects;
  const next = {};
  for (const [k, v] of Object.entries(eff)) {
    if (typeof v === 'number') next[k] = Math.max(0, v - 1);
    else                       next[k] = v;
  }
  return { ...hero, attrs: { ...hero.attrs, effects: next } };
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const playerId    = players[0].id;
  const amuletLevel = config.amuletLevel ?? AMULET_LEVEL_DEFAULT;
  const rng         = config.rng ?? Math.random.bind(Math);

  const floor   = generateFloor(rng, 1);
  const heroPos = floor.heroPos;
  const hero    = createHero(playerId, heroPos);

  const items    = spawnItems(floor.rooms, 1, rng);
  const monsters = spawnMonsters(floor.rooms, 1, [{ position: heroPos, alive: true }], rng);
  const disguiseMap = generateDisguiseMap(rng);

  let amuletPos = null;
  if (amuletLevel === 1) {
    const deepRoom = floor.rooms[floor.rooms.length - 1];
    amuletPos = {
      x: deepRoom.x + Math.floor(deepRoom.w / 2),
      y: deepRoom.y + Math.floor(deepRoom.h / 2),
    };
  }

  return {
    gameName: 'Rogue: Dungeons of Doom',
    turnNumber: 1,
    activePlayers: [playerId],
    currentPhase: 'rogue-turn',
    players,
    units: [hero, ...monsters],
    board: { tiles: floor.tiles, width: MAP_W, height: MAP_H },
    lastActions: [],
    gameSpecific: {
      dungeonLevel: 1,
      amuletLevel,
      experience: 0,
      hunger: MAX_HUNGER,
      items,
      stairsDown: amuletLevel === 1 ? null : floor.stairsDown,
      stairsUp: null,
      amuletPos,
      hasAmulet: false,
      floorMapped: false,
      lastMessages: [],
      disguiseMap,
      identified: [],  // array of item types; serializable
      rooms: floor.rooms,
      tiles: floor.tiles,
      traps: floor.traps,
    },
  };
}

// ── getLegalActions ───────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const hero = state.units.find(u => u.type === 'rogue' && u.alive);
  if (!hero) return [{ type: 'end-turn', unitId: '__player__' }];

  const tiles  = state.board.tiles;
  const units  = state.units;
  const gs     = state.gameSpecific;
  const eff    = hero.attrs.effects;
  const actions = [];

  const isHeld   = (eff.held   ?? 0) > 0;
  const isFrozen = (eff.frozen ?? 0) > 0;

  if (!isHeld && !isFrozen) {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    // Confused: only random moves are "legal" (we still allow all, caller picks random)
    for (const [dx, dy] of dirs) {
      const nx = hero.position.x + dx;
      const ny = hero.position.y + dy;
      const monster = units.find(u => u.alive && u.ownerId === 'dungeon' &&
                                      u.position.x === nx && u.position.y === ny);
      if (monster) {
        actions.push({ type: 'move', unitId: hero.id, from: hero.position, to: { x: nx, y: ny }, isAttack: true, targetId: monster.id });
      } else if (isWalkable(tiles, nx, ny)) {
        actions.push({ type: 'move', unitId: hero.id, from: hero.position, to: { x: nx, y: ny } });
      }
    }
  }

  // Use inventory items
  for (let i = 0; i < hero.attrs.inventory.length; i++) {
    actions.push({ type: 'use-item', unitId: hero.id, payload: { slot: i } });
  }

  // Drop inventory items
  for (let i = 0; i < hero.attrs.inventory.length; i++) {
    actions.push({ type: 'drop-item', unitId: hero.id, payload: { slot: i } });
  }

  // Remove rings
  if (hero.attrs.leftRing)  actions.push({ type: 'remove-ring', unitId: hero.id, payload: { side: 'left' } });
  if (hero.attrs.rightRing) actions.push({ type: 'remove-ring', unitId: hero.id, payload: { side: 'right' } });

  // Stairs
  if (gs.stairsDown &&
      hero.position.x === gs.stairsDown.x && hero.position.y === gs.stairsDown.y &&
      (eff.levitate ?? 0) === 0) {
    actions.push({ type: 'descend-stairs', unitId: hero.id });
  }
  if (gs.stairsUp &&
      hero.position.x === gs.stairsUp.x && hero.position.y === gs.stairsUp.y &&
      (eff.levitate ?? 0) === 0) {
    actions.push({ type: 'ascend-stairs', unitId: hero.id });
  }

  actions.push({ type: 'end-turn', unitId: '__player__' });
  return actions;
}

// ── applyActions ──────────────────────────────────────────────────────────────

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  let units = state.units;
  let gs    = state.gameSpecific;
  let board = state.board;
  const tiles = board.tiles;
  const msgs  = [];

  const identified = new Set(gs.identified ?? []);
  const disguiseMap = gs.disguiseMap ?? {};

  let hero = units.find(u => u.type === 'rogue' && u.alive);
  if (!hero) return state;

  const eff = hero.attrs.effects;

  // ── Hero action ──────────────────────────────────────────────────────────────

  if (action.type === 'move') {
    let dest = action.to;

    // Confusion: redirect move randomly 50% of the time
    if ((eff.confused ?? 0) > 0 && rng() < 0.5) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const [dx, dy] = dirs[Math.floor(rng() * dirs.length)];
      const rx = hero.position.x + dx, ry = hero.position.y + dy;
      if (isWalkable(tiles, rx, ry)) { dest = { x: rx, y: ry }; msgs.push('You stumble in confusion!'); }
    }

    if (action.isAttack && dest === action.to) {
      const monster = units.find(u => u.id === action.targetId);
      // Reveal Xeroc when attacked
      if (monster?.attrs?.specialAbility === 'mimic') {
        units = units.map(u => u.id === monster.id
          ? { ...u, attrs: { ...u.attrs, revealed: true } } : u);
        msgs.push(`It's a Xeroc!`);
      }
      const { hit, damage } = heroAttack(hero, monster, rng);
      if (hit) {
        const newHp = Math.max(0, monster.hp - damage);
        const dead  = newHp <= 0;
        units = units.map(u => u.id === monster.id ? { ...u, hp: newHp, alive: !dead } : u);
        msgs.push(`You hit the ${monster.type} for ${damage}!${dead ? ' It dies!' : ''}`);
        if (dead) {
          gs = { ...gs, experience: gs.experience + monster.attrs.xp };
          msgs.push(`+${monster.attrs.xp} XP`);
        }
      } else {
        msgs.push(`You miss the ${monster.type}.`);
      }
    } else {
      // Move
      hero  = { ...hero, position: dest };
      units = units.map(u => u.id === hero.id ? hero : u);

      // Check trap
      const trap = (gs.traps ?? []).find(tr => tr.x === dest.x && tr.y === dest.y);
      if (trap) {
        const revealed = gs.traps.map(tr =>
          tr.x === dest.x && tr.y === dest.y ? { ...tr, hidden: false } : tr);
        gs = { ...gs, traps: revealed };
        if (trap.hidden) {
          const result = triggerTrap(trap, hero, units, { ...gs, tiles, rooms: gs.rooms }, gs.rooms, rng);
          hero  = result.hero;
          units = result.units;
          gs    = { ...result.gs, tiles, rooms: gs.rooms };
          units = units.map(u => u.id === hero.id ? hero : u);
          msgs.push(...result.msgs);
          // Handle trapdoor
          if (gs._trapdoor) {
            gs = { ...gs, _trapdoor: undefined };
            const newLvl  = gs.dungeonLevel + 1;
            const newFloor = buildFloor(newLvl, gs.amuletLevel, hero.position, rng);
            const newHero  = { ...hero, position: newFloor.heroPos };
            units = [newHero, ...newFloor.monsters];
            hero  = newHero;
            gs = { ...gs, dungeonLevel: newLvl, items: newFloor.items, stairsDown: newFloor.stairsDown,
                   stairsUp: newFloor.stairsUp, amuletPos: newFloor.amuletPos, floorMapped: false,
                   traps: newFloor.traps, rooms: newFloor.rooms, tiles: newFloor.tiles };
            board = { tiles: newFloor.tiles, width: MAP_W, height: MAP_H };
            msgs.push(`You fall through a trapdoor to level ${newLvl}!`);
          }
        }
      }

      // Auto-pick up items (not while levitating)
      if ((eff.levitate ?? 0) === 0) {
        const item = gs.items.find(it => !it.pickedUp && it.x === dest.x && it.y === dest.y);
        if (item) {
          const result = applyPickup(hero, item, rng, disguiseMap, identified);
          hero       = result.hero;
          identified.clear(); for (const t of result.identified) identified.add(t);
          units = units.map(u => u.id === hero.id ? hero : u);
          gs    = { ...gs, items: gs.items.map(it => it.id === item.id ? { ...it, pickedUp: true } : it) };
          if (result.message) msgs.push(result.message);
        }
      }

      // Pick up amulet
      if (gs.amuletPos && !gs.hasAmulet &&
          dest.x === gs.amuletPos.x && dest.y === gs.amuletPos.y) {
        gs = { ...gs, hasAmulet: true };
        msgs.push('You grab the Amulet of Yendor! YOU WIN!');
      }
    }

    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'use-item') {
    const { slot } = action.payload;
    const result = useInventoryItem(hero, slot, rng, disguiseMap, identified,
                                     board.tiles, units);
    hero = result.hero;
    identified.clear(); for (const t of result.identified) identified.add(t);
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push(result.message);

    const fx = result.effect;
    if (fx?.type === 'feed') {
      gs = { ...gs, hunger: Math.min(MAX_HUNGER, gs.hunger + fx.amount) };
    }
    if (fx?.type === 'map')   { gs = { ...gs, floorMapped: true }; }
    if (fx?.type === 'teleport') {
      const excluded = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
      const pos = randomFloorPos(board.tiles, gs.rooms ?? [], rng, excluded);
      if (pos) { hero = { ...hero, position: pos }; units = units.map(u => u.id === hero.id ? hero : u); }
    }
    if (fx?.type === 'scare') {
      units = units.map(u => u.ownerId === 'dungeon' && u.alive
        ? { ...u, attrs: { ...u.attrs, scared: true } } : u);
    }
    if (fx?.type === 'hold_all') {
      units = units.map(u => u.ownerId === 'dungeon' && u.alive
        ? { ...u, attrs: { ...u.attrs, slowed: (u.attrs.slowed ?? 0) + fx.turns * 2 } } : u);
    }
    if (fx?.type === 'aggravate') {
      units = units.map(u => u.ownerId === 'dungeon' && u.alive
        ? { ...u, attrs: { ...u.attrs, asleep: false } } : u);
    }
    if (fx?.type === 'spawn_monster') {
      const lv = gs.dungeonLevel;
      const eligible = Object.keys(MONSTER_DEFS).filter(t => MONSTER_DEFS[t].minFloor <= lv);
      if (eligible.length > 0) {
        const type = eligible[Math.floor(rng() * eligible.length)];
        const excluded = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
        const pos = randomFloorPos(board.tiles, gs.rooms ?? [], rng, excluded);
        if (pos) {
          const newMon = createMonster(`m-scroll-${Date.now()}`, type, pos, rng);
          units = [...units, newMon];
        }
      }
    }
    if (fx?.type === 'wand') {
      const result2 = applyWandEffect(fx.wandEffect, hero, units, { ...gs, tiles: board.tiles }, gs.rooms ?? [], rng);
      units = result2.units;
      gs    = { ...gs, experience: result2.gs.experience, floorMapped: result2.gs.floorMapped ?? gs.floorMapped };
      msgs.push(...result2.msgs);
    }

    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'drop-item') {
    const { slot } = action.payload;
    const result   = dropInventoryItem(hero, slot);
    if (result.droppedItem) {
      hero  = result.hero;
      units = units.map(u => u.id === hero.id ? hero : u);
      const def = ITEM_DEFS[result.droppedItem.type];
      const name = getDisplayName(result.droppedItem.type, disguiseMap, identified);
      gs = { ...gs, items: [...gs.items, result.droppedItem] };
      msgs.push(`You drop the ${name}.`);
    }
    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'remove-ring') {
    const { side } = action.payload;
    const slot = side === 'left' ? 'leftRing' : 'rightRing';
    const ring = hero.attrs[slot];
    if (ring) {
      const inv  = [...hero.attrs.inventory, { id: `ring-${Date.now()}`, type: ring.type, name: ring.name }];
      hero  = { ...hero, attrs: { ...hero.attrs, [slot]: null, inventory: inv } };
      units = units.map(u => u.id === hero.id ? hero : u);
      msgs.push(`You remove the ${ring.name}.`);
    }
    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'end-turn') {
    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'descend-stairs') {
    const newLevel = gs.dungeonLevel + 1;
    const newFloor = buildFloor(newLevel, gs.amuletLevel, hero.position, rng);
    const newHero  = { ...hero, position: newFloor.heroPos };
    units = [newHero, ...newFloor.monsters];
    hero  = newHero;
    gs = { ...gs, dungeonLevel: newLevel, items: newFloor.items,
           stairsDown: newFloor.stairsDown, stairsUp: newFloor.stairsUp,
           amuletPos: newFloor.amuletPos, floorMapped: false,
           traps: newFloor.traps, rooms: newFloor.rooms, tiles: newFloor.tiles };
    board = { tiles: newFloor.tiles, width: MAP_W, height: MAP_H };
    msgs.push(`You descend to dungeon level ${newLevel}.`);
  }

  if (action.type === 'ascend-stairs') {
    const newLevel = gs.dungeonLevel - 1;
    if (newLevel >= 1) {
      const newFloor = buildFloor(newLevel, gs.amuletLevel, hero.position, rng);
      const newHero  = { ...hero, position: newFloor.heroPos };
      units = [newHero, ...newFloor.monsters];
      hero  = newHero;
      gs = { ...gs, dungeonLevel: newLevel, items: newFloor.items,
             stairsDown: newFloor.stairsDown, stairsUp: newFloor.stairsUp,
             amuletPos: newFloor.amuletPos, floorMapped: false,
             traps: newFloor.traps, rooms: newFloor.rooms, tiles: newFloor.tiles };
      board = { tiles: newFloor.tiles, width: MAP_W, height: MAP_H };
      msgs.push(`You ascend to dungeon level ${newLevel}.`);
    }
  }

  // ── Hunger damage ─────────────────────────────────────────────────────────────
  if (gs.hunger <= 0) {
    const newHp = Math.max(0, hero.hp - 1);
    hero  = { ...hero, hp: newHp, alive: newHp > 0 };
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push('You are starving!');
  }

  // ── Ring passive effects ──────────────────────────────────────────────────────
  if (hero.alive) {
    const ringResult = applyRingEffects(hero, gs, rng);
    hero = ringResult.hero;
    gs   = ringResult.gs;
    gs   = { ...gs, hunger: gs.hunger + ringResult.hungerMod };
    if (gs._ringTeleport) {
      gs = { ...gs, _ringTeleport: undefined };
      const excluded = new Set(units.filter(u => u.alive).map(u => `${u.position.x},${u.position.y}`));
      const pos = randomFloorPos(board.tiles, gs.rooms ?? [], rng, excluded);
      if (pos) { hero = { ...hero, position: pos }; msgs.push('Your ring teleports you!'); }
    }
    units = units.map(u => u.id === hero.id ? hero : u);
  }

  // ── Level-up check ────────────────────────────────────────────────────────────
  const newHeroLv = heroLevelForXP(gs.experience);
  if (newHeroLv > (hero.attrs.heroLevel ?? 1)) {
    const hpGain = 4 + Math.floor(rng() * 4);
    hero = { ...hero, maxHp: hero.maxHp + hpGain, hp: hero.hp + hpGain,
             attrs: { ...hero.attrs, heroLevel: newHeroLv } };
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push(`Welcome to hero level ${newHeroLv}! (+${hpGain} max HP)`);
  }

  // ── Tick status effects ───────────────────────────────────────────────────────
  if (hero.alive) {
    hero  = tickEffects(hero);
    units = units.map(u => u.id === hero.id ? hero : u);
  }

  // ── Monster turns (skip after staircase or hero dead) ────────────────────────
  const skipMonsters = ['descend-stairs','ascend-stairs'].includes(action.type);
  if (!skipMonsters && hero.alive) {
    const result = runMonsters(units, board.tiles, { ...gs, tiles: board.tiles, rooms: gs.rooms }, rng);
    units = result.units;
    gs    = result.gs;
    msgs.push(...result.msgs);
    hero  = units.find(u => u.type === 'rogue') ?? hero;
  }

  return {
    ...state,
    board,
    units,
    activePlayers:  [playerId],
    currentPhase:   'rogue-turn',
    turnNumber:     state.turnNumber + 1,
    lastActions:    playerActions,
    gameSpecific:   { ...gs, lastMessages: msgs, identified: [...identified] },
  };
}

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(state) {
  const { gameSpecific: gs, units } = state;
  if (gs.hasAmulet) {
    return { outcome: 'win', winnerId: state.players[0].id, reason: 'amulet-of-yendor' };
  }
  const hero = units.find(u => u.type === 'rogue');
  if (hero && !hero.alive) {
    return { outcome: 'win', winnerId: null, reason: 'rogue-died' };
  }
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function renderState(state) {
  const { turnNumber, units, gameSpecific: gs } = state;
  const hero = units.find(u => u.type === 'rogue');
  const identified = new Set(gs.identified ?? []);
  const disguiseMap = gs.disguiseMap ?? {};

  const mapStr = renderMap(state);

  let heroStr = '(dead)';
  if (hero?.alive) {
    const eff = hero.attrs.effects;
    const statusBits = [
      (eff.confused ?? 0)    > 0 && 'CONFUSED',
      (eff.blind    ?? 0)    > 0 && 'BLIND',
      (eff.haste    ?? 0)    > 0 && 'HASTE',
      (eff.held     ?? 0)    > 0 && 'HELD',
      (eff.frozen   ?? 0)    > 0 && 'FROZEN',
      (eff.levitate ?? 0)    > 0 && 'FLOATING',
      eff.poisoned            && 'POISONED',
    ].filter(Boolean).join(' ');

    const leftRing  = hero.attrs.leftRing
      ? getDisplayName(hero.attrs.leftRing.type, disguiseMap, identified) : 'none';
    const rightRing = hero.attrs.rightRing
      ? getDisplayName(hero.attrs.rightRing.type, disguiseMap, identified) : 'none';

    const inv = hero.attrs.inventory.length
      ? hero.attrs.inventory.map((it, i) => {
          const name = getDisplayName(it.type, disguiseMap, identified);
          const charges = it.charges != null ? `(${it.charges})` : '';
          return `[${i}]${name}${charges}`;
        }).join(' ')
      : '(empty)';

    const wEnch = hero.attrs.weaponEnchant ? ` ${hero.attrs.weaponEnchant > 0 ? '+' : ''}${hero.attrs.weaponEnchant}` : '';
    const aEnch = hero.attrs.armorEnchant  ? ` ${hero.attrs.armorEnchant  > 0 ? '+' : ''}${hero.attrs.armorEnchant}`  : '';

    heroStr = [
      `HP: ${hero.hp}/${hero.maxHp}  Str: ${hero.attrs.strength}  Lv: ${hero.attrs.heroLevel}`,
      `Wpn: ${hero.attrs.weapon}${wEnch}(${hero.attrs.weaponDmg.join('d')})  ` +
        `Arm: ${hero.attrs.armor}${aEnch}(AC${hero.attrs.armorClass + (hero.attrs.armorEnchant ?? 0)})`,
      `Gold: ${hero.attrs.gold}  XP: ${gs.experience}`,
      `Rings: L:${leftRing}  R:${rightRing}`,
      `Hunger: ${hungerBar(gs.hunger)}${statusBits ? '  Status: ' + statusBits : ''}`,
      `Inventory: ${inv}`,
    ].join('\n');
  }

  const msgs  = gs.lastMessages?.join('  |  ') ?? '';
  const alive = units.filter(u => u.ownerId === 'dungeon' && u.alive).length;

  return [
    `╔═ ROGUE: Dungeons of Doom ═══════════════ Turn ${String(turnNumber).padStart(4)} ═══ Dungeon Level ${gs.dungeonLevel}/${gs.amuletLevel} ═╗`,
    mapStr,
    `╚${'═'.repeat(MAP_W - 1)}╝`,
    heroStr,
    `Monsters on floor: ${alive}`,
    msgs ? `>> ${msgs}` : '',
    `Legend: @=you  >=stairs↓  <=stairs↑  ^=trap  "=Amulet  %=food  !=potion  ?=scroll  )=weapon  ]=armor  =:ring  /:wand  *=gold`,
  ].filter(Boolean).join('\n');
}

function hungerBar(hunger) {
  const filled = Math.round((hunger / MAX_HUNGER) * 20);
  const bar    = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, 20 - filled));
  const label  = hunger > 800 ? 'full' : hunger > 400 ? 'hungry' : hunger > 0 ? 'weak' : 'STARVING';
  return `[${bar}] ${label}`;
}

function getActionDuration(_state, action) {
  if (action.type === 'move') return action.isAttack ? 1.5 : 1;
  if (action.type === 'use-item') return 0.5;
  return 1;
}

export const RogueGame = {
  name: 'Rogue: Dungeons of Doom',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getActionDuration,
};
