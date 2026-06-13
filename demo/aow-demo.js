import { GameEngine } from '../engine/index.js';
import { AowGame } from '../games/aow/index.js';
import { HumanAgent } from '../agents/index.js';

function cheby(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Greedy agent — attacks > moves toward objectives.
 * Cavalry rushes the enemy camp; others close with the nearest enemy.
 */
const GreedyAgent = {
  id: 'greedy',
  chooseAction(state, legalActions) {
    const myId = state.activePlayers[0];
    const isP1 = myId === state.players[0].id;
    const { p1Camp, p2Camp } = state.gameSpecific;
    const enemyCamp = isP1 ? p2Camp : p1Camp;
    const enemies   = state.units.filter(u => u.alive && u.ownerId !== myId);

    // Priority 1: attack — prefer lowest-HP targets
    const attacks = legalActions.filter(a => a.type === 'attack');
    if (attacks.length) {
      return attacks.reduce((best, a) => {
        const t = state.units.find(u => u.id === a.targetId);
        const b = state.units.find(u => u.id === best.targetId);
        return t.hp < b.hp ? a : best;
      });
    }

    // Priority 2: move toward objectives
    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length && (enemies.length || true)) {
      const byUnit = new Map();
      for (const m of moves) {
        if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
        byUnit.get(m.unitId).push(m);
      }

      let bestMove = null, bestScore = Infinity;
      for (const [unitId, unitMoves] of byUnit) {
        const unit = state.units.find(u => u.id === unitId);
        const from = unit.position;

        // Cavalry targets enemy camp; others close on nearest enemy (or camp if no enemies)
        let target;
        if (unit.type === 'cavalry') {
          target = enemyCamp;
        } else if (enemies.length) {
          target = enemies.reduce(
            (best, e) => cheby(from, e.position) < cheby(from, best.position) ? e : best
          ).position;
        } else {
          target = enemyCamp;
        }

        for (const m of unitMoves) {
          const d = cheby(m.to, target);
          if (d < bestScore) { bestScore = d; bestMove = m; }
        }
      }
      if (bestMove) return bestMove;
    }

    return legalActions.find(a => a.type === 'end-turn');
  },
};

function makeRandom() {
  return {
    id: 'random',
    chooseAction(_state, legalActions) {
      // end-turn weighted 5× so games don't stall
      const endTurn = legalActions.filter(a => a.type === 'end-turn');
      const others  = legalActions.filter(a => a.type !== 'end-turn');
      const pool    = [...endTurn, ...endTurn, ...endTurn, ...endTurn, ...endTurn, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('You');
const agent2 = isGreedy ? GreedyAgent : makeRandom();

const players = [
  { id: 'player-1', name: 'Player 1', agent: agent1 },
  { id: 'player-2', name: 'Player 2', agent: agent2 },
];

const engine = new GameEngine(AowGame, players, { maxTurns: 200, seed: 7 });

if (isAuto) {
  console.log('Running Ancient Art of War simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(AowGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('═══ Ancient Art of War ═══');
  console.log('You command Player 1 (UPPERCASE). Computer commands Player 2 (lowercase).');
  console.log('Units: W=warrior  A=archer  H=horsemen(cavalry)');
  console.log('Goal:  Capture the enemy camp (2) or destroy their entire army.');
  console.log('Archers attack from up to 2 tiles away — use them from behind your warriors!');
  console.log('Terrain: .=plains  f=forest(+50%def)  n=hills(+75%def)  ^=impassable\n');

  while (!engine.result) {
    console.log('\n' + AowGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }

  console.log('\n' + AowGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
