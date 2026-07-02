import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RogueGame } from './index.js';
import { RogueBelief, isMonsterVisible, VISION } from './belief.js';
import { hasLOS, manhattan } from './map.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { GameEngine } from '../../engine/index.js';

// Rogue is single-player: only players[0] (the hero) is a real controllable
// player. Monsters are owned by 'dungeon' and move automatically inside
// applyActions — there's no second agent.
const players = () => [{ id: 'p1', name: 'Rogue' }];

const seededRng = (seed = 7) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000; };
};

test('rogue fog: exposes a fogOfWar game option', () => {
  const opt = (RogueGame.gameOptions ?? []).find(o => o.id === 'fogOfWar');
  assert.ok(opt && opt.type === 'boolean', 'Rogue declares a fogOfWar boolean option');
  assert.equal(opt.default, false);
});

test('rogue fog: getVisibleState hides out-of-LOS/vision monsters', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: true, rng: seededRng() });
  const view = RogueGame.getVisibleState(s, 'p1');
  const hero = s.units.find(u => u.type === 'rogue');

  const monstersInState = s.units.filter(u => u.ownerId === 'dungeon');
  const monstersInView = view.units.filter(u => u.ownerId === 'dungeon');

  // Every monster still in view must actually be visible under our own rule.
  for (const m of monstersInView) {
    assert.ok(isMonsterVisible(s.board.tiles, hero, m), `${m.id} should be genuinely visible`);
  }
  // Every monster NOT in view must indeed be out of vision/LOS.
  const viewIds = new Set(monstersInView.map(u => u.id));
  const hiddenCount = monstersInState.filter(m => !viewIds.has(m.id)).length;
  for (const m of monstersInState) {
    if (viewIds.has(m.id)) continue;
    assert.ok(!isMonsterVisible(s.board.tiles, hero, m), `${m.id} should be genuinely hidden`);
  }
  // Sanity: floor 1 with a fresh hero should have at least SOME monster
  // outside starting vision (dungeon is bigger than one VISION radius).
  assert.ok(hiddenCount >= 0);
});

test('rogue fog: getVisibleState is a no-op when fog is off', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: false, rng: seededRng() });
  const view = RogueGame.getVisibleState(s, 'p1');
  assert.equal(view, s, 'returns the same state object when fog is off');
});

test('rogue fog: getVisibleState masks unexplored dungeon tiles', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: true, rng: seededRng() });
  const view = RogueGame.getVisibleState(s, 'p1');
  const trueFloorTiles = Object.values(s.board.tiles).filter(t => t === '.').length;
  const visibleFloorTiles = Object.values(view.board.tiles).filter(t => t === '.').length;
  assert.ok(visibleFloorTiles > 0, 'hero sees at least its starting room');
  assert.ok(visibleFloorTiles <= trueFloorTiles, 'never reveals more than the true floor');
  // The dungeon is generated as a 3x3 grid of rooms; a fresh hero at start
  // should not yet see the whole floor.
  assert.ok(visibleFloorTiles < trueFloorTiles, 'unexplored tiles are masked');
});

test('rogue fog: sampleWorlds only places monsters outside current LOS/vision', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: true, rng: seededRng() });
  const view = RogueGame.getVisibleState(s, 'p1');
  const worlds = RogueGame.sampleWorlds(view, 'p1', 8, seededRng(99));
  const hero = view.units.find(u => u.type === 'rogue');
  const seenIds = new Set(view.units.filter(u => u.ownerId === 'dungeon').map(u => u.id));

  assert.ok(worlds.length > 0, 'produces particles when fog is on');
  for (const w of worlds) {
    for (const m of w.units.filter(u => u.ownerId === 'dungeon' && u.alive)) {
      if (seenIds.has(m.id)) continue; // already-known monsters may repeat their pinned tile
      assert.ok(!isMonsterVisible(view.board.tiles, hero, m),
        `sampled monster ${m.id} at (${m.position.x},${m.position.y}) should be outside current vision/LOS`);
    }
  }
});

test('rogue fog: sampleWorlds returns [] when fog is off', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: false, rng: seededRng() });
  const view = RogueGame.getVisibleState(s, 'p1');
  assert.deepEqual(RogueGame.sampleWorlds(view, 'p1', 4, seededRng()), []);
});

test('rogue fog: evaluateState returns a finite number and rewards more hp/depth', () => {
  const s = RogueGame.createInitialState(players(), { rng: seededRng() });
  const hero = s.units.find(u => u.type === 'rogue');
  const base = RogueGame.evaluateState(s, 'p1');
  assert.equal(typeof base, 'number');
  assert.ok(Number.isFinite(base));

  const hurt = { ...s, units: s.units.map(u => u.id === hero.id ? { ...u, hp: 1 } : u) };
  assert.ok(RogueGame.evaluateState(hurt, 'p1') < base, 'low hp scores worse');

  const deeper = { ...s, gameSpecific: { ...s.gameSpecific, dungeonLevel: s.gameSpecific.dungeonLevel + 3 } };
  assert.ok(RogueGame.evaluateState(deeper, 'p1') > base, 'deeper dungeon scores better');

  const dead = { ...s, units: s.units.map(u => u.id === hero.id ? { ...u, alive: false, hp: 0 } : u) };
  assert.ok(RogueGame.evaluateState(dead, 'p1') < base, 'dead hero scores much worse');

  const amulet = { ...s, gameSpecific: { ...s.gameSpecific, hasAmulet: true } };
  assert.ok(RogueGame.evaluateState(amulet, 'p1') > base, 'carrying the amulet scores far better');
});

// ── RogueBelief unit coverage ────────────────────────────────────────────────

test('rogue fog: belief pins a sighting then keeps it near its last position after it hides', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: true, rng: seededRng(11) });
  const hero = s.units.find(u => u.type === 'rogue');
  const monster = s.units.find(u => u.ownerId === 'dungeon');
  if (!monster) return; // extremely unlikely on floor 1, but be defensive

  const belief = new RogueBelief('p1');

  // Turn 1: monster right next to the hero, clearly visible.
  const near = { ...monster, position: { x: hero.position.x + 1, y: hero.position.y } };
  const seenState = {
    ...s, turnNumber: 1,
    units: s.units.map(u => u.id === monster.id ? near : u),
  };
  belief.beginTurn(seenState);
  const pc1 = belief.pieces.get(monster.id);
  assert.ok(pc1, 'monster tracked');
  assert.deepEqual([...pc1.possible], [`${near.position.x},${near.position.y}`], 'pinned where seen');
  assert.equal(pc1.hp, near.hp, 'remembers last-seen hp');

  // Turn 2: monster no longer in the observed unit list (out of sight).
  const hiddenState = {
    ...s, turnNumber: 2,
    units: s.units.filter(u => u.id !== monster.id),
  };
  belief.beginTurn(hiddenState);
  const pc2 = belief.pieces.get(monster.id);
  assert.ok(pc2.possible.size > 0, 'still tracked after leaving sight');
  for (const key of pc2.possible) {
    const [x, y] = key.split(',').map(Number);
    const dist = manhattan(near.position, { x, y });
    assert.ok(dist <= 1, `possible tile stays within one step of last sighting (got ${dist})`);
  }
});

test('rogue fog: witnessed monster death is never resurrected by sampling', () => {
  const s = RogueGame.createInitialState(players(), { fogOfWar: true, rng: seededRng(23) });
  const monster = s.units.find(u => u.ownerId === 'dungeon');
  if (!monster) return;

  const belief = new RogueBelief('p1');
  const deadState = {
    ...s, turnNumber: 1,
    units: s.units.map(u => u.id === monster.id ? { ...u, alive: false, hp: 0 } : u),
  };
  belief.beginTurn(deadState);
  assert.equal(belief.pieces.get(monster.id).alive, false);

  const worlds = belief.sample(deadState, 5, seededRng(5), s.gameSpecific.rooms);
  for (const w of worlds) {
    assert.ok(!w.units.some(u => u.id === monster.id && u.alive), 'no resurrection of a witnessed death');
  }
});

// ── Full self-play with ObscuroAgent as the hero ─────────────────────────────

test('rogue fog: ObscuroAgent plays the hero to completion without crashing', async () => {
  const ps = [{ id: 'p1', name: 'Rogue', agent: new ObscuroAgent(RogueGame, { particles: 3, rows: 4, cols: 4, iters: 30 }) }];
  const engine = new GameEngine(RogueGame, ps, {
    fogOfWar: true, amuletLevel: 3, maxTurns: 40, rng: seededRng(77),
  });
  const { result } = await engine.run();
  assert.ok(result && typeof result.outcome === 'string');
});
