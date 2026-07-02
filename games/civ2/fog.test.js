import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ2Game } from './Civ2Game.js';
import { Civ2Belief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('civ2 fog: getVisibleState hides distant enemies and stores a unit roster', () => {
  const s = Civ2Game.createInitialState(players(), { fogOfWar: true });
  const view = Civ2Game.getVisibleState(s, s.activePlayers[0]);
  assert.ok(s.units.length > 0);
  assert.equal(view.units.filter(u => u.ownerId === 'p2').length, 0, 'far enemies hidden');
  assert.equal(s.gameSpecific.startRoster.units.length, s.units.length, 'startRoster is common knowledge');
});

test('civ2 fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = Civ2Game.createInitialState(players(), { fogOfWar: true });
  const view = Civ2Game.getVisibleState(s, 'p1');
  const worlds = Civ2Game.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'p1' && u.alive);
  for (const w of worlds) {
    for (const L of w.units.filter(u => u.ownerId === 'p2' && !seen.has(u.id))) {
      assert.ok(L.position.x >= 0 && L.position.x < s.board.width && L.position.y >= 0 && L.position.y < s.board.height, 'in bounds');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 2);
      assert.ok(!visible, 'placed outside our vision');
    }
  }
});

test('civ2 fog: sampleWorlds returns [] when fog is off', () => {
  const s = Civ2Game.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(Civ2Game.sampleWorlds(Civ2Game.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('civ2 fog: a captured city is forgotten as an enemy asset', () => {
  const s = Civ2Game.createInitialState(players(), { fogOfWar: true });
  const belief = new Civ2Belief('p1', s.board, [], [
    { id: 'city-9', ownerId: 'p2', name: 'Troy', position: { x: 5, y: 5 }, size: 2, shields: 0, production: 'militia' },
  ]);
  // Turn 1: still an enemy city, out of sight — should be tracked as hidden.
  belief.beginTurn({ ...s, turnNumber: 1, units: [], cities: [] });
  assert.ok(belief.cityPieces.has('city-9'));

  // Turn 2: we've captured it — it now appears in our own observation.cities.
  belief.beginTurn({
    ...s, turnNumber: 2, units: [],
    cities: [{ id: 'city-9', ownerId: 'p1', name: 'Troy', position: { x: 5, y: 5 }, size: 2, shields: 0, production: 'militia' }],
  });
  assert.ok(!belief.cityPieces.has('city-9'), 'no longer tracked as a hidden enemy asset');
});

test('civ2 fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(Civ2Game, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(Civ2Game, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
