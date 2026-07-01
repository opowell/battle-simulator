import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WarodDotsGame } from './index.js';
import { WarodDotsBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const T = 28;
const VISION_PX = 5 * T;

function players() {
  return [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
}

function detRng(seed = 42) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('warofdots fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s    = WarodDotsGame.createInitialState(players(), { rng: detRng(), fogOfWar: true });
  const view = WarodDotsGame.getVisibleState(s, 'p1');
  assert.ok(s.units.length > 0, 'has units');
  assert.ok(view.units.filter(u => u.owner === 'p1').length > 0, 'sees own units');
  // p2 starts at the opposite corner — should be out of vision
  assert.equal(view.units.filter(u => u.owner === 'p2').length, 0, 'far p2 units hidden');
  assert.ok(Array.isArray(s.gameSpecific.startRoster), 'startRoster is an array');
  assert.ok(s.gameSpecific.startRoster.length > 0, 'startRoster has units');
});

test('warofdots fog: sampleWorlds places hidden enemies outside our vision', () => {
  const s      = WarodDotsGame.createInitialState(players(), { rng: detRng(), fogOfWar: true });
  const view   = WarodDotsGame.getVisibleState(s, 'p1');
  const worlds = WarodDotsGame.sampleWorlds(view, 'p1', 8);
  assert.ok(worlds.length > 0, 'worlds produced');

  const myUnits = view.units.filter(u => u.owner === 'p1');
  for (const w of worlds) {
    for (const u of w.units.filter(u => u.owner === 'p2')) {
      const visible = myUnits.some(m => Math.hypot(m.x - u.x, m.y - u.y) <= VISION_PX);
      assert.ok(!visible, `p2 unit placed where p1 can see (${u.x.toFixed(0)},${u.y.toFixed(0)})`);
    }
  }
});

test('warofdots fog: sampleWorlds returns [] when fog is off', () => {
  const s = WarodDotsGame.createInitialState(players(), { rng: detRng(), fogOfWar: false });
  assert.deepEqual(WarodDotsGame.sampleWorlds(WarodDotsGame.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('warofdots fog: belief pins a sighting then expands within reach', () => {
  const s      = WarodDotsGame.createInitialState(players(), { rng: detRng(), fogOfWar: true });
  const roster = s.gameSpecific.startRoster;
  const enemy  = roster.find(u => u.owner === 'p2');
  const belief = new WarodDotsBelief('p1', s.board.grid, roster.filter(u => u.owner === 'p2'));

  // Turn 1: one of our units is right next to the enemy.
  const near = { ...enemy, id: 'p1-scout', owner: 'p1', x: enemy.x - T, y: enemy.y };
  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [near, { ...enemy }],
  });
  const pc = belief.pieces.get(enemy.id);
  const T28 = T;
  const eCol = Math.floor(enemy.x / T28), eRow = Math.floor(enemy.y / T28);
  assert.deepEqual([...pc.possible], [`${eCol},${eRow}`], 'pinned at first sight');

  // Turn 2: scout retreats to (0,0); enemy goes dark.
  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ ...near, x: 0, y: 0 }],
  });
  const possible = [...pc.possible];
  assert.ok(possible.length > 0, 'still tracked after losing sight');
  // All possible tiles should be within one tick of travel (reach tiles from anchor)
  const maxDist = Math.max(...possible.map(key => {
    const [col, row] = key.split(',').map(Number);
    return Math.max(Math.abs(col - eCol), Math.abs(row - eRow));
  }));
  assert.ok(maxDist <= pc.reach, `possible tiles within one turn of reach (${maxDist} <= ${pc.reach})`);
});

test('warofdots fog: newly spawned enemy unit is discovered on sight', () => {
  const s      = WarodDotsGame.createInitialState(players(), { rng: detRng(), fogOfWar: true });
  const belief = new WarodDotsBelief('p1', s.board.grid, []); // start with empty roster

  const newEnemy = { id: 'new-enemy', owner: 'p2', type: 'light', x: 100, y: 100, hp: 60 };
  const scout    = { id: 'p1-scout', owner: 'p1', type: 'light', x: 90, y: 90, hp: 60 };
  belief.beginTurn({ ...s, turnNumber: 1, units: [scout, newEnemy] });

  assert.ok(belief.pieces.has('new-enemy'), 'newly sighted unit added to belief');
  const pc = belief.pieces.get('new-enemy');
  const eCol = Math.floor(newEnemy.x / T), eRow = Math.floor(newEnemy.y / T);
  assert.deepEqual([...pc.possible], [`${eCol},${eRow}`], 'pinned at discovery');
});

test('warofdots fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(WarodDotsGame, { particles: 3, iters: 30 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(WarodDotsGame, ps, {
    maxTurns: 20, fogOfWar: true, config: { rng: detRng(), fogOfWar: true },
  }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
