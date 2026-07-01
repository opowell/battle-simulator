// Obscuro demo — a unified, equilibrium-based chess AI that treats perfect
// information as the special case of an information set of size one.
//
// Usage:
//   node demo/obscuro-demo.js            # obscuro vs obscuro, perfect info
//   node demo/obscuro-demo.js --fog      # obscuro vs obscuro, fog of war
//   node demo/obscuro-demo.js --fog --vs random   # obscuro (white) vs random
//
// It first prints Obscuro's opening strategy with information OFF vs ON, to show
// the contrast: full information collapses to a single (minimax) move, while fog
// of war yields a *mixed* strategy — the randomisation/bluffing the paper is about.

import { GameEngine } from '../engine/index.js';
import { ChessGame, ObscuroAgent, obscuroStrategy } from '../games/chess/index.js';
import { available as stockfishAvailable } from '../games/chess/stockfish.js';
import { RandomAgent } from '../agents/index.js';

const fog = process.argv.includes('--fog');
const vsIdx = process.argv.indexOf('--vs');
const opponent = vsIdx >= 0 ? process.argv[vsIdx + 1] : 'obscuro';

const fmt = a => (a.type === 'castle'
  ? `O-O${a.side === 'queenside' ? '-O' : ''}`
  : `${a.from}${a.isCapture ? 'x' : '-'}${a.to}${a.payload?.promote ? '=' + a.payload.promote[0].toUpperCase() : ''}`);

// ---- Show the opening strategy with information OFF vs ON --------------------
function showOpeningStrategy(difficulty) {
  for (const fogOn of [false, true]) {
    const players = [{ id: 'white', name: 'W', agent: ObscuroAgent }, { id: 'black', name: 'B', agent: ObscuroAgent }];
    const state = ChessGame.createInitialState(players, { fogOfWar: fogOn, difficulty });
    const view = ChessGame.getVisibleState(state, 'white');
    const legal = ChessGame.getLegalActions(state, 'white');
    const { mode, dist, rows, action, particles } = obscuroStrategy(view, legal);
    const top = rows
      .map((a, i) => ({ a, p: dist[i] ?? 0 }))
      .filter(x => x.p > 0.01)
      .sort((x, y) => y.p - x.p);
    console.log(`\n  ${fogOn ? 'Fog of war ON ' : 'Information ON'} (${mode}, ${particles} world${particles === 1 ? '' : 's'}):`);
    for (const { a, p } of top) console.log(`    ${fmt(a).padEnd(7)} ${(p * 100).toFixed(0)}%`);
    console.log(`    → plays ${fmt(action)}`);
  }
}

console.log('Obscuro opening strategy — same agent, different information levels:');
showOpeningStrategy('medium');

// ---- Stockfish backend status + the actual perfect-info move it plays --------
const sfOn = await stockfishAvailable();
console.log(`\n  Stockfish backend: ${sfOn ? 'ACTIVE — perfect-info moves are played by the vendored Stockfish' : 'not loaded — using the built-in JS search'}`);
{
  const players = [{ id: 'white', name: 'W', agent: ObscuroAgent }, { id: 'black', name: 'B', agent: ObscuroAgent }];
  const state = ChessGame.createInitialState(players, { fogOfWar: false, difficulty: 'medium' });
  const move = await ObscuroAgent.chooseAction(state, ChessGame.getLegalActions(state, 'white'));
  console.log(`  Perfect-info move actually played (chooseAction): ${fmt(move)}`);
}

// ---- Play a full self-play game ---------------------------------------------
const black = opponent === 'random' ? RandomAgent
  : opponent === 'chess-ai' ? ChessGame.agents.find(a => a.id === 'chess-ai').agent
  : ObscuroAgent;

const players = [
  { id: 'white', name: 'Obscuro', agent: ObscuroAgent },
  { id: 'black', name: opponent === 'obscuro' ? 'Obscuro' : opponent, agent: black },
];

console.log(`\n\nSelf-play: Obscuro (White) vs ${players[1].name} (Black) — fog ${fog ? 'ON' : 'OFF'}\n`);
const engine = new GameEngine(ChessGame, players, { maxTurns: 120, fogOfWar: fog, difficulty: 'medium' });
const { result, log } = await engine.run();

for (const entry of log) {
  const moves = entry.playerActions.map(pa => `${pa.playerId}:${fmt(pa.action)}`).join('  ');
  if (entry.turnNumber % 5 === 0 || entry.turnNumber <= 3) console.log(`  Turn ${entry.turnNumber}  ${moves}`);
}
console.log('\nFinal board:');
console.log(ChessGame.renderState(engine.state));
console.log('\nResult:', result);
