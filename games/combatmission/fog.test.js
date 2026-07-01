import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatMissionGame } from './index.js';
import { CombatMissionBelief } from './belief.js';
import { hasLOS } from './los.js';
import { UNIT_DEFS } from './units.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'allied', name: 'Allies' }, { id: 'axis', name: 'Axis' }];

test('combatmission fog: getVisibleState hides distant enemies and stores a roster', () => {
  const s = CombatMissionGame.createInitialState(players(), { fogOfWar: true });
  const view = CombatMissionGame.getVisibleState(s, 'allied');
  assert.ok(s.units.length > 0);
  assert.ok(view.units.filter(u => u.ownerId === 'allied').length > 0, 'sees own units');
  assert.ok(view.units.filter(u => u.ownerId === 'axis').length < s.units.filter(u => u.ownerId === 'axis').length, 'fog hides at least some axis units');
  assert.equal(s.gameSpecific.startRoster.length, s.units.length, 'startRoster complete');
});

test('combatmission fog: sampleWorlds places enemies outside vision+LOS', () => {
  const s = CombatMissionGame.createInitialState(players(), { fogOfWar: true });
  const view = CombatMissionGame.getVisibleState(s, 'allied');
  const worlds = CombatMissionGame.sampleWorlds(view, 'allied', 8);
  assert.ok(worlds.length > 0);
  const seen = new Set(view.units.map(u => u.id));
  const myUnits = view.units.filter(u => u.ownerId === 'allied' && u.alive);
  const { width, height } = s.board;
  for (const w of worlds) {
    for (const u of w.units.filter(u => u.ownerId === 'axis' && !seen.has(u.id))) {
      assert.ok(u.position.x >= 0 && u.position.x < width && u.position.y >= 0 && u.position.y < height, 'in bounds');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - u.position.x), Math.abs(m.position.y - u.position.y)) <= 5 &&
        hasLOS(s.board, m.position, u.position));
      assert.ok(!visible, 'placed outside current vision+LOS');
    }
  }
});

test('combatmission fog: sampleWorlds returns [] when fog is off', () => {
  const s = CombatMissionGame.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(CombatMissionGame.sampleWorlds(CombatMissionGame.getVisibleState(s, 'allied'), 'allied', 4), []);
});

test('combatmission fog: belief pins a sighting then keeps it in reach after it hides', () => {
  const s = CombatMissionGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'axis');
  const belief = new CombatMissionBelief('allied', roster, s.board);
  const e = roster[0];
  const reach = e.moveRange * e.maxAP;

  belief.beginTurn({
    ...s, turnNumber: 1,
    units: [
      { id: 'allied-probe', ownerId: 'allied', type: 'rifle-squad', position: { x: e.position.x - 1, y: e.position.y }, alive: true, hp: 10 },
      { id: e.id, ownerId: 'axis', type: e.type, position: { ...e.position }, alive: true, hp: e.hp },
    ],
  });
  assert.deepEqual([...belief.pieces.get(e.id).possible], [`${e.position.x},${e.position.y}`], 'pinned to sighted tile');
  assert.equal(belief.pieces.get(e.id).hp, e.hp);

  belief.beginTurn({
    ...s, turnNumber: 2,
    units: [{ id: 'allied-probe', ownerId: 'allied', type: 'rifle-squad', position: { x: 0, y: 0 }, alive: true, hp: 10 }],
  });
  const possible = [...belief.pieces.get(e.id).possible].map(key => key.split(',').map(Number));
  assert.ok(possible.length > 0, 'still tracked after disappearing');
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - e.position.x), Math.abs(y - e.position.y))));
  assert.ok(maxDist <= reach, `within one turn's travel (${maxDist} <= ${reach})`);
});

test('combatmission fog: witnessed death is never resurrected', () => {
  const s = CombatMissionGame.createInitialState(players(), { fogOfWar: true });
  const roster = s.gameSpecific.startRoster.filter(u => u.ownerId === 'axis');
  const belief = new CombatMissionBelief('allied', roster, s.board);
  const e = roster[0];
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'allied-probe', ownerId: 'allied', type: 'rifle-squad', position: { x: e.position.x - 1, y: e.position.y }, alive: true, hp: 10 },
      { id: e.id, ownerId: 'axis', type: e.type, position: { ...e.position }, alive: false, hp: 0 },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get(e.id).alive, false);
  const worlds = belief.sample(dead, 5, Math.random,
    (id, ownerId, type, x, y) => ({ id, ownerId, type, position: { x, y }, alive: true, hp: 1 }));
  for (const w of worlds) assert.ok(!w.units.some(u => u.id === e.id && u.alive), 'no resurrection');
});

test('combatmission fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0
      ? new ObscuroAgent(CombatMissionGame, { particles: 3, rows: 4, cols: 4, iters: 40 })
      : RandomAgent,
  }));
  const { result } = await new GameEngine(CombatMissionGame, ps, { maxTurns: 16, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
