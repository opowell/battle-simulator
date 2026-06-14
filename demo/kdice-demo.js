import { GameEngine } from '../engine/index.js';
import { KDiceGame } from '../games/kdice/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const numPlayers = parseInt(process.argv.find(a => a.startsWith('--players='))?.split('=')[1] ?? '2');

const human = new HumanAgent('You');

const playerDefs = [
  { id: 'p1', name: isAuto ? 'Player 1' : 'You', agent: isAuto ? RandomAgent : human },
  { id: 'p2', name: 'Player 2', agent: RandomAgent },
  { id: 'p3', name: 'Player 3', agent: RandomAgent },
  { id: 'p4', name: 'Player 4', agent: RandomAgent },
];

const players = playerDefs.slice(0, Math.min(Math.max(numPlayers, 2), 4));

const engine = new GameEngine(KDiceGame, players, { maxTurns: 200 });

if (isAuto) {
  console.log(`KDice — ${players.length} players, auto mode\n`);
  const { result } = await engine.run();
  console.log(KDiceGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('KDice — You are Player 1. Conquer the map by rolling more dice than your opponents!');
  console.log('Attack adjacent territories with 2+ dice. Winner takes (your dice - 1) into the territory.');
  console.log('End your turn to collect bonus dice equal to your largest connected region - 1.\n');

  while (!engine.result) {
    console.log('\n' + KDiceGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }

  console.log('\n' + KDiceGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
