import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AowGame } from './index.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';
import { totalMen, MAX_MEN } from './squad.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

function endTurn(state, playerId) {
  return AowGame.applyActions(state, [{ playerId, action: { type: 'end-turn', unitId: '__player__' } }]);
}

// ── createInitialState ──────────────────────────────────────────────────────

test('aow: both sides field squads', () => {
  const s = AowGame.createInitialState(players());
  assert.ok(s.squads.some(q => q.ownerId === 'p1' && q.alive));
  assert.ok(s.squads.some(q => q.ownerId === 'p2' && q.alive));
});

test('aow: no squad exceeds 14 men', () => {
  const s = AowGame.createInitialState(players());
  assert.ok(s.squads.every(q => totalMen(q) <= MAX_MEN));
});

test('aow: squads start fully supplied and steady', () => {
  const s = AowGame.createInitialState(players());
  assert.ok(s.squads.every(q => q.supply === 100 && q.morale === 100));
});

test('aow: map has forts, villages and flags', () => {
  const s = AowGame.createInitialState(players());
  const types = new Set(s.board.features.map(f => f.type));
  assert.ok(types.has('fort') && types.has('village') && types.has('flag'));
});

test('aow: starts on turn 1 with p1 active', () => {
  const s = AowGame.createInitialState(players());
  assert.equal(s.turnNumber, 1);
  assert.deepEqual(s.activePlayers, ['p1']);
});

// ── getLegalActions ─────────────────────────────────────────────────────────

test('aow: legal actions include move and end-turn', () => {
  const s = AowGame.createInitialState(players());
  const la = AowGame.getLegalActions(s, 'p1');
  assert.ok(la.some(a => a.type === 'move'));
  assert.ok(la.some(a => a.type === 'end-turn'));
});

test('aow: move destinations are on passable ground', () => {
  const s = AowGame.createInitialState(players());
  for (const a of AowGame.getLegalActions(s, 'p1').filter(a => a.type === 'move'))
    assert.ok(AowGame.isActionLegal(s, 'p1', a), 'lattice move should validate');
});

// ── applyActions ────────────────────────────────────────────────────────────

test('aow: a move relocates the squad and marks it acted', () => {
  const s = AowGame.createInitialState(players());
  const mv = AowGame.getLegalActions(s, 'p1').find(a => a.type === 'move');
  const next = AowGame.applyActions(s, [{ playerId: 'p1', action: mv }]);
  const moved = next.squads.find(q => q.id === mv.unitId);
  assert.ok(moved.acted);
});

test('aow: continuous move to an arbitrary passable point is accepted', () => {
  const s = AowGame.createInitialState(players());
  const sq = s.squads.find(q => q.ownerId === 'p1');
  const action = { type: 'move', unitId: sq.id, to: { x: String(sq.position.x + 0.3), y: String(sq.position.y) } };
  assert.ok(AowGame.isActionLegal(s, 'p1', action));
  const next = AowGame.applyActions(s, [{ playerId: 'p1', action }]);
  assert.ok(next.squads.find(q => q.id === sq.id));
});

test('aow: end-turn hands over and advances the turn counter', () => {
  const s = AowGame.createInitialState(players());
  const afterP1 = endTurn(s, 'p1');
  assert.deepEqual(afterP1.activePlayers, ['p2']);
  const afterP2 = endTurn(afterP1, 'p2');
  assert.equal(afterP2.turnNumber, 2);
  assert.deepEqual(afterP2.activePlayers, ['p1']);
});

test('aow: a fort garrison trains reinforcements over a turn', () => {
  const s = AowGame.createInitialState(players());
  const fort = s.board.features.find(f => f.type === 'fort' && f.owner === 'p1');
  const idx = s.squads.findIndex(q => q.ownerId === 'p1');
  s.squads[idx] = { ...s.squads[idx], men: { knight: 2 }, position: { x: fort.x, y: fort.y } };
  const before = totalMen(s.squads[idx]);
  const after = endTurn(s, 'p1');
  const grown = after.squads.find(q => q.id === s.squads[idx].id);
  assert.ok(totalMen(grown) > before, 'fort should add a man');
});

// ── getResult ───────────────────────────────────────────────────────────────

test('aow: no result while both sides hold their flags', () => {
  assert.equal(AowGame.getResult(AowGame.createInitialState(players())), null);
});

test('aow: capturing the enemy flag wins', () => {
  const s = AowGame.createInitialState(players());
  for (const f of s.board.features) if (f.type === 'flag' && f.origOwner === 'p2') f.owner = 'p1';
  const r = AowGame.getResult(s);
  assert.equal(r?.outcome, 'win');
  assert.equal(r.winnerId, 'p1');
  assert.equal(r.reason, 'flags-captured');
});

test('aow: destroying the enemy army wins', () => {
  const s = AowGame.createInitialState(players());
  const noP2 = { ...s, squads: s.squads.map(q => q.ownerId === 'p2' ? { ...q, alive: false } : q) };
  const r = AowGame.getResult(noP2);
  assert.equal(r?.winnerId, 'p1');
  assert.equal(r.reason, 'army-destroyed');
});

// ── toGrid ──────────────────────────────────────────────────────────────────

test('aow: toGrid is continuous with wire-encoded units and detailed terrain shapes', () => {
  const s = AowGame.createInitialState(players());
  const g = AowGame.toGrid(s);
  assert.equal(g.locationType, 'continuous');
  assert.ok(g.units.length > 0);
  assert.ok(g.units.every(u => typeof u.x === 'string'));
  // Primitive-shape terrain/feature art: hundreds of layered oval/rect/poly/line shapes.
  assert.ok(g.shapes.length > 200, 'dense primitive-shape detail');
  assert.ok(g.shapes.some(sh => sh.shape === 'poly'), 'peaks/trees/pennants drawn as polygons');
});

// ── Self-play ───────────────────────────────────────────────────────────────

test('aow: self-play completes with a valid result', async () => {
  const engine = new GameEngine(AowGame, players(), { maxTurns: 200 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});
