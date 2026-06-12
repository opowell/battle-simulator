import { GameEngine } from '../engine/index.js';
import { TacticalGame } from '../games/tactical/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const human = new HumanAgent('You');

const players = [
  { id: 'player-1', name: 'Player 1', agent: isAuto ? RandomAgent : human },
  { id: 'player-2', name: 'Player 2', agent: RandomAgent },
];

const engine = new GameEngine(TacticalGame, players, { maxTurns: 50 });

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    const actions = entry.playerActions.map(({ playerId, action }) => {
      if (action.type === 'end-turn') return `${playerId}: end-turn`;
      if (action.type === 'move') return `${playerId}: ${action.unitId} → (${action.to.x},${action.to.y})`;
      if (action.type === 'attack') return `${playerId}: ${action.unitId} attacks ${action.targetId}`;
      return `${playerId}: ${JSON.stringify(action)}`;
    }).join(', ');
    console.log(`Turn ${entry.turnNumber} ${actions}`);
  }
  console.log('\nFinal state:');
  console.log(TacticalGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Tactical Battle — you command Player 1 (uppercase), computer commands Player 2 (lowercase).');
  console.log('W=Warrior, A=Archer, M=Mage | ~ water | f forest\n');
  while (!engine.result) {
    console.log('\n' + TacticalGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal state:');
  console.log(TacticalGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
