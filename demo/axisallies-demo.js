import { GameEngine } from '../engine/index.js';
import { AxisAlliesGame } from '../games/axisallies/index.js';
import { HumanAgent } from '../agents/index.js';
import { UNITS } from '../games/axisallies/units.js';

// ── Greedy Agent ──────────────────────────────────────────────────────────────
// Priority:  buy cheap land units > move toward enemy capital > end-mobilize/end-turn

const ENEMY_CAPITALS = { axis: 'moscow', allies: 'germany' };

function bfsDist(board, from, to) {
  if (from === to) return 0;
  const visited = new Set([from]);
  const queue = [[from, 0]];
  while (queue.length) {
    const [node, d] = queue.shift();
    for (const adj of (board.adj[node] || [])) {
      if (adj === to) return d + 1;
      if (!visited.has(adj)) {
        visited.add(adj);
        queue.push([adj, d + 1]);
      }
    }
  }
  return Infinity;
}

const GreedyAgent = {
  chooseAction(state, legalActions) {
    const pid = state.activePlayers[0];
    const phase = state.currentPhase;

    // Purchase: buy infantry until can't, then artillery, then end
    if (phase === 'purchase') {
      const buyInf = legalActions.find(a => a.type === 'buy' && a.payload?.unit === 'infantry');
      if (buyInf) return buyInf;
      const buyArt = legalActions.find(a => a.type === 'buy' && a.payload?.unit === 'artillery');
      if (buyArt) return buyArt;
      const buyTank = legalActions.find(a => a.type === 'buy' && a.payload?.unit === 'tank');
      if (buyTank) return buyTank;
      return legalActions.find(a => a.type === 'end-purchase') ?? legalActions[0];
    }

    // Mobilize: place at factory closest to enemy capital
    if (phase === 'mobilize') {
      const place = legalActions.find(a => a.type === 'place');
      if (place) return place;
      return legalActions.find(a => a.type === 'end-mobilize') ?? legalActions[0];
    }

    // Movement phases
    if (phase === 'combat-move' || phase === 'non-combat-move') {
      const target = ENEMY_CAPITALS[pid];

      // In combat-move, only land/sea units attack — skip air units so they don't solo-charge capitals
      const moves = legalActions.filter(a => {
        if (a.type !== 'move') return false;
        if (phase === 'combat-move') {
          const u = state.units.find(u => u.id === a.unitId);
          if (u && UNITS[u.type].domain === 'air') return false;
        }
        return true;
      });

      if (moves.length) {
        const best = moves.reduce((bestM, m) => {
          const d = bfsDist(state.board, m.to, target);
          const bd = bfsDist(state.board, bestM.to, target);
          return d < bd ? m : bestM;
        });
        return best;
      }

      // Skip remaining units (including any air units in combat-move)
      const skip = legalActions.find(a => a.type === 'skip-unit');
      if (skip) return skip;

      const endCombat = legalActions.find(a => a.type === 'end-combat-move');
      if (endCombat) return endCombat;
      const endNon = legalActions.find(a => a.type === 'end-non-combat-move');
      if (endNon) return endNon;
    }

    // Fallback
    return legalActions[legalActions.length - 1];
  },
};

// ── Main ──────────────────────────────────────────────────────────────────────

const isAuto   = process.argv.includes('--auto');
const isGreedy = process.argv.includes('--greedy');

const agent1 = isAuto ? GreedyAgent : new HumanAgent('You');
const agent2 = GreedyAgent;

const players = [
  { id: 'axis',   name: 'Axis',   agent: agent1 },
  { id: 'allies', name: 'Allies', agent: agent2 },
];

// A&A turns are many steps each (one action per unit); step-limit = maxTurns*players*20
// With ~200 steps/round and 2 players, maxTurns=5000 gives ~250 real game rounds
const engine = new GameEngine(AxisAlliesGame, players, { maxTurns: 5000 });

if (isAuto) {
  console.log('Running Axis & Allies simulation...\n');
  const { result, finalState } = await engine.run();
  console.log(AxisAlliesGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('=== AXIS & ALLIES ===');
  console.log('You command the AXIS. Computer commands the ALLIES.');
  console.log('Win by capturing Moscow (Allies capital).');
  console.log('Allies win by capturing Berlin (Germany).\n');
  console.log('Phases: purchase → combat-move → (auto-combat) → non-combat-move → mobilize → collect income\n');

  while (!engine.result) {
    console.log('\n' + AxisAlliesGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + AxisAlliesGame.renderState(engine.state));
  console.log('\nResult:', engine.result);
  if (agent1 instanceof HumanAgent) agent1.close?.();
}
