// Tests for the CS Obscuro AI: the CS leaf evaluation (eval.js) and the
// specialised agent that plugs it into the generic Obscuro search
// (ObscuroAgent.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsGame } from './index.js';
import { csEvaluate, unitValue, ROUND_WIN, CS_SEARCH_WIN } from './eval.js';
import { csLeafEval, CsObscuroAgent } from './ObscuroAgent.js';
import { ROUND_TURN_MAX, BOMB_TIMER, SMOKE_RADIUS, smokeOval, FIRE_RADIUS, fireOval, inZone } from './weapons.js';
import { csVisionCfg, csLosLayers } from './belief.js';
import { isWalkable } from './map.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [{ id: 'p1', name: 'P1', agent: RandomAgent }, { id: 'p2', name: 'P2', agent: RandomAgent }];
}

const fresh = (config = {}) => CsGame.createInitialState(players(), config);

// Advance a buy-phase state into the action phase (both teams decline to buy).
// In the we-go model both teams buy in the SAME turn, so the phase only advances
// once BOTH have ended their buy; then the engine runs beginTurn to open the first
// action turn (fresh per-turn budgets), which we mirror here.
function toActionPhase(state) {
  let s = state;
  for (const team of ['T', 'CT']) {
    const pid = s.gameSpecific.teamPlayerMap[team];
    const end = CsGame.getLegalActions(s, pid).find(a => a.type === 'end-buy');
    s = CsGame.applyActions(s, [{ playerId: pid, action: end }]);
  }
  return CsGame.beginTurn(s);
}

const setGs = (s, gs) => ({ ...s, gameSpecific: { ...s.gameSpecific, ...gs } });

// Find two open tiles `gap` apart on the same row with clear line of sight between
// them. The maps are real authored layouts (the middle of de_dust2 is a wall), so a
// duel fixture has to locate an actual sightline rather than assume one.
function openSightline(state, gap = 3) {
  const map = state.gameSpecific.map;
  const cfg = csVisionCfg(map, []);
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1 - gap; x++) {
      if (!isWalkable(map.tiles, x, y) || !isWalkable(map.tiles, x + gap, y)) continue;
      if (cfg.hasLOS(x, y, x + gap, y)) return { a: { x, y }, b: { x: x + gap, y } };
    }
  }
  throw new Error('no open sightline found on this map');
}

// ---------------------------------------------------------------------------
// eval.js — the CS node heuristic
// ---------------------------------------------------------------------------

test('cs eval: antisymmetric between the two teams', () => {
  const s = fresh();
  assert.ok(Math.abs(csEvaluate(s, 'T') + csEvaluate(s, 'CT')) < 1e-9);
});

test('cs eval: a decided round dominates every positional term', () => {
  const s = fresh();
  // Wipe CT: T has won the round outright.
  const wiped = { ...s, units: s.units.map(u => u.ownerId === 'CT' ? { ...u, alive: false } : u) };
  assert.equal(csEvaluate(wiped, 'T'), ROUND_WIN);
  assert.equal(csEvaluate(wiped, 'CT'), -ROUND_WIN);
});

test('cs eval: a planted bomb favours T, and more so as it ticks down', () => {
  const s = toActionPhase(fresh());
  const site = { x: 5, y: 5 };
  const planted = t => setGs(s, { bomb: { planted: true, plantedAt: site, timer: t, defuseProgress: 0, defuseNeeded: 2 } });

  const before = csEvaluate(s, 'T');
  const justPlanted = csEvaluate(planted(BOMB_TIMER), 'T');
  const nearlyDone  = csEvaluate(planted(1), 'T');

  assert.ok(justPlanted > before, 'planting should favour T');
  assert.ok(nearlyDone > justPlanted, 'a bomb closer to detonation should favour T more');
});

test('cs eval: defuse progress favours CT', () => {
  const s = toActionPhase(fresh());
  const bomb = p => setGs(s, {
    bomb: { planted: true, plantedAt: { x: 5, y: 5 }, timer: 5, defuseProgress: p, defuseNeeded: 2 },
  });
  assert.ok(csEvaluate(bomb(1), 'CT') > csEvaluate(bomb(0), 'CT'));
});

test('cs eval: the round clock pressures T while the bomb is not down', () => {
  const s = toActionPhase(fresh());
  const early = csEvaluate(setGs(s, { roundEndTurns: 0 }), 'T');
  const late  = csEvaluate(setGs(s, { roundEndTurns: ROUND_TURN_MAX - 1 }), 'T');
  assert.ok(late < early, 'T should be worse off as an unplanted round runs down');
});

test('cs eval: losing a unit costs about that unit’s value', () => {
  const s = toActionPhase(fresh());
  const victim = s.units.find(u => u.ownerId === 'T');
  const dead = { ...s, units: s.units.map(u => u.id === victim.id ? { ...u, alive: false } : u) };
  const loss = csEvaluate(s, 'T') - csEvaluate(dead, 'T');
  // Angle terms shift a little too, so this is a band, not an equality.
  assert.ok(loss > unitValue(victim) * 0.5, `losing a unit should cost real value (was ${loss})`);
});

test('cs eval: holding an angle beats being held at one', () => {
  const s = toActionPhase(fresh());
  const { a, b } = openSightline(s);
  // One T and one CT in clear sight of each other, everyone else off the board.
  const [t0] = s.units.filter(u => u.ownerId === 'T');
  const [c0] = s.units.filter(u => u.ownerId === 'CT');
  const place = (u, p, facing) => ({ ...u, position: { ...p }, facing, alive: true });

  // T at `a`, CT at `b` (to its +x). Facing 0 looks toward +x, PI looks away.
  const tHoldsAngle = { ...s, units: [place(t0, a, 0), place(c0, b, 0)] };            // T faces CT, CT faces away
  const ctHoldsAngle = { ...s, units: [place(t0, a, Math.PI), place(c0, b, Math.PI)] }; // CT faces T, T faces away

  assert.ok(csEvaluate(tHoldsAngle, 'T') > csEvaluate(ctHoldsAngle, 'T'),
    'facing the enemy should beat having your back to them');
});

// ---------------------------------------------------------------------------
// ObscuroAgent.js — the leaf evaluator plugged into the generic search
// ---------------------------------------------------------------------------

// Regression: the search identifies the mover by PLAYER id, while eval.js reasons
// in TEAM ids. csLeafEval must translate. Before it did, every unit read as an
// enemy and the leaf value came back as the exact negation of the truth — the AI
// scored buying armor as a loss and refused to buy anything.
test('cs leaf eval: translates the search’s player id to a team id', () => {
  const s = toActionPhase(fresh());
  const { teamPlayerMap } = s.gameSpecific;
  const tPlayer = teamPlayerMap['T'];

  const [byPlayerId] = csLeafEval(s, tPlayer, [null], [s]);
  const [byTeamId]   = csLeafEval(s, 'T',     [null], [s]);
  assert.equal(byPlayerId, byTeamId);

  // And it agrees in SIGN with the game's own (withTeam-wrapped) evaluateState.
  assert.ok(byPlayerId * CsGame.evaluateState(s, tPlayer) > 0);
});

test('cs leaf eval: a unit under unanswered fire is priced as partly lost', () => {
  const s = toActionPhase(fresh());
  const { a, b } = openSightline(s);
  const [t0] = s.units.filter(u => u.ownerId === 'T');
  const [c0] = s.units.filter(u => u.ownerId === 'CT');

  // CT (at `b`, facing back down the line toward T) holds a clean angle; T is
  // looking the other way and cannot answer.
  const exposed = { ...s, units: [
    { ...t0, position: { ...a }, facing: Math.PI, alive: true },
    { ...c0, position: { ...b }, facing: Math.PI, alive: true },
  ] };
  // Same geometry, but CT is looking away too — nobody holds an unanswered angle.
  const safe = { ...s, units: [
    { ...t0, position: { ...a }, facing: Math.PI, alive: true },
    { ...c0, position: { ...b }, facing: 0, alive: true },
  ] };

  const [vExposed] = csLeafEval(s, 'T', [null], [exposed]);
  const [vSafe]    = csLeafEval(s, 'T', [null], [safe]);
  assert.ok(vExposed < vSafe, 'walking into an unanswered angle must score worse');
});

test('cs leaf eval: never exceeds the round-win clamp', () => {
  const s = toActionPhase(fresh());
  const wiped = { ...s, units: s.units.map(u => u.ownerId === 'CT' ? { ...u, alive: false } : u) };
  const [v] = csLeafEval(s, 'T', [null], [wiped]);
  assert.ok(Math.abs(v) <= ROUND_WIN);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('cs: the game declares the specialised Obscuro agent under the id "obscuro"', () => {
  const entry = CsGame.agents?.find(a => a.id === 'obscuro');
  assert.ok(entry, 'CsGame must declare an obscuro agent so it overrides the generic builtin');
  assert.ok(entry.agent instanceof CsObscuroAgent);
  assert.equal(entry.agent._winValue(), CS_SEARCH_WIN);
});

test('cs: the agent picks a legal action in the action phase, under fog', async () => {
  const s = toActionPhase(fresh({ fogOfWar: true }));
  const me = s.activePlayers[0];
  const legal = CsGame.getLegalActions(s, me);
  const agent = new CsObscuroAgent({ particles: 2, timeBudgetMs: 200, maxRounds: 3 });

  const action = await agent.chooseAction(s, legal);
  assert.ok(action, 'agent returned no action');
  // Either one of the enumerated legal actions, or a continuous point the game
  // validates geometrically (the search reasons over a continuous lattice).
  const key = CsGame.actionKey(action);
  const ok = legal.some(a => CsGame.actionKey(a) === key) || CsGame.isActionLegal(s, me, action);
  assert.ok(ok, `agent chose an illegal action: ${JSON.stringify(action)}`);
});

test('cs: the agent buys on the pistol round instead of declining', async () => {
  // With money to spend and no cost assigned to hoarding it, equipping is free
  // value — the AI should take it. (This failed outright under the player-id/team-id
  // bug above: every buy scored as a loss.)
  const s = fresh({ fogOfWar: true });
  const me = s.activePlayers[0];
  const agent = new CsObscuroAgent({ particles: 2, timeBudgetMs: 300, maxRounds: 4 });
  const action = await agent.chooseAction(s, CsGame.getLegalActions(s, me));
  assert.equal(action.type, 'buy');
});

// ---------------------------------------------------------------------------
// Smoke: what you see must be what hides you.
//
// The sight-blocking cloud (belief.js's csLosLayers) and the drawn cloud
// (CsGame's renderState) were written out separately and had drifted apart — the
// drawn one was radius r+0.5 centred half a unit down-right of the one that
// actually blocked line of sight, so a player standing in visibly thick smoke was
// plainly visible. Both derive from weapons.js's smokeOval now; this pins them.
// ---------------------------------------------------------------------------

test('cs smoke: the drawn cloud is exactly the cloud that blocks sight', () => {
  const s = toActionPhase(fresh());
  const { a } = openSightline(s, 6);
  const smoke = { x: a.x + 3, y: a.y, turnsLeft: 5 };
  const withSmoke = setGs(s, { smokeZones: [smoke] });

  // The blocking geometry, as belief.js builds it: the one solid oval that is not
  // part of the map (walls/border are rects or polys authored by the map).
  const mapLayers = csLosLayers(s.gameSpecific.map, []);
  const blocker = csLosLayers(s.gameSpecific.map, [smoke]).slice(mapLayers.length)[0];
  assert.ok(blocker && blocker.shape === 'oval' && blocker.solid, 'expected a solid smoke oval among the LOS layers');

  // The drawn geometry, exactly as the client receives it (toGrid().shapes) — no
  // fallback, or this would pass whatever renderState emitted.
  const drawn = (CsGame.toGrid(withSmoke).shapes ?? []).filter(sh => sh.fill === '#9098a0');
  assert.equal(drawn.length, 1, 'expected exactly one drawn smoke cloud');

  for (const k of ['x', 'y', 'w', 'h']) {
    assert.equal(drawn[0][k], blocker[k], `drawn smoke ${k} must match the sight-blocking smoke`);
  }
  // And both must be the shared definition, not a coincidental match.
  const want = smokeOval(smoke.x, smoke.y);
  for (const k of ['x', 'y', 'w', 'h']) assert.equal(drawn[0][k], want[k]);
});

test('cs smoke: a unit inside the drawn cloud is actually hidden by it', () => {
  const s = toActionPhase(fresh());
  const { a, b } = openSightline(s, 6);
  // Smoke centred on the midpoint of a known-clear sightline.
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, turnsLeft: 5 };

  const clear = csVisionCfg(s.gameSpecific.map, []);
  assert.equal(clear.hasLOS(a.x, a.y, b.x, b.y), true, 'fixture sightline should start clear');

  const smoked = csVisionCfg(s.gameSpecific.map, [mid]);
  assert.equal(smoked.hasLOS(a.x, a.y, b.x, b.y), false, 'smoke on the line must block it');
});

// ---------------------------------------------------------------------------
// Fire pools are continuous.
//
// Molotov/incendiary used to snap to a tile and burn the (2r+1)² square around
// it, while the client drew a round pool on top — so the square's corners burned
// invisibly, and a molotov landing at x.9 burned a square centred most of a unit
// from where it visibly landed. Both sides are one disc about the exact throw
// point now (weapons.js's fireOval / inZone).
// ---------------------------------------------------------------------------

// Advance one full turn boundary — where fire burns, timers tick and budgets reset
// (see CsGame.beginTurn). Under the we-go model end-turn itself is just a no-op
// terminator; the once-per-turn upkeep now lives in beginTurn.
function endTurn(state) {
  return CsGame.beginTurn(state);
}

// Put one unit of each team at chosen points, so a round can't end mid-test.
function withUnitsAt(state, tAt, ctAt) {
  const [t0] = state.units.filter(u => u.ownerId === 'T');
  const [c0] = state.units.filter(u => u.ownerId === 'CT');
  return { ...state, units: [
    { ...t0, position: { x: tAt.x, y: tAt.y }, alive: true, hp: 100 },
    { ...c0, position: { x: ctAt.x, y: ctAt.y }, alive: true, hp: 100 },
  ] };
}

test('cs fire: a unit inside the pool burns, one just outside does not', () => {
  const s = toActionPhase(fresh());
  const { a, b } = openSightline(s, 20);
  const fire = { x: a.x, y: a.y, turnsLeft: 3 };

  // T stands dead centre; CT stands a hair beyond the radius.
  const inside  = { x: a.x, y: a.y };
  const outside = { x: a.x + FIRE_RADIUS + 0.2, y: a.y };
  const staged = setGs(withUnitsAt(s, inside, b), { fireZones: [fire] });

  const after = endTurn(staged);
  const t = after.units.find(u => u.ownerId === 'T');
  assert.ok(t.hp < 100, `unit in the pool should burn, hp=${t.hp}`);

  const staged2 = setGs(withUnitsAt(s, outside, b), { fireZones: [fire] });
  const after2 = endTurn(staged2);
  const t2 = after2.units.find(u => u.ownerId === 'T');
  assert.equal(t2.hp, 100, 'a unit beyond the radius must not burn');
});

test('cs fire: the burn follows the exact throw point, not its tile', () => {
  const s = toActionPhase(fresh());
  const { a, b } = openSightline(s, 20);
  // Thrown to the far edge of a tile. Under the old tile-snapping burn, the pool
  // was centred on the tile and this unit — 1.2 away from the real point but
  // inside the old square — burned regardless of where the molotov actually fell.
  const fire = { x: a.x + 0.95, y: a.y + 0.95, turnsLeft: 3 };
  const far  = { x: a.x + 0.95 - (FIRE_RADIUS + 0.3), y: a.y + 0.95 };

  const staged = setGs(withUnitsAt(s, far, b), { fireZones: [fire] });
  const t = endTurn(staged).units.find(u => u.ownerId === 'T');
  assert.equal(t.hp, 100, 'burn must be measured from the throw point, not its tile');

  // …and a unit the same distance on the other side, inside the disc, does burn.
  const near = { x: a.x + 0.95 + FIRE_RADIUS * 0.5, y: a.y + 0.95 };
  const t2 = endTurn(setGs(withUnitsAt(s, near, b), { fireZones: [fire] })).units.find(u => u.ownerId === 'T');
  assert.ok(t2.hp < 100, `unit inside the disc should burn, hp=${t2.hp}`);
});

test('cs fire: the drawn pool is exactly the pool that burns', () => {
  const s = toActionPhase(fresh());
  const fire = { x: 20.4, y: 18.6, turnsLeft: 3 };
  const drawn = (CsGame.toGrid(setGs(s, { fireZones: [fire] })).shapes ?? [])
    .filter(sh => sh.fill === '#c85a2a');
  assert.equal(drawn.length, 1, 'expected exactly one drawn fire pool');

  const want = fireOval(fire.x, fire.y);
  for (const k of ['x', 'y', 'w', 'h']) assert.equal(drawn[0][k], want[k], `drawn fire ${k}`);

  // Every corner of the drawn box that lies outside the disc must not burn, and
  // the centre must — i.e. the drawing is the disc, not a square.
  assert.equal(inZone(fire.x, fire.y, fire.x, fire.y, FIRE_RADIUS), true);
  assert.equal(inZone(want.x, want.y, fire.x, fire.y, FIRE_RADIUS), false, 'box corner is outside the disc');
});
