// Importing ChessGame first is load-bearing, not stylistic: that module is what
// registers this engine's GameDefinition with the vendored AI (setGame) and
// points the vendored Stockfish at our evaluation cache. Anything reaching the
// agents through this file therefore gets a correctly wired AI — which is also
// why ChessGame.agents[].clientAnalyze names THIS module rather than the
// package's own: the browser analysis worker imports that module directly, and
// importing the package alone would leave the search running on the package's
// FogChess instead of the definition this server applies.
export { ChessGame } from './ChessGame.js';
export {
  ChessAgent,
  ChessObscuroAgent, ObscuroAgent, obscuroStrategy, analyzeObscuro,
} from '../../vendor/obscuro-chess/src/index.js';
