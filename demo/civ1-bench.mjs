// Seat-swapped A/B harness for the civ1 agents. Civ1's seat advantage is large enough
// that an unpaired game says nothing, so every seed is played twice with the sides
// swapped and the pair is the unit of measurement (see games/civ1/AI-DESIGN.md).
//
// As written it measures the stack penalty (ai.js STACK_PENALTY): the agent with it on
// against the identical agent with `stackPenalty: 0`, which is how it behaved before
// units could share a square. Point it at another knob by editing `guard`/`plain`.
//
//   node demo/civ1-bench.mjs <pairs> <maxTurns> [startSeed] [--greedy] [--baseline] [--greedy-mirror]
//
//   --greedy         play the greedy baseline instead of the unguarded heuristic
//   --baseline       ...with the penalty off on our side too, to pair with the above
//   --greedy-mirror  greedy against itself, penalty on vs off
//
// Games mostly time out as draws at 600 turns, so read cities/advances rather than the
// decisive record; `stacked units/turn` is the mechanism check.
import { GameEngine } from '../engine/index.js';
import { Civ1Game } from '../games/civ1/index.js';
import { makeCiv1Agent, makeGreedyAgent } from '../games/civ1/ai.js';

const SEEDS = Number(process.argv[2] ?? 4);
const MAX_TURNS = Number(process.argv[3] ?? 300);
const START = Number(process.argv[4] ?? 1);

// The opponent: the same agent with the penalty off (the pre-change behaviour), or
// --greedy for the standard baseline, to check the change does not cost strength
// against a different sort of player.
const VS_GREEDY = process.argv.includes('--greedy');
// --baseline runs the SAME matchup with the penalty off on both sides, which is how a
// guard-vs-greedy figure gets something to be compared against.
const BASELINE = process.argv.includes('--baseline');
// --greedy-mirror measures the baseline agent's own stack discipline: greedy against
// itself with the penalty off.
const GREEDY_MIRROR = process.argv.includes('--greedy-mirror');
const guard = () => GREEDY_MIRROR ? makeGreedyAgent({ id: 'guard' })
  : makeCiv1Agent({ id: 'guard', ...(BASELINE ? { stackPenalty: 0 } : {}) });
const plain = () => GREEDY_MIRROR ? makeGreedyAgent({ id: 'plain', stackPenalty: 0 })
  : VS_GREEDY ? makeGreedyAgent() : makeCiv1Agent({ id: 'plain', stackPenalty: 0 });

// Units sharing a square outside a city, per side — the thing the penalty targets.
function fieldStacks(state, ownerId) {
  const cityKeys = new Set(state.cities.map(c => `${c.position.x},${c.position.y}`));
  const at = new Map();
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== ownerId) continue;
    const k = `${u.position.x},${u.position.y}`;
    if (cityKeys.has(k)) continue;
    at.set(k, (at.get(k) ?? 0) + 1);
  }
  let extra = 0;
  for (const n of at.values()) if (n > 1) extra += n - 1;   // units riding on someone else's roll
  return extra;
}

async function play(seed, guardSeat) {
  const players = [
    { id: 'p1', name: 'P1', agent: guardSeat === 0 ? guard() : plain() },
    { id: 'p2', name: 'P2', agent: guardSeat === 1 ? guard() : plain() },
  ];
  const guardId = guardSeat === 0 ? 'p1' : 'p2';
  const plainId = guardSeat === 0 ? 'p2' : 'p1';

  const engine = new GameEngine(Civ1Game, players, { maxTurns: MAX_TURNS, seed });
  engine._init();
  let samples = 0, gStack = 0, pStack = 0, lastTurn = -1;
  while (!engine.result) {
    const { done } = await engine.step();
    const s = engine.state;
    if (s.turnNumber !== lastTurn && s.turnNumber % 10 === 0) {
      lastTurn = s.turnNumber;
      samples++;
      gStack += fieldStacks(s, guardId);
      pStack += fieldStacks(s, plainId);
    }
    if (done) break;
  }
  const s = engine.state;
  const count = (id, arr, key) => arr.filter(x => x[key] === id).length;
  const ev = Civ1Game.evaluateState?.(s, guardId);
  return {
    seed, guardSeat,
    outcome: engine.result?.outcome,
    winner: engine.result?.winnerId ?? null,
    guardWon: engine.result?.outcome === 'win' && engine.result?.winnerId === guardId,
    plainWon: engine.result?.outcome === 'win' && engine.result?.winnerId === plainId,
    turns: s.turnNumber,
    gCities: count(guardId, s.cities, 'ownerId'),
    pCities: count(plainId, s.cities, 'ownerId'),
    gUnits: s.units.filter(u => u.alive && u.ownerId === guardId).length,
    pUnits: s.units.filter(u => u.alive && u.ownerId === plainId).length,
    gTechs: (s.gameSpecific.civ?.[guardId]?.techs ?? []).length,
    pTechs: (s.gameSpecific.civ?.[plainId]?.techs ?? []).length,
    ev,
    gStackAvg: samples ? gStack / samples : 0,
    pStackAvg: samples ? pStack / samples : 0,
  };
}

const rows = [];
const t0 = Date.now();
for (let i = 0; i < SEEDS; i++) {
  const seed = START + i;
  for (const guardSeat of [0, 1]) {
    const r = await play(seed, guardSeat);
    rows.push(r);
    console.log(`seed ${seed} guard=${guardSeat === 0 ? 'p1' : 'p2'} ${r.outcome}`
      + ` winner=${r.winner ?? '-'} turns=${r.turns}`
      + ` cities ${r.gCities}-${r.pCities} units ${r.gUnits}-${r.pUnits} techs ${r.gTechs}-${r.pTechs}`
      + ` stacked/turn ${r.gStackAvg.toFixed(2)}-${r.pStackAvg.toFixed(2)}`
      + ` (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const n = rows.length;
console.log('\n=== ' + n + ' games (' + SEEDS + ' seat-swapped pairs), maxTurns ' + MAX_TURNS + ' ===');
console.log('decisive:', sum(r => r.guardWon), 'guard -', sum(r => r.plainWon), 'plain,',
            rows.filter(r => r.outcome !== 'win').length, 'undecided');
console.log('cities  :', (sum(r => r.gCities) / n).toFixed(2), 'vs', (sum(r => r.pCities) / n).toFixed(2));
console.log('units   :', (sum(r => r.gUnits) / n).toFixed(2), 'vs', (sum(r => r.pUnits) / n).toFixed(2));
console.log('techs   :', (sum(r => r.gTechs) / n).toFixed(2), 'vs', (sum(r => r.pTechs) / n).toFixed(2));
console.log('stacked units/turn in the field:',
            (sum(r => r.gStackAvg) / n).toFixed(2), 'vs', (sum(r => r.pStackAvg) / n).toFixed(2));
console.log('total time', ((Date.now() - t0) / 1000).toFixed(0) + 's');
