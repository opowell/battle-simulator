import { generateFloor, MAP_W, MAP_H } from './dungeon.js';
import { isWalkable, manhattan, hasLOS, stepToward, renderMap } from './map.js';
import { createHero, createMonster, spawnMonsters } from './units.js';
import { spawnItems, applyPickup, useInventoryItem } from './items.js';
import { heroAttack, monsterAttack } from './combat.js';

const MAX_HUNGER      = 1500;
const AMULET_LEVEL_DEFAULT = 10;

// XP needed to reach each hero level (index = level - 1)
const XP_THRESHOLDS = [0, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120];

function heroLevelForXP(xp) {
  let lv = 1;
  while (lv < XP_THRESHOLDS.length && xp >= XP_THRESHOLDS[lv]) lv++;
  return lv;
}

// Build a fresh floor: tiles + monsters + items + stairs + amulet placement
function buildFloor(dungeonLevel, amuletLevel, heroPos, rng) {
  const floor   = generateFloor(rng);
  const items   = spawnItems(floor.rooms, dungeonLevel, rng);
  const monsters = spawnMonsters(floor.rooms, dungeonLevel, [{ position: heroPos, alive: true }], rng);

  let amuletPos = null;
  if (dungeonLevel === amuletLevel) {
    const deepRoom = floor.rooms[floor.rooms.length - 1];
    amuletPos = {
      x: deepRoom.x + Math.floor(deepRoom.w / 2),
      y: deepRoom.y + Math.floor(deepRoom.h / 2),
    };
  }

  return { tiles: floor.tiles, rooms: floor.rooms, heroPos: floor.heroPos, stairsDown: floor.stairsDown, items, monsters, amuletPos };
}

// Run all monster turns after the hero acts
function runMonsters(units, tiles, gs, rng) {
  const msgs = [];
  const liveUnits = units.map(u => ({ ...u })); // shallow copy array entries

  const heroIdx = liveUnits.findIndex(u => u.type === 'rogue');
  if (heroIdx < 0 || !liveUnits[heroIdx].alive) return { units: liveUnits, msgs };

  for (let i = 0; i < liveUnits.length; i++) {
    const mon = liveUnits[i];
    if (mon.ownerId !== 'dungeon' || !mon.alive) continue;

    const hero = liveUnits[heroIdx];
    if (!hero.alive) break;

    const dist    = manhattan(mon.position, hero.position);
    const canSee  = dist <= mon.attrs.vision &&
                    hasLOS(tiles, mon.position.x, mon.position.y, hero.position.x, hero.position.y);

    let updated = mon;

    // Wake up
    if (canSee && updated.attrs.asleep) {
      updated = { ...updated, attrs: { ...updated.attrs, asleep: false } };
    }

    if (updated.attrs.asleep) {
      liveUnits[i] = updated;
      continue;
    }

    if (dist === 1) {
      // Attack hero
      const { hit, damage } = monsterAttack(updated, hero, rng);
      if (hit) {
        const newHp  = Math.max(0, hero.hp - damage);
        liveUnits[heroIdx] = { ...hero, hp: newHp, alive: newHp > 0 };
        msgs.push(`${updated.type} hits you for ${damage}!`);
      } else {
        msgs.push(`${updated.type} misses.`);
      }
    } else {
      // Move toward hero
      const step = stepToward(tiles, updated.position, hero.position, liveUnits);
      if (step) updated = { ...updated, position: step };
    }

    liveUnits[i] = updated;
  }

  return { units: liveUnits, msgs };
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const playerId    = players[0].id;
  const amuletLevel = config.amuletLevel ?? AMULET_LEVEL_DEFAULT;
  const rng         = config.rng ?? Math.random.bind(Math);

  const floor   = generateFloor(rng);
  const heroPos = floor.heroPos;
  const hero    = createHero(playerId, heroPos);

  const items    = spawnItems(floor.rooms, 1, rng);
  const monsters = spawnMonsters(floor.rooms, 1, [{ position: heroPos, alive: true }], rng);

  // Place amulet on floor 1 when amuletLevel === 1
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
      amuletPos,
      hasAmulet: false,
      floorMapped: false,
      lastMessages: [],
    },
  };
}

// ── getLegalActions ────────────────────────────────────────────────────────────

function getLegalActions(state, playerId) {
  const hero  = state.units.find(u => u.type === 'rogue' && u.alive);
  if (!hero) return [{ type: 'end-turn', unitId: '__player__' }];

  const tiles   = state.board.tiles;
  const units   = state.units;
  const gs      = state.gameSpecific;
  const actions = [];

  // Move (or attack by moving into a monster)
  for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
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

  // Use inventory items
  for (let i = 0; i < hero.attrs.inventory.length; i++) {
    actions.push({ type: 'use-item', unitId: hero.id, payload: { slot: i } });
  }

  // Descend stairs
  if (gs.stairsDown &&
      hero.position.x === gs.stairsDown.x && hero.position.y === gs.stairsDown.y) {
    actions.push({ type: 'descend-stairs', unitId: hero.id });
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

  let hero = units.find(u => u.type === 'rogue' && u.alive);
  if (!hero) return state; // already dead

  // ── Hero action ──────────────────────────────────────────────────────────────

  if (action.type === 'move') {
    const { to } = action;

    if (action.isAttack) {
      // Attack the monster at `to`
      const monster  = units.find(u => u.id === action.targetId);
      const { hit, damage } = heroAttack(hero, monster, rng);
      if (hit) {
        const newHp = Math.max(0, monster.hp - damage);
        const dead  = newHp <= 0;
        units = units.map(u => u.id === monster.id ? { ...u, hp: newHp, alive: !dead } : u);
        msgs.push(`You hit the ${monster.type} for ${damage}!${dead ? ' It dies!' : ''}`);
        if (dead) {
          const xpGain = monster.attrs.xp;
          gs = { ...gs, experience: gs.experience + xpGain };
          msgs.push(`+${xpGain} XP`);
        }
      } else {
        msgs.push(`You miss the ${monster.type}.`);
      }
    } else {
      // Move
      hero  = { ...hero, position: to };
      units = units.map(u => u.id === hero.id ? hero : u);

      // Auto-pick up items
      const item = gs.items.find(it => !it.pickedUp && it.x === to.x && it.y === to.y);
      if (item) {
        const { hero: newHero, message } = applyPickup(hero, item, rng);
        hero  = newHero;
        units = units.map(u => u.id === hero.id ? hero : u);
        gs    = { ...gs, items: gs.items.map(it => it.id === item.id ? { ...it, pickedUp: true } : it) };
        if (message) msgs.push(message);
      }

      // Pick up amulet
      if (gs.amuletPos && !gs.hasAmulet &&
          to.x === gs.amuletPos.x && to.y === gs.amuletPos.y) {
        gs = { ...gs, hasAmulet: true };
        msgs.push('You grab the Amulet of Yendor! YOU WIN!');
      }
    }

    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'use-item') {
    const { slot } = action.payload;
    const result   = useInventoryItem(hero, slot, rng);
    hero  = result.hero;
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push(result.message);
    if (result.effect?.type === 'feed') {
      gs = { ...gs, hunger: Math.min(MAX_HUNGER, gs.hunger + result.effect.amount) };
    }
    if (result.effect?.type === 'map') {
      gs = { ...gs, floorMapped: true };
    }
    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'end-turn') {
    gs = { ...gs, hunger: gs.hunger - 1 };
  }

  if (action.type === 'descend-stairs') {
    const newLevel  = gs.dungeonLevel + 1;
    const newFloor  = buildFloor(newLevel, gs.amuletLevel, hero.position, rng);
    const newHero   = { ...hero, position: newFloor.heroPos };
    units = [newHero, ...newFloor.monsters];
    hero  = newHero;
    gs = {
      ...gs,
      dungeonLevel: newLevel,
      items:        newFloor.items,
      stairsDown:   newFloor.stairsDown,
      amuletPos:    newFloor.amuletPos,
      floorMapped:  false,
    };
    board = { tiles: newFloor.tiles, width: MAP_W, height: MAP_H };
    msgs.push(`You descend to dungeon level ${newLevel}.`);
  }

  // ── Hunger damage ────────────────────────────────────────────────────────────
  if (gs.hunger <= 0) {
    const newHp = Math.max(0, hero.hp - 1);
    hero  = { ...hero, hp: newHp, alive: newHp > 0 };
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push('You are starving!');
  }

  // ── Level-up check ───────────────────────────────────────────────────────────
  const newHeroLv = heroLevelForXP(gs.experience);
  if (newHeroLv > hero.attrs.heroLevel) {
    const hpGain = 4 + Math.floor(rng() * 4);
    hero = {
      ...hero,
      maxHp: hero.maxHp + hpGain,
      hp:    hero.hp    + hpGain,
      attrs: { ...hero.attrs, heroLevel: newHeroLv },
    };
    units = units.map(u => u.id === hero.id ? hero : u);
    msgs.push(`Welcome to hero level ${newHeroLv}! (+${hpGain} max HP)`);
  }

  // ── Monster turns ────────────────────────────────────────────────────────────
  if (action.type !== 'descend-stairs' && hero.alive) {
    const result = runMonsters(units, board.tiles, gs, rng);
    units = result.units;
    msgs.push(...result.msgs);
  }

  return {
    ...state,
    board,
    units,
    activePlayers:  [playerId],
    currentPhase:   'rogue-turn',
    turnNumber:     state.turnNumber + 1,
    lastActions:    playerActions,
    gameSpecific:   { ...gs, lastMessages: msgs },
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

  const mapStr = renderMap(state);

  let heroStr = '(dead)';
  if (hero?.alive) {
    const inv = hero.attrs.inventory.map((it, i) => `[${i}]${it.name}`).join(' ') || '(empty)';
    heroStr = [
      `HP: ${hero.hp}/${hero.maxHp}  Str: ${hero.attrs.strength}  Lv: ${hero.attrs.heroLevel}`,
      `Wpn: ${hero.attrs.weapon}(${hero.attrs.weaponDmg.join('d')})  Arm: ${hero.attrs.armor}(AC${hero.attrs.armorClass})`,
      `Gold: ${hero.attrs.gold}  XP: ${gs.experience}`,
      `Hunger: ${hungerBar(gs.hunger)}`,
      `Inventory: ${inv}`,
    ].join('\n');
  }

  const msgs = gs.lastMessages?.join('  |  ') ?? '';
  const alive = units.filter(u => u.ownerId === 'dungeon' && u.alive).length;

  return [
    `╔═ ROGUE: Dungeons of Doom ═══════════════ Turn ${String(turnNumber).padStart(4)} ═══ Dungeon Level ${gs.dungeonLevel}/${gs.amuletLevel} ═╗`,
    mapStr,
    `╚${'═'.repeat(MAP_W - 1)}╝`,
    heroStr,
    `Monsters on floor: ${alive}`,
    msgs ? `>> ${msgs}` : '',
    `Legend: @=you  >=stairs  "=Amulet  %=food  !=potion  ?=scroll  )=weapon  ]=armor  *=gold`,
  ].filter(Boolean).join('\n');
}

function hungerBar(hunger) {
  const filled = Math.round((hunger / MAX_HUNGER) * 20);
  const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, 20 - filled));
  const label = hunger > 800 ? 'full' : hunger > 400 ? 'hungry' : hunger > 0 ? 'weak' : 'STARVING';
  return `[${bar}] ${label}`;
}

// ── Export ────────────────────────────────────────────────────────────────────

function getActionDuration(_state, action) {
  // Hero moves one tile at a time; attack-moves take longer (combat)
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
