// Tests for the CS Obscuro AI: the CS leaf evaluation (eval.js) and the
// specialised agent that plugs it into the generic Obscuro search
// (ObscuroAgent.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsGame } from './index.js';
import { csEvaluate, unitValue, ROUND_WIN, CS_SEARCH_WIN } from './eval.js';
import { csLeafEval, CsObscuroAgent } from './ObscuroAgent.js';
import { ROUND_TURN_MAX, BOMB_TIMER } from './weapons.js';
import { csVisionCfg } from './belief.js';
import { isWalkable } from './map.js';
import { RandomAgent } from '../../agents/index.js';

function players() {
  return [{ id: 'p1', name: 'P1', agent: RandomAgent }, { id: 'p2', name: 'P2', agent: RandomAgent }];
}

const fresh = (config = {}) => CsGame.createInitialState(players(), config);

// Advance a buy-phase state into the action phase (both teams decline to buy).
function toActionPhase(state) {
  let s = state;
  while (s.currentPhase === 'buy') {
    const me = s.activePlayers[0];
    const end = CsGame.getLegalActions(s, me).find(a => a.type === 'end-buy');
    s = CsGame.applyActions(s, [{ playerId: me, action: end }]);
  }
  return s;
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
