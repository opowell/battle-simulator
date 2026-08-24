import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './Civ1Game.js';
import { Civ1Belief } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

test('civ1 fog: getVisibleState hides distant enemies and stores a unit roster', () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  const view = Civ1Game.getVisibleState(s, s.activePlayers[0]);
  assert.ok(s.units.length > 0);
  assert.equal(view.units.filter(u => u.ownerId === 'p2').length, 0, 'far enemies hidden');
  assert.equal(s.gameSpecific.startRoster.units.length, s.units.length, 'startRoster is common knowledge');
});

test("civ1 fog: the observation never spells out the enemy's last move", () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  // p2 starts an advance — a move that leaves no trace on the map at all, and is a
  // ledger secret besides.
  const played = {
    ...s,
    lastActions: [
      { playerId: 'p2', action: { type: 'set-research', tech: 'bronze-working' } },
      { playerId: 'p1', action: { type: 'skip-unit', unitId: s.units[0].id } },
    ],
  };
  const view = Civ1Game.getVisibleState(played, 'p1');
  assert.deepEqual(view.lastActions.map(pa => pa.playerId), ['p1'], 'only our own moves survive');
  assert.ok(!JSON.stringify(view).includes('bronze-working'), 'their research is nowhere in the observation');
});

test("civ1 fog: the Apollo Program reveals the map, not the enemy's move", () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  // Apollo takes the reveal-map early return, which skips the unit/city filtering
  // below it — the projection has to happen before that, not after.
  const withApollo = {
    ...s,
    cities: [{ id: 'c1', ownerId: 'p1', name: 'Rome', position: { x: 1, y: 1 }, size: 1,
               shields: 0, food: 0, production: 'militia', buildings: ['apollo'] }],
    lastActions: [{ playerId: 'p2', action: { type: 'set-research', tech: 'bronze-working' } }],
  };
  const view = Civ1Game.getVisibleState(withApollo, 'p1');
  assert.equal(view.units.length, s.units.length, 'the map really is revealed');
  assert.deepEqual(view.lastActions, [], 'their move is not');
});

test("civ1 fog: the observation's id counter says nothing about rival production", () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  const before = Civ1Game.getVisibleState(s, 'p1').gameSpecific.nextId;
  // p2 quietly builds an army on the far side of the map. The shared counter in the
  // true state climbs with every one of them; ours must not.
  const busy = {
    ...s,
    units: [...s.units, ...Array.from({ length: 12 }, (_, i) => ({
      ...s.units.find(u => u.ownerId === 'p2'), id: `u${50 + i}`, position: { x: 25, y: 15 },
    }))],
    gameSpecific: { ...s.gameSpecific, nextId: s.gameSpecific.nextId + 12 },
  };
  assert.equal(Civ1Game.getVisibleState(busy, 'p1').gameSpecific.nextId, before, 'their build queue is not our business');
  assert.notEqual(busy.gameSpecific.nextId, before, 'the true counter did move');
});

test('civ1 fog: with fog off the last move is public', () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: false });
  const played = { ...s, lastActions: [{ playerId: 'p2', action: { type: 'skip-unit', unitId: 'u0' } }] };
  assert.deepEqual(Civ1Game.getVisibleState(played, 'p1').lastActions, played.lastActions);
});

test('civ1 fog: sampleWorlds places in-bounds, hidden enemies', () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  const view = Civ1Game.getVisibleState(s, 'p1');
  const worlds = Civ1Game.sampleWorlds(view, 'p1', 8);
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

test('civ1 fog: sampleWorlds returns [] when fog is off', () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: false });
  assert.deepEqual(Civ1Game.sampleWorlds(Civ1Game.getVisibleState(s, 'p1'), 'p1', 4), []);
});

test('civ1 fog: a captured city is forgotten as an enemy asset', () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  const belief = new Civ1Belief('p1', s.board, [], [
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

// ── Terrain fog ──────────────────────────────────────────────────────────────
//
// The map itself is hidden until somebody walks it. What a player has seen is kept
// per seat in gameSpecific.explored and never re-hidden, exactly as the original
// blacks out the world and then keeps whatever your units have passed.

const terrainAt = (view, x, y) => view.board.tiles[`${x},${y}`].terrain;

test('civ1 fog: the map is dark until somebody walks it', () => {
  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const view = Civ1Game.getVisibleState(s, 'p1');
  const mine = s.units.find(u => u.ownerId === 'p1');

  // Our own square and its neighbours are ours to know.
  assert.equal(terrainAt(view, mine.position.x, mine.position.y), terrainAt(s, mine.position.x, mine.position.y));
  assert.notEqual(terrainAt(view, mine.position.x, mine.position.y), 'unknown');

  const dark = Object.entries(view.board.tiles).filter(([, t]) => t.terrain === 'unknown');
  assert.ok(dark.length > 500, `most of a 600-square world is unexplored, got ${dark.length}`);
  // And it is the real map that is hidden, not a map that was never there.
  const [key] = dark[0];
  assert.notEqual(s.board.tiles[key].terrain, 'unknown', 'the true board still has terrain there');
});

test('civ1 fog: ground stays known once walked, and each seat keeps its own record', () => {
  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const mine = s.units.find(u => u.ownerId === 'p1' && u.type === 'militia');
  const step = Civ1Game.getLegalActions(s, 'p1')
    .find(a => a.type === 'move' && a.unitId === mine.id);
  assert.ok(step, 'expected somewhere to walk');

  const after = Civ1Game.applyActions(s, [{ playerId: 'p1', action: step }]);
  const seenNow = Civ1Game.getVisibleState(after, 'p1');
  // Whatever the step brought into view is ours from here on, including the square
  // behind us that nothing is standing on any more.
  assert.notEqual(terrainAt(seenNow, mine.position.x, mine.position.y), 'unknown', 'we remember where we came from');

  // p2 walked nowhere: their map is untouched by our step.
  assert.equal(after.gameSpecific.explored.p2, s.gameSpecific.explored.p2);
  assert.notEqual(after.gameSpecific.explored.p1, s.gameSpecific.explored.p1, 'ours grew');
});

test('civ1 fog: no move is ever offered into the dark', () => {
  // A move onto unexplored ground would be thrown out by the engine the moment that
  // ground turned out to be ocean, silently replacing the agent's plan with a
  // fallback. Single steps still work — a unit sees all eight of its neighbours — so
  // this costs exploration nothing.
  let s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  for (let i = 0; i < 12; i++) {
    const view = Civ1Game.getVisibleState(s, 'p1');
    const moves = Civ1Game.getLegalActions(view, 'p1').filter(a => a.type === 'move');
    for (const m of moves) {
      assert.notEqual(terrainAt(view, m.to.x, m.to.y), 'unknown', `move onto unexplored ${m.to.x},${m.to.y}`);
    }
    const act = moves[0] ?? Civ1Game.getLegalActions(s, 'p1')[0];
    s = Civ1Game.applyActions(s, [{ playerId: 'p1', action: act }]);
  }
});

test('civ1 fog: terrain is public with fog off, and to Apollo', () => {
  const open = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: false });
  const openView = Civ1Game.getVisibleState(open, 'p1');
  assert.equal(Object.values(openView.board.tiles).filter(t => t.terrain === 'unknown').length, 0);

  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const withApollo = {
    ...s,
    cities: [{ id: 'c1', ownerId: 'p1', name: 'Rome', position: { x: 1, y: 1 }, size: 1,
               shields: 0, food: 0, production: 'militia', buildings: ['apollo'] }],
  };
  const apolloView = Civ1Game.getVisibleState(withApollo, 'p1');
  assert.equal(Object.values(apolloView.board.tiles).filter(t => t.terrain === 'unknown').length, 0,
    'revealing the map is the whole point of the wonder');
});

test('civ1 fog: a state that keeps no record is not silently blinded', () => {
  // Hand-built states (tests, fixtures) have no explored map. Hiding everything from
  // them would turn every such state into a blind one; they behave as they always did.
  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const legacy = { ...s, gameSpecific: { ...s.gameSpecific, explored: undefined } };
  const view = Civ1Game.getVisibleState(legacy, 'p1');
  assert.equal(Object.values(view.board.tiles).filter(t => t.terrain === 'unknown').length, 0);
});

test("civ1 fog: a rival's explored map is theirs, not ours", () => {
  // Where somebody has walked traces every march they have made since turn one — a
  // record of their expansion that no unit of ours ever saw.
  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const view = Civ1Game.getVisibleState(s, 'p1');
  assert.ok(view.gameSpecific.explored.p1, 'we keep our own');
  assert.equal(view.gameSpecific.explored.p2, undefined, 'and only our own');
});

test('civ1 fog: exploring is something you do in the world, not in your head', () => {
  // An agent applies actions to its own observation all through a search. Letting that
  // grow the explored record would have it "discover" ground it has only imagined
  // walking — and would cost a fresh copy of the board at every such node.
  const s = Civ1Game.createInitialState(players(), { width: 30, height: 20, seed: 7, fogOfWar: true });
  const view = Civ1Game.getVisibleState(s, 'p1');
  const step = Civ1Game.getLegalActions(view, 'p1').find(a => a.type === 'move');
  const imagined = Civ1Game.applyActions(view, [{ playerId: 'p1', action: step }]);
  assert.equal(imagined.gameSpecific.explored.p1, view.gameSpecific.explored.p1, 'imagining explores nothing');

  // The same step really taken does explore.
  const real = Civ1Game.applyActions(s, [{ playerId: 'p1', action: step }]);
  assert.notEqual(real.gameSpecific.explored.p1, s.gameSpecific.explored.p1);
});

test('civ1 fog: Obscuro plays a fog game to completion', async () => {
  const ps = players().map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(Civ1Game, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(Civ1Game, ps, { maxTurns: 20, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
