import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsGame } from './index.js';
import { isWalkable } from './map.js';
import { CsBelief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'T' }, { id: 'p2', name: 'CT' }];

test('cs fog: getVisibleState hides distant enemies', () => {
  const s = CsGame.createInitialState(players(), { fogOfWar: true, mapId: 'dust2' });
  const view = CsGame.getVisibleState(s, s.activePlayers[0]); // T's view
  assert.equal(s.units.length, 10);
  assert.equal(view.units.filter(u => u.ownerId === 'T').length, 5, 'sees own whole team');
  assert.equal(view.units.filter(u => u.ownerId === 'CT').length, 0, 'CTs at far spawn are hidden');
});

test('cs fog: sampleWorlds places walkable, hidden enemies', () => {
  const s = CsGame.createInitialState(players(), { fogOfWar: true, mapId: 'dust2' });
  const view = CsGame.getVisibleState(s, s.activePlayers[0]);
  const worlds = CsGame.sampleWorlds(view, s.activePlayers[0], 8);
  assert.ok(worlds.length > 0, 'produced particles');

  const myUnits = view.units.filter(u => u.ownerId === 'T' && u.alive);
  const seenIds = new Set(view.units.map(u => u.id));
  const tiles = s.gameSpecific.map.tiles;
  for (const w of worlds) {
    const lurkers = w.units.filter(u => u.ownerId === 'CT' && !seenIds.has(u.id));
    assert.ok(lurkers.length <= 5, 'no more than the enemy roster');
    for (const L of lurkers) {
      assert.ok(isWalkable(tiles, L.position.x, L.position.y), 'lurker on a walkable tile');
      const visible = myUnits.some(m =>
        Math.max(Math.abs(m.position.x - L.position.x), Math.abs(m.position.y - L.position.y)) <= 4);
      assert.ok(!visible, 'lurker is outside our vision (else we would see it)');
    }
  }
});

test('cs fog: belief remembers a sighting and localises it after it hides', () => {
  const s = CsGame.createInitialState(players(), { fogOfWar: true, mapId: 'dust2' });
  const map = s.gameSpecific.map;
  const belief = new CsBelief('T', map);

  // Turn 1: a T scout stands next to CT-0 at (10,6); everything else hidden.
  const sight = {
    ...s, turnNumber: 1,
    units: [
      { id: 'T-0', ownerId: 'T', type: 'player', position: { x: 9, y: 6 }, alive: true, hp: 100, perTurn: {} },
      { id: 'CT-0', ownerId: 'CT', type: 'player', position: { x: 10, y: 6 }, alive: true, hp: 100, perTurn: {} },
    ],
  };
  belief.beginTurn(sight);
  assert.deepEqual([...belief.pieces.get('CT-0').possible], ['10,6'], 'pinned where seen');

  // Turn 2: the scout backs off so CT-0 is no longer visible. Belief should keep
  // CT-0 near (10,6) (a bounded move of reach), NOT scattered across the map.
  const away = { ...s, turnNumber: 2, units: [{ id: 'T-0', ownerId: 'T', type: 'player', position: { x: 3, y: 6 }, alive: true, hp: 100, perTurn: {} }] };
  belief.beginTurn(away);
  const possible = [...belief.pieces.get('CT-0').possible].map(k => k.split(',').map(Number));
  assert.ok(possible.length > 0 && possible.length <= 40, 'localised, bounded belief');
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - 10), Math.abs(y - 6))));
  assert.ok(maxDist <= 4, `stays within one move of the last sighting (got ${maxDist})`);
});

test('cs fog: belief confirms a death it witnesses', () => {
  const s = CsGame.createInitialState(players(), { fogOfWar: true, mapId: 'dust2' });
  const belief = new CsBelief('T', s.gameSpecific.map);
  const dead = {
    ...s, turnNumber: 1,
    units: [
      { id: 'T-0', ownerId: 'T', type: 'player', position: { x: 9, y: 6 }, alive: true, hp: 100, perTurn: {} },
      { id: 'CT-0', ownerId: 'CT', type: 'player', position: { x: 10, y: 6 }, alive: false, hp: 0, perTurn: {} },
    ],
  };
  belief.beginTurn(dead);
  assert.equal(belief.pieces.get('CT-0').alive, false, 'witnessed death is recorded');
  const worlds = belief.sample(dead, 5, Math.random, (id, team, pos) => ({ id, ownerId: team, position: pos, alive: true }));
  for (const w of worlds)
    assert.ok(!w.units.some(u => u.id === 'CT-0' && u.alive), 'never resurrects a confirmed-dead enemy');
});

test('cs fog: sampleWorlds returns [] when fog is off', () => {
  const s = CsGame.createInitialState(players(), { fogOfWar: false });
  const view = CsGame.getVisibleState(s, s.activePlayers[0]);
  assert.deepEqual(CsGame.sampleWorlds(view, s.activePlayers[0], 4), []);
});

test('cs fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p,
    agent: i === 0 ? new ObscuroAgent(CsGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(CsGame, ps, { maxTurns: 6, fogOfWar: true, mapId: 'dust2' }).run();
  assert.ok(result && typeof result.outcome === 'string', 'fog game produced a result');
});

test('cs fog: exposes a fogOfWar game option', () => {
  const opt = (CsGame.gameOptions ?? []).find(o => o.id === 'fogOfWar');
  assert.ok(opt && opt.type === 'boolean', 'CS declares a fogOfWar boolean option');
});
