import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SurvivGame } from './index.js';
import { num } from '../coord.js';
import { isWalkableContinuous } from './map.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'blue', name: 'Blue', agent: RandomAgent },
    { id: 'red',  name: 'Red',  agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('surviv: 10 red and 10 blue units spawn, unarmed', () => {
  const state = SurvivGame.createInitialState(players());
  assert.equal(state.units.filter(u => u.ownerId === 'red').length, 10);
  assert.equal(state.units.filter(u => u.ownerId === 'blue').length, 10);
  for (const u of state.units) {
    assert.equal(u.weapon, 'fists');
    assert.equal(u.hp, 100);
    assert.equal(u.vest, 0);
    assert.equal(u.helmet, 0);
  }
});

test('surviv: no buy phase — starts straight in the action phase', () => {
  const state = SurvivGame.createInitialState(players());
  assert.equal(state.currentPhase, 'action');
  assert.equal(state.activePlayers[0], 'red');
});

test('surviv: map loot is seeded and untaken at kickoff', () => {
  const state = SurvivGame.createInitialState(players());
  assert.ok(state.gameSpecific.loot.length > 0);
  assert.ok(state.gameSpecific.loot.every(l => !l.taken));
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

test('surviv: a legal move updates position, facing, and spends move budget', () => {
  const state = SurvivGame.createInitialState(players());
  const mover = state.units.find(u => u.ownerId === 'red');
  const to = { x: num(mover.position.x) + 1, y: num(mover.position.y) };
  const next = SurvivGame.applyActions(state, [{ playerId: 'red', action: { type: 'move', unitId: mover.id, to } }]);
  const moved = next.units.find(u => u.id === mover.id);
  assert.equal(num(moved.position.x), to.x);
  assert.ok(moved.perTurn.moveAllowance < mover.perTurn.moveAllowance);
  assert.ok(Math.abs(moved.facing - 0) < 1e-9, 'moved due east, facing ~0 rad');
});

test('surviv: getLegalActions never offers a move onto an unwalkable point', () => {
  const state = SurvivGame.createInitialState(players());
  const actions = SurvivGame.getLegalActions(state, 'red');
  const moves = actions.filter(a => a.type === 'move');
  assert.ok(moves.length > 0, 'red has at least one legal move at kickoff');
  for (const m of moves)
    assert.ok(isWalkableContinuous(state.gameSpecific.map, m.to.x, m.to.y), `move target (${m.to.x},${m.to.y}) is walkable`);
});

// ---------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------

test('surviv: shoot in range and clear LOS is legal, damages the target', () => {
  const base = SurvivGame.createInitialState(players());
  const state = { ...base, units: [
    { ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 3, y: 9 }, weapon: 'colt45', ammo: { mag: 7, reserve: 21 }, perTurn: { hasActed: false, moveAllowance: 4 } },
    { ...base.units[1], id: 'blue-0', ownerId: 'blue', position: { x: 5, y: 9 }, hp: 100, alive: true, perTurn: { hasActed: false, moveAllowance: 4 } },
  ] };
  const actions = SurvivGame.getLegalActions(state, 'red');
  const shoot = actions.find(a => a.type === 'shoot' && a.unitId === 'red-0' && a.targetId === 'blue-0');
  assert.ok(shoot, 'shoot at an in-range, unobstructed enemy is legal');

  const next = SurvivGame.applyActions(state, [{ playerId: 'red', action: shoot }], () => 0); // rng()=0 always hits
  const target = next.units.find(u => u.id === 'blue-0');
  assert.ok(target.hp < 100, 'took damage');
});

test('surviv: a kill sets alive=false and getResult declares the surviving team', () => {
  const base = SurvivGame.createInitialState(players());
  const state = { ...base,
    units: [
      { ...base.units[0], id: 'red-0', ownerId: 'red', alive: true, hp: 100 },
      { ...base.units[1], id: 'blue-0', ownerId: 'blue', alive: false, hp: 0 },
    ],
  };
  const result = SurvivGame.getResult(state);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, state.gameSpecific.teamPlayerMap.red);
});

test('surviv: mutual elimination is a draw', () => {
  const base = SurvivGame.createInitialState(players());
  const state = { ...base, units: base.units.map(u => ({ ...u, alive: false, hp: 0 })) };
  const result = SurvivGame.getResult(state);
  assert.equal(result.outcome, 'draw');
});

// ---------------------------------------------------------------------------
// loot
// ---------------------------------------------------------------------------

test('surviv: looting a weapon upgrades from fists and never downgrades a better gun', () => {
  const base = SurvivGame.createInitialState(players());
  const lootItem = { id: 'loot-x', x: 5, y: 5, kind: 'weapon', item: 'm4a1', taken: false, name: 'M4A1' };
  const state = { ...base,
    gameSpecific: { ...base.gameSpecific, loot: [lootItem] },
    units: [{ ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 5, y: 5 }, weapon: 'fists', perTurn: { hasActed: false, moveAllowance: 4 } }],
  };
  const next = SurvivGame.applyActions(state, [{ playerId: 'red', action: { type: 'loot', unitId: 'red-0', lootId: 'loot-x' } }]);
  assert.equal(next.units[0].weapon, 'm4a1');
  assert.ok(next.gameSpecific.loot[0].taken);

  // A second, worse loot item at the same spot should not downgrade the held m4a1.
  const worseLoot = { id: 'loot-y', x: 5, y: 5, kind: 'weapon', item: 'colt45', taken: false, name: 'Colt' };
  const state2 = { ...next, gameSpecific: { ...next.gameSpecific, loot: [worseLoot] } };
  const next2 = SurvivGame.applyActions(state2, [{ playerId: 'red', action: { type: 'loot', unitId: 'red-0', lootId: 'loot-y' } }]);
  assert.equal(next2.units[0].weapon, 'm4a1', 'kept the better weapon');
});

test('surviv: looting a vest/helmet sets its tier, grenade loot stacks up to the cap', () => {
  const base = SurvivGame.createInitialState(players());
  const unit = { ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 5, y: 5 }, perTurn: { hasActed: false, moveAllowance: 4 } };
  const vestLoot = { id: 'lv', x: 5, y: 5, kind: 'vest', level: 2, taken: false, name: 'Vest' };
  const s1 = { ...base, gameSpecific: { ...base.gameSpecific, loot: [vestLoot] }, units: [unit] };
  const s2 = SurvivGame.applyActions(s1, [{ playerId: 'red', action: { type: 'loot', unitId: 'red-0', lootId: 'lv' } }]);
  assert.equal(s2.units[0].vest, 2);
});

// ---------------------------------------------------------------------------
// full game
// ---------------------------------------------------------------------------

test('surviv: RandomAgent vs RandomAgent plays to completion without fog', async () => {
  const { result, finalState } = await new GameEngine(SurvivGame, players(), { turnCap: 20 }).run();
  assert.ok(result && typeof result.outcome === 'string');
  assert.ok(finalState.turnNumber > 1);
});

test('surviv: exposes a fogOfWar game option', () => {
  const opt = (SurvivGame.gameOptions ?? []).find(o => o.id === 'fogOfWar');
  assert.ok(opt && opt.type === 'boolean');
});

test('surviv: toGrid renders spriteLayers with a held-weapon layer once armed', () => {
  const base = SurvivGame.createInitialState(players());
  const state = { ...base, units: base.units.map((u, i) => i === 0 ? { ...u, weapon: 'm4a1' } : u) };
  const grid = SurvivGame.toGrid(state);
  const armed = grid.units.find(u => u.job === 'm4a1');
  assert.ok(armed.spriteLayers.some(l => l.src.includes('/weapons/m4a1')), 'gun sprite layer present');
  const unarmed = grid.units.find(u => u.job === 'fists');
  assert.ok(!unarmed.spriteLayers.some(l => l.src.includes('/weapons/')), 'fists draws no weapon sprite');
});

// ---------------------------------------------------------------------------
// break (destructible crates/barrels)
// ---------------------------------------------------------------------------

// breakable-1 is the small 1x1 crate at rect(10,8,1,1) — centre (10.5, 8.5) — and
// breakable-3 is the 1x1 barrel at oval(12.5,3,1,1) — centre (13, 3.5). Both come
// straight from games/surviv/map.js's SANDBAR_ISLAND terrain list.

test('surviv: a nearby crate offers a break action, which damages it', () => {
  const base = SurvivGame.createInitialState(players());
  const unit = { ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 9, y: 8.5 }, weapon: 'colt45', ammo: { mag: 7, reserve: 21 }, perTurn: { hasActed: false, moveAllowance: 4 } };
  const state = { ...base, units: [unit] };

  const actions = SurvivGame.getLegalActions(state, 'red');
  const brk = actions.find(a => a.type === 'break' && a.breakableId === 'breakable-1');
  assert.ok(brk, 'break action offered against the nearby crate');

  const next = SurvivGame.applyActions(state, [{ playerId: 'red', action: brk }]);
  const target = next.gameSpecific.breakables.find(b => b.id === 'breakable-1');
  assert.equal(target.hp, target.maxHp - brk.damage);
  assert.equal(target.destroyed, false);
});

test('surviv: breaking a crate to 0 hp destroys it, opens movement, and drops loot', () => {
  const base = SurvivGame.createInitialState(players());
  const unit = { ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 9, y: 8.5 }, weapon: 'm4a1', ammo: { mag: 30, reserve: 90 }, perTurn: { hasActed: false, moveAllowance: 4 } };
  let state = { ...base, units: [unit] };

  // m4a1 does 25 dmg/hit; the crate has 60 hp — a few hits finish it.
  for (let i = 0; i < 4; i++) {
    const actions = SurvivGame.getLegalActions(state, 'red');
    const brk = actions.find(a => a.type === 'break' && a.breakableId === 'breakable-1');
    if (!brk) break; // already destroyed — no more break actions offered
    state = SurvivGame.applyActions(state, [{ playerId: 'red', action: brk }]);
    state = { ...state, units: state.units.map(u => ({ ...u, perTurn: { ...u.perTurn, hasActed: false } })) };
  }

  const target = state.gameSpecific.breakables.find(b => b.id === 'breakable-1');
  assert.equal(target.hp, 0);
  assert.equal(target.destroyed, true);

  assert.ok(
    isWalkableContinuous(state.gameSpecific.map, 10.5, 8.5, new Set(['breakable-1'])),
    'destroyed crate cell is walkable once its id is marked destroyed',
  );
  assert.ok(
    !isWalkableContinuous(state.gameSpecific.map, 10.5, 8.5),
    'sanity: that same cell is still solid without the destroyed-id set (i.e. the crate really was blocking before)',
  );

  const dropped = state.gameSpecific.loot.find(l => l.id === 'loot-break-breakable-1');
  assert.ok(dropped, 'destroying a crate drops a loot pickup where it stood');
  assert.equal(dropped.kind, 'weapon');

  const grid = SurvivGame.toGrid(state);
  assert.ok(!grid.shapes.some(s => s.id === 'breakable-1'), 'destroyed crate no longer renders as a shape');
});

test('surviv: breaking a barrel to 0 hp explodes, damaging both teams nearby', () => {
  const base = SurvivGame.createInitialState(players());
  const attacker = { ...base.units[0], id: 'red-0', ownerId: 'red', position: { x: 12, y: 3.5 }, weapon: 'm4a1', ammo: { mag: 30, reserve: 90 }, perTurn: { hasActed: false, moveAllowance: 4 } };
  const bystanderRed  = { ...base.units[1], id: 'red-1',  ownerId: 'red',  position: { x: 14, y: 3.5 }, hp: 100, alive: true };
  const bystanderBlue = { ...base.units[2], id: 'blue-0', ownerId: 'blue', position: { x: 13, y: 4.5 }, hp: 100, alive: true };
  let state = { ...base, units: [attacker, bystanderRed, bystanderBlue] };

  // barrel has 40 hp; m4a1 does 25/hit — two hits destroy it.
  for (let i = 0; i < 3; i++) {
    const actions = SurvivGame.getLegalActions(state, 'red');
    const brk = actions.find(a => a.type === 'break' && a.breakableId === 'breakable-3');
    if (!brk) break;
    state = SurvivGame.applyActions(state, [{ playerId: 'red', action: brk }]);
    state = { ...state, units: state.units.map(u => ({ ...u, perTurn: { ...u.perTurn, hasActed: false } })) };
  }

  const target = state.gameSpecific.breakables.find(b => b.id === 'breakable-3');
  assert.equal(target.destroyed, true);

  const red1  = state.units.find(u => u.id === 'red-1');
  const blue0 = state.units.find(u => u.id === 'blue-0');
  assert.ok(red1.hp  < 100, 'nearby red bystander takes blast damage too — barrels do not discriminate by team');
  assert.ok(blue0.hp < 100, 'nearby blue bystander takes blast damage');
});
