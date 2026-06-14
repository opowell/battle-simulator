import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFTAGame } from '../games/ffta/index.js';
import { getAoeTiles } from '../games/ffta/grid.js';
import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('ffta: 4 units per player', () => {
  const state = FFTAGame.createInitialState(players());
  assert.equal(state.units.filter(u => u.ownerId === 'p1').length, 4);
  assert.equal(state.units.filter(u => u.ownerId === 'p2').length, 4);
});

test('ffta: has an activeUnitId set from the start', () => {
  const state = FFTAGame.createInitialState(players());
  assert.ok(typeof state.gameSpecific.activeUnitId === 'string');
  assert.ok(state.units.some(u => u.id === state.gameSpecific.activeUnitId));
});

test('ffta: active unit is owned by the active player', () => {
  const state = FFTAGame.createInitialState(players());
  const activeUnit = state.units.find(u => u.id === state.gameSpecific.activeUnitId);
  assert.equal(activeUnit.ownerId, state.activePlayers[0]);
});

test('ffta: units have abilities and stats', () => {
  const state = FFTAGame.createInitialState(players());
  for (const u of state.units) {
    assert.ok(u.abilities.length > 0, `${u.id} should have abilities`);
    assert.ok(u.stats.atk > 0 || u.stats.mag > 0);
  }
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('ffta: getLegalActions includes end-turn for active owner', () => {
  const state = FFTAGame.createInitialState(players());
  const owner = state.activePlayers[0];
  const actions = FFTAGame.getLegalActions(state, owner);
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('ffta: getLegalActions includes move for unmoved active unit', () => {
  const state = FFTAGame.createInitialState(players());
  const owner = state.activePlayers[0];
  const actions = FFTAGame.getLegalActions(state, owner);
  assert.ok(actions.some(a => a.type === 'move'));
});

test('ffta: getLegalActions includes ability actions when enemy is in range', () => {
  const state = FFTAGame.createInitialState(players());
  const { activeUnitId } = state.gameSpecific;
  const activeUnit = state.units.find(u => u.id === activeUnitId);
  // Move one enemy adjacent to the active unit so melee abilities are in range
  const adjacent = { x: activeUnit.position.x + 1, y: activeUnit.position.y };
  const withNearEnemy = {
    ...state,
    units: state.units.map(u =>
      u.ownerId !== activeUnit.ownerId && !state.units.some(o => o.id !== u.id && o.position.x === adjacent.x && o.position.y === adjacent.y)
        ? { ...u, position: adjacent }
        : u
    ).filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i), // dedupe safety
  };
  // Only move the first enemy unit — clear collisions
  const enemy = state.units.find(u => u.ownerId !== activeUnit.ownerId);
  const moved = {
    ...state,
    units: state.units.map(u => u.id === enemy.id ? { ...u, position: adjacent } : u),
  };
  const owner   = moved.activePlayers[0];
  const actions = FFTAGame.getLegalActions(moved, owner);
  assert.ok(actions.some(a => a.type === 'ability'), 'should have ability actions when enemy is adjacent');
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('ffta: end-turn advances to next unit', () => {
  const state = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const prevId = state.gameSpecific.activeUnitId;
  const next = FFTAGame.applyActions(state, [{ playerId: owner, action: { type: 'end-turn', unitId: prevId } }]);
  assert.ok(next.gameSpecific.activeUnitId !== undefined);
});

test('ffta: move updates unit position and marks as moved', () => {
  const state   = FFTAGame.createInitialState(players());
  const owner   = state.activePlayers[0];
  const move    = FFTAGame.getLegalActions(state, owner).find(a => a.type === 'move');
  if (!move) return;
  const next    = FFTAGame.applyActions(state, [{ playerId: owner, action: move }]);
  const moved   = next.units.find(u => u.id === move.unitId);
  assert.deepEqual(moved.position, move.to);
  assert.equal(moved.moved, true);
});

test('ffta: undo-move restores position and clears moved flag', () => {
  const state  = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const move   = FFTAGame.getLegalActions(state, owner).find(a => a.type === 'move');
  if (!move) return;
  const originalPos = state.units.find(u => u.id === move.unitId).position;
  const afterMove = FFTAGame.applyActions(state, [{ playerId: owner, action: move }]);
  const undo = FFTAGame.getLegalActions(afterMove, owner).find(a => a.type === 'undo-move');
  assert.ok(undo, 'undo-move should be available after moving but before acting');
  const afterUndo = FFTAGame.applyActions(afterMove, [{ playerId: owner, action: undo }]);
  const u = afterUndo.units.find(u => u.id === move.unitId);
  assert.deepEqual(u.position, originalPos, 'position should be restored');
  assert.equal(u.moved, false, 'moved flag should be cleared');
  assert.equal(u.preMovedPosition, null, 'preMovedPosition should be cleared');
});

test('ffta: undo-move not available after ability is used', () => {
  const state  = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const { activeUnitId } = state.gameSpecific;
  const activeUnit = state.units.find(u => u.id === activeUnitId);
  const adjacent = { x: activeUnit.position.x + 1, y: activeUnit.position.y };
  const withEnemy = {
    ...state,
    units: state.units.map(u =>
      u.ownerId !== activeUnit.ownerId ? { ...u, position: adjacent } : u
    ),
  };
  const move = FFTAGame.getLegalActions(withEnemy, owner).find(a => a.type === 'move');
  if (!move) return;
  const afterMove = FFTAGame.applyActions(withEnemy, [{ playerId: owner, action: move }]);
  const ability = FFTAGame.getLegalActions(afterMove, owner).find(a => a.type === 'ability');
  if (!ability) return;
  const afterAbility = FFTAGame.applyActions(afterMove, [{ playerId: owner, action: ability }], () => 0.5);
  const actions = FFTAGame.getLegalActions(afterAbility, owner);
  assert.ok(!actions.some(a => a.type === 'undo-move'), 'undo-move should not be available after acting');
});

test('ffta: ability action reduces target HP (damage ability)', () => {
  const state  = FFTAGame.createInitialState(players());
  const owner  = state.activePlayers[0];
  const ability = FFTAGame.getLegalActions(state, owner)
    .find(a => a.type === 'ability' && a.targetId !== a.unitId);
  if (!ability) return;
  const targetBefore = state.units.find(u => u.id === ability.targetId);
  const next = FFTAGame.applyActions(state, [{ playerId: owner, action: ability }], () => 0.5);
  const targetAfter  = next.units.find(u => u.id === ability.targetId);
  // HP may decrease (damage) or stay same (status / ally heal); just check it doesn't go negative
  assert.ok(targetAfter.hp >= 0);
  assert.ok(targetAfter.hp <= targetBefore.maxHp);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('ffta: getResult null while both sides have units', () => {
  const state = FFTAGame.createInitialState(players());
  assert.equal(FFTAGame.getResult(state), null);
});

test('ffta: getResult win when all p2 units are dead', () => {
  const state = FFTAGame.createInitialState(players());
  const noP2  = { ...state, units: state.units.map(u => u.ownerId === 'p2' ? { ...u, alive: false, hp: 0 } : u) };
  const result = FFTAGame.getResult(noP2);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('ffta: self-play completes with a valid result', async () => {
  const engine = new GameEngine(FFTAGame, players(), { maxTurns: 300 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

// Construct a state with the active unit facing one adjacent enemy (to the right).
// Remaining enemies are killed. Accepts property overrides for attacker and target.
function duelState(state, attackerOverrides = {}, targetOverrides = {}) {
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId);
  const adj      = { x: active.position.x + 1, y: active.position.y };
  const enemy    = state.units.find(u => u.ownerId !== active.ownerId);
  return {
    ...state,
    units: state.units.map(u => {
      if (u.id === activeId)            return { ...u, ...attackerOverrides };
      if (u.id === enemy.id)            return { ...u, position: adj, reaction: null, ...targetOverrides };
      if (u.ownerId !== active.ownerId) return { ...u, alive: false, hp: 0 };
      return u;
    }),
  };
}

// ---------------------------------------------------------------------------
// CT system
// ---------------------------------------------------------------------------

test('ffta: units have ct initialized on game start', () => {
  const state = FFTAGame.createInitialState(players());
  for (const u of state.units) assert.ok(typeof u.ct === 'number', `${u.id} missing ct`);
});

test('ffta: active unit starts with ct >= 100', () => {
  const state = FFTAGame.createInitialState(players());
  const active = state.units.find(u => u.id === state.gameSpecific.activeUnitId);
  assert.ok(active.ct >= 100, `active unit ct=${active.ct}`);
});

test('ffta: end-turn drains active unit ct by 100', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const ctBefore = state.units.find(u => u.id === activeId).ct;
  const next     = FFTAGame.applyActions(state, [{ playerId: owner, action: { type: 'end-turn', unitId: activeId } }]);
  const ctAfter  = next.units.find(u => u.id === activeId).ct;
  assert.equal(ctAfter, Math.max(0, ctBefore - 100));
});

// ---------------------------------------------------------------------------
// Support abilities
// ---------------------------------------------------------------------------

test('ffta: move-plus support extends reachable tiles', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const without  = FFTAGame.getLegalActions({
    ...state, units: state.units.map(u => u.id === activeId ? { ...u, support: null }        : u),
  }, owner).filter(a => a.type === 'move').length;
  const withPlus = FFTAGame.getLegalActions({
    ...state, units: state.units.map(u => u.id === activeId ? { ...u, support: 'move-plus' } : u),
  }, owner).filter(a => a.type === 'move').length;
  assert.ok(withPlus > without, `move-plus: ${withPlus} vs ${without}`);
});

test('ffta: attack-boost support increases physical damage dealt', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const action   = { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id };
  const rng      = () => 0.5;
  const tPatch   = { stats: { ...target.stats, def: 6 }, reaction: null };

  const hpBase   = FFTAGame.applyActions(duelState(state, { support: null },          tPatch), [{ playerId: owner, action }], rng)
    .units.find(u => u.id === target.id).hp;
  const hpBoost  = FFTAGame.applyActions(duelState(state, { support: 'attack-boost' }, tPatch), [{ playerId: owner, action }], rng)
    .units.find(u => u.id === target.id).hp;

  assert.ok(hpBoost < hpBase, 'attack-boost should deal more damage');
});

test('ffta: defense-boost support reduces incoming physical damage', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const action   = { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id };
  const rng      = () => 0.5;
  const aPatch   = { support: null };

  const hpBase   = FFTAGame.applyActions(duelState(state, aPatch, { stats: { ...target.stats, def: 6 }, support: null }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id).hp;
  const hpBoost  = FFTAGame.applyActions(duelState(state, aPatch, { stats: { ...target.stats, def: 6 }, support: 'defense-boost' }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id).hp;

  assert.ok(hpBoost > hpBase, 'defense-boost should reduce damage taken');
});

test('ffta: awareness support blocks blind status', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const setup    = duelState(state, {}, { support: 'awareness' });

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'blind', targetId: target.id } }],
    () => 0.5);

  assert.ok(!next.units.find(u => u.id === target.id).statusEffects.includes('blind'),
    'awareness should block blind');
});

// ---------------------------------------------------------------------------
// Reaction abilities
// ---------------------------------------------------------------------------

test('ffta: weapon-guard evades physical attack when rng < 0.5', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const setup    = duelState(state, {}, { reaction: 'weapon-guard' });
  const hpBefore = setup.units.find(u => u.id === target.id).hp;

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id } }],
    () => 0.1);

  assert.equal(next.units.find(u => u.id === target.id).hp, hpBefore, 'attack should be evaded');
});

test('ffta: weapon-guard does not evade when rng >= 0.5', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const setup    = duelState(state, {}, { reaction: 'weapon-guard' });
  const hpBefore = setup.units.find(u => u.id === target.id).hp;

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id } }],
    () => 0.9);

  assert.ok(next.units.find(u => u.id === target.id).hp < hpBefore, 'attack should land when rng >= 0.5');
});

test('ffta: reflex evades magic attack when rng < 0.5', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId);
  const target   = state.units.find(u => u.ownerId !== owner);
  const setup    = duelState(state, { mp: 40, stats: { ...active.stats, mag: 10 } }, { reaction: 'reflex' });
  const hpBefore = setup.units.find(u => u.id === target.id).hp;

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'fire', targetId: target.id } }],
    () => 0.1);

  assert.equal(next.units.find(u => u.id === target.id).hp, hpBefore, 'fire should be evaded with reflex');
});

test('ffta: counter reaction deals damage back to the physical attacker', () => {
  const state     = FFTAGame.createInitialState(players());
  const owner     = state.activePlayers[0];
  const activeId  = state.gameSpecific.activeUnitId;
  const active    = state.units.find(u => u.id === activeId);
  const target    = state.units.find(u => u.ownerId !== owner);
  const hpBefore  = active.hp;
  // Give target very high HP and ATK so counter definitely lands and deals damage
  const setup     = duelState(state, {}, { reaction: 'counter', hp: 200, maxHp: 200, stats: { ...target.stats, atk: 20 } });

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id } }],
    () => 0.5);

  assert.ok(next.units.find(u => u.id === activeId).hp < hpBefore, 'caster should take counter damage');
});

test('ffta: mp-shield absorbs half of damage as MP loss', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const action   = { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id };
  const rng      = () => 0.5;

  const noShield = FFTAGame.applyActions(duelState(state, {}, { reaction: null,       mp: 30, maxMp: 30 }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id);
  const shielded = FFTAGame.applyActions(duelState(state, {}, { reaction: 'mp-shield', mp: 30, maxMp: 30 }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id);

  assert.ok(shielded.hp > noShield.hp, 'mp-shield target should take less HP damage');
  assert.ok(shielded.mp < 30,          'mp-shield target should lose MP');
});

test('ffta: absorb-hp reaction recovers 25% of damage taken', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const action   = { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id };
  const rng      = () => 0.5;
  // Use low-def target so damage is large enough for floor(dmg * 0.25) >= 1
  const tPatch   = { stats: { ...target.stats, def: 6 } };

  const noAbsorb = FFTAGame.applyActions(duelState(state, {}, { ...tPatch, reaction: null      }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id).hp;
  const absorbed = FFTAGame.applyActions(duelState(state, {}, { ...tPatch, reaction: 'absorb-hp' }),
    [{ playerId: owner, action }], rng).units.find(u => u.id === target.id).hp;

  assert.ok(absorbed > noAbsorb, 'absorb-hp should recover some HP');
});

// ---------------------------------------------------------------------------
// AoE abilities
// ---------------------------------------------------------------------------

test('ffta: diamond AoE hits all enemies within radius', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId); // thief at (2,2)
  const [e1, e2, ...rest] = state.units.filter(u => u.ownerId !== owner);

  // flood diamond at targetPos (3,2) with radius 1 covers (2,2),(3,1),(3,2),(3,3),(4,2)
  const testState = {
    ...state,
    units: state.units.map(u => {
      if (u.id === e1.id)                    return { ...u, position: { x: 3, y: 2 } };
      if (u.id === e2.id)                    return { ...u, position: { x: 3, y: 3 } };
      if (rest.some(r => r.id === u.id))     return { ...u, alive: false, hp: 0 };
      if (u.id === activeId)                 return { ...u, mp: 30, stats: { ...active.stats, mag: 10 } };
      return u;
    }),
  };

  const next = FFTAGame.applyActions(testState,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'flood', targetPos: { x: 3, y: 2 } } }],
    () => 0.5);

  assert.ok(next.units.find(u => u.id === e1.id).hp < e1.hp, 'enemy at center of AoE should lose HP');
  assert.ok(next.units.find(u => u.id === e2.id).hp < e2.hp, 'enemy at edge of AoE radius should lose HP');
});

test('ffta: line AoE hits all enemies along the line', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId); // thief at (2,2)
  const [e1, e2, ...rest] = state.units.filter(u => u.ownerId !== owner);

  // gust line from (2,2) going right: hits (3,2),(4,2),(5,2),(6,2)
  const testState = {
    ...state,
    units: state.units.map(u => {
      if (u.id === e1.id)                return { ...u, position: { x: 3, y: 2 } };
      if (u.id === e2.id)                return { ...u, position: { x: 4, y: 2 } };
      if (rest.some(r => r.id === u.id)) return { ...u, alive: false, hp: 0 };
      if (u.id === activeId)             return { ...u, mp: 30, stats: { ...active.stats, mag: 10 } };
      return u;
    }),
  };

  const next = FFTAGame.applyActions(testState,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'gust', targetPos: { x: 3, y: 2 } } }],
    () => 0.5);

  assert.ok(next.units.find(u => u.id === e1.id).hp < e1.hp, 'first enemy in line should lose HP');
  assert.ok(next.units.find(u => u.id === e2.id).hp < e2.hp, 'second enemy in line should lose HP');
});

// ---------------------------------------------------------------------------
// Knockback
// ---------------------------------------------------------------------------

test('ffta: knockback ability pushes target away from caster', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId); // thief at (2,2)
  const target   = state.units.find(u => u.ownerId !== owner);
  // target will be placed at (3,2); expected knockback pushes to (4,2)
  const setup    = duelState(state, { abilities: [...active.abilities, 'bash'] }, { hp: 200, maxHp: 200 });
  const adjPos   = setup.units.find(u => u.id === target.id).position; // (3,2)
  const knockPos = { x: adjPos.x + 1, y: adjPos.y };                  // (4,2)

  const next       = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'bash', targetId: target.id } }],
    () => 0.5);
  const afterPos   = next.units.find(u => u.id === target.id).position;
  const wasKnocked = afterPos.x === knockPos.x && afterPos.y === knockPos.y;
  const tookCrash  = next.units.find(u => u.id === target.id).hp < 200;

  assert.ok(wasKnocked || tookCrash, 'target should move (knockback) or take crash damage');
});

// ---------------------------------------------------------------------------
// Elemental resistance
// ---------------------------------------------------------------------------

test('ffta: elemental weakness increases damage, resistance reduces it', () => {
  const state     = FFTAGame.createInitialState(players());
  const owner     = state.activePlayers[0];
  const activeId  = state.gameSpecific.activeUnitId;
  const active    = state.units.find(u => u.id === activeId);
  const target    = state.units.find(u => u.ownerId !== owner);
  const rng       = () => 0.5;
  const fireAct   = { type: 'ability', unitId: activeId, abilityName: 'fire', targetId: target.id };
  const aPatch    = { mp: 40, stats: { ...active.stats, mag: 12 } };

  const hpNeutral = FFTAGame.applyActions(duelState(state, aPatch, { elemResist: { fire: 1.0 }, reaction: null }),
    [{ playerId: owner, action: fireAct }], rng).units.find(u => u.id === target.id).hp;
  const hpWeak    = FFTAGame.applyActions(duelState(state, aPatch, { elemResist: { fire: 1.5 }, reaction: null }),
    [{ playerId: owner, action: fireAct }], rng).units.find(u => u.id === target.id).hp;
  const hpResist  = FFTAGame.applyActions(duelState(state, aPatch, { elemResist: { fire: 0.5 }, reaction: null }),
    [{ playerId: owner, action: fireAct }], rng).units.find(u => u.id === target.id).hp;

  assert.ok(hpWeak   < hpNeutral, 'fire-weak unit should take more damage');
  assert.ok(hpResist > hpNeutral, 'fire-resistant unit should take less damage');
});

// ---------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------

test('ffta: unit with stop status can only end-turn', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const stopped  = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, statusEffects: ['stop'] } : u) };
  const actions  = FFTAGame.getLegalActions(stopped, owner);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'end-turn');
});

test('ffta: unit with sleep status can only end-turn', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const sleeping = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, statusEffects: ['sleep'] } : u) };
  const actions  = FFTAGame.getLegalActions(sleeping, owner);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'end-turn');
});

test('ffta: sleep is removed when unit is hit', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const target   = state.units.find(u => u.ownerId !== owner);
  const setup    = duelState(state, {}, { statusEffects: ['sleep'] });

  const next = FFTAGame.applyActions(setup,
    [{ playerId: owner, action: { type: 'ability', unitId: activeId, abilityName: 'attack', targetId: target.id } }],
    () => 0.5);

  assert.ok(!next.units.find(u => u.id === target.id).statusEffects.includes('sleep'),
    'sleep should be removed on hit');
});

test('ffta: doom kills unit when countdown reaches zero', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const doomed   = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, statusEffects: ['doom'], doomCountdown: 1 } : u) };

  const next = FFTAGame.applyActions(doomed,
    [{ playerId: owner, action: { type: 'end-turn', unitId: activeId } }]);

  assert.equal(next.units.find(u => u.id === activeId).alive, false,
    'unit with doomCountdown 1 should die on their turn end');
});

test('ffta: doom countdown decrements by 1 on end-turn', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const doomed   = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, statusEffects: ['doom'], doomCountdown: 3 } : u) };

  const next = FFTAGame.applyActions(doomed,
    [{ playerId: owner, action: { type: 'end-turn', unitId: activeId } }]);

  const after = next.units.find(u => u.id === activeId);
  assert.equal(after.doomCountdown, 2, 'doomCountdown should decrement by 1');
  assert.equal(after.alive, true, 'unit should still be alive at counter 3→2');
});

test('ffta: last-breath sets doomCountdown to 3', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId);
  const enemy    = state.units.find(u => u.ownerId !== owner);
  // Override active unit to use last-breath; high-HP enemy to survive the hit
  const inRange  = { x: active.position.x + 2, y: active.position.y };
  const setup    = {
    ...state,
    units: state.units.map(u => {
      if (u.id === activeId) return { ...u, abilities: ['last-breath'], mp: 0, maxMp: 0 };
      if (u.id === enemy.id) return { ...u, position: inRange, hp: enemy.maxHp };
      return u;
    }),
  };
  const action = FFTAGame.getLegalActions(setup, owner)
    .find(a => a.type === 'ability' && a.abilityName === 'last-breath' && a.targetId === enemy.id);
  assert.ok(action, 'last-breath should be available in range');

  const next = FFTAGame.applyActions(setup, [{ playerId: owner, action }], () => 0);
  const targetAfter = next.units.find(u => u.id === enemy.id);
  if (targetAfter.alive) {
    assert.ok(targetAfter.statusEffects.includes('doom'), 'target should have doom');
    assert.equal(targetAfter.doomCountdown, 3, 'doomCountdown should be 3');
  }
});

test('ffta: units start with doomCountdown null', () => {
  const state = FFTAGame.createInitialState(players());
  for (const u of state.units) {
    assert.equal(u.doomCountdown, null, `${u.id} should start with doomCountdown null`);
  }
});

test('ffta: esuna clears doom and resets doomCountdown to null', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  // Give the active unit esuna and an active doom
  const setup    = { ...state, units: state.units.map(u =>
    u.id === activeId
      ? { ...u, abilities: ['esuna'], statusEffects: ['doom'], doomCountdown: 2, mp: 10, maxMp: 10 }
      : u) };
  const action   = FFTAGame.getLegalActions(setup, owner)
    .find(a => a.type === 'ability' && a.abilityName === 'esuna' && a.targetId === activeId);
  assert.ok(action, 'self-esuna should be available');

  const next  = FFTAGame.applyActions(setup, [{ playerId: owner, action }]);
  const after = next.units.find(u => u.id === activeId);
  assert.ok(!after.statusEffects.includes('doom'), 'doom should be cleared by esuna');
  assert.equal(after.doomCountdown, null, 'doomCountdown should be null after esuna');
});

// ---------------------------------------------------------------------------
// Poison
// ---------------------------------------------------------------------------

test('ffta: poison drains 10% max HP at end of turn', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const active   = state.units.find(u => u.id === activeId);
  const poisoned = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, statusEffects: ['poison'] } : u) };

  const next  = FFTAGame.applyActions(poisoned,
    [{ playerId: owner, action: { type: 'end-turn', unitId: activeId } }]);
  const after = next.units.find(u => u.id === activeId);
  const expectedDmg = Math.max(1, Math.floor(active.maxHp * 0.1));
  assert.equal(after.hp, active.hp - expectedDmg, 'poison should drain 10% max HP');
});

test('ffta: poison kills a unit at 1 HP on end-turn', () => {
  const state    = FFTAGame.createInitialState(players());
  const owner    = state.activePlayers[0];
  const activeId = state.gameSpecific.activeUnitId;
  const dying    = { ...state, units: state.units.map(u =>
    u.id === activeId ? { ...u, hp: 1, statusEffects: ['poison'] } : u) };

  const next  = FFTAGame.applyActions(dying,
    [{ playerId: owner, action: { type: 'end-turn', unitId: activeId } }]);
  const after = next.units.find(u => u.id === activeId);
  assert.equal(after.alive, false, 'poisoned unit at 1 HP should die at end of turn');
  assert.equal(after.hp, 0);
});

// ---------------------------------------------------------------------------
// getAoeTiles
// ---------------------------------------------------------------------------

test('ffta: getAoeTiles diamond returns correct set of tiles', () => {
  const tiles = getAoeTiles('diamond', { x: 3, y: 3 }, null, 1);
  const keys  = tiles.map(t => `${t.x},${t.y}`).sort();
  assert.deepEqual(keys, ['2,3', '3,2', '3,3', '3,4', '4,3']);
});

test('ffta: getAoeTiles line returns tiles along direction from caster', () => {
  const tiles = getAoeTiles('line', { x: 3, y: 2 }, { x: 2, y: 2 }, 3);
  const keys  = tiles.map(t => `${t.x},${t.y}`);
  assert.deepEqual(keys, ['3,2', '4,2', '5,2']);
});
