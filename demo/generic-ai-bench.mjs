#!/usr/bin/env node
// Benchmark the generic AI (agents/generic) across games and (space × time ×
// play) modes, in SEAT-SWAPPED pairs so neither side's seat advantage counts.
//
//   node demo/generic-ai-bench.mjs                        # Arena, all 8 modes, vs random
//   node demo/generic-ai-bench.mjs --vs=greedy-generic    # vs 1-ply greedy on the same evaluation
//   node demo/generic-ai-bench.mjs --game=tactical --vs=greedy --pairs=5
//   node demo/generic-ai-bench.mjs --modes=dd-seq,cc-sim --fog
//
// Opponents: random | greedy (the game's own evaluateState) | greedy-generic
// (GreedyAgent on the generic evaluation) | generic.
// Modes: <space><time>-<play>, d/c for discrete/continuous, e.g. dc-sim.

import { GameEngine } from '../engine/index.js';
import { RandomAgent } from '../agents/RandomAgent.js';
import { makeGreedyAgent } from '../agents/GreedyAgent.js';
import { makeGenericAgent, genericEvaluateState } from '../agents/generic/GenericAgent.js';
import { ArenaGame } from '../games/arena/index.js';
import { TacticalGame } from '../games/tactical/index.js';
import { CsMiniGame } from '../games/csmini/index.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const GAMES = { arena: ArenaGame, tactical: TacticalGame, csmini: CsMiniGame };
const gameName = args.game ?? 'arena';
const game = GAMES[gameName];
const pairs = Number(args.pairs ?? 3);
const maxTurns = Number(args.maxTurns ?? 40);
const timeMs = Number(args.timeMs ?? 150);
const vs = args.vs ?? 'random';
const ALL = ['dd-seq', 'dd-sim', 'dc-seq', 'dc-sim', 'cd-seq', 'cd-sim', 'cc-seq', 'cc-sim'];
const modes = args.modes ? String(args.modes).split(',') : (gameName === 'arena' ? ALL : ['dd-seq', 'dd-sim']);
const S = { d: 'discrete', c: 'continuous' };

function opponent() {
  if (vs === 'random') return RandomAgent;
  if (vs === 'greedy') return makeGreedyAgent(game);
  if (vs === 'greedy-generic') return makeGreedyAgent({ ...game, evaluateState: genericEvaluateState(game) });
  if (vs === 'generic') return makeGenericAgent(game, { timeMs });
  throw new Error(`unknown opponent ${vs}`);
}

async function play(mode, genericSeat) {
  const [st, play] = mode.split('-');
  const ids = gameName === 'csmini' ? ['ct', 't'] : ['p1', 'p2'];
  const agents = [makeGenericAgent(game, { timeMs }), opponent()];
  if (genericSeat === 1) agents.reverse();
  const players = ids.map((id, i) => ({ id, name: id, agent: agents[i] }));
  const config = { space: S[st[0]], time: S[st[1]], simultaneousTurns: play === 'sim', maxTurns, fogOfWar: !!args.fog };
  const engine = new GameEngine(game, players, config);
  const { result } = await engine.run();
  const genericId = ids[genericSeat];
  return result.outcome === 'win' ? (result.winnerId === genericId ? 'W' : 'L') : 'D';
}

console.log(`generic vs ${vs} on ${gameName}${args.fog ? ' (fog)' : ''} — ${pairs} seat-swapped pairs per mode, maxTurns ${maxTurns}, ${timeMs}ms/decision`);
const total = { W: 0, L: 0, D: 0 };
for (const mode of modes) {
  const tally = { W: 0, L: 0, D: 0 };
  const t0 = Date.now();
  for (let i = 0; i < pairs; i++) for (const seat of [0, 1]) tally[await play(mode, seat)]++;
  for (const k of 'WLD') total[k] += tally[k];
  console.log(`${mode.padEnd(7)} W ${tally.W}  L ${tally.L}  D ${tally.D}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`total   W ${total.W}  L ${total.L}  D ${total.D}`);
