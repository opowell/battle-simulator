import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sc2Game } from './index.js';
import { Sc2Belief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('sc2 fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s    = Sc2Game.createInitialState(players(), { fogOfWar: true });
  const view = Sc2Game.getVisibleState(s, 'p1');
  assert.ok(s.units.length > 0);
  assert.ok(view.units.filter(u => u.ownerId === 'p1').length > 0, 'sees own units');
  assert.equal(view.units.filter(u => u.ownerId === 'p2').length, 0, 'far p2 units hidden');
  assert.equal(view.buildings.filter(b => b.ownerId === 'p2').length, 0, 'far p2 buildings hidden');
  assert.ok(s.gameSpecific.startRoster.units.length > 0, 'startRoster has units');
  assert.ok(s.gameSpecific.startRoster.buildings.length > 0, 'startRoster has buildings');
});

test('sc2 fog: sampleWorlds places hidden enemies outside our vision', () => {
  const s      = Sc2Game.createInitialState(players(), { fogOfWar: true });
  const view   = Sc2Game.getVisibleState(s, 'p1');
  const worlds = Sc2Game.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0, 'worlds produced');

  const myUnits = view.units.filter(u => u.ownerId === 'p1' && u.alive);
  const myBldgs = view.buildings.filter(b => b.ownerId === 'p1' && b.alive);
  const VISION  = 3;

  for (const w of worlds) {
    for (const u of w.units.filter(u => u.ownerId === 'p2')) {
      const visible =
        myUnits.some(m => Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= VISION) ||
        myBldgs.some(b => Math.max(Math.abs(b.position.x - u.position.x), Math.abs(b.position.y - u.position.y)) <= VISION);
      assert.ok(!visible, `p2 unit placed where p1 can see (${u.position.x},${u.position.y})`);
    }
  }
});

test('sc2 fog: sampleWorlds returns [] when fog is off', () => {
  const s = Sc2Game.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(Sc2Game.sampleWorlds(Sc2Game.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('sc2 fog: belief pins a sighting then expands within move range', () => {
  const s      = Sc2Game.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster;
  const enemy  = roster.units.find(u => u.ownerId === 'p2');
  const belief = new Sc2Belief('p1', s.board,
    roster.units.filter(u => u.ownerId === 'p2'),
    roster.buildings.filter(b => b.ownerId === 'p2'),
  );

  // Turn 1: scout adjacent to the enemy unit.
  const near = { x: enemy.position.x - 1, y: enemy.position.y };
  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [
      { id: 'p1-scout', ownerId: 'p1', type: 'marine', position: near, alive: true, hp: 45 },
      { id: enemy.id, ownerId: 'p2', type: enemy.type, position: { ...enemy.position }, alive: true, hp: enemy.hp },
    ],
    buildings: [],
  });
  const pc = belief.unitPieces.get(enemy.id);
  assert.deepEqual([...pc.possible], [`${enemy.position.x},${enemy.position.y}`], 'pinned at sight');

  // Turn 2: scout retreats; enemy goes dark.
  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ id: 'p1-scout', ownerId: 'p1', type: 'marine', position: { x: 0, y: 0 }, alive: true, hp: 45 }],
    buildings: [],
  });
  const possible = [...pc.possible].map(key => key.split(',').map(Number));
  assert.ok(possible.length > 0, 'still tracked after losing sight');
  const moves = enemy.movesLeft ?? 2;
  const maxDist = Math.max(...possible.map(([x, y]) =>
    Math.max(Math.abs(x - enemy.position.x), Math.abs(y - enemy.position.y))));
  assert.ok(maxDist <= moves, `stays within one turn of travel (got ${maxDist} <= ${moves})`);
});

test('sc2 fog: witnessed building destruction is not resurrected', () => {
  const s         = Sc2Game.createInitialState(players(), { fogOfWar: true });
  const roster    = s.gameSpecific.startRoster;
  const enemyBldg = roster.buildings.find(b => b.ownerId === 'p2');
  const belief    = new Sc2Belief('p1', s.board,
    roster.units.filter(u => u.ownerId === 'p2'),
    roster.buildings.filter(b => b.ownerId === 'p2'),
  );

  const near = { x: enemyBldg.position.x - 1, y: enemyBldg.position.y };
  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [{ id: 'p1-scout', ownerId: 'p1', type: 'marine', position: near, alive: true, hp: 45 }],
    buildings: [{ ...enemyBldg, alive: false, hp: 0 }],
  });
  const pb = belief.bldgPieces.get(enemyBldg.id);
  assert.equal(pb.alive, false, 'belief marks building dead');

  const worlds = belief.sample(
    { ...s, units: [{ id: 'p1-scout', ownerId: 'p1', type: 'marine', position: near, alive: true, hp: 45 }], buildings: [] },
    5, Math.random,
    (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: 1, shields: 0, movesLeft: 2, attacksLeft: 1, domain: 'ground', attrs: {} }),
  );
  for (const w of worlds) {
    assert.ok(!w.buildings.some(b => b.id === enemyBldg.id && b.alive), 'dead building not resurrected');
  }
});

test('sc2 fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(Sc2Game, { particles: 3, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(Sc2Game, ps, { maxTurns: 30, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
