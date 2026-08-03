// ---------------------------------------------------------------------------
// The generic Obscuro agent now lives in its own repository, vendored here as a
// git submodule at vendor/obscuro (github.com/opowell/obscuro-ai). It contains
// no game knowledge and never did, so it stands alone: zero dependencies, no
// build step, its own test suite.
//
// This file stays as the import path the rest of the repo already uses. Nothing
// game-specific belongs in it — a change to the search itself goes upstream:
//
//   cd vendor/obscuro && git checkout main && git pull   # or:
//   git submodule update --remote vendor/obscuro         # pull latest upstream
//   git add vendor/obscuro && git commit                 # pin the new commit
//
// What lives WHERE:
//   • the search, the difficulty dial, belief handling → vendor/obscuro/src/
//   • how a game describes itself to it (sampleWorlds, evaluateState, …)
//     → games/types.js here, vendor/obscuro/src/types.js upstream
//   • the fog-chess specialisation (Stockfish leaf eval, the exact belief
//     tracker) → games/chess/ObscuroAgent.js, still in this repo
// ---------------------------------------------------------------------------

export { ObscuroAgent, compactAction } from '../vendor/obscuro/src/ObscuroAgent.js';
