import { GameEngine } from '../engine/index.js';
import { ChessGame } from '../games/chess/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const human = new HumanAgent('You');

const players = [
  { id: 'white', name: 'White', agent: isAuto ? RandomAgent : human },
  { id: 'black', name: 'Black', agent: RandomAgent },
];

const engine = new GameEngine(ChessGame, players, { maxTurns: 200 });

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    const actions = entry.playerActions.map(pa => formatAction(pa)).join(', ');
    console.log(`Turn ${entry.turnNumber} [${entry.phase}] ${actions}`);
  }
  console.log('\nFinal board:');
  console.log(ChessGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Chess — you play White, computer plays Black.');
  while (!engine.result) {
    console.log('\n' + ChessGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal board:');
  console.log(ChessGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}

function formatAction({ playerId, action }) {
  if (action.type === 'castle') return `${playerId}: O-O${action.side === 'queenside' ? '-O' : ''}`;
  if (action.type === 'move') {
    const cap = action.isCapture ? 'x' : '-';
    const promo = action.payload?.promote ? `=${action.payload.promote[0].toUpperCase()}` : '';
    return `${playerId}: ${action.from}${cap}${action.to}${promo}`;
  }
  return `${playerId}: ${JSON.stringify(action)}`;
}
