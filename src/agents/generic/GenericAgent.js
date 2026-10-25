// ---------------------------------------------------------------------------
// GenericAgent — an AI for any battle the engine can run, needing nothing from
// the game beyond the GameDefinition every game already implements.
//
// It does not use the game's evaluateState. It reads the board as units with
// numbers (battleView.js) and judges positions by material, exposure, threat
// and initiative (evaluate.js), so it plays a game that has no AI of its own —
// and plays it the same way in every corner of (space × time × play):
//
//   • It searches its OWN TURN: a beam search over sequences of its own
//     actions, each child produced by the game's real applyActions and scored
//     by the generic evaluation, until the sequence ends the turn (end-turn /
//     isTurnEnder), hands the move to another seat, or reaches the depth limit.
//     The first action of the best sequence is played, and the search runs
//     again at the next decision (receding horizon), so a turn of many actions
//     is planned as a whole — "move into range, then strike" — without the
//     game ever describing what a turn is.
//   • Discrete or continuous SPACE changes only which actions exist: it takes
//     whatever the game enumerates (a continuous-location game's lattice via
//     getSearchActions), and measures distances Euclidean or Chebyshev to match.
//   • Discrete or continuous TIME needs nothing special: in a game with its own
//     clock (games/arena) an order that leaves no decision at the instant makes
//     applyActions run the clock, so the search sees what the order leads to.
//   • Sequential or SIMULTANEOUS play changes the weighing (evaluate.js): in
//     we-go and real-time both sides' strikes land together; in I-go-you-go
//     the enemy answers first. It also works out which seat it is from its
//     legal actions, since a simultaneous instant puts several seats on move.
//   • Under FOG it remembers enemies it has seen and plays against those
//     ghosts where it last saw them, dropping one when it looks there and the
//     enemy has gone; with nothing known it marches on the enemy's start.
//   • The damage scale of the game's combat is calibrated as it plays: every
//     strike it simulates shows what the game really deals.
//
// Options: { beam, depth, timeMs, expand, aggression, noise }.
// ---------------------------------------------------------------------------

import { readBattle, unitView, distance } from './battleView.js';
import { evaluateBattle, strikeDamage, WIN } from './evaluate.js';

const DEFAULTS = {
  beam: 4,          // sequences kept per depth
  depth: 4,         // own actions looked ahead
  timeMs: 250,      // search budget per decision (the depth-1 sweep always completes)
  expand: 48,       // children tried per expanded sequence
  aggression: 1,    // scales the pull toward the enemy
  noise: 1e-4,      // tie-breaking jitter, as a share of the best value's magnitude
  minGain: 1e-3,    // an action must beat ending the turn by this share of |value|
  readyProbeMs: 0.5,// read strike readiness off the legal list when one call costs less
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function compact(a) {
  if (!a || typeof a !== 'object') return { type: String(a) };
  const c = { type: a.type ?? null };
  for (const k of ['unitId', 'from', 'to', 'targetId', 'duration', 'ability', 'at', 'facing']) if (a[k] != null) c[k] = a[k];
  return c;
}

const isTurnEnder = (game, a) => a?.type === 'end-turn' || !!game.isTurnEnder?.(a);

export class GenericAgent {
  constructor(game = null, opts = {}) {
    this.id = 'generic';
    this.game = game;
    this.opts = { ...DEFAULTS, ...opts };
    this.rng = opts.rng ?? Math.random;
    this.lastAnalysis = null;
    this._ghosts = new Map();       // seat → Map(enemy id → unitView last seen)
    this._calib = { k: null, n: 0 };
  }

  chooseAction(state, legalActions, game = this.game) {
    const g = game ?? this.game;
    const t0 = now();
    const me = whoAmI(state, legalActions);
    const actions = this._candidates(g, state, me, legalActions);
    if (!actions.length) { this.lastAnalysis = null; return undefined; }
    const ctx = this._observe(g, state, me);
    // Is the legal list cheap enough to consult at every leaf (evaluate.js
    // "Readiness")? Measured on this decision's own position.
    const p0 = now();
    try { g.getLegalActions(state, me); } catch { /* measured as slow */ }
    ctx.probeReady = now() - p0 < this.opts.readyProbeMs;
    if (actions.length === 1) {
      this.lastAnalysis = { agent: 'generic', chosen: compact(actions[0]), value: null, considered: 1 };
      return actions[0];
    }

    const { beam, depth, timeMs, expand } = this.opts;
    const deadline = t0 + timeMs;
    const best = new Map();          // index of first action → { value, seq }
    const note = (first, value, seq) => {
      const b = best.get(first);
      if (!b || value > b.value) best.set(first, { value, seq });
    };

    // Depth 1: every candidate, always.
    let frontier = [];
    let considered = 0;
    actions.forEach((a, i) => {
      const child = this._apply(g, state, me, a);
      if (!child) return;
      considered++;
      const value = this._value(g, state, child, me, a, ctx, 1);
      note(i, value, [a]);
      if (this._open(g, child, me, a)) frontier.push({ first: i, seq: [a], state: child, value });
    });

    // Deeper: extend the best few sequences with the turn's further actions —
    // and while time is left and some level had more sequences than the beam
    // kept, search again with the beam twice as wide (many tied first moves
    // can otherwise crowd out the one whose follow-up wins).
    const root = frontier;
    for (let width = beam; ; width *= 2) {
      let cut = false;
      frontier = root;
      for (let d = 2; d <= depth && frontier.length && now() < deadline; d++) {
        frontier.sort((x, y) => y.value - x.value);
        if (frontier.length > width) cut = true;
        const next = [];
        for (const node of frontier.slice(0, width)) {
          if (now() >= deadline) break;
          const kids = this._prune(this._candidates(g, node.state, me, null), expand);
          for (const a of kids) {
            if (now() >= deadline) break;
            const child = this._apply(g, node.state, me, a);
            if (!child) continue;
            considered++;
            const value = this._value(g, node.state, child, me, a, ctx, d);
            const seq = [...node.seq, a];
            note(node.first, value, seq);
            if (this._open(g, child, me, a)) next.push({ first: node.first, seq, state: child, value });
          }
        }
        frontier = next;
      }
      if (!cut || now() >= deadline) break;
    }

    let pick = null, top = -Infinity;
    const scale = Math.max(1, ...[...best.values()].map(b => Math.abs(b.value)).filter(v => v < WIN / 2));
    for (const [i, b] of best) {
      const v = b.value + (this.rng() - 0.5) * this.opts.noise * scale;
      if (v > top) { top = v; pick = i; }
    }
    if (pick == null) pick = 0;
    // Don't fidget: if ending the turn now is as good, to within minGain, end it.
    const ender = actions.findIndex(a => isTurnEnder(g, a));
    if (ender >= 0 && ender !== pick && best.has(ender)
        && best.get(ender).value >= best.get(pick).value - this.opts.minGain * scale) pick = ender;
    const chosen = actions[pick];
    this.lastAnalysis = {
      agent: 'generic',
      chosen: compact(chosen),
      value: best.get(pick)?.value ?? null,
      plan: (best.get(pick)?.seq ?? [chosen]).slice(0, 8).map(compact),
      considered,
      damageScale: this._calib.k,
      ms: Math.round(now() - t0),
    };
    return chosen;
  }

  // The actions to search. A continuous-location game advertises only
  // representatives in its legal list and the real point set in getSearchActions
  // (validated through isActionLegal); everything else is searched verbatim.
  _candidates(g, state, me, legal) {
    if (g.getSearchActions && g.isActionLegal) {
      try { return g.getSearchActions(state, me) ?? []; } catch { /* fall through */ }
    }
    if (legal) return legal;
    try { return g.getLegalActions(state, me) ?? []; } catch { return []; }
  }

  // Deeper levels try a subset: every strike, ability and turn-ender, then the
  // rest in a random order — the beam's job is to find the follow-up, not to
  // re-sweep.
  _prune(actions, cap) {
    if (actions.length <= cap) return actions;
    const keep = [], rest = [];
    for (const a of actions) (a?.targetId != null || a?.type === 'end-turn' || a?.type === 'ability' ? keep : rest).push(a);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    return [...keep, ...rest].slice(0, Math.max(cap, keep.length));
  }

  _apply(g, state, me, action) {
    try { return g.applyActions(state, [{ playerId: me, action }], this.rng) ?? null; } catch { return null; }
  }

  // May the sequence go on after `action`? Not once the turn is over, the move
  // has passed to someone else, or the game has ended.
  _open(g, child, me, action) {
    if (isTurnEnder(g, action)) return false;
    if (child.activePlayers && !child.activePlayers.includes(me)) return false;
    try { return !g.getResult?.(child); } catch { return false; }
  }

  _value(g, parent, child, me, action, ctx, depth) {
    let r = null;
    try { r = g.getResult?.(child) ?? null; } catch { r = null; }
    if (r) return r.outcome === 'draw' ? 0 : r.winnerId === me ? WIN - depth : -WIN + depth;
    if (action?.targetId != null) this._calibrate(g, parent, child, action);
    const battle = readBattle(g, child);
    const ready = ctx.probeReady ? readiness(g, child, me) : null;
    const captures = battle.units.some(u => u.exactThreats) ? threatsOf(g, child) : null;
    return evaluateBattle(battle, me, { ...ctx, ready, captures, damageScale: this._calib.k ?? undefined, turn: child.turnNumber ?? 0 });
  }

  // One observed strike: how much did the game really take off the target,
  // against the generic formula at scale 1? A running mean of that ratio is the
  // game's damage scale. Kills are skipped — they only show the hp that was left.
  _calibrate(g, parent, child, action) {
    const before = parent.units?.find(u => u.id === action.targetId);
    const after = child.units?.find(u => u.id === action.targetId);
    const attacker = parent.units?.find(u => u.id === action.unitId);
    if (!before || !after || !attacker || after.alive === false) return;
    const b = unitView(g, parent, before), a = unitView(g, child, after), atk = unitView(g, parent, attacker);
    const dealt = b.hp - a.hp;
    const formula = strikeDamage(atk, b, 1);
    if (!(dealt > 0) || !(formula > 0)) return;
    const c = this._calib;
    c.n = Math.min(c.n + 1, 50);
    c.k = c.k == null ? dealt / formula : c.k + (dealt / formula - c.k) / c.n;
  }

  // What this seat knows beyond the observation: enemies seen before and now out
  // of sight (fog), and where to march when no enemy position is known.
  _observe(g, state, me) {
    const fog = !!state.gameSpecific?.fogOfWar;
    let mem = this._ghosts.get(me);
    if (!mem) { mem = new Map(); this._ghosts.set(me, mem); }
    if (!fog) mem.clear();
    const views = (state.units ?? []).map(u => unitView(g, state, u));
    const present = new Set();
    for (const v of views) {
      if (v.owner === me) continue;
      present.add(v.id);
      if (v.alive) { if (fog) mem.set(v.id, { ...v }); } else mem.delete(v.id);
    }
    const mine = views.filter(v => v.owner === me && v.alive && v.point);
    const battle = readBattle(g, state);
    for (const [id, gst] of mem) {
      if (present.has(id) || !gst.point) continue;
      // Looked where it was and it isn't there: it moved — remember it, not where.
      const p = gst.point;
      if (mine.some(m => distance(battle.metric, m.point, p) <= m.vision)) mem.set(id, { ...gst, point: null });
    }
    // A side's survivor count (when the game keeps one) caps how many of its
    // remembered units can still be alive; the longest-unseen go first.
    const alive = state.gameSpecific?.alive;
    if (alive && typeof alive === 'object') {
      const byOwner = new Map();
      for (const v of views) if (v.owner !== me && v.alive) byOwner.set(v.owner, (byOwner.get(v.owner) ?? 0) + 1);
      for (const [id, gst] of [...mem]) {
        if (present.has(id)) continue;
        const known = byOwner.get(gst.owner) ?? 0;
        if (known >= (alive[gst.owner] ?? Infinity)) mem.delete(id);
        else byOwner.set(gst.owner, known + 1);
      }
    }
    const ghosts = [...mem.values()].filter(gst => !present.has(gst.id));
    return { ghosts, objective: objectiveOf(g, state, me), aggression: this.opts.aggression };
  }
}

// The strikes `me` may legally make in `state`: attacker id → Set(target ids).
// A strike is any legal action naming one of my units and an enemy unit as its
// target. null when the game offers `me` nothing here (not on move, say), which
// says nothing about readiness either way.
function readiness(g, state, me) {
  let legal;
  try { legal = g.getLegalActions(state, me) ?? []; } catch { return null; }
  if (!legal.length) return null;
  const owner = new Map((state.units ?? []).map(u => [u.id, u.ownerId]));
  const out = new Map();
  for (const u of state.units ?? []) if (u.ownerId === me && u.alive !== false) out.set(u.id, null);
  for (const a of legal) {
    if (a?.targetId == null || owner.get(a.unitId) !== me) continue;
    const o = owner.get(a.targetId);
    if (o == null || o === me) continue;
    if (!out.get(a.unitId)) out.set(a.unitId, new Set());
    out.get(a.unitId).add(a.targetId);
  }
  for (const [id, set] of out) if (!set) out.delete(id);
  return out;
}

// What every side's pieces threaten to take (game.threats: attacker id → target
// ids), for the units whose threats are exact (battleView `exactThreats`).
function threatsOf(g, state) {
  try { return g.threats?.(state) ?? null; } catch { return null; }
}

/** Which seat this decision is for: whoever owns the units the legal actions name. */
export function whoAmI(state, legalActions) {
  const byId = new Map((state.units ?? []).map(u => [u.id, u]));
  for (const a of legalActions ?? []) {
    const u = a?.unitId != null ? byId.get(a.unitId) : null;
    if (u?.ownerId != null) return u.ownerId;
  }
  return state.activePlayers?.[0];
}

// Where the enemy started (the common-knowledge start roster many games keep),
// else the middle of the board.
function objectiveOf(g, state, me) {
  const roster = state.gameSpecific?.startRoster;
  if (Array.isArray(roster)) {
    const pts = roster.filter(r => r.ownerId !== me).map(r => unitView(g, state, r).point).filter(Boolean);
    if (pts.length) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  const b = state.board;
  if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) return { x: b.width / 2, y: b.height / 2 };
  return null;
}

export function makeGenericAgent(game, opts = {}) {
  return new GenericAgent(game, opts);
}

/**
 * The generic evaluation as a game's evaluateState: (state, playerId) → number.
 * Lets other searches (GreedyAgent, the Obscuro search) play a game that has no
 * evaluator of its own.
 */
export function genericEvaluateState(game) {
  return (state, playerId) => {
    const battle = readBattle(game, state);
    const captures = battle.units.some(u => u.exactThreats) ? threatsOf(game, state) : null;
    return evaluateBattle(battle, playerId, { objective: objectiveOf(game, state, playerId), turn: state.turnNumber ?? 0, captures });
  };
}
