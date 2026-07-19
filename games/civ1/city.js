// Civ1 city economics: what a city works, produces, earns, and how it grows.
//
// Everything the original computes on the "city screen" lives here, driven by plain
// data from terrain.js / specials.js / improvements.js / governments.js. The rules
// are the 1991 game's, in a compact form:
//   - a city works its centre tile free plus one tile per citizen, chosen from the
//     21-square "fat cross" around it;
//   - food feeds citizens (2 each) and the surplus fills a box that grows the city;
//   - trade splits into tax / luxury / science by the government's rates, after
//     corruption, then improvements multiply each stream;
//   - happiness decides whether the city works at all (civil disorder stops it).

import { TERRAIN } from './terrain.js';
import { tileYield } from './specials.js';
import { IMPROVEMENTS, WONDERS } from './improvements.js';
import { wrapX } from './map.js';

// The 21 squares a city may work: the 5x5 block around the centre minus its four
// corners. Includes the centre (0,0), worked for free.
export const FAT_CROSS = (() => {
  const out = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (!(Math.abs(dx) === 2 && Math.abs(dy) === 2)) out.push([dx, dy]);
  return out;
})();

// Terrains irrigation and mining act on, matching the original: irrigation adds food
// on the flatter, wetter squares; mining adds shields on hills and mountains.
const IRRIGABLE = new Set(['desert', 'grassland', 'plains', 'hills', 'swamp', 'tundra']);
const MINEABLE = { hills: 2, mountains: 1 };
// Roads lay trade on the squares the original gives a trade arrow to.
const ROAD_TRADE = new Set(['desert', 'grassland', 'plains']);

// Yield of one square as actually worked: terrain + special, then the tile's own
// improvements (irrigation / mine / road), then the government's positive and
// negative trade rules. `ctx` carries the owner's government and wonders.
export function workedTileYield(tile, x, y, ctx) {
  const terrain = tile.terrain;
  const base = TERRAIN[terrain] ?? TERRAIN.plains;
  let { food, shields, trade } = tileYield(base, terrain, x, y);

  if (tile.irrigated && IRRIGABLE.has(terrain)) food += 1;
  if (tile.mined && MINEABLE[terrain]) shields += MINEABLE[terrain];
  if (tile.hasRoad && ROAD_TRADE.has(terrain)) trade += 1;

  // Despotism/Anarchy dock 1 from any yield of 3+ (the Pyramids cancel this).
  if (ctx.gov.despotismPenalty && !ctx.wonderEffects.has('negate-despotism-penalty')) {
    if (food >= 3) food -= 1;
    if (shields >= 3) shields -= 1;
    if (trade >= 3) trade -= 1;
  }
  // Republic/Democracy add a trade arrow to any square already trading.
  if (ctx.gov.tradeBonus && trade >= 1) trade += 1;

  return { food, shields, trade };
}

// Existing tiles a city may work, as {x, y, key, yield}, best-valued first and with
// squares another of the owner's cities is already working removed.
function candidateTiles(city, ctx) {
  const { board, width } = ctx;
  const out = [];
  for (const [dx, dy] of FAT_CROSS) {
    const y = city.position.y + dy;
    if (y < 0 || y >= board.height) continue;
    const x = wrapX(city.position.x + dx, width);
    const key = `${x},${y}`;
    const tile = board.tiles[key];
    if (!tile) continue; // ocean tiles are workable (fishing) — only missing tiles skip
    const center = dx === 0 && dy === 0;
    if (!center && ctx.takenTiles.has(key)) continue;
    const y3 = workedTileYield(tile, x, y, ctx);
    out.push({ x, y, key, center, yield: y3 });
  }
  return out;
}

const tileValue = t => t.yield.food * 1.4 + t.yield.shields * 1.1 + t.yield.trade;

// Assign the city's citizens to its best tiles and total the raw yield. The centre is
// always worked and free; `size` more tiles are picked by value. Returns the worked
// tiles (for display) and gross { food, shields, trade } before upkeep and taxes.
export function assignWorkers(city, ctx) {
  const cands = candidateTiles(city, ctx);
  const center = cands.find(c => c.center);
  const workers = cands.filter(c => !c.center).sort((a, b) => tileValue(b) - tileValue(a)).slice(0, city.size);

  // The centre square always yields at least 1 food / 1 shield / 1 trade.
  const cy = center ? center.yield : { food: 0, shields: 0, trade: 0 };
  let food = Math.max(1, cy.food), shields = Math.max(1, cy.shields), trade = Math.max(1, cy.trade);
  const worked = [center, ...workers].filter(Boolean);
  for (const w of workers) { food += w.yield.food; shields += w.yield.shields; trade += w.yield.trade; }

  return { worked, food, shields, trade };
}

// ── Improvement/wonder bonus helpers ───────────────────────────────────────────

// Sum a per-city fractional bonus (sciBonus / taxBonus / shieldBonus) over the city's
// own buildings and wonders. Civ-wide wonder bonuses are added by the caller via ctx.
function bonusFrom(city, field) {
  let b = 0;
  for (const id of city.buildings) {
    b += IMPROVEMENTS[id]?.[field] ?? 0;
    b += WONDERS[id]?.[field] ?? 0;
  }
  return b;
}

// ── Happiness ──────────────────────────────────────────────────────────────────
//
// Citizens start content up to a baseline; the rest are unhappy. Luxuries, temples,
// colosseums, cathedrals, martial law and wonders pacify unhappy citizens (and turn
// content ones happy). If unhappy outnumber happy the city falls into civil disorder.

// Fallback when no difficulty rules are present on the state (e.g. bare unit tests).
const CONTENT_BASELINE = 4;

// How many unhappy citizens this city's content-makers pacify: temples (doubled by
// Mysticism or the Oracle), colosseums, cathedrals, civ-wide wonders that act as one
// of those, courthouses, and martial law from a garrison.
function contentMakers(city, ctx) {
  let c = 0;
  for (const id of city.buildings) {
    const imp = IMPROVEMENTS[id];
    if (!imp?.content) continue;
    let amt = imp.content;
    if (imp.contentDoubledBy && (ctx.techs.has(imp.contentDoubledBy) || ctx.wonderEffects.has('double-temples'))) amt *= 2;
    c += amt;
  }
  for (const wid of ctx.wonderIds) {
    const w = WONDERS[wid];
    if (w?.effect === 'cathedral-all') c += 3;
    else if (w?.effect === 'content-all') c += w.content ?? 0;
  }
  c += Math.min(ctx.gov.martialLaw, ctx.garrison);
  return c;
}

export function computeHappiness(city, luxuryPoints, ctx) {
  const size = city.size;
  const baseline = ctx.contentBaseline ?? CONTENT_BASELINE;
  let unhappy = Math.max(0, size - baseline);
  let content = size - unhappy;
  let happy = 0;

  // Pacifiers turn unhappy -> content; leftover luxury faces turn content -> happy.
  let faces = contentMakers(city, ctx) + Math.floor(luxuryPoints / 2);
  const u2c = Math.min(unhappy, faces);
  unhappy -= u2c; content += u2c; faces -= u2c;
  const c2h = Math.min(content, faces);
  content -= c2h; happy += c2h;

  // Wonders that grant happy faces directly (e.g. Cure for Cancer, civ-wide).
  for (const wid of ctx.wonderIds) {
    const w = WONDERS[wid];
    if (w?.effect === 'happy-all' && w.happy) {
      const t = Math.min(content, w.happy); content -= t; happy += t;
    }
  }

  const disorder = unhappy > happy;
  return { happy, content, unhappy, disorder };
}

// ── Full city output ────────────────────────────────────────────────────────────
//
// Gross yields -> upkeep -> taxes/science -> happiness. Returns everything the turn
// processing and the city screen need. Does not mutate the city.
export function computeCity(city, baseCtx) {
  // Overlay the per-city facts (garrison size) onto the shared owner context.
  const ctx = { ...baseCtx, garrison: baseCtx.garrisonByCity.get(city.id) ?? 0 };
  const gross = assignWorkers(city, ctx);

  // Shield upkeep: units homed here beyond the free allowance cost 1 shield each.
  // Despotism/Monarchy/Communism support up to `size` units free; Republic/Democracy
  // pay for every unit.
  const freeSupport = ctx.gov.tradeBonus ? 0 : city.size;
  const supported = ctx.supportedUnits.get(city.id) ?? 0;
  const shieldUpkeep = Math.max(0, supported - freeSupport);
  let shields = Math.max(0, gross.shields - shieldUpkeep);
  const shieldMult = 1 + bonusFrom(city, 'shieldBonus') + ctx.civShieldBonus;
  shields = Math.floor(shields * shieldMult);

  // Corruption removes a fraction of trade, worse the farther from the capital, nil at
  // the palace and under Democracy. Courthouse/Palace reduce it.
  let corr = ctx.gov.corruption;
  if (ctx.capitalPos) {
    const dxr = Math.abs(city.position.x - ctx.capitalPos.x);
    const dx = Math.min(dxr, ctx.width - dxr);
    const cheb = Math.max(dx, Math.abs(city.position.y - ctx.capitalPos.y));
    corr *= Math.min(1, cheb / 16);
  }
  for (const id of city.buildings) corr *= (1 - (IMPROVEMENTS[id]?.corruptionReduce ?? 0));
  const trade = Math.max(0, Math.round(gross.trade * (1 - corr)));

  // Split trade into luxury / tax / science by the government's rates.
  const luxRate = ctx.luxRate, taxRate = ctx.taxRate;
  const luxury = Math.round(trade * luxRate / 100);
  const taxRaw = Math.round(trade * taxRate / 100);
  const sciRaw = Math.max(0, trade - luxury - taxRaw);
  const gold = Math.floor(taxRaw * (1 + bonusFrom(city, 'taxBonus')));
  const science = Math.floor(sciRaw * (1 + bonusFrom(city, 'sciBonus') + ctx.civSciBonus));

  const happiness = computeHappiness(city, luxury, ctx);

  // Food: 2 per citizen, plus 1 per settler homed here (2 under Republic/Democracy).
  const settlerFood = (ctx.settlersHomed.get(city.id) ?? 0) * (ctx.gov.tradeBonus ? 2 : 1);
  const foodUpkeep = city.size * 2 + settlerFood;
  const foodSurplus = happiness.disorder ? 0 : gross.food - foodUpkeep;

  return {
    worked: gross.worked,
    grossFood: gross.food, grossShields: gross.shields, grossTrade: gross.trade,
    foodSurplus,
    shields: happiness.disorder ? 0 : shields,
    trade, gold: happiness.disorder ? 0 : gold, science: happiness.disorder ? 0 : science,
    luxury,
    happiness,
    maintenance: cityMaintenance(city),
  };
}

// Gold each city pays per turn for its improvements (wonders have no upkeep).
export function cityMaintenance(city) {
  let m = 0;
  for (const id of city.buildings) m += IMPROVEMENTS[id]?.maint ?? 0;
  return m;
}

// Food box that must fill to grow to the next size (Granary keeps half on growth).
export function foodBox(size) { return (size + 1) * 10; }
