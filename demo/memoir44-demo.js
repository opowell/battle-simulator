import { GameEngine } from '../engine/index.js';
import { Memoir44Game } from '../games/memoir44/index.js';
import { RandomAgent, HumanAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
const scenIdx = process.argv.indexOf('--scenario');
const scenario = scenIdx >= 0 ? process.argv[scenIdx + 1] : 'encounter';
const human = new HumanAgent('You');

const players = [
  { id: 'allies', name: 'Allies', agent: isAuto ? RandomAgent : human },
  { id: 'axis',   name: 'Axis',   agent: RandomAgent },
];

const engine = new GameEngine(Memoir44Game, players, { maxTurns: 120, scenario });

function describe(playerId, action) {
  if (action.type === 'end-turn') return `${playerId}: end turn`;
  if (action.type === 'play-card') return `${playerId}: play ${action.cardId} (${action.section})`;
  if (action.type === 'move') return `${playerId}: ${action.unitId} → (${action.to.col},${action.to.row})`;
  if (action.type === 'attack') return `${playerId}: ${action.unitId} battles ${action.targetId}`;
  return `${playerId}: ${JSON.stringify(action)}`;
}

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    console.log(`T${entry.turnNumber} ` + entry.playerActions.map(({ playerId, action }) => describe(playerId, action)).join(', '));
  }
  console.log('\nFinal state:');
  console.log(Memoir44Game.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log(`Memoir '44 — you command the Allies (UPPERCASE), computer commands the Axis (lowercase).`);
  console.log('I=Infantry, A=Armor, R=aRtillery | . open  f forest  t town  h hill  ~ river  = bridge  ✪ objective\n');
  while (!engine.result) {
    console.log('\n' + Memoir44Game.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal state:');
  console.log(Memoir44Game.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}
