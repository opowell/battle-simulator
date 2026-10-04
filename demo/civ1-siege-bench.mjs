// Balance harness for civ1's Siege fixed battle (games/civ1/fixedMaps.js): the heuristic
// agent on both sides, fog on, N games, and how they end. The engine's dice are
// Math.random — the seed below only fixes the agents' own tie-breaks — so read the rate
// over 100+ games, not a handful.
//
//   node demo/civ1-siege-bench.mjs <games> [--map ID] [--size N] [--walls]
//
//   --map ID   another fixed battle from the same file (default: siege) — whatever its
//              objective; "attacker" is the side its objective names, seat 1 or 2
//   --size N   the city's size (the map says 3): a beaten garrison costs a citizen and
//              a city with none left is razed, so this is the attacker's win count
//   --walls    give the city City Walls (no shrinking, x3 defence against land units)
//   --swap S   re-arm the defender, e.g. "17,7:catapult->phalanx*2" (see below)
//
// Besides the result it reports what the forts and the sorties did, so a change to the
// defender's play can be checked by its mechanism and not only by the score.
import { GameEngine } from '../engine/index.js';
import { Civ1Game } from '../games/civ1/index.js';
import { makeCiv1Agent } from '../games/civ1/ai.js';
import { getFixedMap } from '../games/civ1/fixedMaps.js';

const GAMES = Number(process.argv[2] ?? 50);
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const SIZE = arg('--size');
const WALLS = process.argv.includes('--walls');

const MAP = arg('--map') ?? 'siege';
const map = getFixedMap(MAP);
const city = map.cities?.[0] ?? null;
const ATT = `p${map.objective.attacker}`, DEF = `p${map.objective.defender}`;
if (SIZE != null) city.size = Number(SIZE);
if (WALLS) city.buildings = [...new Set([...(city.buildings ?? []), 'city-walls'])];
// --swap "17,7:catapult->phalanx*2;18,6:knights->chariot" turns up to N of the
// defender's units of one type on a square into another type, to try a different
// garrison without editing the map.
for (const part of (arg('--swap') ?? '').split(';').filter(Boolean)) {
  const [where, what] = part.split(':');
  const [x, y] = where.split(',').map(Number);
  const [fromType, rest] = what.split('->');
  const [toType, n = '1'] = rest.split('*');
  let left = Number(n);
  for (const u of map.units) {
    if (left > 0 && u.side === map.objective.defender && u.x === x && u.y === y && u.type === fromType) { u.type = toType; left--; }
  }
}
const forts = (map.fortresses ?? []).map(([x, y]) => `${x},${y}`);

const tally = { attacker: 0, defender: 0, other: 0, turns: 0, reasons: {} };
const sum = { attLost: 0, defLost: 0, fortsHeldT5: 0, fortsHeldEnd: 0, fortsTaken: 0, sorties: 0, sortieKills: 0 };

for (let g = 0; g < GAMES; g++) {
  const engine = new GameEngine(Civ1Game, [
    { id: 'p1', name: 'Attacker', agent: makeCiv1Agent({ id: 'att' }) },
    { id: 'p2', name: 'Defender', agent: makeCiv1Agent({ id: 'def' }) },
  ], { seed: 1000 + g, scenario: MAP, fogOfWar: true });
  engine._init();

  const held = (s, owner) => forts.filter(k => s.units.some(u => u.alive && u.ownerId === owner && `${u.position.x},${u.position.y}` === k)).length;
  let sawT5 = false;
  const knightsOut = new Map();   // defender rider id -> turn it left the city
  const cityKey = city ? `${city.x},${city.y}` : null;
  let prevBattles = 0;
  while (!engine.result) {
    const { done } = await engine.step();
    const s = engine.state;
    if (!sawT5 && s.turnNumber >= 5) { sum.fortsHeldT5 += held(s, DEF); sawT5 = true; }
    // A sortie: a defender horseman outside the city that struck from there.
    for (const b of s.gameSpecific.battles ?? []) {
      if (b.n <= prevBattles) continue;
      const from = `${b.from.x},${b.from.y}`;
      if (b.attacker.ownerId === DEF && ['knights', 'chariot'].includes(b.attacker.type) && from !== cityKey) {
        sum.sorties++;
        if (b.won) sum.sortieKills++;
      }
    }
    prevBattles = s.gameSpecific.battles?.at(-1)?.n ?? prevBattles;
    if (done) break;
  }
  const s = engine.state;
  const r = engine.result ?? { reason: 'none' };
  tally.reasons[r.reason] = (tally.reasons[r.reason] ?? 0) + 1;
  if (r.winnerId === ATT) tally.attacker++;
  else if (r.winnerId === DEF) tally.defender++;
  else tally.other++;
  tally.turns += s.turnNumber;
  const dead = owner => s.units.filter(u => u.ownerId === owner && !u.alive).length;
  sum.attLost += dead(ATT);
  sum.defLost += dead(DEF);
  sum.fortsHeldEnd += held(s, DEF);
  sum.fortsTaken += held(s, ATT);
}

const pct = n => `${(100 * n / GAMES).toFixed(0)}%`;
const avg = n => (n / GAMES).toFixed(2);
console.log(`${MAP} (${map.objective.type}, attacker ${ATT}) x${GAMES}${city ? `  city size ${city.size}` : ''}${WALLS ? ' + walls' : ''}`);
console.log(`  attacker wins ${tally.attacker} (${pct(tally.attacker)})  defender ${tally.defender} (${pct(tally.defender)})  other ${tally.other}  avg end turn ${avg(tally.turns)}`);
console.log(`  reasons ${JSON.stringify(tally.reasons)}`);
console.log(`  units lost/game: attacker ${avg(sum.attLost)}  defender ${avg(sum.defLost)}`);
console.log(`  forts (of ${forts.length}) held by the defender: turn 5 ${avg(sum.fortsHeldT5)}, at the end ${avg(sum.fortsHeldEnd)}; held by the attacker at the end ${avg(sum.fortsTaken)}`);
console.log(`  sorties/game ${avg(sum.sorties)} (won ${avg(sum.sortieKills)})`);
