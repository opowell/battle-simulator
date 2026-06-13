import { GameEngine } from '../engine/index.js';
import { Sc2Game } from '../games/sc2/index.js';
import { HumanAgent } from '../agents/index.js';
import { UNITS } from '../games/sc2/units.js';
import { BUILDINGS } from '../games/sc2/buildings.js';
import { chebyshev } from '../games/sc2/combat.js';

// ── Greedy AI ─────────────────────────────────────────────────────────────────

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

const GreedyAgent = {
  id: 'greedy',

  chooseAction(state, legalActions) {
    const pid       = state.activePlayers[0];
    const res       = state.gameSpecific.resources[pid] ?? { minerals: 0, gas: 0 };
    const enemies   = state.units.filter(u => u.alive && u.ownerId !== pid);
    const enemyBldgs = state.buildings.filter(b => b.alive && b.ownerId !== pid);

    // 1. Attack any reachable enemy
    const attack = legalActions.find(a => a.type === 'attack');
    if (attack) return attack;

    // 2. Inject larva if queen is adjacent to hatchery
    const inject = legalActions.find(a => a.type === 'inject-larva');
    if (inject) return inject;

    // 3. Set production on idle buildings (prefer military)
    const setProd = legalActions.filter(a => a.type === 'set-production');
    if (setProd.length) {
      const milProd = setProd.find(a => !UNITS[a.unitType]?.special.includes('worker'));
      return milProd ?? setProd[0];
    }

    // 4. Warp in units if warp gate is ready
    const warpIn = legalActions.find(a => a.type === 'warp-in');
    if (warpIn) return warpIn;

    // 5. Build key production structures
    const buildActions = legalActions.filter(a => a.type === 'build');
    if (buildActions.length) {
      const priority = ['barracks','gateway','spawning-pool','refinery','extractor','assimilator',
                        'supply-depot','pylon','factory','starport','cybernetics-core','roach-warren'];
      for (const btype of priority) {
        const ba = buildActions.find(a => a.buildingType === btype);
        if (ba) return ba;
      }
      return buildActions[0];
    }

    // 6. Morph to warp gate
    const morph = legalActions.find(a => a.type === 'morph-to-warp-gate');
    if (morph) return morph;

    // 7. Gather minerals with idle workers
    const gather = legalActions.find(a => a.type === 'gather-minerals');
    if (gather) return gather;

    // 8. Move military toward enemies, workers toward minerals
    const allTargets = [...enemies.map(u => u.position), ...enemyBldgs.map(b => b.position)];
    const moves      = legalActions.filter(a => a.type === 'move');
    if (moves.length) {
      const byUnit = new Map();
      for (const m of moves) {
        if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
        byUnit.get(m.unitId).push(m);
      }

      // Workers toward nearest mineral patch
      for (const [uid, unitMoves] of byUnit) {
        const unit = state.units.find(u => u.id === uid);
        if (!unit || !UNITS[unit.type]?.special.includes('worker')) continue;
        if (unit.attrs?.gathering) continue;
        const mineralTiles = Object.entries(state.board.tiles)
          .filter(([, t]) => t.terrain === 'minerals')
          .map(([k]) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
        if (!mineralTiles.length) continue;
        const nearest = mineralTiles.reduce(
          (best, t) => dist(unit.position, t) < dist(unit.position, best) ? t : best,
          mineralTiles[0]
        );
        return unitMoves.reduce((b, m) => dist(m.to, nearest) < dist(b.to, nearest) ? m : b);
      }

      // Military toward nearest enemy
      if (allTargets.length) {
        let bestMove = null, bestScore = Infinity;
        for (const [uid, unitMoves] of byUnit) {
          const unit = state.units.find(u => u.id === uid);
          if (!unit || UNITS[unit.type]?.special.includes('worker')) continue;
          const from = unitMoves[0].from;
          const nearest = allTargets.reduce(
            (best, t) => dist(from, t) < dist(from, best) ? t : best, allTargets[0]
          );
          for (const m of unitMoves) {
            const d = dist(m.to, nearest);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      return moves[Math.floor(Math.random() * moves.length)];
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
      const pool    = [...endTurn, ...endTurn, ...endTurn, ...endTurn, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const race1arg  = (process.argv.find(a => a.startsWith('--race1=')) ?? '--race1=terran').split('=')[1];
const race2arg  = (process.argv.find(a => a.startsWith('--race2=')) ?? '--race2=zerg').split('=')[1];
const validRaces = ['terran', 'zerg', 'protoss'];
const race1 = validRaces.includes(race1arg) ? race1arg : 'terran';
const race2 = validRaces.includes(race2arg) ? race2arg : 'zerg';

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('You');
const agent2 = isGreedy ? GreedyAgent : makeRandom();

const players = [
  { id: 'player-1', name: 'Player 1', race: race1, agent: agent1 },
  { id: 'player-2', name: 'Player 2', race: race2, agent: agent2 },
];

const engine = new GameEngine(Sc2Game, players, {
  maxTurns: 300,
  race1,
  race2,
});

if (isAuto) {
  console.log(`Running SC2 simulation: ${race1} vs ${race2}\n`);
  const { result, finalState } = await engine.run();
  console.log(Sc2Game.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log(`StarCraft II (Turn-Based) — ${race1.toUpperCase()} (P1) vs ${race2.toUpperCase()} (P2)`);
  console.log('You command Player 1 (UPPERCASE symbols). Computer commands Player 2 (lowercase).');
  console.log("Terrain: .=open '=elevated /=ramp *=minerals %=vespene #=obstacle");
  console.log('SC2 actions: stim | blink | siege/unsiege | burrow/unburrow | assault-mode/fighter-mode');
  console.log('             inject-larva | morph-to-warp-gate | warp-in\n');

  while (!engine.result) {
    console.log('\n' + Sc2Game.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + Sc2Game.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
