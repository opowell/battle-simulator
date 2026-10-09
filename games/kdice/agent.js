// ---------------------------------------------------------------------------
// The KDice AI.
//
// The generic agents played KDice badly in one particular way: they attacked
// whenever the dice happened to fall their way in the one world they looked at
// (greedy applies an attack with ONE sampled roll; Obscuro did the same before
// the game exposed chance outcomes), and they valued a position by little more
// than territories + dice — so a 3-on-4 attack that throws a stack away looked as
// good as one that wins, and a stack sitting on a border next to an enemy 8 looked
// as safe as one in the interior. They threw their dice at every neighbour and
// had nothing left when the counter-attack came.
//
// This agent plays one attack (or ends its turn) per decision:
//   • every attack is priced at its EXACT odds (odds.js), as the expectation over
//     its two outcomes — win: the stack moves in and the source drops to one die;
//     lose: the source drops to one die — of a position value;
//   • the position value (evaluatePosition) is what the next turns hinge on: the
//     largest connected region (it IS the income), the dice on the board after this
//     turn's reinforcement is dealt, the dice left over in reserve, territories held
//     — minus what the neighbours are likely to take back, at their own exact odds
//     against the stacks this player will be left with. Opponents are valued the same
//     way and subtracted, so cutting the leader's region is worth something too;
//   • it ends the turn when no attack is worth its expected cost. With dice in
//     reserve a failed attack is cheap (the reserve refills the stack), so it keeps
//     attacking from full territories; without, it waits and lets the stacks grow.
// ---------------------------------------------------------------------------

import { MAX_DICE, DEFAULT_STOCK_MAX, winProbability } from './odds.js';

// Position weights (see evaluatePosition).
export const WEIGHTS = {
  region: 2.0,     // per territory in the largest connected region (= dice per turn)
  dice: 0.6,       // per die on the board after this turn's reinforcement
  stock: 0.4,      // per die left in reserve after it
  territory: 1.0,  // per territory held
  threat: 0.6,     // how much of a neighbour's chance to take a territory counts
  leader: 0.5,     // share of the opponents' value that is the best opponent's
  margin: 0.05,    // an attack must be worth more than this to be played
  chain: 0.8,      // how much a won attack's best follow-up from the captured territory counts
};

function largestRegion(owner, territories, adjacency, without = null) {
  const seen = new Set();
  let best = [];
  for (const [id, t] of Object.entries(territories)) {
    if (t.owner !== owner || id === without || seen.has(id)) continue;
    const region = [id];
    seen.add(id);
    for (let i = 0; i < region.length; i++) {
      for (const nid of adjacency[region[i]] ?? []) {
        if (nid === without || seen.has(nid) || territories[nid]?.owner !== owner) continue;
        seen.add(nid);
        region.push(nid);
      }
    }
    if (region.length > best.length) best = region;
  }
  return best;
}

/**
 * One player's standing, in the units the weights above are in: what they earn,
 * what they have to fight with once this turn's dice are dealt, and what they stand
 * to lose to their neighbours' next attacks.
 */
function playerValue(state, owner, w) {
  const { territories, adjacency } = state.board;
  const gs = state.gameSpecific ?? {};
  const owned = [];
  for (const t of Object.values(territories)) if (t.owner === owner) owned.push(t);
  if (!owned.length) return 0;

  const region = largestRegion(owner, territories, adjacency);
  const inRegion = new Set(region);
  const stockMax = gs.stockMax ?? DEFAULT_STOCK_MAX;
  const pool = Math.min(stockMax, (gs.stock?.[owner] ?? 0) + region.length);
  let dice = 0, room = 0, open = 0;
  for (const t of owned) {
    dice += t.dice ?? 0;
    if ((t.dice ?? 0) < MAX_DICE) { room += MAX_DICE - t.dice; open++; }
  }
  const placed = Math.min(pool, room);
  // Only the part of the reserve that next turn's income will not push over the cap
  // is worth anything: past that, a die kept back now is a die thrown away later. So a
  // player sitting on a full reserve loses nothing by spending it — which is exactly
  // when it should be attacking from full stacks.
  const left = Math.max(0, Math.min(pool - placed, stockMax - region.length));
  // Reinforcement is dealt one die at a time to random territories with room, so on
  // average each open territory gets an equal share of what is placed.
  const share = open ? placed / open : 0;

  let risk = 0;
  for (const t of owned) {
    const after = Math.min(MAX_DICE, (t.dice ?? 0) + ((t.dice ?? 0) < MAX_DICE ? share : 0));
    let worst = 0;
    for (const nid of adjacency[t.id] ?? []) {
      const e = territories[nid];
      if (!e || e.owner == null || e.owner === owner || (e.dice ?? 0) < 2) continue;
      // Interpolate the odds at a fractional stack (the expected reinforcement).
      const lo = Math.floor(after), f = after - lo;
      const p = (1 - f) * winProbability(e.dice, lo) + f * winProbability(e.dice, Math.min(MAX_DICE, lo + 1));
      if (p > worst) worst = p;
    }
    if (worst < 0.02) continue;
    // Losing it costs the territory, its dice, and — if it holds the main region
    // together — the part of the region it cuts off.
    let regionLoss = 0;
    if (inRegion.has(t.id)) {
      regionLoss = region.length - largestRegion(owner, territories, adjacency, t.id).length;
    }
    risk += worst * (w.territory + w.dice * after + w.region * regionLoss);
  }

  return w.region * region.length + w.dice * (dice + placed) + w.stock * left
    + w.territory * owned.length - w.threat * risk;
}

/**
 * How good `state` is for `playerId`: their own value less the opponents' — half
 * the best opponent's, half the average, so a lone runaway leader is worth cutting
 * down and the rest of the table still counts. A won or lost game is ±1e6.
 */
export function evaluatePosition(state, playerId, w = WEIGHTS) {
  const territories = Object.values(state.board.territories);
  const known = territories.filter(t => t.owner != null);
  if (known.length === territories.length && known.every(t => t.owner === playerId)) return 1e6;
  if (!known.some(t => t.owner === playerId)) return -1e6;
  const out = state.gameSpecific?.eliminatedPlayers ?? [];
  const mine = playerValue(state, playerId, w);
  let best = 0, sum = 0, n = 0;
  for (const p of state.players ?? []) {
    if (p.id === playerId || out.includes(p.id)) continue;
    const v = playerValue(state, p.id, w);
    if (v > best) best = v;
    sum += v; n++;
  }
  if (!n) return mine;
  return mine - (w.leader * best + (1 - w.leader) * sum / n);
}

// The two outcomes of an attack, as the minimal states evaluatePosition reads.
function outcome(state, action, won) {
  const { territories } = state.board;
  const from = territories[action.from];
  const to = territories[action.to];
  const next = { ...territories, [action.from]: { ...from, dice: 1 } };
  let gs = state.gameSpecific;
  if (won) {
    next[action.to] = { ...to, owner: from.owner, dice: from.dice - 1 };
    if (!Object.values(next).some(t => t.owner === to.owner)) {
      gs = { ...gs, eliminatedPlayers: [...(gs.eliminatedPlayers ?? []), to.owner] };
    }
  }
  return { ...state, board: { ...state.board, territories: next }, gameSpecific: gs };
}

// An attack's worth over standing pat, as the expectation of its two outcomes. A win
// leaves a stack in the captured territory that can strike again at once, and that
// is often the point of the first blow (two steps to join a cut-off territory to the
// main region); `depth` looks that one follow-up ahead, from the captured territory.
function attackValue(state, me, action, base, w, depth) {
  const { territories } = state.board;
  const from = territories[action.from], to = territories[action.to];
  const p = winProbability(from.dice, to.dice);
  const won = outcome(state, action, true);
  let vWin = evaluatePosition(won, me, w);
  if (depth > 0 && from.dice - 1 >= 2 && vWin < 1e5) {
    let follow = 0;
    for (const nid of state.board.adjacency[action.to] ?? []) {
      const n = won.board.territories[nid];
      if (!n || n.owner == null || n.owner === me) continue;
      const next = { type: 'attack', unitId: action.to, from: action.to, to: nid };
      follow = Math.max(follow, attackValue(won, me, next, vWin, w, depth - 1));
    }
    vWin += w.chain * follow;
  }
  const vLose = p < 1 ? evaluatePosition(outcome(state, action, false), me, w) : 0;
  return p * vWin + (1 - p) * vLose - base;
}

/**
 * Every attack open to the player to move, with its odds and expected worth over
 * ending the turn now, best first.
 */
export function rankAttacks(state, legalActions, w = WEIGHTS) {
  const me = state.activePlayers?.[0];
  const { territories } = state.board;
  const base = evaluatePosition(state, me, w);
  const ranked = [];
  for (const action of legalActions ?? []) {
    if (action.type !== 'attack') continue;
    const from = territories[action.from], to = territories[action.to];
    if (!from || !to || from.owner !== me || to.owner == null) continue;
    const p = winProbability(from.dice, to.dice);
    if (p <= 0.02) continue;
    ranked.push({ action, p, value: attackValue(state, me, action, base, w, w.chain > 0 ? 1 : 0) });
  }
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

/** Build a KDice agent, optionally with its own weights (for tuning and tests). */
export function makeKDiceAgent(weights = WEIGHTS) {
  const w = { ...WEIGHTS, ...weights };
  const agent = {
    id: 'kdice',
    lastAnalysis: null,
    chooseAction(state, legalActions) {
      const endTurn = legalActions.find(a => a.type === 'end-turn') ?? legalActions[0];
      const ranked = rankAttacks(state, legalActions, w);
      const best = ranked[0];
      const play = best && best.value > w.margin ? best.action : endTurn;
      agent.lastAnalysis = {
        agent: 'kdice',
        player: state.activePlayers?.[0],
        chosen: { type: play.type, from: play.from, to: play.to },
        value: best && play === best.action ? best.value : 0,
        candidates: ranked.slice(0, 5).map(r => ({ from: r.action.from, to: r.action.to, p: +r.p.toFixed(3), value: +r.value.toFixed(2) })),
      };
      return play;
    },
  };
  return agent;
}

export const KDiceAgent = makeKDiceAgent();
