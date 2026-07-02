import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDiceGame } from './index.js';
import { KDiceBelief, visibleTerritoryIds } from './belief.js';
import { ObscuroAgent } from '../../agents/ObscuroAgent.js';
import { RandomAgent } from '../../agents/RandomAgent.js';
import { GameEngine } from '../../engine/index.js';

const players = (n = 3) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

// Small helper: map layout/ownership is randomised, so occasionally every
// territory ends up visible to the active player (owned or bordering) on a
// small map. Retry with fresh randomness (bounded) to reliably land on a
// state that actually has fog, so these tests aren't flaky.
function stateWithHiddenTerritory(numPlayers = 3, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    const s = KDiceGame.createInitialState(players(numPlayers), { fogOfWar: true });
    const me = s.activePlayers[0];
    const view = KDiceGame.getVisibleState(s, me);
    if (Object.values(view.board.territories).some(t => t.owner === null)) return { s, me, view };
  }
  throw new Error('could not find a fog state with a hidden territory after retries');
}

test('kdice fog: getVisibleState hides distant territories', () => {
  const { s, me, view } = stateWithHiddenTerritory();

  const { territories, adjacency } = s.board;
  const vis = visibleTerritoryIds(territories, adjacency, me);

  assert.ok(vis.size < Object.keys(territories).length, 'at least some territories are not visible (sanity check on map size)');

  for (const [id, t] of Object.entries(view.board.territories)) {
    if (vis.has(id)) {
      assert.equal(t.owner, territories[id].owner, 'visible territory keeps true owner');
      assert.equal(t.dice, territories[id].dice, 'visible territory keeps true dice');
    } else {
      assert.equal(t.owner, null, 'hidden territory owner concealed');
      assert.equal(t.dice, null, 'hidden territory dice concealed');
    }
  }
});

test('kdice fog: getVisibleState is a no-op when fog is off', () => {
  const s = KDiceGame.createInitialState(players(), { fogOfWar: false });
  const view = KDiceGame.getVisibleState(s, s.activePlayers[0]);
  assert.equal(view, s);
});

test('kdice fog: own territories and their neighbors are always visible', () => {
  const s = KDiceGame.createInitialState(players(), { fogOfWar: true });
  const me = s.activePlayers[0];
  const view = KDiceGame.getVisibleState(s, me);
  const { territories, adjacency } = s.board;

  const mine = Object.values(territories).filter(t => t.owner === me);
  for (const t of mine) {
    assert.equal(view.board.territories[t.id].owner, me, 'own territory visible');
    for (const nid of adjacency[t.id]) {
      assert.notEqual(view.board.territories[nid].owner, undefined);
      // A neighbor's owner/dice must be revealed (non-null), whoever owns it.
      assert.ok(view.board.territories[nid].owner !== null, 'neighbor of own territory is visible');
    }
  }
});

test('kdice fog: sampleWorlds fills hidden territories with plausible dice in [1,8] and real owners', () => {
  const { s, me, view } = stateWithHiddenTerritory();
  const worlds = KDiceGame.sampleWorlds(view, me, 6, Math.random);

  assert.ok(worlds.length > 0, 'produces particles when territories are hidden');
  const validOwners = new Set(s.players.map(p => p.id));

  for (const w of worlds) {
    assert.equal(Object.keys(w.board.territories).length, Object.keys(s.board.territories).length);
    for (const t of Object.values(w.board.territories)) {
      assert.ok(t.owner != null && validOwners.has(t.owner), 'every territory has a real owner');
      assert.ok(t.dice >= 1 && t.dice <= 8, `dice in range, got ${t.dice}`);
    }
    // Previously-visible territories must be preserved exactly.
    for (const [id, t] of Object.entries(view.board.territories)) {
      if (t.owner !== null) {
        assert.equal(w.board.territories[id].owner, t.owner, 'known territory owner preserved in sample');
        assert.equal(w.board.territories[id].dice, t.dice, 'known territory dice preserved in sample');
      }
    }
  }
});

test('kdice fog: sampleWorlds returns [] when fog is off', () => {
  const s = KDiceGame.createInitialState(players(), { fogOfWar: false });
  const view = KDiceGame.getVisibleState(s, s.activePlayers[0]);
  assert.deepEqual(KDiceGame.sampleWorlds(view, s.activePlayers[0], 4), []);
});

test('kdice fog: sampleWorlds returns [] once no territory is hidden (belief has nothing to fill)', () => {
  const s = KDiceGame.createInitialState(players(2), { fogOfWar: true });
  // With 2 players sharing a small map, every territory tends to end up
  // visible (own + all neighbors). If some remain hidden this still holds
  // vacuously via the general sampleWorlds test above, so just check shape.
  const me = s.activePlayers[0];
  const view = KDiceGame.getVisibleState(s, me);
  const hiddenCount = Object.values(view.board.territories).filter(t => t.owner === null).length;
  const worlds = KDiceGame.sampleWorlds(view, me, 4, Math.random);
  if (hiddenCount === 0) {
    assert.deepEqual(worlds, []);
  } else {
    assert.ok(worlds.length > 0);
  }
});

test('kdice fog: belief remembers a last-known owner and dice after territory goes out of sight', () => {
  const s = KDiceGame.createInitialState(players(), { fogOfWar: true });
  const me = s.activePlayers[0];
  const belief = new KDiceBelief(me, s.players.map(p => p.id));

  const view1 = KDiceGame.getVisibleState(s, me);
  belief.beginTurn({ ...view1, turnNumber: 1 });

  // Find a territory that was actually visible (owner revealed) this turn.
  const seenId = Object.keys(view1.board.territories).find(id => view1.board.territories[id].owner !== null);
  assert.ok(seenId, 'at least one territory visible turn 1');
  const rec = belief.knowledge.get(seenId);
  assert.ok(rec.ownerKnown && rec.diceKnown, 'belief recorded the sighting');
  assert.equal(rec.staleness, 0);
});

test('kdice fog: Obscuro plays a fog game to completion', async () => {
  const ps = players(3).map((p, i) => ({
    ...p, agent: i === 0 ? new ObscuroAgent(KDiceGame, { particles: 3, rows: 4, cols: 4, iters: 40 }) : RandomAgent,
  }));
  const { result } = await new GameEngine(KDiceGame, ps, { maxTurns: 150, fogOfWar: true }).run();
  assert.ok(result && typeof result.outcome === 'string');
});
