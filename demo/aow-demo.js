import { GameEngine } from '../engine/index.js';
import { AowGame } from '../games/aow/index.js';
import { HumanAgent } from '../agents/index.js';

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/**
 * Greedy captain — marches each squad toward the enemy's flag, brushing aside any enemy
 * squad that lies close to its path. Good enough to make flag races competitive.
 */
const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    const myId    = state.activePlayers[0];
    const enemies = state.squads.filter(s => s.alive && s.ownerId !== myId);
    const enemyFlag = state.board.features.find(f => f.type === 'flag' && f.origOwner && f.origOwner !== myId);

    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length) {
      const byId = new Map();
      for (const m of moves) { (byId.get(m.unitId) ?? byId.set(m.unitId, []).get(m.unitId)).push(m); }

      let best = null, bestScore = Infinity;
      for (const [unitId, sqMoves] of byId) {
        const sq = state.squads.find(s => s.id === unitId);
        // Aim at the nearest enemy squad if one is close, else the enemy flag.
        const nearEnemy = enemies.reduce((b, e) => !b || dist(sq.position, e.position) < dist(sq.position, b.position) ? e : b, null);
        const target = (nearEnemy && dist(sq.position, nearEnemy.position) < 5)
          ? nearEnemy.position
          : (enemyFlag ?? { x: state.board.width / 2, y: state.board.height / 2 });
        for (const m of sqMoves) {
          const d = dist(m.to, target);
          if (d < bestScore) { bestScore = d; best = m; }
        }
      }
      if (best) return best;
    }
    return legalActions.find(a => a.type === 'end-turn');
  },
};

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      // end-turn weighted so games don't stall
      const endTurn = legalActions.filter(a => a.type === 'end-turn');
      const others  = legalActions.filter(a => a.type !== 'end-turn');
      const pool    = [...endTurn, ...endTurn, ...endTurn, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('You');
const agent2 = isGreedy ? GreedyAgent : makeRandom();

const players = [
  { id: 'p1', name: 'Player 1', agent: agent1 },
  { id: 'p2', name: 'Player 2', agent: agent2 },
];

const engine = new GameEngine(AowGame, players, { maxTurns: 200, seed: 7 });

if (isAuto) {
  console.log('Running Ancient Art of War simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(AowGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('═══ The Ancient Art of War ═══');
  console.log('You command Player 1 (U). Computer commands Player 2 (e).');
  console.log('Each squad holds up to 14 men: K=knight B=barbarian A=archer S=spy.');
  console.log('Knights beat barbarians, barbarians beat archers, archers beat knights.');
  console.log('Move a squad toward a point each turn; contact triggers a battle.');
  console.log('Goal: march a squad onto the enemy fort/flag (#), or destroy their army.\n');

  while (!engine.result) {
    console.log('\n' + AowGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }

  console.log('\n' + AowGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
