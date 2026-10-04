// The five fixed battles before the Siege (fixedMaps.js): a ladder, each one smaller
// and easier than the one after it, and every one smaller than the Siege itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { makeCiv1Agent } from './ai.js';
import { FIXED_MAPS, getFixedMap } from './fixedMaps.js';
import { UNITS } from './units.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const LADDER = ['outpost', 'border-town', 'river-fort', 'twin-forts', 'highland-pass', 'siege'];

const players = () => [
  { id: 'p1', name: 'Attacker', agent: RandomAgent },
  { id: 'p2', name: 'Defender', agent: RandomAgent },
];
const army = (map, side) => map.units.filter(u => u.side === side).length;
const area = map => map.rows.length * map.rows[0].length;

test('battle ladder: listed easiest first, ending with the Siege', () => {
  const ids = FIXED_MAPS.map(m => m.id).filter(id => LADDER.includes(id));
  assert.deepEqual(ids, LADDER);
});

test('battle ladder: every rung is bigger than the last — field, armies and the clock', () => {
  for (let i = 1; i < LADDER.length; i++) {
    const [a, b] = [getFixedMap(LADDER[i - 1]), getFixedMap(LADDER[i])];
    assert.ok(area(a) < area(b), `${a.id} field < ${b.id}`);
    assert.ok(army(a, 1) < army(b, 1), `${a.id} attackers < ${b.id}`);
    assert.ok(army(a, 2) < army(b, 2), `${a.id} defenders < ${b.id}`);
    assert.ok(a.objective.turns <= b.objective.turns, `${a.id} turns <= ${b.id}`);
    assert.ok((a.fortresses ?? []).length <= (b.fortresses ?? []).length, `${a.id} forts <= ${b.id}`);
  }
});

for (const id of LADDER.slice(0, -1)) {
  test(`${id}: a take-city battle on a surveyed island that does not wrap`, () => {
    const map = getFixedMap(id);
    const W = map.rows[0].length, H = map.rows.length;
    for (const layer of ['rows', 'rivers', 'tileImprovements']) {
      if (!map[layer]) continue;
      assert.equal(map[layer].length, H, layer);
      for (const row of map[layer]) assert.equal(row.length, W, `${layer}: ${row}`);
    }
    // An island: the rim is sea all round.
    for (let x = 0; x < W; x++) assert.ok(map.rows[0][x] === '.' && map.rows[H - 1][x] === '.');
    for (let y = 0; y < H; y++) assert.ok(map.rows[y][0] === '.' && map.rows[y][W - 1] === '.');
    for (const u of map.units) {
      assert.ok(UNITS[u.type], u.type);
      assert.notEqual(map.rows[u.y][u.x], '.', `${u.type} at ${u.x},${u.y} is at sea`);
    }
    for (const [x, y] of map.fortresses ?? []) assert.equal(map.rows[y][x], 'H', `fort at ${x},${y}`);

    const s = Civ1Game.createInitialState(players(), { scenario: id });
    assert.equal(s.board.wrap, false);
    assert.equal(s.units.filter(u => u.ownerId === 'p1').length, army(map, 1));
    assert.equal(s.units.filter(u => u.ownerId === 'p2').length, army(map, 2));
    const obj = s.gameSpecific.objective;
    assert.equal(obj.type, 'take-city');
    assert.equal(obj.attackerId, 'p1');
    const city = s.cities.find(c => c.id === obj.cityId);
    assert.equal(city.ownerId, 'p2');
    // The whole field is known ground, and the city is on the attacker's map.
    assert.equal(s.gameSpecific.explored.p1, '1'.repeat(W * H));
    assert.deepEqual(Civ1Game.getVisibleState(s, 'p1').cities.map(c => c.id), [city.id]);
    // The attackers open out of the city's sight: the garrison has to be found.
    const view = Civ1Game.getVisibleState(s, 'p1');
    assert.ok(!view.units.some(u => u.ownerId === 'p2'), 'the defenders start fogged');
    assert.equal(Civ1Game.getResult(s), null);
  });
}

test('outpost: plays to an end with the heuristic on both sides, inside its ten turns', async () => {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'Attacker', agent: makeCiv1Agent({ id: 'att' }) },
    { id: 'p2', name: 'Defender', agent: makeCiv1Agent({ id: 'def' }) },
  ], { seed: 1, scenario: 'outpost', fogOfWar: true });
  engine._init();
  while (!engine.result) {
    const { done } = await engine.step();
    if (done) break;
  }
  assert.ok(engine.result, 'the battle is decided');
  assert.ok(engine.state.turnNumber <= 11, `ended on turn ${engine.state.turnNumber}`);
});
