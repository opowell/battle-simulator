import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WarodDotsGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

const COLS = 40;
const ROWS = 26;
const T = 28;

function players() {
  return [
    { id: 'p1', name: 'Player 1', agent: RandomAgent },
    { id: 'p2', name: 'Player 2', agent: RandomAgent },
  ];
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

// ── createInitialState ────────────────────────────────────────────────────────

test('warofdots: grid is 40×26', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  assert.equal(state.board.cols, COLS);
  assert.equal(state.board.rows, ROWS);
  assert.equal(state.board.grid.length, ROWS);
  assert.ok(state.board.grid.every(row => row.length === COLS));
});

test('warofdots: each player starts with a capital city', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  for (const p of state.players) {
    assert.ok(state.board.cities.some(c => c.isCapital && c.owner === p.id));
  }
});

test('warofdots: map has at least 2 cities', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  assert.ok(state.board.cities.length >= 2);
});

test('warofdots: each player starts with 300 gold', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  for (const p of state.players) {
    assert.equal(p.gold, 300);
  }
});

test('warofdots: each player starts with 3 units near their capital', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  for (const p of state.players) {
    const myUnits = state.units.filter(u => u.owner === p.id);
    assert.equal(myUnits.length, 3);
  }
});

test('warofdots: all starting units are light type', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  assert.ok(state.units.every(u => u.type === 'light'));
});

test('warofdots: starts in play phase with one active player', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  assert.equal(state.currentPhase, 'play');
  assert.equal(state.activePlayers.length, 1);
});

// ── getLegalActions ───────────────────────────────────────────────────────────

test('warofdots: legal actions always include end-turn', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const actions = WarodDotsGame.getLegalActions(state, state.activePlayers[0]);
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('warofdots: legal actions include move actions for own units', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const actions = WarodDotsGame.getLegalActions(state, pid);
  const moves = actions.filter(a => a.type === 'move');
  const myUnits = state.units.filter(u => u.owner === pid);
  assert.ok(moves.length >= myUnits.length);
});

test('warofdots: move actions target valid city coordinates', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const moves = WarodDotsGame.getLegalActions(state, pid).filter(a => a.type === 'move');
  const cityCenters = new Set(state.board.cities.map(c => `${c.cx},${c.cy}`));
  for (const m of moves) {
    assert.ok(cityCenters.has(`${m.tx},${m.ty}`), `move target (${m.tx},${m.ty}) not a city center`);
  }
});

test('warofdots: buy actions have valid unit types and require enough gold', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const player = state.players.find(p => p.id === pid);
  const buys = WarodDotsGame.getLegalActions(state, pid).filter(a => a.type === 'buy');
  for (const b of buys) {
    assert.ok(['light', 'heavy'].includes(b.unitType));
  }
  // No buy actions possible if gold is 0
  const broke = { ...state, players: state.players.map(p => p.id === pid ? { ...p, gold: 0 } : p) };
  const brokeActions = WarodDotsGame.getLegalActions(broke, pid).filter(a => a.type === 'buy');
  assert.equal(brokeActions.length, 0);
});

test('warofdots: getLegalActions for unknown player returns end-turn only', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const actions = WarodDotsGame.getLegalActions(state, 'nobody');
  assert.deepEqual(actions, [{ type: 'end-turn' }]);
});

// ── applyActions — move ───────────────────────────────────────────────────────

test('warofdots: move action sets unit target and state to moving', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const unit = state.units.find(u => u.owner === pid);
  const targetCity = state.board.cities[0];

  const next = WarodDotsGame.applyActions(state, [{
    playerId: pid,
    action: { type: 'move', unitId: unit.id, tx: targetCity.cx, ty: targetCity.cy, attackMove: false },
  }]);

  const movedUnit = next.units.find(u => u.id === unit.id);
  assert.equal(movedUnit.tx, targetCity.cx);
  assert.equal(movedUnit.ty, targetCity.cy);
  assert.equal(movedUnit.state, 'moving');
});

test('warofdots: move action does not change active player', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const unit = state.units.find(u => u.owner === pid);
  const targetCity = state.board.cities[0];

  const next = WarodDotsGame.applyActions(state, [{
    playerId: pid,
    action: { type: 'move', unitId: unit.id, tx: targetCity.cx, ty: targetCity.cy, attackMove: false },
  }]);

  assert.equal(next.activePlayers[0], pid);
});

// ── applyActions — buy ────────────────────────────────────────────────────────

test('warofdots: buy light unit costs 200 gold', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const city = state.board.cities.find(c => c.owner === pid);
  const before = state.players.find(p => p.id === pid).gold;

  const next = WarodDotsGame.applyActions(state, [{
    playerId: pid,
    action: { type: 'buy', cityId: city.id, unitType: 'light' },
  }]);

  const after = next.players.find(p => p.id === pid).gold;
  assert.equal(after, before - 200);
});

test('warofdots: buy adds unit type to city queue', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const city = state.board.cities.find(c => c.owner === pid);

  const next = WarodDotsGame.applyActions(state, [{
    playerId: pid,
    action: { type: 'buy', cityId: city.id, unitType: 'light' },
  }]);

  const updatedCity = next.board.cities.find(c => c.id === city.id);
  assert.ok(updatedCity.queue.includes('light'));
});

test('warofdots: buy with insufficient gold is rejected', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const city = state.board.cities.find(c => c.owner === pid);
  const broke = { ...state, players: state.players.map(p => p.id === pid ? { ...p, gold: 0 } : p) };

  const next = WarodDotsGame.applyActions(broke, [{
    playerId: pid,
    action: { type: 'buy', cityId: city.id, unitType: 'light' },
  }]);

  const afterGold = next.players.find(p => p.id === pid).gold;
  assert.equal(afterGold, 0);
  const updatedCity = next.board.cities.find(c => c.id === city.id);
  assert.equal(updatedCity.queue.length, 0);
});

// ── applyActions — end-turn ───────────────────────────────────────────────────

test('warofdots: end-turn advances to next player', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const first = state.activePlayers[0];
  const next = WarodDotsGame.applyActions(state, [{ playerId: first, action: { type: 'end-turn' } }], detRng());
  assert.notEqual(next.activePlayers[0], first);
});

test('warofdots: end-turn increments turn number after both players go', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const [p1, p2] = state.players;
  const s1 = WarodDotsGame.applyActions(state, [{ playerId: p1.id, action: { type: 'end-turn' } }], detRng());
  const s2 = WarodDotsGame.applyActions(s1, [{ playerId: p2.id, action: { type: 'end-turn' } }], detRng());
  assert.equal(s2.turnNumber, state.turnNumber + 1);
});

test('warofdots: end-turn grows gold (cities produce income)', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const goldBefore = state.players.find(p => p.id === pid).gold;
  const next = WarodDotsGame.applyActions(state, [{ playerId: pid, action: { type: 'end-turn' } }], detRng());
  const goldAfter = next.players.find(p => p.id === pid).gold;
  assert.ok(goldAfter > goldBefore);
});

test('warofdots: end-turn preserves unit count (no losses on first quiet turn)', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const pid = state.activePlayers[0];
  const unitsBefore = state.units.length;
  const next = WarodDotsGame.applyActions(state, [{ playerId: pid, action: { type: 'end-turn' } }], detRng());
  assert.equal(next.units.length, unitsBefore);
});

// ── getResult ─────────────────────────────────────────────────────────────────

test('warofdots: getResult is null while game is ongoing', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  assert.equal(WarodDotsGame.getResult(state), null);
});

test('warofdots: getResult detects win when enemy has no cities and no units', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const stripped = {
    ...state,
    units: state.units.filter(u => u.owner === 'p1'),
    board: {
      ...state.board,
      cities: state.board.cities.map(c => ({ ...c, owner: 'p1' })),
    },
  };
  const result = WarodDotsGame.getResult(stripped);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
});

test('warofdots: getResult detects win when all enemy capitals captured and 80% cities owned', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const total = state.board.cities.length;
  const threshold = Math.floor(total * 0.8);
  // Give p1 enough cities to hit threshold, and take p2's capital
  let count = 0;
  const dominated = {
    ...state,
    board: {
      ...state.board,
      cities: state.board.cities.map(c => {
        if (c.isCapital && c.owner === 'p2') return { ...c, owner: 'p1' };
        if (count < threshold) { count++; return { ...c, owner: 'p1' }; }
        return c;
      }),
    },
  };
  const result = WarodDotsGame.getResult(dominated);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ── renderState ───────────────────────────────────────────────────────────────

test('warofdots: renderState returns a non-empty string', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const rendered = WarodDotsGame.renderState(state);
  assert.equal(typeof rendered, 'string');
  assert.ok(rendered.length > 0);
});

test('warofdots: renderState includes turn number and active player', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const rendered = WarodDotsGame.renderState(state);
  assert.ok(rendered.includes('Turn 1'));
  assert.ok(rendered.includes(state.activePlayers[0]));
});

// ── toGrid ────────────────────────────────────────────────────────────────────

test('warofdots: toGrid returns correct dimensions', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const grid = WarodDotsGame.toGrid(state);
  assert.equal(grid.width, COLS);
  assert.equal(grid.height, ROWS);
  assert.equal(grid.cells.length, COLS * ROWS);
});

test('warofdots: toGrid cells have required fields', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const { cells } = WarodDotsGame.toGrid(state);
  for (const cell of cells) {
    assert.ok('x' in cell);
    assert.ok('y' in cell);
    assert.ok('glyph' in cell);
    assert.ok('owner' in cell);
    assert.ok('color' in cell);
  }
});

test('warofdots: toGrid capital cells have ★ glyph', () => {
  const state = WarodDotsGame.createInitialState(players(), { rng: detRng() });
  const { cells } = WarodDotsGame.toGrid(state);
  const capitals = state.board.cities.filter(c => c.isCapital);
  for (const cap of capitals) {
    const cell = cells.find(c => c.x === cap.col && c.y === cap.row);
    assert.equal(cell?.glyph, '★');
  }
});

// ── self-play ─────────────────────────────────────────────────────────────────

test('warofdots: self-play completes with a valid result', async () => {
  const engine = new GameEngine(WarodDotsGame, players(), { maxTurns: 100 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw', 'victory'].includes(result.outcome));
});
