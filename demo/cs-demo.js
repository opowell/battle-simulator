import { GameEngine } from '../engine/index.js';
import { CsGame } from '../games/cs/index.js';
import { HumanAgent } from '../agents/index.js';
import { WEAPONS } from '../games/cs/weapons.js';
import { euclidean } from '../games/cs/map.js';

// ── Greedy T agent — split push both sites ───────────────────────────────────

// T-0/1/2 push A (upper-left), T-3/4 push B (lower-left)
const T_UNIT_SITES = {
  'T-0': 'A', 'T-1': 'A', 'T-2': 'A', 'T-3': 'B', 'T-4': 'B',
};

const SITE_A_TILES = [{ x:2,y:8 },{ x:3,y:8 },{ x:4,y:8 },{ x:2,y:9 },{ x:3,y:9 },{ x:2,y:10 }];
const SITE_B_TILES = [{ x:2,y:1 },{ x:3,y:1 },{ x:4,y:1 },{ x:2,y:2 },{ x:3,y:2 },{ x:2,y:3  }];

function makeTAgent(id) {
  return {
    id,
    chooseAction(state, legalActions) {
      const gs = state.gameSpecific;

      if (state.currentPhase === 'buy') {
        const ak    = legalActions.find(a => a.type === 'buy' && a.item === 'ak47');
        if (ak) return ak;
        const armor = legalActions.find(a => a.type === 'buy' && a.item === 'armor');
        if (armor) return armor;
        const deagle = legalActions.find(a => a.type === 'buy' && a.item === 'deagle');
        if (deagle) return deagle;
        return legalActions.find(a => a.type === 'end-buy');
      }

      // Shoot first
      const shoot = legalActions.find(a => a.type === 'shoot');
      if (shoot) return shoot;

      // Plant if at bombsite
      const plant = legalActions.find(a => a.type === 'plant');
      if (plant) return plant;

      // Move toward assigned site (or any site if bomb already planted)
      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length && !gs.bomb?.planted) {
        // Group moves by unit and route each to its assigned site
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }
        // Pick the unit whose next move gets it furthest toward its goal
        let best = null, bestDist = Infinity;
        for (const [uid, ms] of byUnit) {
          const targetSite = T_UNIT_SITES[uid] === 'A' ? SITE_A_TILES : SITE_B_TILES;
          const nearestTarget = targetSite.reduce((b, t) => euclidean(ms[0].from, t) < euclidean(ms[0].from, b) ? t : b, targetSite[0]);
          const move = ms.reduce((b, m) => euclidean(m.to, nearestTarget) < euclidean(b.to, nearestTarget) ? m : b);
          const d = euclidean(move.to, nearestTarget);
          if (d < bestDist) { bestDist = d; best = move; }
        }
        if (best) return best;
        return moves[0];
      }
      if (moves.length) return moves[0];

      const skip = legalActions.find(a => a.type === 'skip-unit');
      if (skip) return skip;
      return legalActions.find(a => a.type === 'end-turn');
    },
  };
}

// ── Greedy CT agent — split defense + defuse ─────────────────────────────────

// CT-0/1 defend A (upper-left), CT-2/3 defend B (lower-left), CT-4 rotates
const CT_UNIT_SITES = {
  'CT-0': 'A', 'CT-1': 'A', 'CT-2': 'B', 'CT-3': 'B', 'CT-4': 'rotate',
};
const CT_GUARD_A = [{ x:5,y:9 },{ x:5,y:10 },{ x:7,y:10 },{ x:4,y:10 }];
const CT_GUARD_B = [{ x:5,y:2 },{ x:5,y:1  },{ x:7,y:1  },{ x:4,y:1  }];

function makeCtAgent(id) {
  return {
    id,
    chooseAction(state, legalActions) {
      const gs = state.gameSpecific;

      if (state.currentPhase === 'buy') {
        const m4    = legalActions.find(a => a.type === 'buy' && a.item === 'm4a4');
        if (m4) return m4;
        const armor = legalActions.find(a => a.type === 'buy' && a.item === 'armor');
        if (armor) return armor;
        const deagle = legalActions.find(a => a.type === 'buy' && a.item === 'deagle');
        if (deagle) return deagle;
        return legalActions.find(a => a.type === 'end-buy');
      }

      // Defuse
      const defuse = legalActions.find(a => a.type === 'defuse');
      if (defuse) return defuse;

      // Shoot
      const shoot = legalActions.find(a => a.type === 'shoot');
      if (shoot) return shoot;

      // Move
      const moves = legalActions.filter(a => a.type === 'move');
      if (moves.length) {
        if (gs.bomb?.planted) {
          // Closest CT rushes to bomb; others cover approach
          const from = moves[0].from;
          const target = gs.bomb.plantedAt;
          return moves.reduce((b, m) => euclidean(m.to, target) < euclidean(b.to, target) ? m : b);
        }
        // Route each CT to its assigned guard zone
        const byUnit = new Map();
        for (const m of moves) {
          if (!byUnit.has(m.unitId)) byUnit.set(m.unitId, []);
          byUnit.get(m.unitId).push(m);
        }
        let best = null, bestDist = Infinity;
        for (const [uid, ms] of byUnit) {
          const assignment = CT_UNIT_SITES[uid];
          const guards = assignment === 'B' ? CT_GUARD_B
                       : assignment === 'rotate' ? [...CT_GUARD_A, ...CT_GUARD_B]
                       : CT_GUARD_A;
          const nearestGuard = guards.reduce((b, t) => euclidean(ms[0].from, t) < euclidean(ms[0].from, b) ? t : b, guards[0]);
          // Skip moving if already close enough to guard position
          if (euclidean(ms[0].from, nearestGuard) <= 2) continue;
          const move = ms.reduce((b, m) => euclidean(m.to, nearestGuard) < euclidean(b.to, nearestGuard) ? m : b);
          const d = euclidean(move.to, nearestGuard);
          if (d < bestDist) { bestDist = d; best = move; }
        }
        if (best) return best;
        return moves[0];
      }

      const skip = legalActions.find(a => a.type === 'skip-unit');
      if (skip) return skip;
      return legalActions.find(a => a.type === 'end-turn');
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const isAuto = process.argv.includes('--auto');

const agent1 = isAuto ? makeTAgent('t-ai')  : new HumanAgent('You (T)');
const agent2 = isAuto ? makeCtAgent('ct-ai') : makeCtAgent('ct-ai');

const players = [
  { id: 'player-1', name: 'Terrorists',        agent: agent1 },
  { id: 'player-2', name: 'Counter-Terrorists', agent: agent2 },
];

const engine = new GameEngine(CsGame, players, { winRounds: 5, maxRounds: 9 });

if (isAuto) {
  console.log('Running CS simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(CsGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Counter-Strike (turn-based) — You command the T side, AI commands CT.');
  console.log('Objective: Plant and detonate the bomb at site A or B. CT must defuse or eliminate all Ts.');
  console.log('Sites A (upper-left) and B (lower-right) on map. T spawn = right-center, CT spawn = left-center.\n');

  while (!engine.result) {
    console.log('\n' + CsGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + CsGame.renderState(engine.state));
  console.log('\nMatch result:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
