import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../RandomAgent.js';
import { makeGenericAgent, whoAmI, genericEvaluateState } from './GenericAgent.js';
import { readBattle, unitView } from './battleView.js';
import { ArenaGame, UNIT_TYPES } from '../../../games/arena/index.js';
import { ChessGame } from '../../../games/chess/index.js';

const PLAYERS = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

function arena(config, units) {
  return ArenaGame.createInitialState(PLAYERS, {
    width: 10, height: 6, terrain: {}, ...config,
    units: units.map(([ownerId, type, x, y], i) => ({ id: `${ownerId}-${i}`, ownerId, type, position: { x, y }, alive: true, hp: UNIT_TYPES[type].hp })),
  });
}
const decide = (agent, state, player) => agent.chooseAction(state, ArenaGame.getLegalActions(state, player), ArenaGame);

// ── Reading any game as units with numbers ──────────────────────────────────

test('reads unit numbers from the game contract, unit fields, type tables or algebraic squares', () => {
  const a = readBattle(ArenaGame, ArenaGame.createInitialState(PLAYERS, {}));
  const archer = a.units.find(u => u.type === 'archer');
  assert.deepEqual([archer.attack, archer.defense, archer.range, archer.speed], [4, 2, 4, 3]);

  // A game with no unit contract: the numbers come from the unit's own fields, under
  // the usual names, or from the game's per-type table.
  const fields = readBattle({}, { units: [{ id: 'u', ownerId: 'p1', type: 'mage', position: { x: 1, y: 2 }, hp: 15, attrs: { atk: 15, attackRange: 2, moveRange: 2 } }] });
  assert.deepEqual([fields.units[0].hp, fields.units[0].attack, fields.units[0].range, fields.units[0].speed], [15, 15, 2, 2]);
  const table = readBattle({ unitStats: () => ({ mage: { hp: 15, attack: 15, defense: 1, range: 2, move: 2 } }) },
    { units: [{ id: 'u', ownerId: 'p1', type: 'mage', position: { x: 1, y: 2 } }] });
  assert.deepEqual([table.units[0].hp, table.units[0].attack, table.units[0].defense, table.units[0].range], [15, 15, 1, 2]);

  const c = ChessGame.createInitialState([{ id: 'white' }, { id: 'black' }], {});
  const pieces = readBattle(ChessGame, c).units;
  assert.ok(pieces.length === 32 && pieces.every(u => u.point && u.point.x >= 0 && u.point.x < 8));

  assert.equal(readBattle(ArenaGame, ArenaGame.createInitialState(PLAYERS, { space: 'continuous' })).metric, 'euclid');
});

test('a unit under way is judged where it is going, and a strike under way as landed', () => {
  let s = arena({ time: 'continuous' }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 1, 0]]);
  s = ArenaGame.applyActions(s, [{ playerId: 'p1', action: { type: 'attack', unitId: 'p1-0', targetId: 'p2-1' } }]);
  const v = unitView(ArenaGame, s, s.units[0]);
  assert.equal(v.striking, 'p2-1');
  const before = genericEvaluateState(ArenaGame)(arena({ time: 'continuous' }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 1, 0]]), 'p1');
  assert.ok(genericEvaluateState(ArenaGame)(s, 'p1') > before, 'the strike in progress is already worth something');
});

test('works out its seat from its legal actions when several seats are on move', () => {
  const s = arena({ time: 'continuous', simultaneousTurns: true }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  assert.deepEqual(s.activePlayers, ['p1', 'p2']);
  assert.equal(whoAmI(s, ArenaGame.getLegalActions(s, 'p2')), 'p2');
});

// ── Deciding ────────────────────────────────────────────────────────────────

test('strikes what it can kill, and plans move-then-strike within one turn', () => {
  const agent = makeGenericAgent(ArenaGame, { timeMs: 200, rng: () => 0.5 });
  // The kill is in the plan — possibly behind a step that keeps the scout in reach.
  const kill = arena({}, [['p1', 'knight', 0, 0], ['p2', 'scout', 1, 0], ['p2', 'infantry', 9, 5]]);
  decide(agent, { ...kill, units: kill.units.map(u => (u.id === 'p2-1' ? { ...u, hp: 2 } : u)) }, 'p1');
  assert.ok(agent.lastAnalysis.plan.some(a => a.type === 'attack' && a.targetId === 'p2-1'));

  const reach = arena({}, [['p1', 'cavalry', 0, 0], ['p2', 'artillery', 4, 0], ['p2', 'infantry', 9, 5]]);
  const first = decide(agent, reach, 'p1');
  assert.equal(first.type, 'move', 'gets into reach first');
  assert.ok(agent.lastAnalysis.plan.some(a => a.type === 'attack' && a.targetId === 'p2-1'), 'with the strike planned behind it');
});

test('on a clock it gives orders rather than waiting (the order is judged by where it leads)', () => {
  const agent = makeGenericAgent(ArenaGame, { timeMs: 200 });
  const s = arena({ time: 'continuous' }, [['p1', 'cavalry', 0, 0], ['p2', 'infantry', 9, 5]]);
  const a = decide(agent, s, 'p1');
  assert.equal(a.type, 'move');
});

test('calibrates the game\'s damage scale from the strikes it simulates', () => {
  const agent = makeGenericAgent(ArenaGame, { timeMs: 100 });
  const s = arena({}, [['p1', 'knight', 0, 0], ['p2', 'knight', 1, 0]]);
  decide(agent, s, 'p1');
  // Arena: ⌊36/12⌋ = 3 against the formula's 36/12 = 3, so k = 1.
  assert.ok(Math.abs(agent.lastAnalysis.damageScale - 1) < 1e-9);
});

test('under fog it remembers an enemy it lost sight of, and forgets where once it looks', () => {
  const agent = makeGenericAgent(ArenaGame, { timeMs: 50 });
  const seen = arena({ fogOfWar: true }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 3, 0]]);
  agent.chooseAction(ArenaGame.getVisibleState(seen, 'p1'), ArenaGame.getLegalActions(seen, 'p1'), ArenaGame);
  const gone = arena({ fogOfWar: true }, [['p1', 'infantry', 0, 0], ['p2', 'infantry', 9, 5]]);
  const ctx = agent._observe(ArenaGame, ArenaGame.getVisibleState(gone, 'p1'), 'p1');
  assert.equal(ctx.ghosts.length, 1);
  assert.equal(ctx.ghosts[0].point, null, '(3,0) is in view and empty: it moved');
});

// ── Playing ─────────────────────────────────────────────────────────────────

test('beats a random player in every (space × time × play) mode of Arena', async () => {
  let wins = 0, losses = 0;
  const modes = [];
  for (const space of ['discrete', 'continuous']) for (const time of ['discrete', 'continuous']) for (const sim of [false, true]) modes.push({ space, time, sim });
  for (const [i, { space, time, sim }] of modes.entries()) {
    const seat = i % 2;
    const agents = [makeGenericAgent(ArenaGame, { timeMs: 40 }), RandomAgent];
    if (seat) agents.reverse();
    const players = PLAYERS.map((p, k) => ({ ...p, agent: agents[k] }));
    const { result } = await new GameEngine(ArenaGame, players, { space, time, simultaneousTurns: sim, maxTurns: 40 }).run();
    if (result.winnerId === PLAYERS[seat].id) wins++;
    else if (result.outcome === 'win') losses++;
  }
  assert.equal(losses, 0);
  assert.ok(wins >= 6, `won ${wins} of 8`);
});

test('plays every Arena scenario, and a game it was not written for, legally', async () => {
  for (const { config } of ArenaGame.scenarios) {
    const players = PLAYERS.map(p => ({ ...p, agent: makeGenericAgent(ArenaGame, { timeMs: 20 }) }));
    const { result } = await new GameEngine(ArenaGame, players, { ...config, maxTurns: 6 }).run();
    assert.ok(result);
  }
  const chess = ChessGame.createInitialState([{ id: 'white' }, { id: 'black' }], {});
  const legal = ChessGame.getLegalActions(chess, 'white');
  const pick = makeGenericAgent(ChessGame, { timeMs: 50 }).chooseAction(chess, legal, ChessGame);
  assert.ok(legal.some(a => JSON.stringify(a) === JSON.stringify(pick)));
});
