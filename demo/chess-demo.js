import { GameEngine } from '../engine/index.js';
import { ChessGame } from '../games/chess/index.js';
import { RandomAgent, HumanAgent, makeGreedyAgent } from '../agents/index.js';

const isAuto = process.argv.includes('--auto');
// `--scenario=<id>` picks one of ChessGame.scenarios — the same five the web UI's
// Scenario picker offers. The three non-standard ones move the game into another
// quadrant of the (space × time) plane (games/chess/spacetime.js): pieces that hop
// on a clock, or slide as bodies through continuous space. Random play there is
// noise on a board of 30-odd destinations per piece, so the computer plays the
// generic 1-ply greedy agent against the variant's own heuristic instead.
const scenarioId = (process.argv.find(a => a.startsWith('--scenario=')) ?? '').split('=')[1] ?? 'standard';
const scenario = ChessGame.scenarios.find(s => s.id === scenarioId);
if (!scenario) {
  console.error(`Unknown scenario "${scenarioId}". One of: ${ChessGame.scenarios.map(s => s.id).join(', ')}`);
  process.exit(1);
}
const { players: _seats, maxTurns, ...config } = scenario.config;
const isStandard = scenarioId === 'standard' || scenarioId === 'fog';
const cpu = () => (isStandard ? RandomAgent : makeGreedyAgent(ChessGame));

const human = new HumanAgent('You');

const players = [
  { id: 'white', name: 'White', agent: isAuto ? cpu() : human },
  { id: 'black', name: 'Black', agent: cpu() },
];

// A "step" is one action, and in the continuous-time quadrants a single instant of
// clock costs one per piece ordered plus a `wait` from each side — so run()'s default
// budget (maxTurns x seats x 20, sized for one move per turn) runs out long before
// the game does. Only run() is bounded this way; a live session steps unbounded.
const stepLimit = config.time === 'continuous' ? 200000 : undefined;
const engine = new GameEngine(ChessGame, players, { ...config, maxTurns: maxTurns ?? 200, stepLimit });

if (isAuto) {
  const { result, log } = await engine.run();
  for (const entry of log) {
    const actions = entry.playerActions.map(pa => formatAction(pa)).join(', ');
    console.log(`Turn ${entry.turnNumber} [${entry.phase}] ${actions}`);
  }
  console.log('\nFinal board:');
  console.log(ChessGame.renderState(engine.state));
  console.log('\nResult:', result);
} else {
  engine._init();
  console.log(`Chess (${scenario.name}) — you play White, computer plays Black.`);
  console.log(scenario.description);
  while (!engine.result) {
    console.log('\n' + ChessGame.renderState(engine.state));
    const { done } = await engine.step();
    if (done) break;
  }
  console.log('\nFinal board:');
  console.log(ChessGame.renderState(engine.state));
  console.log('Result:', engine.result);
  human.close();
}

function formatAction({ playerId, action }) {
  if (action.type === 'castle') return `${playerId}: O-O${action.side === 'queenside' ? '-O' : ''}`;
  if (action.type === 'move' || action.type === 'order') {
    const cap = action.isCapture ? 'x' : '-';
    const promo = action.payload?.promote ? `=${action.payload.promote[0].toUpperCase()}` : '';
    // Journeys (the non-standard quadrants) name the route as well as the ends —
    // a knight's three ways round its L are three different moves there.
    const via = action.path?.length > 1 && !action.isDoublePush ? ` [${action.path.length} steps]` : '';
    return `${playerId}: ${action.from}${cap}${action.to}${promo}${via}`;
  }
  if (action.type === 'cancel') return `${playerId}: call off ${action.unitId}`;
  if (action.type === 'wait') return `${playerId}: wait`;
  return `${playerId}: ${JSON.stringify(action)}`;
}
