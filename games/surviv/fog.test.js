import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SurvivGame } from './index.js';
import { isWalkable, isInBush } from './map.js';
import { SurvivBelief, survivVisionCfg, spotsPoint } from './belief.js';
import { num } from '../coord.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }];

test('surviv fog: getVisibleState hides distant enemies', () => {
  const s = SurvivGame.createInitialState(players(), { fogOfWar: true });
  const view = SurvivGame.getVisibleState(s, s.activePlayers[0]); // red's view
  assert.equal(s.units.length, 20);
  assert.equal(view.units.filter(u => u.ownerId === 'red').length, 10, 'sees own whole team');
  assert.equal(view.units.filter(u => u.ownerId === 'blue').length, 0, 'blues at the far spawn are hidden');
});

test('surviv fog: a facing player sees ahead within its cone but not behind', () => {
  const base = SurvivGame.createInitialState(players(), { fogOfWar: true });
  const state = { ...base, units: [
    { id: 'me',     ownerId: 'red',  alive: true, position: { x: 3, y: 9 }, facing: 0 }, // faces east, open ground in the red spawn
    { id: 'ahead',  ownerId: 'blue', alive: true, position: { x: 5, y: 9 } },
    { id: 'behind', ownerId: 'blue', alive: true, position: { x: 1, y: 9 } },
  ] };
  const seen = SurvivGame.getVisibleState(state, base.activePlayers[0]).units.map(u => u.id);
  assert.ok(seen.includes('ahead'),   'enemy ahead within the cone is visible');
  assert.ok(!seen.includes('behind'), 'enemy behind is hidden');
});

test('surviv fog: a unit inside a bush is concealed beyond spotting range, even in cone+LOS', () => {
  const base = SurvivGame.createInitialState(players(), { fogOfWar: true });
  const map = base.gameSpecific.map;
  const bush = map.bushShapes[0];
  const bx = bush.x + bush.w / 2, by = bush.y + bush.h / 2;
  assert.ok(isInBush(map, bx, by), 'sanity: this point is really inside a bush');

  const state = { ...base, units: [
    { id: 'me',    ownerId: 'red',  alive: true, position: { x: bx - 3, y: by }, facing: 0 }, // faces the bush, in range
    { id: 'lurker', ownerId: 'blue', alive: true, position: { x: bx, y: by } },
  ] };
  // Direct spotsPoint check at the same geometry: in range/cone/LOS, but too far to see
  // through the bush (BUSH_SPOT_RANGE < 3 tiles) — confirms the concealment predicate
  // itself, before checking that getVisibleState wires it through end to end below.
  const cfg = survivVisionCfg(map);
  assert.equal(spotsPoint({ x: bx - 3, y: by, facing: 0 }, bx, by, cfg, map), false, 'not spotted through the bush at range');

  const seen = SurvivGame.getVisibleState(state, 'red').units.map(u => u.id);
  assert.ok(!seen.includes('lurker'), 'bush-concealed enemy 3 tiles out is hidden despite range+cone+LOS');
});

test('surviv fog: sampleWorlds places walkable, hidden enemies', () => {
  const s = SurvivGame.createInitialState(players(), { fogOfWar: true });
  const view = SurvivGame.getVisibleState(s, s.activePlayers[0]);
  const worlds = SurvivGame.sampleWorlds(view, s.activePlayers[0], 8);
  assert.ok(worlds.length > 0, 'produced particles');

  const seenIds = new Set(view.units.map(u => u.id));
  const tiles = s.gameSpecific.map.tiles;
  for (const w of worlds) {
    const lurkers = w.units.filter(u => u.ownerId === 'blue' && !seenIds.has(u.id));
    assert.ok(lurkers.length <= 10, 'no more than the enemy roster');
    for (const L of lurkers)
      assert.ok(isWalkable(tiles, L.position.x, L.position.y), 'lurker on a walkable tile');
  }
});

test('surviv fog: belief remembers a sighting and localises it after it hides', () => {
  const s = SurvivGame.createInitialState(players(), { fogOfWar: true });
  const map = s.gameSpecific.map;
  const belief = new SurvivBelief('red', map);

  const sight = { ...s, turnNumber: 1, units: [
    { id: 'red-0',  ownerId: 'red',  position: { x: 14, y: 9 }, alive: true, hp: 100, perTurn: {} },
    { id: 'blue-0', ownerId: 'blue', position: { x: 15, y: 9 }, alive: true, hp: 100, perTurn: {} },
  ] };
  belief.beginTurn(sight);
  assert.deepEqual([...belief.pieces.get('blue-0').possible], ['15,9'], 'pinned where seen');

  const away = { ...s, turnNumber: 2, units: [
    { id: 'red-0', ownerId: 'red', position: { x: 3, y: 9 }, alive: true, hp: 100, perTurn: {} },
  ] };
  belief.beginTurn(away);
  const possible = [...belief.pieces.get('blue-0').possible].map(k => k.split(',').map(Number));
  assert.ok(possible.length > 0 && possible.length <= 40, 'localised, bounded belief');
  const maxDist = Math.max(...possible.map(([x, y]) => Math.max(Math.abs(x - 15), Math.abs(y - 9))));
  assert.ok(maxDist <= 4, `stays within one move of the last sighting (got ${maxDist})`);
});

test('surviv fog: sampleWorlds returns [] when fog is off', () => {
  const s = SurvivGame.createInitialState(players(), { fogOfWar: false });
  const view = SurvivGame.getVisibleState(s, s.activePlayers[0]);
  assert.deepEqual(SurvivGame.sampleWorlds(view, s.activePlayers[0], 4), []);
});

test('surviv fog: Obscuro plays a fog game a few turns without crashing', async () => {
  const ps = players().map((p, i) => ({
    ...p,
    agent: i === 0 ? new ObscuroAgent(SurvivGame, { particles: 2, rows: 4, cols: 4, iters: 30 }) : RandomAgent,
  }));
  const engine = new GameEngine(SurvivGame, ps, { fogOfWar: true });
  engine._init();
  for (let i = 0; i < 4 && !engine.result; i++) await engine.step();
  assert.ok(true, 'ran without throwing');
});
