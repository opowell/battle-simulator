import { GameEngine } from '../engine/index.js';
import { XComGame }   from '../games/xcom/index.js';
import { HumanAgent } from '../agents/index.js';
import { manhattan }  from '../games/xcom/grid.js';

/**
 * Greedy agent: shoot lowest-HP enemy in sight > move toward nearest enemy > end-turn.
 */
const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    const myId = state.activePlayers[0];

    // Priority 1: shoot — pick the shot targeting the lowest-HP visible enemy
    const shoots = legalActions.filter(a => a.type === 'shoot');
    if (shoots.length) {
      return shoots.reduce((best, a) => {
        const t = state.units.find(u => u.id === a.targetId);
        const b = state.units.find(u => u.id === best.targetId);
        return (t?.hp ?? 999) < (b?.hp ?? 999) ? a : best;
      });
    }

    // Priority 2: move — advance unit that is furthest from any enemy
    const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
    const moves   = legalActions.filter(a => a.type === 'move');
    if (moves.length && enemies.length) {
      let bestMove = null, bestScore = Infinity;
      for (const m of moves) {
        const minDist = Math.min(...enemies.map(e => manhattan(m.to, e.position)));
        if (minDist < bestScore) { bestScore = minDist; bestMove = m; }
      }
      if (bestMove) return bestMove;
    }

    return legalActions.find(a => a.type === 'end-turn');
  },
};

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('XCOM');
const agent2  = isGreedy ? GreedyAgent : makeRandom();

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      const endTurns = legalActions.filter(a => a.type === 'end-turn');
      const others   = legalActions.filter(a => a.type !== 'end-turn');
      // Weight end-turn 3× so games don't stall
      const pool = [...endTurns, ...endTurns, ...endTurns, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

const players = [
  { id: 'xcom',   name: 'XCOM',   agent: agent1 },
  { id: 'aliens', name: 'Aliens', agent: agent2  },
];

const engine = new GameEngine(XComGame, players, { maxTurns: 80 });

if (isAuto) {
  console.log('Running X-Com simulation…\n');
  const { result, log, finalState } = await engine.run();
  console.log(XComGame.renderState(finalState));
  console.log('\n--- Battle log (shoots only) ---');
  for (const entry of log) {
    const { action } = entry.playerActions[0];
    if (action.type === 'shoot') {
      // hitChance/hit/damage are enriched in state.lastActions but not in the engine log
      console.log(`  Turn ${entry.turnNumber} [${entry.phase}]  ${action.unitId} → ${action.targetId}`);
    }
  }
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('X-Com Tactical  —  you command XCOM (S=Soldier H=Heavy N=Sniper P=Support)');
  console.log('Enemies: z=Sectoid f=Floater m=Muton');
  console.log('Terrain: #=wall  .=floor  c=low-cover(-20% hit)  C=high-cover(-40% hit)');
  console.log('Each unit has 2 AP: move costs 1 AP, shoot uses all remaining AP.\n');

  while (!engine.result) {
    console.log('\n' + XComGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + XComGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close();
}
