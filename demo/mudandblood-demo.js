import { GameEngine }       from '../engine/index.js';
import { MudAndBloodGame }  from '../games/mudandblood/index.js';
import { HumanAgent }       from '../agents/index.js';
import { manhattan }        from '../games/mudandblood/grid.js';

// ---------------------------------------------------------------------------
// Axis greedy agent — advance toward the trench, shoot when in range
// ---------------------------------------------------------------------------

const AxisGreedyAgent = {
  id: 'axis-greedy',
  chooseAction(state, legalActions) {
    const myId    = state.activePlayers[0];
    const enemies = state.units.filter(u => u.alive && u.ownerId !== myId);

    // Priority 1: shoot the nearest allied unit
    const shoots = legalActions.filter(a => a.type === 'shoot');
    if (shoots.length) {
      return shoots.reduce((best, a) => {
        const tA = state.units.find(u => u.id === a.targetId);
        const tB = state.units.find(u => u.id === best.targetId);
        const mA = tA ? state.units.find(u => u.id === a.unitId) : null;
        const mB = tB ? state.units.find(u => u.id === best.unitId) : null;
        const dA = tA && mA ? manhattan(mA.position, tA.position) : 999;
        const dB = tB && mB ? manhattan(mB.position, tB.position) : 999;
        return dA < dB ? a : best;
      });
    }

    // Priority 2: advance toward the Allied trench (increase y)
    const moves = legalActions.filter(a => a.type === 'move');
    if (moves.length) {
      // Pick the move that reaches the highest y (closest to trench)
      return moves.reduce((best, a) => a.to.y > best.to.y ? a : best);
    }

    return legalActions.find(a => a.type === 'end-turn');
  },
};

// ---------------------------------------------------------------------------
// Allied greedy agent — shoot the nearest/weakest enemy, stay in cover
// ---------------------------------------------------------------------------

const AlliesGreedyAgent = {
  id: 'allies-greedy',
  chooseAction(state, legalActions) {
    const myId = state.activePlayers[0];

    // Priority 1: shoot — target lowest HP enemy
    const shoots = legalActions.filter(a => a.type === 'shoot');
    if (shoots.length) {
      return shoots.reduce((best, a) => {
        const tA = state.units.find(u => u.id === a.targetId);
        const tB = state.units.find(u => u.id === best.targetId);
        return (tA?.hp ?? 999) < (tB?.hp ?? 999) ? a : best;
      });
    }

    // Priority 2: heal if any adjacent wounded ally
    const heals = legalActions.filter(a => a.type === 'heal');
    if (heals.length) return heals[0];

    // Priority 3: move — stay in the trench / sandbags (don't advance above y=7)
    const moves = legalActions.filter(a => a.type === 'move' && a.to.y >= 7);
    if (moves.length) {
      // Move to the spot with highest y (deepest cover)
      return moves.reduce((best, a) => a.to.y > best.to.y ? a : best);
    }

    return legalActions.find(a => a.type === 'end-turn');
  },
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isAuto = process.argv.includes('--auto');

const players = [
  { id: 'allies', name: 'Allies', agent: isAuto ? AlliesGreedyAgent : new HumanAgent('ALLIES') },
  { id: 'axis',   name: 'Axis',   agent: AxisGreedyAgent },
];

const engine = new GameEngine(MudAndBloodGame, players, { maxTurns: 120 });

if (isAuto) {
  console.log('Mud and Blood 2 — auto simulation\n');
  const { result, finalState } = await engine.run();
  console.log(MudAndBloodGame.renderState(finalState));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log('Mud and Blood 2  —  you command the ALLIED forces');
  console.log('Units: R=Rifleman  M=MG  S=Sniper  +=Medic');
  console.log('Enemy: g=Grenadier  m=MG42  o=Officer');
  console.log('Terrain: T=Trench(-50% hit)  s=Sandbag(-35%)  o=Crater(-20%)  ~=Barbed-wire(2AP)\n');
  console.log('Survive all 6 waves. If a German reaches row 8 (trench), you lose.\n');

  while (!engine.result) {
    console.log('\n' + MudAndBloodGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\n' + MudAndBloodGame.renderState(engine.state));
  console.log('\nResult:', engine.result);

  const agent = players[0].agent;
  if (agent instanceof HumanAgent) agent.close();
}
