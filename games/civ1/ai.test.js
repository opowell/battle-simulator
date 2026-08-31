// The agents' stack discipline. Friendly units may share a square (see stack.test.js),
// but an open square that loses its defence loses every unit on it, so both agents
// price a step onto one of their own — ai.js's STACK_PENALTY, mirrored in the search's
// pruner (searchActions.js). A city square is exempt: that is a garrison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { makeCiv1Agent, makeGreedyAgent } from './ai.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function unit(id, ownerId, type, x, y, over = {}) {
  return {
    id, ownerId, type, position: { x, y }, alive: true,
    hp: 10, maxHp: 10, movesLeft: 1, attrs: {}, queue: [], ...over,
  };
}

// A corridor: grassland everywhere except the two squares above and below (10,10), so
// the only step east is over whatever is standing on (10,10) itself. Going round it
// means a step that ends up further from the enemy in the east.
function corridor(opts = {}) {
  const state = Civ1Game.createInitialState(players(), {
    width: 20, height: 20, seed: 7, barbarians: 'villages-only', fogOfWar: false,
  });
  const wall = new Set(['10,9', '10,11']);
  const tiles = {};
  for (const [k, t] of Object.entries(state.board.tiles)) {
    tiles[k] = { ...t, terrain: wall.has(k) ? 'ocean' : 'grassland', hasRoad: false, hasRail: false };
  }
  return {
    ...state,
    board: { ...state.board, tiles },
    units: opts.units ?? [],
    cities: opts.cities ?? [],
    activePlayers: ['p1'],
  };
}

// Only this unit's moves are offered, so the agent has exactly one decision to make.
const movesFor = (state, unitId) =>
  Civ1Game.getLegalActions(state, 'p1').filter(a => a.type === 'move' && a.unitId === unitId);

// Ids matter: the search's pruner decides one unit at a time, lowest id first
// (searchActions.js focusUnit), so the mover has to sort ahead of the blocker for the
// pruned set to be about the step under test.
const world = (cities = []) => corridor({
  units: [
    unit('a-mover',   'p1', 'legion',  9, 10),
    unit('b-blocker', 'p1', 'militia', 10, 10),
    unit('e-enemy',   'p2', 'militia', 14, 10),
  ],
  cities,
});

test('civ1 agent: it walks around its own unit rather than piling onto it', () => {
  const state = world();
  const moves = movesFor(state, 'a-mover');
  assert.ok(moves.some(m => m.to.x === 10 && m.to.y === 10), 'the fixture offers the stacking step');

  const chosen = makeCiv1Agent().chooseAction(state, moves);
  assert.notDeepEqual(chosen.to, { x: 10, y: 10 }, 'took the long way round');

  // …and the fixture is discriminating: without the penalty that step is the pick,
  // because it is the one that closes on the enemy.
  const before = makeCiv1Agent({ stackPenalty: 0 }).chooseAction(state, moves);
  assert.deepEqual(before.to, { x: 10, y: 10 });
});

test('civ1 agent: stacking into its own city is free — that is a garrison', () => {
  const state = world([{
    id: 'c1', name: 'Roma', ownerId: 'p1', position: { x: 10, y: 10 },
    size: 1, shields: 0, food: 0, production: 'militia', buildings: [],
  }]);
  const chosen = makeCiv1Agent().chooseAction(state, movesFor(state, 'a-mover'));
  assert.deepEqual(chosen.to, { x: 10, y: 10 }, 'straight in');
});

test('civ1 greedy agent: even the baseline does not march into its own units', () => {
  // Until squares could be shared, the engine refused this move and greedy never had to
  // think about it — it is the worst offender without the rule (see AI-DESIGN.md).
  const state = world();
  const moves = movesFor(state, 'a-mover');
  assert.notDeepEqual(makeGreedyAgent().chooseAction(state, moves).to, { x: 10, y: 10 });
  assert.deepEqual(makeGreedyAgent({ stackPenalty: 0 }).chooseAction(state, moves).to, { x: 10, y: 10 });
});

test('civ1 search actions: the pruner drops the stacking step when there is another way', () => {
  // The pruner poses one kind of decision per node and empire business comes first
  // (research, tax), so take its own choices until it gets round to the unit.
  let state = world();
  for (let i = 0; i < 8; i++) {
    const acts = Civ1Game.getSearchActions(state, 'p1');
    const moves = acts.filter(a => a.type === 'move' && a.unitId === 'a-mover');
    if (moves.length) {
      assert.ok(!moves.some(m => m.to.x === 10 && m.to.y === 10),
        'the pruned set keeps the moves that do not pile up');
      return;
    }
    state = Civ1Game.applyActions(state, [{ playerId: 'p1', action: acts[0] }]);
  }
  assert.fail('the pruner never got round to the mover');
});
