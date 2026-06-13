import { GameEngine } from '../engine/index.js';
import { RiskGame } from '../games/risk/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const numPlayers = parseInt(process.argv.find(a => a.startsWith('--players='))?.split('=')[1] ?? '2');

const human = new HumanAgent('You');

const playerDefs = [
  { id: 'p1', name: isAuto ? 'Player 1' : 'You',      agent: isAuto ? RandomAgent : human },
  { id: 'p2', name: 'Player 2', agent: RandomAgent },
  { id: 'p3', name: 'Player 3', agent: RandomAgent },
  { id: 'p4', name: 'Player 4', agent: RandomAgent },
];

const players = playerDefs.slice(0, Math.min(Math.max(numPlayers, 2), 4));

const engine = new GameEngine(RiskGame, players, { maxTurns: 200 });

if (isAuto) {
  console.log(`Risk — ${players.length} players, auto mode\n`);
  const { result } = await engine.run();
  console.log(RiskGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Risk — You are Player 1. Conquer the world!');
  console.log('Phases: reinforce → attack → fortify → end-turn\n');

  while (!engine.result) {
    console.log('\n' + RiskGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }

  console.log('\n' + RiskGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
