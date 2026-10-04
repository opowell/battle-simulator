// Fortresses — the original's two rules for them (CIV.EXE, as disassembled by
// OpenCivOne): a land defender in one fights at double strength INSTEAD of the fortify
// bonus (combat routine F0_29f3_000e picks one multiplier), and a beaten defender there
// dies alone, as in a city (the stack is only deleted when the square is neither).
// Hand-built flat worlds with nothing on them but the pieces under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { getCombatStrengths, inFortress } from './combat.js';
import { getFixedMap, parseFixedMap } from './fixedMaps.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

// Flat grassland with a fortress at (10,10).
function world(units, cities = []) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false,
  });
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: 'grassland', hasRoad: false, hasRail: false, fortress: k === '10,10' };
  }
  return { ...state, board: { ...state.board, tiles }, units, cities, activePlayers: ['p1'] };
}

const attackerWins = () => 0;   // every combat round to the attacker (resolveCombat)

test('civ1 fortress: a land defender in one fights at double strength', () => {
  const atk = unit('a', 'p1', 'legion', 9, 10);
  const def = (over) => getCombatStrengths(atk, unit('d', 'p2', 'phalanx', 10, 10, over), world([])).def;
  const open = (over) => getCombatStrengths(atk, unit('d', 'p2', 'phalanx', 11, 11, over), world([])).def;
  assert.equal(open({}), 2);
  assert.equal(def({}), 4, 'x2 in the fort');
});

test('civ1 fortress: instead of the fortify bonus, not on top of it', () => {
  const atk = unit('a', 'p1', 'legion', 9, 10);
  const s = world([]);
  const fortified = { attrs: { fortified: true } };
  assert.equal(getCombatStrengths(atk, unit('d', 'p2', 'phalanx', 11, 11, fortified), s).def, 3, 'dug in in the open: x1.5');
  assert.equal(getCombatStrengths(atk, unit('d', 'p2', 'phalanx', 10, 10, fortified), s).def, 4, 'dug in in the fort: still x2');
  // Veterans keep their own bonus wherever they stand.
  assert.equal(getCombatStrengths(atk, unit('d', 'p2', 'phalanx', 10, 10, { attrs: { veteran: true } }), s).def, 6);
});

test('civ1 fortress: a city square is a city, not a fort', () => {
  const s = world([], [{ id: 'c', name: 'C', ownerId: 'p2', position: { x: 10, y: 10 }, size: 1, buildings: [] }]);
  assert.equal(inFortress(s, unit('d', 'p2', 'phalanx', 10, 10)), false);
  assert.equal(inFortress(world([]), unit('d', 'p2', 'phalanx', 10, 10)), true);
});

test('civ1 fortress: a beaten defender there dies alone — the stack survives it', () => {
  const state = world([
    unit('atk', 'p1', 'legion', 9, 10),
    unit('hard', 'p2', 'phalanx', 10, 10),
    unit('soft', 'p2', 'catapult', 10, 10),
  ]);
  const after = Civ1Game.applyActions(state,
    [{ playerId: 'p1', action: { type: 'attack', unitId: 'atk', targetId: 'hard' } }], attackerWins);
  const byId = Object.fromEntries(after.units.map(u => [u.id, u]));
  assert.equal(byId.hard.alive, false);
  assert.equal(byId.soft.alive, true, 'the catapult behind the walls lives');
  assert.deepEqual(byId.atk.position, { x: 9, y: 10 }, 'and the winner stays where it struck from');
});

test('civ1 fortress: drawn on its square, and named by the terrain inspector', () => {
  const cell = Civ1Game.toGrid(world([])).cells.find(c => c.x === 10 && c.y === 10);
  assert.ok(cell.overlayImage.at(-1).endsWith('/map/fortress'), JSON.stringify(cell.overlayImage));
  assert.match(cell.terrain.description, /fortress/);
  const plain = Civ1Game.toGrid(world([])).cells.find(c => c.x === 11 && c.y === 10);
  assert.ok(!plain.overlayImage.some(p => p.includes('fortress')));
});

test('civ1 fortress: a fixed map may build them in, and the siege has one on every hill before the city', () => {
  const map = getFixedMap('siege');
  const board = parseFixedMap(map);
  const forts = Object.entries(board.tiles).filter(([, t]) => t.fortress).map(([k]) => k).sort();
  assert.deepEqual(forts, ['13,7', '13,9', '16,11', '16,5', '17,11', '17,5']);
  for (const k of forts) assert.equal(board.tiles[k].terrain, 'hills', k);
  // …each held from the start.
  const s = Civ1Game.createInitialState(players(), { scenario: 'siege' });
  for (const k of forts) {
    assert.ok(s.units.some(u => u.ownerId === 'p2' && `${u.position.x},${u.position.y}` === k), `fort ${k} manned`);
  }
});
