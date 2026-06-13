import { GameEngine } from '../engine/index.js';
import { CombatMissionGame } from '../games/combatmission/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const human = new HumanAgent('You');

const players = [
  { id: 'allied', name: 'Allies (US)', agent: isAuto ? RandomAgent : human },
  { id: 'axis',   name: 'Axis (DE)',   agent: RandomAgent },
];

const engine = new GameEngine(CombatMissionGame, players, { maxTurns: 60 });

function describeAction({ playerId, action }) {
  if (action.type === 'end-turn')  return `${playerId}: end-turn`;
  if (action.type === 'move')      return `${playerId}: ${action.unitId} → (${action.to.x},${action.to.y})`;
  if (action.type === 'fire')      return `${playerId}: ${action.unitId} fires at ${action.targetId}`;
  if (action.type === 'skip-unit') return `${playerId}: ${action.unitId} skip`;
  return `${playerId}: ${JSON.stringify(action)}`;
}

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    console.log(`Turn ${entry.turnNumber} | ${entry.playerActions.map(describeAction).join(', ')}`);
  }
  console.log('\nFinal state:');
  console.log(CombatMissionGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Combat Mission — Allies (uppercase) vs Axis (uppercase)');
  console.log('R=Rifle G=MG S=Sherman  |  V=Volks M=MG42 K=Tiger\n');
  while (!engine.result) {
    console.log('\n' + CombatMissionGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal state:');
  console.log(CombatMissionGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
