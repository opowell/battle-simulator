import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsMiniGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';
import { makeGreedyAgent } from '../../agents/GreedyAgent.js';

function players() {
  return [
    { id: 'ct', name: 'CT', agent: RandomAgent },
    { id: 't', name: 'T', agent: RandomAgent },
  ];
}

const init = (config) => CsMiniGame.createInitialState(players(), config);
const apply = (state, playerId, action) => CsMiniGame.applyActions(state, [{ playerId, action }]);
const unit = (state, id) => state.units.find(u => u.id === id);

// ── Setup ─────────────────────────────────────────────────────────────────────

test('csmini: two units per team, 5 HP each', () => {
  const s = init();
  const ct = s.units.filter(u => u.ownerId === 'ct');
  const t = s.units.filter(u => u.ownerId === 't');
  assert.equal(ct.length, 2);
  assert.equal(t.length, 2);
  assert.ok(s.units.every(u => u.hp === 5 && u.maxHp === 5 && u.alive && u.loaded));
});

test('csmini: 8x6 board with a central 2x2 wall', () => {
  const s = init();
  assert.equal(s.board.width, 8);
  assert.equal(s.board.height, 6);
  const g = CsMiniGame.toGrid(s);
  const walls = g.los.blocked.slice().sort();
  assert.deepEqual(walls, ['3,2', '3,3', '4,2', '4,3'].sort());
});

test('csmini: CT acts first, fog on by default', () => {
  const s = init();
  assert.deepEqual(s.activePlayers, ['ct']);
  assert.equal(s.gameSpecific.fogOfWar, true);
  assert.equal(init({ fogOfWar: false }).gameSpecific.fogOfWar, false);
});

// ── Turn budget ─────────────────────────────────────────────────────────────

test('csmini: units start each turn with 5 seconds and 3 move squares', () => {
  const s = init();
  assert.ok(s.units.every(u => u.perTurn.time === 5 && u.perTurn.moveLeft === 3));
});

test('csmini: a move step spends a second and a move square, and turns the unit', () => {
  const s = init();
  const s2 = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  const u = unit(s2, 'CT-1');
  assert.deepEqual(u.position, { x: 1, y: 1 });
  assert.equal(u.perTurn.time, 4);
  assert.equal(u.perTurn.moveLeft, 2);
  assert.ok(Math.abs(u.facing - 0) < 1e-9); // faced east after stepping +x
});

test('csmini: move budget caps total movement at 3 squares per turn', () => {
  let s = init();
  // Four move actions available in the list? Only 3 should be spendable via moveLeft.
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 2, y: 1 }, to: { x: 3, y: 1 } });
  assert.equal(unit(s, 'CT-1').perTurn.moveLeft, 0);
  const moves = CsMiniGame.getLegalActions(s, 'ct').filter(a => a.type === 'move' && a.unitId === 'CT-1');
  assert.equal(moves.length, 0);
});

test('csmini: end-turn hands over and refreshes the next team', () => {
  let s = init();
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  s = apply(s, 'ct', { type: 'end-turn', unitId: '__team__' });
  assert.deepEqual(s.activePlayers, ['t']);
  assert.equal(s.currentPhase, 't-turn');
  // CT-1 keeps its spent budget; T units are freshly refreshed.
  assert.equal(unit(s, 'CT-1').perTurn.time, 4);
  assert.ok(s.units.filter(u => u.ownerId === 't').every(u => u.perTurn.time === 5));
});

// ── Shooting, reload, LOS ───────────────────────────────────────────────────

test('csmini: shooting deals 1 damage, empties the chamber, and faces the target', () => {
  let s = init({ fogOfWar: false });
  // Line CT-1 (0,1) and T-1 (7,1) up on the same row — clear shot, in range/cone.
  const shots = CsMiniGame.getLegalActions(s, 'ct').filter(a => a.type === 'shoot');
  assert.ok(shots.length === 0, 'too far to shoot at spawn (range 5, distance 7)');

  // Walk CT-1 to (2,1): distance 5 to T-1, now visible and shootable.
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  const shot = CsMiniGame.getLegalActions(s, 'ct').find(a => a.type === 'shoot' && a.unitId === 'CT-1' && a.targetId === 'T-1');
  assert.ok(shot, 'CT-1 should have a shot on T-1 at distance 5');
  s = apply(s, 'ct', shot);
  assert.equal(unit(s, 'T-1').hp, 4);
  assert.equal(unit(s, 'CT-1').loaded, false);
  assert.ok(Math.abs(unit(s, 'CT-1').facing - 0) < 1e-9);
});

test('csmini: an empty gun cannot shoot until reloaded', () => {
  let s = init({ fogOfWar: false });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  s = apply(s, 'ct', CsMiniGame.getLegalActions(s, 'ct').find(a => a.type === 'shoot' && a.unitId === 'CT-1'));
  assert.equal(CsMiniGame.getLegalActions(s, 'ct').filter(a => a.type === 'shoot' && a.unitId === 'CT-1').length, 0);
  const reload = CsMiniGame.getLegalActions(s, 'ct').find(a => a.type === 'reload' && a.unitId === 'CT-1');
  assert.ok(reload);
  s = apply(s, 'ct', reload);
  assert.equal(unit(s, 'CT-1').loaded, true);
});

test('csmini: the central wall blocks line of sight for shots', () => {
  const s = init({ fogOfWar: false });
  // Put a shooter and target on opposite sides of the wall, same row.
  s.units[0] = { ...s.units[0], position: { x: 2, y: 2 }, facing: 0 };   // CT-1 west of wall
  s.units[2] = { ...s.units[2], position: { x: 5, y: 2 }, facing: 0 };   // T-1 east of wall
  const frozen = { ...s };
  const shots = CsMiniGame.getLegalActions(frozen, 'ct').filter(a => a.type === 'shoot' && a.unitId === 'CT-1');
  assert.equal(shots.length, 0, 'wall between them should block the shot');
});

// ── Fog / vision cone ────────────────────────────────────────────────────────

test('csmini: fog hides enemies outside every vision cone', () => {
  const s = init();
  // CT faces east; T units are 7 squares east — out of range (5), so hidden.
  const seen = CsMiniGame.getVisibleState(s, 'ct');
  assert.equal(seen.units.filter(u => u.ownerId === 't').length, 0);
  assert.equal(seen.units.filter(u => u.ownerId === 'ct').length, 2);
});

test('csmini: an enemy inside a cone and in range becomes visible', () => {
  let s = init();
  // Move CT-1 to (2,1): T-1 at (7,1) is 5 away, due east, inside the 90° cone.
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 0, y: 1 }, to: { x: 1, y: 1 } });
  s = apply(s, 'ct', { type: 'move', unitId: 'CT-1', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  const seen = CsMiniGame.getVisibleState(s, 'ct');
  assert.ok(seen.units.some(u => u.id === 'T-1'));
});

test('csmini: facing away from an in-range enemy hides it (90° cone)', () => {
  const s = init({ fogOfWar: false });
  // Control ALL four units: both CT units face north, both T units sit due south
  // and in range. Vision is the union of the team's cones, so if neither CT cone
  // covers south, the T units stay hidden.
  s.units[0] = { ...s.units[0], position: { x: 2, y: 0 }, facing: Math.atan2(-1, 0) }; // CT-1 north
  s.units[1] = { ...s.units[1], position: { x: 5, y: 0 }, facing: Math.atan2(-1, 0) }; // CT-2 north
  s.units[2] = { ...s.units[2], position: { x: 2, y: 4 }, facing: 0 };                 // T-1 south of CT-1
  s.units[3] = { ...s.units[3], position: { x: 5, y: 4 }, facing: 0 };                 // T-2 south of CT-2
  const seen = CsMiniGame.getVisibleState({ ...s }, 'ct');
  assert.equal(seen.units.some(u => u.ownerId === 't'), false);
});

// ── Result & full games ────────────────────────────────────────────────────────

test('csmini: wiping a team ends the game', () => {
  const s = init();
  const dead = s.units.map(u => u.ownerId === 't' ? { ...u, hp: 0, alive: false } : u);
  const gs = { ...s.gameSpecific, alive: { ...s.gameSpecific.alive, t: 0 } };
  const res = CsMiniGame.getResult({ ...s, units: dead, gameSpecific: gs });
  assert.equal(res.outcome, 'win');
  assert.equal(res.winnerId, 'ct');
});

test('csmini: getResult survives fog (hidden enemies are not a phantom win)', () => {
  const s = init(); // fog on
  const fogged = CsMiniGame.getVisibleState(s, 'ct'); // strips the T units out of `units`
  assert.equal(fogged.units.filter(u => u.ownerId === 't').length, 0);
  assert.equal(CsMiniGame.getResult(fogged), null); // both teams still alive
});

test('csmini: a killing shot decrements the survivor count', () => {
  let s = init({ fogOfWar: false });
  s.units[2] = { ...s.units[2], position: { x: 2, y: 1 }, hp: 1 }; // T-1 at 1hp, in front of CT-1
  s = { ...s };
  const shot = CsMiniGame.getLegalActions(s, 'ct').find(a => a.type === 'shoot' && a.unitId === 'CT-1' && a.targetId === 'T-1');
  assert.ok(shot);
  s = apply(s, 'ct', shot);
  assert.equal(unit(s, 'T-1').alive, false);
  assert.equal(s.gameSpecific.alive.t, 1);
});

test('csmini: getLegalActions is never empty while both teams live', async () => {
  const engine = new GameEngine(CsMiniGame, players(), { maxTurns: 60 });
  engine._init();
  for (let i = 0; i < 50 && !engine.result; i++) {
    const la = CsMiniGame.getLegalActions(engine.state, engine.state.activePlayers[0]);
    assert.ok(la.length > 0);
    await engine.step();
  }
});

test('csmini: greedy agent beats random (seat-swapped)', async () => {
  const makeRandom = () => ({ id: 'r', chooseAction(_s, la) {
    const ends = la.filter(a => a.type === 'end-turn');
    const pool = [...ends, ...la];
    return pool[Math.floor(Math.random() * pool.length)];
  }});
  let greedyWins = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const greedyIsCt = i % 2 === 0;
    const ps = [
      { id: 'ct', name: 'CT', agent: greedyIsCt ? makeGreedyAgent(CsMiniGame) : makeRandom() },
      { id: 't', name: 'T', agent: greedyIsCt ? makeRandom() : makeGreedyAgent(CsMiniGame) },
    ];
    const { result } = await new GameEngine(CsMiniGame, ps, { maxTurns: 60, fogOfWar: true }).run();
    if (result.winnerId === (greedyIsCt ? 'ct' : 't')) greedyWins++;
  }
  assert.ok(greedyWins >= N * 0.8, `greedy won ${greedyWins}/${N}, expected >= ${N * 0.8}`);
});
