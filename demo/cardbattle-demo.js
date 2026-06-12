import { GameEngine } from '../engine/index.js';
import { CardBattleGame } from '../games/cardbattle/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const human = new HumanAgent('You');

const players = [
  { id: 'p1', name: 'Player 1', agent: isAuto ? RandomAgent : human },
  { id: 'p2', name: 'Player 2', agent: RandomAgent },
];

const engine = new GameEngine(CardBattleGame, players, { maxTurns: 30 });

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    const actions = entry.playerActions
      .map(({ playerId, action }) => `${playerId}: ${action.payload.card}`)
      .join(' vs ');
    console.log(`Turn ${entry.turnNumber}: ${actions}`);
  }
  console.log('\nFinal state:');
  console.log(CardBattleGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Card Battle — you are Player 1. Both players choose cards simultaneously.');
  console.log('Cards: attack (8dmg), heavy-attack (14dmg, skip next), block (halves incoming), heal (+6hp)\n');
  while (!engine.result) {
    console.log('\n' + CardBattleGame.renderState(engine.state));
    // In interactive mode, engine asks human first, then RandomAgent for p2
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal state:');
  console.log(CardBattleGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
