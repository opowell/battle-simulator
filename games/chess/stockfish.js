// ---------------------------------------------------------------------------
// The Stockfish backend moved out with the rest of the fog-chess AI: it now
// lives in vendor/obscuro-chess (github.com/opowell/obscuro-chess), engine
// binaries and all. This file stays as the import path the repo already uses,
// and does one thing of its own — point the engine at THIS repo's evaluation
// cache.
//
// WHY THE CACHE STAYED BEHIND. It is derived data (multiPV is deterministic
// given fen+depth+multipv, so results keep indefinitely), there is ~50 MB of it,
// and it is ours: tens of thousands of positions from games played here. That is
// not something to ship inside a public package and re-download on every clone,
// so the package takes a cache directory instead and we hand it ./vendor, where
// the warm cache already sits. Node only — in a browser the cache is in-memory
// and setCacheDir is a no-op.
//
// The call has to happen before the first search opens the cache, which is why
// it is a module-level side effect rather than something a caller must remember.
// ChessGame.js imports this module for exactly that reason.
// ---------------------------------------------------------------------------

import { setCacheDir } from '../../vendor/obscuro-chess/src/stockfish.js';

setCacheDir(new URL('./vendor/', import.meta.url));

export * from '../../vendor/obscuro-chess/src/stockfish.js';
