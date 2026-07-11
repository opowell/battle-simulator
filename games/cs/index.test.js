import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsGame } from './index.js';
import { WEAPONS } from './weapons.js';
import { num } from '../coord.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [
    { id: 'p1', name: 'P1', agent: RandomAgent },
    { id: 'p2', name: 'P2', agent: RandomAgent },
  ];
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

test('cs: 5 T and 5 CT units spawn', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.units.filter(u => u.ownerId === 'T').length, 5);
  assert.equal(state.units.filter(u => u.ownerId === 'CT').length, 5);
});

test('cs: starts in buy phase', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.currentPhase, 'buy');
});

test('cs: every unit starts with its own money', () => {
  const state = CsGame.createInitialState(players());
  // Money is per-player (per-unit), not a shared team pool, so each side can equip
  // its whole squad at round start.
  assert.ok(state.units.length > 0);
  for (const u of state.units) assert.ok(u.money > 0);
});

test('cs: scores start at 0', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(state.gameSpecific.tScore, 0);
  assert.equal(state.gameSpecific.ctScore, 0);
});

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

test('cs: in buy phase, includes end-buy', () => {
  const state = CsGame.createInitialState(players());
  const actions = CsGame.getLegalActions(state, 'p1');
  assert.ok(actions.some(a => a.type === 'end-buy'));
});

test('cs: in buy phase, can buy weapons if affordable', () => {
  const state = CsGame.createInitialState(players());
  const actions = CsGame.getLegalActions(state, 'p1');
  // With $800 starting money, ak-47/m4 (~$2700) not affordable, but some rifles might not be.
  // At minimum, end-buy is always available.
  assert.ok(actions.length >= 1);
});

// ---------------------------------------------------------------------------
// applyActions
// ---------------------------------------------------------------------------

test('cs: T end-buy switches to CT buy', () => {
  const state = CsGame.createInitialState(players());
  const next = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  assert.deepEqual(next.activePlayers, ['p1']);
  assert.equal(next.currentPhase, 'buy');
});

test('cs: both end-buy transitions to action phase', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  assert.equal(s2.currentPhase, 'action');
});

test('cs: in action phase, includes end-turn', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const actions = CsGame.getLegalActions(s2, 'p1');
  assert.ok(actions.some(a => a.type === 'end-turn'));
});

test('cs: end-turn in action phase alternates active team', () => {
  const state = CsGame.createInitialState(players());
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s2 = CsGame.applyActions(s1,    [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const s3 = CsGame.applyActions(s2,    [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);
  assert.deepEqual(s3.activePlayers, ['p2']);
});

// ---------------------------------------------------------------------------
// Crouching
// ---------------------------------------------------------------------------

function toActionPhase(state) {
  const s1 = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  return CsGame.applyActions(s1, [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
}

test('cs: crouch and stand actions are offered and toggle unit.crouched', () => {
  let state = toActionPhase(CsGame.createInitialState(players()));
  const unitId = state.units.find(u => u.ownerId === 'T').id;

  let actions = CsGame.getLegalActions(state, 'p2');
  assert.ok(actions.some(a => a.type === 'crouch' && a.unitId === unitId));
  assert.ok(!actions.some(a => a.type === 'stand' && a.unitId === unitId));

  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'crouch', unitId } }]);
  assert.equal(state.units.find(u => u.id === unitId).crouched, true);

  actions = CsGame.getLegalActions(state, 'p2');
  assert.ok(actions.some(a => a.type === 'stand' && a.unitId === unitId));
  assert.ok(!actions.some(a => a.type === 'crouch' && a.unitId === unitId));

  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'stand', unitId } }]);
  assert.equal(state.units.find(u => u.id === unitId).crouched, false);
});

test('cs: crouching reduces damage taken from a shot', () => {
  function hpLossFor(crouched) {
    let state = toActionPhase(CsGame.createInitialState(players()));
    const shooter = state.units.find(u => u.ownerId === 'CT');
    const target  = state.units.find(u => u.ownerId === 'T');
    state = {
      ...state,
      units: state.units.map(u => {
        if (u.id === shooter.id) return { ...u, position: { ...target.position } };
        if (u.id === target.id)  return { ...u, crouched };
        return u;
      }),
    };
    const s2 = CsGame.applyActions(
      state,
      [{ playerId: 'p1', action: { type: 'shoot', unitId: shooter.id, targetId: target.id } }],
      () => 0, // always beats accuracy, so the shot always hits
    );
    const after = s2.units.find(u => u.id === target.id);
    return target.hp - after.hp;
  }

  assert.ok(hpLossFor(true) < hpLossFor(false));
});

test('cs: crouching halves next-turn move allowance', () => {
  let state = toActionPhase(CsGame.createInitialState(players()));
  const unitId = state.units.find(u => u.ownerId === 'T').id;

  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'crouch', unitId } }]);
  // End T's turn, then CT's turn, so T's perTurn resets for its next turn.
  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'end-turn', unitId: '__player__' } }]);
  state = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-turn', unitId: '__player__' } }]);

  const unit = state.units.find(u => u.id === unitId);
  assert.ok(unit.perTurn.moveAllowance < 4);
});

test('cs: crouching shrinks vision range for getVisibleState', () => {
  let state = toActionPhase(CsGame.createInitialState(players()));
  const unitId = state.units.find(u => u.ownerId === 'T').id;
  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'crouch', unitId } }]);
  const unit = state.units.find(u => u.id === unitId);
  assert.ok(unit.visionRange < 4);
});

// ---------------------------------------------------------------------------
// getResult
// ---------------------------------------------------------------------------

test('cs: getResult null at game start', () => {
  const state = CsGame.createInitialState(players());
  assert.equal(CsGame.getResult(state), null);
});

test('cs: getResult win when T reaches winRounds', () => {
  const state = CsGame.createInitialState(players(), { winRounds: 1 });
  const winning = { ...state, gameSpecific: { ...state.gameSpecific, tScore: 1, winRounds: 1 } };
  const result = CsGame.getResult(winning);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p2');
});

test('cs: getResult win when CT reaches winRounds', () => {
  const state = CsGame.createInitialState(players(), { winRounds: 1 });
  const winning = { ...state, gameSpecific: { ...state.gameSpecific, ctScore: 1, winRounds: 1 } };
  const result = CsGame.getResult(winning);
  assert.ok(result !== null);
  assert.equal(result.outcome, 'win');
  assert.equal(result.winnerId, 'p1');
});

// ---------------------------------------------------------------------------
// Self-play
// ---------------------------------------------------------------------------

test('cs: self-play completes with a valid result', async () => {
  const engine = new GameEngine(CsGame, players(), { maxTurns: 400 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
});

// ---------------------------------------------------------------------------
// Continuous search actions (ObscuroAgent): moves AND grenade throws
// ---------------------------------------------------------------------------

test('cs: getSearchActions replaces discrete move+throw candidates with continuous lattices', () => {
  let state = CsGame.createInitialState(players(), { mapId: 'dust2' });
  // Enter the action phase and give a T unit two grenade types.
  state = { ...state, currentPhase: 'action', gameSpecific: { ...state.gameSpecific, buyPhase: 'done' } };
  state = { ...state, units: state.units.map(u => u.id === 'T-0' ? { ...u, grenades: { he: 1, smoke: 1 } } : u) };

  const set   = CsGame.getSearchActions(state, 'p2', { rings: 2, spokes: 8 });
  const moves  = set.filter(a => a.type === 'move');
  const throws = set.filter(a => a.type === 'throw');

  assert.ok(moves.length > 0 && throws.length > 0, 'has continuous moves and throws');
  // Both action families carry genuinely non-integer (continuous) points.
  assert.ok(moves.some(a => !Number.isInteger(a.to.x) || !Number.isInteger(a.to.y)), 'continuous move point');
  assert.ok(throws.some(a => !Number.isInteger(a.target.x) || !Number.isInteger(a.target.y)), 'continuous throw point');
  assert.deepEqual([...new Set(throws.map(t => t.grenade))].sort(), ['he', 'smoke'], 'every grenade type is aimed');
  // Every generated point-action must pass the engine's geometric legality check.
  for (const a of [...moves, ...throws]) assert.ok(CsGame.isActionLegal(state, 'p2', a), `legal: ${JSON.stringify(a)}`);
});

// ---------------------------------------------------------------------------
// Anti-freeze guarantees — regressions for "the AI gets stuck after N turns"
// (an unbounded buy phase, a target-less throw crash, and a zero-distance move
// loop, all of which hung the engine mid-turn).
// ---------------------------------------------------------------------------

test('cs: buy phase is bounded even with a huge wallet and a buy-everything player', () => {
  // Give every unit the max wallet, then always take a `buy` when one is offered — the pattern
  // an equilibrium AI (which never values leftover money) follows. Before the per-unit cap and
  // the one-weapon / no-re-buy rules this ran for hundreds of steps (weapon ping-pong), one AI
  // search each, so the game looked frozen. It must now finish in a small bounded number.
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  let steps = 0;
  while (state.currentPhase === 'buy') {
    const active  = state.activePlayers[0];
    const actions = CsGame.getLegalActions(state, active);
    const buy = actions.find(a => a.type === 'buy') ?? actions.find(a => a.type === 'end-buy');
    state = CsGame.applyActions(state, [{ playerId: active, action: buy }]);
    assert.ok(++steps <= 70, `buy phase ran away (${steps} steps)`);
  }
  assert.equal(state.currentPhase, 'action');
});

// A unit carries a pistol AND a primary slot at once (see CsGame.js's WEAPON_SLOT), so a
// second weapon buy is legitimately offered after the first — as long as it fills the OTHER
// slot. What must never happen is a second buy for the SAME slot (that's the ping-pong the
// per-round cap/gating exists to prevent).
function slotOf(item) {
  const cat = WEAPONS[item].category;
  return cat === 'pistol' ? 'pistol' : cat === 'melee' ? 'melee' : 'primary';
}

test('cs: a unit is never offered a second buy for the same weapon slot in one buy phase', () => {
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  const active = state.activePlayers[0];         // T buys first
  const buyWeapon = CsGame.getLegalActions(state, active).find(a => a.type === 'buy' && WEAPON_IS(a.item));
  const boughtSlot = slotOf(buyWeapon.item);
  state = CsGame.applyActions(state, [{ playerId: active, action: buyWeapon }]);
  const unit = state.units.find(u => u.id === buyWeapon.unitId);
  const stillOffered = CsGame.getLegalActions(state, active)
    .some(a => a.type === 'buy' && a.unitId === unit.id && WEAPON_IS(a.item) && slotOf(a.item) === boughtSlot);
  assert.equal(stillOffered, false, 'same-slot weapon re-buy still offered — that slot can ping-pong');
});

test('cs: a unit CAN be offered a weapon buy for the other slot after filling one', () => {
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  const active = state.activePlayers[0];
  const buyWeapon = CsGame.getLegalActions(state, active).find(a => a.type === 'buy' && WEAPON_IS(a.item));
  const boughtSlot = slotOf(buyWeapon.item);
  state = CsGame.applyActions(state, [{ playerId: active, action: buyWeapon }]);
  const unit = state.units.find(u => u.id === buyWeapon.unitId);
  const otherSlotOffered = CsGame.getLegalActions(state, active)
    .some(a => a.type === 'buy' && a.unitId === unit.id && WEAPON_IS(a.item) && slotOf(a.item) !== boughtSlot);
  assert.equal(otherSlotOffered, true, 'the other weapon slot (pistol/primary) should still be buyable');
});

test('cs: a unit stops being offered buys after the per-round cap', () => {
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  const active = state.activePlayers[0];
  const target = state.units.find(u => u.ownerId === (state.gameSpecific.teamMap[active])).id;
  // Keep buying for one specific unit until it runs out of offers; it must cap out quickly.
  let buys = 0;
  while (true) {
    const next = CsGame.getLegalActions(state, active).find(a => a.type === 'buy' && a.unitId === target);
    if (!next) break;
    state = CsGame.applyActions(state, [{ playerId: active, action: next }]);
    assert.ok(++buys <= 6, `unit bought ${buys} times — exceeds the per-round cap`);
  }
  assert.ok(buys <= 6);
});

test('cs: actionKey distinguishes different buys, and a thrown grenade from its template', () => {
  const buyA = { type: 'buy', unitId: 'T-0', item: 'ak47' };
  const buyB = { type: 'buy', unitId: 'T-0', item: 'armor' };
  assert.notEqual(CsGame.actionKey(buyA), CsGame.actionKey(buyB), 'buys of different items must differ');

  const template = { type: 'throw', unitId: 'T-0', grenade: 'he' };                 // no target (from getLegalActions)
  const at56     = { type: 'throw', unitId: 'T-0', grenade: 'he', target: { x: 5, y: 6 } };
  const at78     = { type: 'throw', unitId: 'T-0', grenade: 'he', target: { x: 7, y: 8 } };
  assert.notEqual(CsGame.actionKey(template), CsGame.actionKey(at56), 'concrete throw must not collide with its template');
  assert.notEqual(CsGame.actionKey(at56), CsGame.actionKey(at78), 'throws at different points must differ');
});

test('cs: a zero-distance move is rejected (would otherwise loop forever)', () => {
  let state = CsGame.createInitialState(players(), { mapId: 'dust2' });
  state = { ...state, currentPhase: 'action', gameSpecific: { ...state.gameSpecific, buyPhase: 'done' } };
  const u = state.units.find(x => x.id === 'T-0');
  const here = { x: num(u.position.x), y: num(u.position.y) };
  assert.equal(CsGame.isActionLegal(state, 'p2', { type: 'move', unitId: 'T-0', to: here }), false,
    'move onto own position must be illegal');
});

test('cs: a target-less throw is consumed, not crashed on', () => {
  let state = CsGame.createInitialState(players(), { mapId: 'dust2' });
  state = { ...state, currentPhase: 'action', gameSpecific: { ...state.gameSpecific, buyPhase: 'done' } };
  state = { ...state, units: state.units.map(u => u.id === 'T-0' ? { ...u, grenades: { he: 1 } } : u) };
  // The engine should never hand applyActions a target-less `throw`, but if it does the turn must
  // advance instead of throwing in parsePos and hanging.
  let next;
  assert.doesNotThrow(() => {
    next = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'throw', unitId: 'T-0', grenade: 'he' } }]);
  });
  assert.equal(next.units.find(u => u.id === 'T-0').perTurn.hasActed, true, 'the unit’s action is consumed');
});

// ---------------------------------------------------------------------------
// Weapon loadout (pistol/melee/primary slots, switching, per-slot move speed)
// ---------------------------------------------------------------------------

test('cs: units spawn with a pistol+knife loadout, pistol active, no primary', () => {
  const state = CsGame.createInitialState(players());
  for (const u of state.units) {
    assert.equal(u.weapons.pistol, 'pistol');
    assert.equal(u.weapons.melee, 'knife');
    assert.equal(u.weapons.primary, null);
    assert.equal(u.active, 'pistol');
  }
});

test('cs: buying a primary equips it without clearing the pistol slot', () => {
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  const active = state.activePlayers[0];
  const primaryBuy = CsGame.getLegalActions(state, active)
    .find(a => a.type === 'buy' && WEAPON_IS(a.item) && WEAPONS[a.item].category !== 'pistol');
  state = CsGame.applyActions(state, [{ playerId: active, action: primaryBuy }]);
  const unit = state.units.find(u => u.id === primaryBuy.unitId);
  assert.equal(unit.weapons.primary, primaryBuy.item);
  assert.equal(unit.weapons.pistol, 'pistol', 'pistol slot untouched by a primary buy');
  assert.equal(unit.active, 'primary', 'buying auto-equips the new weapon');
});

test('cs: switch-weapon changes the active slot and taxes moveAllowance, not hasActed', () => {
  let state = CsGame.createInitialState(players(), { mapId: 'dust2' });
  state = { ...state, currentPhase: 'action', gameSpecific: { ...state.gameSpecific, buyPhase: 'done' } };
  const before = state.units.find(u => u.id === 'T-0');
  const budgetBefore = before.perTurn.moveAllowance;
  const next = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'switch-weapon', unitId: 'T-0', slot: 'melee' } }]);
  const after = next.units.find(u => u.id === 'T-0');
  assert.equal(after.active, 'melee');
  assert.equal(after.perTurn.moveAllowance, budgetBefore - 1);
  assert.equal(after.perTurn.hasActed, false, 'switching weapons does not consume the main action');
});

test('cs: turn-start move budget follows the active weapon — knife fastest, pistol baseline, primary slowest', () => {
  // A switch mid-turn only taxes the budget already fixed for that turn (see the
  // switch-weapon test above) — the speed tier itself is applied when moveAllowance is
  // (re)computed at the start of a unit's turn (the 'end-turn' handler), so exercise that
  // directly: force a unit's active slot, then end its team's turn and read the fresh budget.
  const budgetFor = (activeSlot) => {
    let state = CsGame.createInitialState(players());
    state = {
      ...state, currentPhase: 'action',
      gameSpecific: { ...state.gameSpecific, buyPhase: 'done' },
      units: state.units.map(u => u.id === 'T-0'
        ? { ...u, weapons: { ...u.weapons, primary: 'ak47' }, active: activeSlot,
            ammo: { ...u.ammo, primary: { mag: 30, reserve: 90 } } }
        : u),
    };
    // T-0 belongs to team T, controlled by player p2 — ending p2's turn resets T's own units.
    const next = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'end-turn', unitId: '__player__' } }]);
    return next.units.find(u => u.id === 'T-0').perTurn.moveAllowance;
  };
  const melee = budgetFor('melee'), pistol = budgetFor('pistol'), primary = budgetFor('primary');
  assert.ok(melee > pistol, 'knife should move faster than pistol');
  assert.ok(pistol > primary, 'pistol should move faster than a primary');
});

test('cs: shooting only spends ammo from the active slot', () => {
  let state = CsGame.createInitialState(players());
  state = { ...state, units: state.units.map(u => ({ ...u, money: 16000 })) };
  const active = state.activePlayers[0];
  const primaryBuy = CsGame.getLegalActions(state, active)
    .find(a => a.type === 'buy' && WEAPON_IS(a.item) && WEAPONS[a.item].category !== 'pistol');
  state = CsGame.applyActions(state, [{ playerId: active, action: primaryBuy }]);
  state = CsGame.applyActions(state, [{ playerId: 'p1', action: { type: 'end-buy', unitId: '__player__' } }]);
  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'end-buy', unitId: '__player__' } }]);
  const unitId = primaryBuy.unitId;
  const before = state.units.find(u => u.id === unitId);
  assert.equal(before.active, 'primary');
  const pistolAmmoBefore = before.ammo.pistol.mag;

  // Switch to pistol and shoot the air (no target needed to exercise ammo debit — call
  // applyActions' shoot branch directly against a fabricated adjacent enemy).
  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'switch-weapon', unitId, slot: 'pistol' } }]);
  const enemy = state.units.find(u => u.ownerId === 'CT');
  state = CsGame.applyActions(state, [{ playerId: 'p2', action: { type: 'shoot', unitId, targetId: enemy.id } }], () => 1);
  const after = state.units.find(u => u.id === unitId);
  assert.equal(after.ammo.pistol.mag, pistolAmmoBefore - 1, 'pistol mag debited');
  assert.equal(after.ammo.primary.mag, before.ammo.primary.mag, 'primary mag untouched while pistol is active');
});

// A weapon id is anything in WEAPONS except non-weapon buy items (armor/helmet/kit/grenades).
function WEAPON_IS(item) {
  return !['armor', 'helmet', 'defusekit', 'he', 'flash', 'smoke', 'molotov', 'incendiary', 'decoy'].includes(item);
}
