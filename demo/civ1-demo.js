import { GameEngine } from '../engine/index.js';
import { Civ1Game, Civ1ObscuroAgent } from '../games/civ1/index.js';
import { makeCiv1Agent, makeGreedyAgent } from '../games/civ1/ai.js';
import { HumanAgent } from '../agents/index.js';

const GreedyAgent = makeGreedyAgent();

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      const endTurn = legalActions.filter(a => a.type === 'end-turn');
      const others  = legalActions.filter(a => a.type !== 'end-turn');
      const pool = [...endTurn, ...endTurn, ...endTurn, ...endTurn, ...endTurn, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');
// --heuristic: the EV-attacking agent (games/civ1/ai.js) vs the greedy baseline.
const isHeuristic = process.argv.includes('--heuristic');
// --obscuro: the equilibrium search agent (games/civ1/Civ1ObscuroAgent.js) vs the
// greedy baseline. Note that civ1 has a sizeable seat-1 advantage, so a single
// game either way says less than it looks — swap the seats before believing it.
const isObscuro = process.argv.includes('--obscuro');

const makeBot = () => isObscuro ? new Civ1ObscuroAgent(Civ1Game)
  : isHeuristic ? makeCiv1Agent()
  : (isGreedy ? GreedyAgent : makeRandom());

const agent1 = isAuto ? makeBot() : new HumanAgent('You');
const agent2 = (isHeuristic || isObscuro) ? GreedyAgent : makeBot();

const players = [
  { id: 'player-1', name: 'Player 1', agent: agent1 },
  { id: 'player-2', name: 'Player 2', agent: agent2 },
];

const engine = new GameEngine(Civ1Game, players, { maxTurns: 150, seed: 13 });

if (isAuto) {
  console.log('Running Civ1 simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(Civ1Game.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Civilization I — you command Player 1 (uppercase symbols), computer commands Player 2 (lowercase).');
  console.log('Symbols: 1/2=city | S=settlers M=militia P=phalanx A=archers L=legion C=cavalry ...');
  console.log('Terrain: ~=ocean ^=arctic t=tundra d=desert .=plains ,=grass f=forest n=hills A=mtns\n');
  while (!engine.result) {
    console.log('\n' + Civ1Game.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + Civ1Game.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
