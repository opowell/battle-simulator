// The five fixed battles before the Siege (fixedMaps.js): a ladder, easiest first, each
// one a different kind of fight — a different objective — on different ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { makeCiv1Agent } from './ai.js';
import { siegeRole } from './objective.js';
import { FIXED_MAPS, getFixedMap } from './fixedMaps.js';
import { UNITS } from './units.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const LADDER = ['desert-raiders', 'outpost', 'mountain-pass', 'caravan', 'two-rivers', 'siege'];

const players = () => [
  { id: 'p1', name: 'You', agent: RandomAgent },
  { id: 'p2', name: 'Them', agent: RandomAgent },
];
const army = (map, side) => map.units.filter(u => u.side === side).length;
const start = id => Civ1Game.createInitialState(players(), { scenario: id });
const kill = (s, pred) => ({ ...s, units: s.units.map(u => pred(u) ? { ...u, alive: false, hp: 0 } : u) });
const moveTo = (s, unitId, at) => ({ ...s, units: s.units.map(u => u.id === unitId ? { ...u, position: { ...at } } : u) });

test('battle ladder: listed easiest first, ending with the Siege', () => {
  const ids = FIXED_MAPS.map(m => m.id).filter(id => LADDER.includes(id));
  assert.deepEqual(ids, LADDER);
});

test('battle ladder: the scenario menu opens with it, in order (the console lists it so)', () => {
  assert.deepEqual(Civ1Game.scenarios.slice(0, LADDER.length).map(s => s.id), LADDER);
});

test('battle ladder: each menu entry suggests the next rung up (the game-over dialog offers it)', () => {
  const entry = id => Civ1Game.scenarios.find(s => s.id === id);
  for (let i = 0; i < LADDER.length - 1; i++) assert.equal(entry(LADDER[i]).next, LADDER[i + 1], LADDER[i]);
  assert.equal(entry('siege').next, undefined, 'the top of the ladder');
  for (const s of Civ1Game.scenarios) if (s.next) assert.ok(entry(s.next), `${s.id} -> ${s.next}`);
});

test('battle ladder: no two rungs are the same kind of fight', () => {
  // The objective, whose seat attacks, and how many cities are in it.
  const kind = id => {
    const m = getFixedMap(id);
    return `${m.objective.type}/attacker ${m.objective.attacker}/${(m.cities ?? []).length} cities`;
  };
  assert.equal(new Set(LADDER.map(kind)).size, LADDER.length, LADDER.map(kind).join(', '));
  // ...nor fought on the same ground: no two share their commonest land terrain and
  // their second.
  const ground = id => {
    const n = {};
    for (const ch of getFixedMap(id).rows.join('')) if (ch !== '.') n[ch] = (n[ch] ?? 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([ch]) => ch).join('');
  };
  assert.equal(new Set(LADDER.map(ground)).size, LADDER.length, LADDER.map(ground).join(', '));
});

for (const id of LADDER.slice(0, -1)) {
  test(`${id}: a surveyed battlefield that does not wrap, both armies out of each other's sight`, () => {
    const map = getFixedMap(id);
    const W = map.rows[0].length, H = map.rows.length;
    for (const layer of ['rows', 'rivers', 'tileImprovements']) {
      if (!map[layer]) continue;
      assert.equal(map[layer].length, H, layer);
      for (const row of map[layer]) assert.equal(row.length, W, `${layer}: ${row}`);
    }
    const land = (x, y) => map.rows[y][x] !== '.';
    for (const u of map.units) {
      assert.ok(UNITS[u.type], u.type);
      assert.ok(land(u.x, u.y), `${u.type} at ${u.x},${u.y} is at sea`);
    }
    for (const [x, y] of map.fortresses ?? []) assert.ok(land(x, y), `fort at ${x},${y}`);
    for (const c of map.cities ?? []) assert.ok(land(c.x, c.y), `city at ${c.x},${c.y}`);
    if (map.objective.at) assert.ok(land(...map.objective.at), 'the objective square');

    const s = start(id);
    assert.equal(s.board.wrap, false);
    assert.equal(s.units.filter(u => u.ownerId === 'p1').length, army(map, 1));
    assert.equal(s.units.filter(u => u.ownerId === 'p2').length, army(map, 2));
    const obj = s.gameSpecific.objective;
    assert.equal(obj.type, map.objective.type);
    assert.equal(obj.attackerId, `p${map.objective.attacker}`);
    assert.equal(obj.defenderId, `p${map.objective.defender}`);
    for (const pid of ['p1', 'p2']) {
      // The whole field is known ground, and every city on it is on everyone's map.
      assert.equal(s.gameSpecific.explored[pid], '1'.repeat(W * H));
      const view = Civ1Game.getVisibleState(s, pid);
      assert.equal(view.cities.length, s.cities.length);
      // The enemy has to be found.
      assert.ok(!view.units.some(u => u.ownerId !== pid), `${pid} starts seeing an enemy`);
    }
    assert.equal(Civ1Game.getResult(s), null);
  });
}

test('outpost: you defend — the raiders, seat 2, have the clock against them', () => {
  const s = start('outpost');
  const { attackerId, defenderId, cityIds } = s.gameSpecific.objective;
  assert.deepEqual([attackerId, defenderId], ['p2', 'p1']);
  assert.equal(s.cities.find(c => c.id === cityIds[0]).ownerId, 'p1');
  assert.equal(siegeRole(s, 'p2').role, 'attacker');
  const over = { ...s, turnNumber: getFixedMap('outpost').objective.turns + 1 };
  assert.deepEqual(Civ1Game.getResult(over), { outcome: 'win', winnerId: 'p1', reason: 'city-held' });
  const taken = { ...s, cities: s.cities.map(c => ({ ...c, ownerId: 'p2' })) };
  assert.deepEqual(Civ1Game.getResult(taken), { outcome: 'win', winnerId: 'p2', reason: 'city-taken' });
});

test('desert-raiders: a rout — destroy every raider, or they win once the clock runs out', () => {
  const s = start('desert-raiders');
  assert.equal(s.cities.length, 0);
  assert.equal(siegeRole(s, 'p1'), null, 'nothing to march on but the enemy');
  assert.deepEqual(Civ1Game.getResult(kill(s, u => u.ownerId === 'p2')),
    { outcome: 'win', winnerId: 'p1', reason: 'army-routed' });
  const one = s.units.find(u => u.ownerId === 'p2');
  assert.equal(Civ1Game.getResult(kill(s, u => u.ownerId === 'p2' && u.id !== one.id)), null, 'one left is not a rout');
  assert.deepEqual(Civ1Game.getResult({ ...s, turnNumber: 13 }),
    { outcome: 'win', winnerId: 'p2', reason: 'army-escaped' });
});

test('mountain-pass: a seize — a unit of yours on the fort wins it, whoever else is dead', () => {
  const s = start('mountain-pass');
  const { at } = s.gameSpecific.objective;
  assert.deepEqual(at, { x: 9, y: 4 });
  assert.ok(s.board.tiles['9,4'].fortress);
  assert.deepEqual(siegeRole(s, 'p1').cityPos, at);
  const cleared = kill(s, u => u.ownerId === 'p2' && u.position.x === at.x && u.position.y === at.y);
  assert.equal(Civ1Game.getResult(cleared), null, 'an empty fort is not yet taken');
  const legion = s.units.find(u => u.ownerId === 'p1' && u.type === 'legion');
  assert.deepEqual(Civ1Game.getResult(moveTo(cleared, legion.id, at)),
    { outcome: 'win', winnerId: 'p1', reason: 'position-taken' });
  assert.deepEqual(Civ1Game.getResult({ ...s, turnNumber: 13 }),
    { outcome: 'win', winnerId: 'p2', reason: 'position-held' });
  // The square is marked on the board, for both sides.
  assert.deepEqual(Civ1Game.toGrid(s).zones.map(z => [z.x, z.y, z.kind]), [[9, 4, 'objective']]);
});

test('caravan: an escort — the caravan, and only it, has to reach the post alive', () => {
  const s = start('caravan');
  const { at, escortId } = s.gameSpecific.objective;
  const caravan = s.units.find(u => u.id === escortId);
  assert.equal(caravan.type, 'caravan');
  assert.equal(caravan.ownerId, 'p1');
  const holders = kill(s, u => u.ownerId === 'p2' && u.position.x === at.x && u.position.y === at.y);
  const legion = s.units.find(u => u.ownerId === 'p1' && u.type === 'legion');
  assert.equal(Civ1Game.getResult(moveTo(holders, legion.id, at)), null, 'a legion there is not the caravan');
  assert.deepEqual(Civ1Game.getResult(moveTo(holders, escortId, at)),
    { outcome: 'win', winnerId: 'p1', reason: 'escort-arrived' });
  assert.deepEqual(Civ1Game.getResult(kill(s, u => u.id === escortId)),
    { outcome: 'win', winnerId: 'p2', reason: 'escort-lost' });
  // A fogged view without the caravan in it is not its death.
  assert.equal(Civ1Game.getResult({ ...s, units: s.units.filter(u => u.id !== escortId) }), null);
  assert.deepEqual(Civ1Game.getResult({ ...s, turnNumber: getFixedMap('caravan').objective.turns + 1 }),
    { outcome: 'win', winnerId: 'p2', reason: 'escort-stopped' });
});

test('two-rivers: both towns have to fall — one taken is half the battle', () => {
  const s = start('two-rivers');
  const { cityIds } = s.gameSpecific.objective;
  assert.equal(cityIds.length, 2);
  const take = (st, ids) => ({ ...st, cities: st.cities.map(c => ids.includes(c.id) ? { ...c, ownerId: 'p1' } : c) });
  assert.equal(Civ1Game.getResult(take(s, [cityIds[0]])), null);
  assert.deepEqual(Civ1Game.getResult(take(s, cityIds)), { outcome: 'win', winnerId: 'p1', reason: 'city-taken' });
  // One taken and the other razed is both gone from the defender too.
  const razed = { ...take(s, [cityIds[0]]), cities: take(s, [cityIds[0]]).cities.filter(c => c.id !== cityIds[1]) };
  assert.equal(Civ1Game.getResult(razed).winnerId, 'p1');
  // The attacker makes for whichever town is still to take.
  const half = take(s, [cityIds[0]]);
  assert.equal(siegeRole(half, 'p1').cityId, cityIds[1]);
  assert.deepEqual(siegeRole(half, 'p2').cityIds, [cityIds[1]]);
  assert.match(Civ1Game.toGrid(s).turnLabel, / & .*: 16 turns left$/);
});

test('outpost: plays to an end with the heuristic on both sides, inside its ten turns', async () => {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'You', agent: makeCiv1Agent({ id: 'def' }) },
    { id: 'p2', name: 'Raiders', agent: makeCiv1Agent({ id: 'att' }) },
  ], { seed: 1, scenario: 'outpost', fogOfWar: true });
  engine._init();
  while (!engine.result) {
    const { done } = await engine.step();
    if (done) break;
  }
  assert.ok(engine.result, 'the battle is decided');
  assert.ok(engine.state.turnNumber <= 11, `ended on turn ${engine.state.turnNumber}`);
});
