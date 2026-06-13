import { GameEngine } from '../engine/index.js';
import { Sc1Game } from '../games/sc1/index.js';
import { HumanAgent } from '../agents/index.js';
import { UNITS } from '../games/sc1/units.js';
import { BUILDINGS } from '../games/sc1/buildings.js';
import { chebyshev } from '../games/sc1/combat.js';

// ── Greedy AI ─────────────────────────────────────────────────────────────────

function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

const GreedyAgent = {
  id: 'greedy',

  chooseAction(state, legalActions) {
    const pid = state.activePlayers[0];
    const res = state.gameSpecific.resources[pid] ?? { minerals: 0, gas: 0 };
    const enemies = state.units.filter(u => u.alive && u.ownerId !== pid);
    const enemyBldgs = state.buildings.filter(b => b.alive && b.ownerId !== pid);

    // 1. Attack any reachable enemy unit/building
    const attack = legalActions.find(a => a.type === 'attack');
    if (attack) return attack;

    // 2. Start gathering minerals with idle workers adjacent to minerals
    const gather = legalActions.find(a => a.type === 'gather-minerals');
    if (gather) return gather;

    const gatherGas = legalActions.find(a => a.type === 'gather-gas');
    if (gatherGas) return gatherGas;

    // 3. Build supply structures when near supply cap
    const sup = state.gameSpecific.resources ? (() => {
      const max = state.buildings
        .filter(b => b.alive && b.ownerId === pid && b.constructTurns === 0)
        .reduce((s, b) => s + (BUILDINGS[b.type]?.supplies ?? 0), 0)
        + state.units.filter(u => u.alive && u.ownerId === pid && UNITS[u.type]?.special.includes('supply-8')).length * 8;
      const used = state.units.filter(u => u.alive && u.ownerId === pid)
        .reduce((s, u) => s + (UNITS[u.type]?.supply ?? 0), 0);
      return { max, used };
    })() : { max: 999, used: 0 };

    const buildActions = legalActions.filter(a => a.type === 'build');
    if (sup.used >= sup.max - 2 && buildActions.length) {
      const supplyBldg = buildActions.find(a =>
        ['supply-depot','pylon'].includes(a.buildingType)
      );
      if (supplyBldg) return supplyBldg;
    }

    // 4. Build gas extractor if have minerals and no extractor yet
    const hasExtractor = state.buildings.some(b => b.alive && b.ownerId === pid
      && ['refinery','extractor','assimilator'].includes(b.type));
    if (!hasExtractor && buildActions.length) {
      const gasExtractor = buildActions.find(a =>
        ['refinery','extractor','assimilator'].includes(a.buildingType)
      );
      if (gasExtractor) return gasExtractor;
    }

    // 5. Build production building (max 2 of same type)
    if (buildActions.length) {
      const prodBldgTypes = ['barracks','gateway','spawning-pool'];
      for (const bt of prodBldgTypes) {
        const count = state.buildings.filter(b => b.alive && b.ownerId === pid && b.type === bt).length;
        if (count < 2) {
          const bldgAction = buildActions.find(a => a.buildingType === bt);
          if (bldgAction) return bldgAction;
        }
      }
    }

    // 6. Set production on idle buildings (prefer military over workers)
    const setProd = legalActions.filter(a => a.type === 'set-production');
    if (setProd.length) {
      const milProd = setProd.find(a => !UNITS[a.unitType]?.special.includes('worker'));
      return milProd ?? setProd[0];
    }

    // 5. Move units: workers toward minerals, military toward enemies
    const allTargets = [...enemies.map(u => u.position), ...enemyBldgs.map(b => b.position)];
    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length) {
      const byUnit = new Map();
      for (const m of moves) {
        if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
        byUnit.get(m.unitId).push(m);
      }

      // Move idle workers toward nearest mineral patch
      for (const [uid, unitMoves] of byUnit) {
        const unit = state.units.find(u => u.id === uid);
        if (!unit || !UNITS[unit.type]?.special.includes('worker')) continue;
        if (unit.attrs?.gathering) continue;
        const mineralTiles = Object.entries(state.board.tiles)
          .filter(([, t]) => t.terrain === 'minerals')
          .map(([k]) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
        if (!mineralTiles.length) continue;
        const nearest = mineralTiles.reduce(
          (best, t) => dist(unit.position, t) < dist(unit.position, best) ? t : best, mineralTiles[0]
        );
        return unitMoves.reduce((b, m) => dist(m.to, nearest) < dist(b.to, nearest) ? m : b);
      }

      // Move military toward nearest enemy
      if (allTargets.length) {
        let bestMove = null, bestScore = Infinity;
        for (const [uid, unitMoves] of byUnit) {
          const unit = state.units.find(u => u.id === uid);
          if (!unit || UNITS[unit.type]?.special.includes('worker')) continue;
          const from = unitMoves[0].from;
          const nearestTarget = allTargets.reduce(
            (best, t) => dist(from, t) < dist(from, best) ? t : best, allTargets[0]
          );
          for (const m of unitMoves) {
            const d = dist(m.to, nearestTarget);
            if (d < bestScore) { bestScore = d; bestMove = m; }
          }
        }
        if (bestMove) return bestMove;
      }

      if (moves.length) return moves[Math.floor(Math.random() * moves.length)];
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
      const pool = [...endTurn, ...endTurn, ...endTurn, ...endTurn, ...others];
      return pool[Math.floor(Math.random() * pool.length)];
    },
  };
}

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

// Race selection: --race1=terran --race2=zerg
const race1arg = (process.argv.find(a => a.startsWith('--race1=')) ?? '--race1=terran').split('=')[1];
const race2arg = (process.argv.find(a => a.startsWith('--race2=')) ?? '--race2=zerg').split('=')[1];
const validRaces = ['terran', 'zerg', 'protoss'];
const race1 = validRaces.includes(race1arg) ? race1arg : 'terran';
const race2 = validRaces.includes(race2arg) ? race2arg : 'zerg';

const agent1 = isAuto ? (isGreedy ? GreedyAgent : makeRandom()) : new HumanAgent('You');
const agent2 = isGreedy ? GreedyAgent : makeRandom();

const players = [
  { id: 'player-1', name: 'Player 1', race: race1, agent: agent1 },
  { id: 'player-2', name: 'Player 2', race: race2, agent: agent2 },
];

const engine = new GameEngine(Sc1Game, players, {
  maxTurns: 600,
  race1,
  race2,
});

if (isAuto) {
  console.log(`Running SC1 simulation: ${race1} vs ${race2}\n`);
  const { result, finalState } = await engine.run();
  console.log(Sc1Game.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log(`StarCraft I (Turn-Based) — ${race1.toUpperCase()} (P1) vs ${race2.toUpperCase()} (P2)`);
  console.log('You command Player 1 (UPPERCASE symbols). Computer commands Player 2 (lowercase).');
  console.log('Terrain: .=open \'=elevated /=ramp *=minerals %=vespene #=obstacle');
  console.log('Key buildings: C/H/N=main base  B/W/G=production  R/X/A=gas extractor  S/Y=supply\n');

  while (!engine.result) {
    console.log('\n' + Sc1Game.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + Sc1Game.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
