#!/usr/bin/env node
// Benchmark the generic AI (src/agents/generic) across games and (space × time ×
// play) modes, in SEAT-SWAPPED pairs so neither side's seat advantage counts.
//
//   node demo/generic-ai-bench.mjs                        # Arena, all 8 modes, vs random
//   node demo/generic-ai-bench.mjs --vs=greedy-generic    # vs 1-ply greedy on the same evaluation
//   node demo/generic-ai-bench.mjs --game=ffta --vs=greedy --pairs=5
//   node demo/generic-ai-bench.mjs --game=close-quarters --vs=greedy-generic
//   node demo/generic-ai-bench.mjs --modes=dd-seq,cc-sim --fog
//
// Games: arena (all 8 modes); ffta, a grid skirmish with a hand-written evaluator
// to measure against; and Arena's reference scenarios (games/arena/specs): magic,
// scifi, hex, regions (discrete space only) and close-quarters, where facing,
// vision cones and reloading decide fights — the generic AI's measured weak spot.
// Opponents: random | greedy (the game's own evaluateState) | greedy-generic
// (GreedyAgent on the generic evaluation) | generic.
// Modes: <space><time>-<play>, d/c for discrete/continuous, e.g. dc-sim. A game
// with a board and clock of its own (ffta) takes the play alone: seq or sim.

import { GameEngine } from '#core/engine/index.js';
import { RandomAgent } from '#core/agents/RandomAgent.js';
import { makeGreedyAgent } from '#core/agents/GreedyAgent.js';
import { makeGenericAgent, genericEvaluateState } from '#core/agents/generic/GenericAgent.js';
import { ArenaGame } from '../games/arena/index.js';
import { FFTAGame } from '../games/ffta/index.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const ALL = ['dd-seq', 'dd-sim', 'dc-seq', 'dc-sim', 'cd-seq', 'cd-sim', 'cc-seq', 'cc-sim'];
const GAMES = {
  arena: { game: ArenaGame, ids: ['p1', 'p2'], modes: ALL, maxTurns: 40 },
  ffta: { game: FFTAGame, ids: ['p1', 'p2'], modes: ['seq', 'sim'], maxTurns: 100 },
  ...Object.fromEntries(['magic', 'scifi', 'hex', 'regions', 'close-quarters'].map(spec => [spec, {
    game: ArenaGame, ids: ['p1', 'p2'], maxTurns: 40, config: { spec },
    modes: ['hex', 'regions'].includes(spec) ? ALL.filter(m => m.startsWith('d')) : ALL,
  }])),
};
const gameName = args.game ?? 'arena';
const { game, ids, modes: gameModes, config: gameConfig = {} } = GAMES[gameName];
const pairs = Number(args.pairs ?? 3);
const maxTurns = Number(args.maxTurns ?? GAMES[gameName].maxTurns);
const timeMs = Number(args.timeMs ?? 150);
const vs = args.vs ?? 'random';
const modes = args.modes ? String(args.modes).split(',') : gameModes;
const S = { d: 'discrete', c: 'continuous' };

function opponent() {
  if (vs === 'random') return RandomAgent;
  if (vs === 'greedy') return makeGreedyAgent(game);
  if (vs === 'greedy-generic') return makeGreedyAgent({ ...game, evaluateState: genericEvaluateState(game) });
  if (vs === 'generic') return makeGenericAgent(game, { timeMs });
  throw new Error(`unknown opponent ${vs}`);
}

async function play(mode, genericSeat) {
  const [st, play] = mode.includes('-') ? mode.split('-') : [null, mode];
  const agents = [makeGenericAgent(game, { timeMs }), opponent()];
  if (genericSeat === 1) agents.reverse();
  const players = ids.map((id, i) => ({ id, name: id, agent: agents[i] }));
  const config = { ...gameConfig, ...(st ? { space: S[st[0]], time: S[st[1]] } : {}), simultaneousTurns: play === 'sim', maxTurns, fogOfWar: !!args.fog };
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
