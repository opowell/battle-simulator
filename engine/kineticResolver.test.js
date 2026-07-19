import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './index.js';
import { interceptTime } from './kinetics.js';

// ---------------------------------------------------------------------------
// DuelGame: free-form 2-D kinetic sandbox. Orders are constructed directly by
// the scripted agents (isActionLegal accepts anything sane), carrying their
// own duration / projectile speed, so tests can set up exact scenarios.
// ---------------------------------------------------------------------------

const DuelGame = {
  name: 'duel',

  createInitialState(players, config = {}) {
    return {
      gameName: 'duel',
      turnNumber: 1,
      activePlayers: [players[0].id],
      currentPhase: 'action',
      players,
      board: {},
      units: (config.units ?? []).map(u => ({ alive: true, hp: 2, ...u })),
      lastActions: null,
      gameSpecific: { contacts: [] },
    };
  },

  getLegalActions(_state, _playerId) {
    return [{ type: 'end-turn', unitId: '__player__' }];
  },

  isActionLegal(state, playerId, action) {
    if (action.type === 'end-turn') return true;
    const u = state.units.find(x => x.id === action.unitId);
    if (!u || !u.alive || u.ownerId !== playerId) return false;
    if (action.type === 'attack') {
      const t = state.units.find(x => x.id === action.targetId);
      return !!t && t.alive;
    }
    return action.type === 'move';
  },

  getActionDuration(_state, action) { return action.duration ?? 1; },
  getProjectileSpeed(_state, action) { return action.projSpeed; },

  applyActions(state, playerActions) {
    const { playerId, action } = playerActions[0];
    if (action.type === 'end-turn') {
      const ids = state.players.map(p => p.id);
      const nextIdx = (ids.indexOf(playerId) + 1) % ids.length;
      return { ...state, activePlayers: [ids[nextIdx]],
        turnNumber: nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber, lastActions: playerActions };
    }
    if (action.type === 'move') {
      return { ...state, lastActions: playerActions,
        units: state.units.map(u => u.id === action.unitId ? { ...u, position: { ...action.to } } : u) };
    }
    if (action.type === 'attack') {
      return { ...state, lastActions: playerActions,
        units: state.units.map(u => u.id === action.targetId
          ? { ...u, hp: u.hp - 1, alive: u.hp - 1 > 0 } : u) };
    }
    return state;
  },

  getResult: () => null,
  renderState: () => '',
};

// Agent that plays a fixed list of constructed actions, then ends the turn.
function playbook(actions) {
  const script = [...actions];
  return { id: 'playbook', chooseAction: (_s, legal) => script.shift() ?? legal.find(a => a.type === 'end-turn') };
}

function duel(config, aActions, bActions) {
  const players = [
    { id: 'a', name: 'a', agent: playbook(aActions) },
    { id: 'b', name: 'b', agent: playbook(bActions) },
  ];
  return new GameEngine(DuelGame, players, { simultaneousTurns: true, ...config });
}

const attackEntries = (log) => log.filter(e => e.playerActions[0]?.action.type === 'attack');

// ---------------------------------------------------------------------------

test('projectile intercepts a moving target at the exact solved time', async () => {
  // Shooter at origin; target starts at (3,0) moving +y at speed 1. Projectile
  // speed 2, target radius 0.35 — impact time must equal interceptTime's root.
  const engine = duel(
    { units: [
      { id: 's', ownerId: 'a', type: 'gunner', position: { x: 0, y: 0 } },
      { id: 'r', ownerId: 'b', type: 'runner', position: { x: 3, y: 0 } },
    ] },
    [{ type: 'attack', unitId: 's', targetId: 'r', duration: 5, projSpeed: 2 }],
    [{ type: 'move', unitId: 'r', from: { x: 3, y: 0 }, to: { x: 3, y: 8 }, duration: 8 }],
  );
  engine._init();
  await engine.step();

  const expected = interceptTime(0, 0, 2, { x0: 3, y0: 0, vx: 0, vy: 1, tRef: 0 }, 0.35, 0).t;
  const hits = attackEntries(engine.log);
  assert.equal(hits.length, 1);
  assert.ok(Math.abs(hits[0].t1 - expected) < 1e-6, `impact at ${hits[0].t1}, expected ${expected}`);
  assert.equal(engine.state.units.find(u => u.id === 'r').hp, 1);
  // The projectile appears in playback frames while in flight.
  assert.ok(engine.playback.frames.some(f => f.projectiles?.length));
});

test('projectile misses a target it can never catch', async () => {
  // Target flees at speed 3; projectile speed 1 → no intercept → the attack
  // fizzles at its nominal duration and deals no damage.
  const engine = duel(
    { units: [
      { id: 's', ownerId: 'a', type: 'gunner', position: { x: 0, y: 0 } },
      { id: 'r', ownerId: 'b', type: 'runner', position: { x: 3, y: 0 } },
    ] },
    [{ type: 'attack', unitId: 's', targetId: 'r', duration: 2, projSpeed: 1 }],
    [{ type: 'move', unitId: 'r', from: { x: 3, y: 0 }, to: { x: 30, y: 0 }, duration: 9 }],
  );
  engine._init();
  await engine.step();

  assert.equal(attackEntries(engine.log).length, 0);
  assert.equal(engine.state.units.find(u => u.id === 'r').hp, 2);
});

test('intercept is re-solved when the target changes velocity mid-flight', async () => {
  // Initially unhittable (target flees at 2 > projectile speed 1), but the
  // target's short sprint ends at t=1 — the projectile re-leads the now
  // stationary target and lands after all.
  const engine = duel(
    { units: [
      { id: 's', ownerId: 'a', type: 'gunner', position: { x: 0, y: 0 } },
      { id: 'r', ownerId: 'b', type: 'runner', position: { x: 3, y: 0 } },
    ] },
    [{ type: 'attack', unitId: 's', targetId: 'r', duration: 20, projSpeed: 1 }],
    [{ type: 'move', unitId: 'r', from: { x: 3, y: 0 }, to: { x: 5, y: 0 }, duration: 1 }],
  );
  engine._init();
  await engine.step();

  const hits = attackEntries(engine.log);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].t1 > 1, 'impact only after the target stopped');
  // Projectile flew straight at speed 1 the whole way; it lands on the disk
  // edge at x = 5 − 0.35, so flight time ≈ 4.65.
  assert.ok(Math.abs(hits[0].t1 - 4.65) < 0.05, `impact at ${hits[0].t1}`);
  assert.equal(engine.state.units.find(u => u.id === 'r').hp, 1);
});

test('one seat\'s units execute their lanes in parallel', async () => {
  // One player orders two units to move (1s each) — both arrive at t=1, and
  // the seat's end-turn runs only after both lanes drain (t=1, not t=2).
  const engine = duel(
    { units: [
      { id: 'u1', ownerId: 'a', type: 'w', position: { x: 0, y: 0 } },
      { id: 'u2', ownerId: 'a', type: 'w', position: { x: 0, y: 2 } },
      { id: 'e', ownerId: 'b', type: 'w', position: { x: 9, y: 9 } },
    ] },
    [
      { type: 'move', unitId: 'u1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, duration: 1 },
      { type: 'move', unitId: 'u2', from: { x: 0, y: 2 }, to: { x: 1, y: 2 }, duration: 1 },
    ],
    [],
  );
  engine._init();
  await engine.step();

  const moves = engine.log.filter(e => e.playerActions[0]?.action.type === 'move');
  assert.equal(moves.length, 2);
  assert.ok(moves.every(m => Math.abs(m.t1 - 1) < 1e-9), 'both moves complete at t=1');
  const endTurns = engine.log.filter(e => e.playerActions[0]?.action.type === 'end-turn' && e.playerActions[0].playerId === 'a');
  assert.equal(endTurns.length, 1);
  assert.ok(Math.abs(endTurns[0].t0 - 1) < 1e-9, 'end-turn starts once all lanes drained');
});

test('unit-unit contact stops both movers at the exact touch instant', async () => {
  const ContactGame = {
    ...DuelGame,
    // Commit the exact contact positions so the units stay where they collided.
    onUnitContact(state, aId, bId, { t, positions }) {
      return {
        ...state,
        units: state.units.map(u => positions[u.id] ? { ...u, position: { ...positions[u.id] } } : u),
        gameSpecific: { contacts: [...state.gameSpecific.contacts, { aId, bId, t }] },
      };
    },
  };
  const players = [
    { id: 'a', name: 'a', agent: playbook([{ type: 'move', unitId: 'u1', from: { x: 0, y: 0 }, to: { x: 4, y: 0 }, duration: 4 }]) },
    { id: 'b', name: 'b', agent: playbook([{ type: 'move', unitId: 'u2', from: { x: 4, y: 0 }, to: { x: 0, y: 0 }, duration: 4 }]) },
  ];
  const engine = new GameEngine(ContactGame, players, { simultaneousTurns: true,
    units: [
      { id: 'u1', ownerId: 'a', type: 'walker', position: { x: 0, y: 0 } },
      { id: 'u2', ownerId: 'b', type: 'walker', position: { x: 4, y: 0 } },
    ] });
  engine._init();
  await engine.step();

  // Disks r=0.35 closing at combined speed 2 over gap 4−0.7 → touch at t=1.65.
  const contacts = engine.state.gameSpecific.contacts;
  assert.equal(contacts.length, 1);
  assert.ok(Math.abs(contacts[0].t - 1.65) < 1e-6, `contact at ${contacts[0].t}`);
  // Both moves were cancelled — neither unit reached its destination.
  assert.equal(engine.log.filter(e => e.playerActions[0]?.action.type === 'move').length, 0);
  // Both game state and playback leave them stopped at the touch points,
  // symmetric about x=2 with their disks exactly meeting.
  const s1 = engine.state.units.find(u => u.id === 'u1'), s2 = engine.state.units.find(u => u.id === 'u2');
  assert.ok(Math.abs(s1.position.x - 1.65) < 1e-6 && Math.abs(s2.position.x - 2.35) < 1e-6);
  const last = engine.playback.frames[engine.playback.frames.length - 1];
  const u1 = last.units.find(u => u.id === 'u1'), u2 = last.units.find(u => u.id === 'u2');
  assert.ok(Math.abs(u1.x - 1.65) < 1e-6 && Math.abs(u2.x - 2.35) < 1e-6);
});
