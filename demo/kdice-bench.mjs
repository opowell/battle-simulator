// KDice agent A/B harness: the KDice AI (games/kdice/agent.js) against the AIs that
// played KDice before it — the generic greedy and Obscuro agents, on the game's OLD
// leaf evaluation (territories + dice) and without exact chance outcomes, i.e. exactly
// as they played before the KDice AI landed. Every game is played under the current
// rules (reserve included) and with seeded map + dice, so a run is repeatable.
//
// Seat matters in a turn-based dice game (the first mover strikes first), so a seed
// is never scored alone: in `table` mode one NEW agent sits at a 7-player table of OLD
// ones and the same map is replayed with it in every seat; in `duel` mode the same
// 2-player map is played twice, sides swapped.
//
//   node demo/kdice-bench.mjs <mode> <opponent> <seeds> [startSeed] [--reverse] [--budget=ms] [--players=N]
//
//   mode       table | duel
//   opponent   greedy | obscuro | kdice   (kdice = mirror match, a sanity check)
//   --reverse  table mode: one OLD agent among NEW ones instead
//   --w=JSON   weight overrides for the new agent (see agent.js WEIGHTS)
//   --budget   Obscuro's per-move time budget in ms (default 150 — the in-app default
//              of ~700 makes a 7-seat game take many minutes)
//
// Output: wins for each side and the win rate against the share an equal agent would
// take (1/N at an N-seat table, 50% in a duel).
import { GameEngine } from '../engine/index.js';
import { KDiceGame } from '../games/kdice/index.js';
import { makeKDiceAgent } from '../games/kdice/agent.js';
import { makeGreedyAgent } from '../agents/GreedyAgent.js';
import { ObscuroAgent } from '../agents/ObscuroAgent.js';
import { sidesEval } from '../games/evalHelpers.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = (name, dflt) => {
  const f = process.argv.find(a => a.startsWith(`--${name}`));
  if (!f) return dflt;
  const v = f.includes('=') ? f.slice(f.indexOf('=') + 1) : undefined;
  return v ?? true;
};
const MODE = args[0] ?? 'table';
const OPP = args[1] ?? 'greedy';
const SEEDS = Number(args[2] ?? 5);
const START = Number(args[3] ?? 1);
const REVERSE = !!flag('reverse', false);
const BUDGET = Number(flag('budget', 150));
const N = MODE === 'duel' ? 2 : Number(flag('players', 7));
const MAX_TURNS = 300;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// KDice as the old agents knew it: the old leaf, no chance outcomes.
const OLD_GAME = {
  ...KDiceGame,
  evaluateState: (state, playerId) =>
    sidesEval(Object.values(state.board.territories), playerId, t => 10 + (t.dice ?? 0), t => t.owner),
  getChanceOutcomes: undefined,
};
// The engine hands every agent ITS game as chooseAction's 3rd argument; pin the old one.
const pinned = (agent, game) => ({ id: agent.id, chooseAction: (s, l) => agent.chooseAction(s, l, game) });

const makeOld = () => {
  if (OPP === 'greedy') return pinned(makeGreedyAgent(OLD_GAME), OLD_GAME);
  if (OPP === 'obscuro') return pinned(new ObscuroAgent(OLD_GAME, { timeBudgetMs: BUDGET }), OLD_GAME);
  if (OPP === 'kdice') return makeKDiceAgent();
  throw new Error(`unknown opponent ${OPP}`);
};
// --w='{"threat":0.3}' plays the new side with these weight overrides (tuning).
const NEW_WEIGHTS = JSON.parse(flag('w', '{}'));
const makeNew = () => makeKDiceAgent(NEW_WEIGHTS);

async function game(seed, newSeats) {
  const players = Array.from({ length: N }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, agent: newSeats.includes(i) ? makeNew() : makeOld(),
  }));
  // createInitialState reads config.rng for the map and opening dice; the engine's
  // own rng (also config.rng) then rolls the battles. One seeded stream for both:
  // identical map per seed, and different dice per seating once play diverges.
  const engine = new GameEngine(KDiceGame, players, { maxTurns: MAX_TURNS, rng: mulberry32(seed) });
  const t0 = Date.now();
  const { result } = await engine.run();
  return { winner: result?.winnerId ? Number(result.winnerId.slice(1)) - 1 : -1, ms: Date.now() - t0 };
}

let newWins = 0, oldWins = 0, draws = 0, games = 0;
const bySeat = Array(N).fill(0);
for (let s = START; s < START + SEEDS; s++) {
  const seatings = MODE === 'duel' ? [[0], [1]] : Array.from({ length: N }, (_, i) => [i]);
  for (const seats of seatings) {
    // --reverse: the listed seat is the lone OLD agent; everyone else is new.
    const newSeats = REVERSE ? Array.from({ length: N }, (_, i) => i).filter(i => !seats.includes(i)) : seats;
    const { winner, ms } = await game(s, newSeats);
    games++;
    if (winner < 0) draws++;
    else if (newSeats.includes(winner)) { newWins++; if (!REVERSE) bySeat[winner]++; }
    else { oldWins++; if (REVERSE) bySeat[winner]++; }
    process.stdout.write(`seed ${s} seats ${JSON.stringify(seats)} -> winner p${winner + 1} (${newSeats.includes(winner) ? 'NEW' : winner < 0 ? 'draw' : 'OLD'}) ${ms}ms\n`);
  }
}
const lone = REVERSE ? 'old' : 'new';
const loneWins = REVERSE ? oldWins : newWins;
const fair = MODE === 'duel' ? 0.5 : 1 / N;
console.log(`\n${MODE} vs ${OPP}${REVERSE ? ' (reverse)' : ''}: ${games} games — NEW ${newWins}, OLD ${oldWins}, unfinished ${draws}`);
console.log(`lone ${lone} agent won ${loneWins}/${games} = ${(100 * loneWins / games).toFixed(1)}% (equal strength: ${(100 * fair).toFixed(1)}%)`);
if (MODE === 'table') console.log(`lone agent wins by seat: ${bySeat.join(' ')}`);
