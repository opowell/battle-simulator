import { GameEngine }     from '../engine/index.js';
import { CsMiniGame }      from '../games/csmini/index.js';
import { HumanAgent }      from '../agents/index.js';
import { makeGreedyAgent } from '../agents/GreedyAgent.js';

// CS-mini demo.
//   node demo/csmini-demo.js            you (CT) vs greedy AI (T), fog on
//   node demo/csmini-demo.js --auto     greedy vs greedy
//   node demo/csmini-demo.js --auto --random   random vs random
//   add --nofog to turn fog off
const isAuto   = process.argv.includes('--auto');
const isRandom = process.argv.includes('--random');
const fogOfWar = !process.argv.includes('--nofog');

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      // Weight end-turn a little so random games don't spin the full budget.
      const ends   = legalActions.filter(a => a.type === 'end-turn');
      const others = legalActions.filter(a => a.type !== 'end-turn');
      const pool   = [...ends, ...ends, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

const aiT = isRandom ? makeRandom() : makeGreedyAgent(CsMiniGame);
const ct  = isAuto
  ? (isRandom ? makeRandom() : makeGreedyAgent(CsMiniGame))
  : new HumanAgent('CT');

const players = [
  { id: 'ct', name: 'CT', agent: ct },
  { id: 't',  name: 'T',  agent: aiT },
];

const engine = new GameEngine(CsMiniGame, players, { maxTurns: 60, fogOfWar });

if (isAuto) {
  console.log(`Running CS-mini — ${isRandom ? 'random vs random' : 'greedy vs greedy'}, fog ${fogOfWar ? 'ON' : 'OFF'}\n`);
  const { result, finalState } = await engine.run();
  console.log(CsMiniGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  while (!engine.result) {
    console.log('\n' + CsMiniGame.renderState(engine.state) + '\n');
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + CsMiniGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (ct.close) ct.close();
}
