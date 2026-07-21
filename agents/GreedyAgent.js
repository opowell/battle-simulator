// ---------------------------------------------------------------------------
// GreedyAgent (generic) — a low-memory, high-performance heuristic AI that runs
// for ANY game implementing the engine's GameDefinition interface.
//
// It is a 1-ply best-response: for the player to move it enumerates the legal
// actions, applies each to get the child state, scores that child with the
// game's own heuristic, and plays the highest-scoring action. No game tree, no
// belief enumeration, no CFR iterations — just O(#actions) work and memory, so
// it stays fast and light even on the biggest boards.
//
// Every game-specific judgement is borrowed from the exact same hook bundle the
// Obscuro search uses (agents/obscuro/search.js `makeHooks`), so the greedy
// agent honours the identical conventions:
//   • legal        — getSearchActions (continuous games) else getLegalActions
//   • apply        — game.applyActions for one { playerId, action }
//   • terminalValue — a decisive win/loss/draw from game.getResult, so a mating
//                     / game-ending move is always preferred over any heuristic
//   • evalChildren — game.evaluateLeaves (batch) else per-child evaluateState,
//                     each a value TO THE MOVER (positive = good for the mover)
//
// Graceful degradation (no game changes required):
//   • no evaluateState  → every non-terminal child scores 0, so it plays the
//                         first legal action unless a move wins/loses outright.
//   • + evaluateState   → genuine greedy heuristic play.
// ---------------------------------------------------------------------------

import { makeHooks } from './obscuro/search.js';

// A tiny compact projection for the AI-analysis panel — mirrors the shape the
// ObscuroAgent publishes, so the UI can render the chosen move uniformly.
function compact(a) {
  if (!a || typeof a !== 'object') return { type: String(a) };
  const c = { type: a.type ?? null };
  if (a.unitId != null) c.unitId = a.unitId;
  if (a.from != null) c.from = a.from;
  if (a.to != null) c.to = a.to;
  if (a.targetId != null) c.targetId = a.targetId;
  if (a.isCapture) c.isCapture = true;
  if (a.side != null) c.side = a.side;
  return c;
}

/**
 * Choose greedily for the player to move (state.activePlayers[0]). `game` is the
 * GameDefinition; the engine passes it as the 3rd chooseAction argument, and the
 * factory below also binds it so the agent works when driven directly.
 */
export function greedyChoose(state, legalActions, game, rng = Math.random) {
  const mover = state.activePlayers?.[0];
  if (mover == null) return legalActions?.[0];

  const hooks = makeHooks(game, mover, { rng });
  // Continuous-location games (getSearchActions) advertise only representatives in
  // legalActions, so ask hooks.legal for the real search set. For every other game
  // the engine hands us the AUTHORITATIVE legal list it will validate against —
  // use it verbatim. Re-enumerating would desync games that bake per-call RNG into
  // their actions (e.g. kdice's pre-rolled dice), producing an "illegal action".
  const actions = (game.getSearchActions || game.getSearchLegalActions)
    ? hooks.legal(state, mover)
    : (legalActions ?? game.getLegalActions?.(state, mover) ?? []);
  if (!actions || actions.length === 0) return undefined;
  if (actions.length === 1) return actions[0];

  // Apply each candidate once; a null child (illegal / threw) scores -Infinity.
  const childStates = actions.map(a => hooks.apply(state, mover, a));

  // Score the surviving children in one batch so games with a vectorised
  // evaluateLeaves (e.g. a learned net) pay a single call, then override any
  // terminal child with its decisive game-result value.
  const values = new Array(actions.length).fill(-Infinity);
  const idx = [], keptActions = [], keptChildren = [];
  actions.forEach((a, i) => {
    if (childStates[i] != null) { idx.push(i); keptActions.push(a); keptChildren.push(childStates[i]); }
  });
  const heur = keptChildren.length ? hooks.evalChildren(state, mover, keptActions, keptChildren) : [];
  idx.forEach((origI, k) => {
    const tv = hooks.terminalValue(keptChildren[k]);
    values[origI] = tv != null ? tv : (heur[k] ?? 0);
  });

  // argmax with a random tie-break so repeated games don't play out identically.
  let bestIdx = 0, bestVal = values[0], ties = 1;
  for (let i = 1; i < actions.length; i++) {
    if (values[i] > bestVal) { bestVal = values[i]; bestIdx = i; ties = 1; }
    else if (values[i] === bestVal && rng() < 1 / ++ties) { bestIdx = i; }
  }
  return { action: actions[bestIdx], value: bestVal };
}

/**
 * Build a GreedyAgent bound to a game. Matches the ObscuroAgent construction site
 * in api-server.js (`new`-free factory is fine — the agent holds no per-move
 * state beyond the last analysis it publishes for the AI panel).
 */
export function makeGreedyAgent(game) {
  const agent = {
    id: 'greedy',
    lastAnalysis: null,
    chooseAction(state, legalActions, g = game) {
      const picked = greedyChoose(state, legalActions, g);
      // greedyChoose returns {action,value} in the normal (>1 action) path and a
      // bare action in the trivial paths; normalise both.
      const action = picked && typeof picked === 'object' && 'action' in picked ? picked.action : picked;
      const value  = picked && typeof picked === 'object' && 'value'  in picked ? picked.value  : null;
      agent.lastAnalysis = action == null ? null : { agent: 'greedy', chosen: compact(action), value };
      return action;
    },
  };
  return agent;
}

// A game-agnostic singleton that reads the GameDefinition from the engine-supplied
// 3rd chooseAction argument. Lets callers who don't want to construct a per-game
// instance (e.g. quick scripts) still use the greedy policy with zero allocation.
export const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions, game) {
    const picked = greedyChoose(state, legalActions, game);
    return picked && typeof picked === 'object' && 'action' in picked ? picked.action : picked;
  },
};
