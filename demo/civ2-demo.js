import { GameEngine } from '../engine/index.js';
import { Civ2Game } from '../games/civ2/index.js';
import { HumanAgent } from '../agents/index.js';

// Manhattan distance helper
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/**
 * Greedy agent: attack > found-city > move military toward nearest enemy > end-turn.
 */
const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    // Priority 1: attack any adjacent enemy
    const attack = legalActions.find(a => a.type === 'attack');
    if (attack) return attack;

    // Priority 2: found a city (settlers on open land)
    const found = legalActions.find(a => a.type === 'found-city');
    if (found) return found;

    // Priority 3: move units toward nearest threat
    //   - settlers move toward a good land spot (away from current pos, toward map center)
    //   - military units move toward nearest enemy unit or enemy city
    const myId = state.activePlayers[0];
    const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);
    const enemyCities = state.cities.filter(c => c.ownerId !== myId);
    const targets = [...enemies.map(u => u.position), ...enemyCities.map(c => c.position)];

    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length && targets.length) {
      // For each move group by unit, pick the move that gets closest to nearest target
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

    // Fallback: move toward map center (settlers exploring)
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
      // End-turn weighted 5× so games don't stall forever
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

// Seed 13 gives closely-spaced starting positions on connected land
const engine = new GameEngine(Civ2Game, players, { maxTurns: 150, seed: 13 });

if (isAuto) {
  console.log('Running Civ2 simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(Civ2Game.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Civilization II — you command Player 1 (uppercase symbols), computer commands Player 2 (lowercase).');
  console.log('Symbols: 1/2=city | S=settlers W=warriors P=phalanx H=horsemen ...');
  console.log('Terrain: ~=ocean ^=arctic t=tundra d=desert .=plains ,=grass f=forest n=hills A=mtns\n');
  while (!engine.result) {
    console.log('\n' + Civ2Game.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + Civ2Game.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
