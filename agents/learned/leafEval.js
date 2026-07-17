// ---------------------------------------------------------------------------
// Learned leaf evaluation installer (agents/LEARNED-EVAL-PLAN.md).
//
// `installLearnedEval(game, modelUrl)` loads games/<game>/model.json if it
// exists and, ONLY then, rewires the game's evaluation hooks to the learned
// value network:
//
//   • evaluateState(state, p)  → tanh(f(φ(state,p)) − f(φ(state,opp))) ∈ (−1,1)
//   • evaluateLeaves(...)      → the same, batched over child states (what the
//                                Obscuro search actually consumes)
//   • winValue                 → 1  (the paper's u: Z → [−1,+1] scale)
//   • staticEvaluateState      → the original hand heuristic, kept for the
//                                training script's bootstrap/adjudication
//
// With no model file this is a NO-OP: the game keeps its hand heuristic, so
// wiring the call into every game's index.js carries zero regression risk —
// whether a game uses a learned eval is decided entirely by whether
// `node agents/learned/train.mjs` produced (and gated) a model for it.
//
// Models embed the encoder version; a mismatch refuses to load (falls back to
// the static eval) rather than silently mis-featurizing.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MLP } from './mlp.js';
import { encodeState, opponentOf, ENCODER_VERSION } from './encoder.js';

/**
 * @param {object} game  the GameDefinition to (maybe) rewire — mutated in place
 * @param {string} modelUrl  import.meta.url of the game's index.js; the model
 *   is looked up as ./model.json next to it
 * @returns {boolean} whether a learned eval was installed
 */
export function installLearnedEval(game, modelUrl) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(fileURLToPath(new URL('./model.json', modelUrl)), 'utf8'));
  } catch { return false; } // no model — keep the hand heuristic
  if (spec.encoderVersion !== ENCODER_VERSION) return false; // stale featurizer
  let net;
  try { net = MLP.fromJSON(spec.net); } catch { return false; }
  wireNet(game, net);
  game.learnedEval = { trainedAt: spec.trainedAt, gate: spec.gate };
  return true;
}

/**
 * Rewire a game(-clone)'s evaluation hooks onto a value net. Shared by the
 * model loader above and the training script (which wires candidate nets onto
 * throwaway clones for self-play and gate matches).
 */
export function wireNet(game, net) {
  const value = (state, playerId) => {
    const opp = opponentOf(state, playerId);
    const fa = net.f(encodeState(game, state, playerId));
    const fb = opp != null ? net.f(encodeState(game, state, opp)) : 0;
    return Math.tanh(fa - fb);
  };
  game.staticEvaluateState = game.staticEvaluateState ?? game.evaluateState;
  game.evaluateState = value;
  game.evaluateLeaves = (state, mover, actions, ctx = {}) =>
    (ctx.childStates ?? []).map(cs => (cs ? value(cs, mover) : 0));
  game.winValue = 1;
  return game;
}
