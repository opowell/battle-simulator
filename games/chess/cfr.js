// The CFR+ matrix-game solver now lives in the shared agents/ layer so that
// both the chess-specific ObscuroAgent and the generic, all-games ObscuroAgent
// can use it. Re-exported here to keep chess's existing imports stable.
export { solveMatrixGame } from '../../agents/cfr.js';
