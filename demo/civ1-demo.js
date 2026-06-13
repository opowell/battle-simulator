import { GameEngine } from '../engine/index.js';
import { Civ1Game } from '../games/civ1/index.js';
import { HumanAgent } from '../agents/index.js';

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    const attack = legalActions.find(a => a.type === 'attack');
    if (attack) return attack;

    const found = legalActions.find(a => a.type === 'found-city');
    if (found) return found;

    const myId = state.activePlayers[0];
    const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
    const enemyCities = state.cities.filter(c => c.ownerId !== myId);
    const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length && targets.length) {
      const byUnit = new Map();
      for (const m of moves) {
        if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
        byUnit.get(m.unitId).push(m);
      }

      let bestMove = null, bestScore = Infinity;
      for (const [, unitMoves] of byUnit) {
        const from = unitMoves[0].from;
        const nearestTarget = targets.reduce((best, t) => dist(from, t) < dist(from, best) ? t : best, targets[0]);
        for (const m of unitMoves) {
          const d = dist(m.to, nearestTarget);
          if (d < bestScore) { bestScore = d; bestMove = m; }
        }
      }
      if (bestMove) return bestMove;
    }

    if (moves.length) {
      const cx = state.board.width / 2, cy = state.board.height / 2;
      const center = { x: cx, y: cy };
      return moves.reduce((best, m) => dist(m.to, center) < dist(best.to, center) ? m : best);
    }

    return { type: 'end-turn', unitId: '__player__' };
  },
};

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

const agent1 = isAuto   ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('You');
const agent2 = isGreedy ? GreedyAgent : makeRandom();

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
