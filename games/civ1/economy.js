// Civ1 owner-level economy: the per-turn bookkeeping that sits above single cities —
// treasury, research, government, wonders — plus the context object city.js needs.
//
// createInitialState seeds each player a civ record (see newCivState). At the end of a
// player's turn Civ1Game calls processOwnerEconomy, which runs every city through
// city.js, banks the gold and science, grows or starves cities, finishes production,
// pays maintenance, and advances research.

import { UNITS } from './units.js';
import { TECHS, researchableTechs, techCost } from './tech.js';
import { IMPROVEMENTS, WONDERS, SPACESHIP, improvementDef } from './improvements.js';
import { GOVERNMENTS } from './governments.js';
import { computeCity, cityMaintenance, foodBox } from './city.js';
import { findAdjacentFree } from './map.js';

// A fresh civilization: Despotism, no advances, a small starting treasury, taxes at
// 50/50 tax/science with no luxuries, and no research target yet.
export function newCivState() {
  return {
    government: 'despotism',
    anarchyTurns: 0,       // >0 while a revolution is in progress
    techs: [],             // researched advance ids
    futureTechs: 0,        // completions of Future Tech, the one repeatable advance
    research: null,        // advance currently being researched
    bulbs: 0,              // accumulated science toward `research`
    gold: 0,
    taxRate: 50,           // % of trade to the treasury
    luxRate: 0,            // % of trade to luxuries; science gets the rest
    // Space race: parts accumulate here; once launched the ship travels to Alpha
    // Centauri and its owner wins on arrival (see getResult in Civ1Game).
    spaceship: { structural: 0, component: 0, module: 0, launched: false, arrivesTurn: null },
  };
}

// Everything city.js needs about the owner this turn (government, wonders, tech,
// support/garrison tallies). takenTiles accumulates as cities are assigned in order so
// two of the owner's cities never work the same square.
export function buildOwnerCtx(state, ownerId) {
  const civ = state.gameSpecific.civ[ownerId];
  const known = new Set(civ.techs);
  const gov = GOVERNMENTS[civ.government];
  const ownerCities = state.cities.filter(c => c.ownerId === ownerId);

  const wonderIds = [];
  for (const c of ownerCities) for (const b of c.buildings ?? []) if (WONDERS[b]) wonderIds.push(b);
  const wonderEffects = new Set(wonderIds.map(id => WONDERS[id].effect));
  const capital = ownerCities.find(c => (c.buildings ?? []).includes('palace'));

  const supportedUnits = new Map();
  const settlersHomed = new Map();
  const garrisonByCity = new Map();
  for (const c of ownerCities) garrisonByCity.set(c.id, 0);
  for (const u of state.units) {
    if (!u.alive || u.ownerId !== ownerId) continue;
    if (u.homeCityId != null) {
      supportedUnits.set(u.homeCityId, (supportedUnits.get(u.homeCityId) ?? 0) + 1);
      if (u.type === 'settlers') settlersHomed.set(u.homeCityId, (settlersHomed.get(u.homeCityId) ?? 0) + 1);
    }
    if (UNITS[u.type].defense > 0 && u.type !== 'settlers') {
      const onCity = ownerCities.find(c => c.position.x === u.position.x && c.position.y === u.position.y);
      if (onCity) garrisonByCity.set(onCity.id, (garrisonByCity.get(onCity.id) ?? 0) + 1);
    }
  }

  return {
    board: state.board, width: state.board.width,
    gov, govId: civ.government, techs: known,
    wonderIds, wonderEffects,
    capitalPos: capital?.position ?? null,
    taxRate: civ.taxRate, luxRate: civ.luxRate,
    // Difficulty rule shared by every civ (symmetric — see difficulty.js).
    contentBaseline: state.gameSpecific.rules?.contentBaseline,
    civSciBonus: wonderEffects.has('science-all') ? 0.5 : 0,
    civShieldBonus: wonderEffects.has('power-all') ? 0.5 : 0,
    supportedUnits, settlersHomed, garrisonByCity,
    takenTiles: new Set(),
  };
}

// Wonders already built anywhere in the world — one per world. Handed back as a COPY:
// processOwnerEconomy adds to it as cities finish wonders during the turn, and the
// cached set below must not be mutated out from under the next caller.
function claimedWonders(state) {
  return new Set(worldWonders(state).claimed);
}

// Which wonders exist anywhere in the world, computed once per distinct `cities`
// array rather than once per candidate build. canProduce asks three questions of the
// world (is this wonder taken? does the Manhattan Project exist? the Apollo Program?)
// and buildableForCity runs it across every unit, improvement, wonder and ship part,
// so without this the AI search rescanned every city's building list ~90 times per
// city per turn. `state.cities` is replaced wholesale on any change (the engine is
// immutable throughout), so its identity is a sound cache key.
const wonderCache = new WeakMap();
function worldWonders(state) {
  const hit = wonderCache.get(state.cities);
  if (hit) return hit;
  const claimed = new Set();
  for (const c of state.cities) for (const b of c.buildings ?? []) if (WONDERS[b]) claimed.add(b);
  const out = { claimed, manhattan: claimed.has('manhattan'), apollo: claimed.has('apollo') };
  wonderCache.set(state.cities, out);
  return out;
}

// Whether `city` may build `id` right now — the ONE place the build rules live.
//
// Three callers share it and must agree, or the tech tree stops meaning anything:
// buildableForCity below (what the UI offers), the set-production handler in
// Civ1Game.js (what an action is allowed to set — a client posts the item id, so
// listing the legal ones is not the same as enforcing them), and the end-of-turn
// build in processOwnerEconomy (what a city is still allowed to FINISH — production
// is chosen once and then sits on the city for many turns, and a captured city
// arrives carrying whatever its old owner was building, on that owner's advances).
//
// `allowClaimedWonder` is the one deliberate split: a wonder someone else completed
// after you started it can never be *chosen*, but the city keeps its shields banked
// and goes on trying (see the Production block below), so the end-of-turn caller must
// not treat that as an illegal build and reset the city.
export function canProduce(state, city, id, ctx = null, { allowClaimedWonder = false } = {}) {
  const known = ctx ? ctx.techs : new Set(state.gameSpecific.civ[city.ownerId]?.techs ?? []);
  const has = new Set(city.buildings ?? []);

  const u = UNITS[id];
  if (u) {
    if (u.tech != null && !known.has(u.tech)) return false;
    // The Nuclear missile also needs the Manhattan Project to exist somewhere.
    if (u.special?.includes('nuclear') && !worldWonders(state).manhattan) return false;
    return true;
  }

  const imp = IMPROVEMENTS[id];
  if (imp) {
    if (id === 'palace') return false; // capital only; not a manual build here
    if (has.has(id)) return false;
    if (imp.tech != null && !known.has(imp.tech)) return false;
    if (imp.requires && !has.has(imp.requires)) return false;
    return true;
  }

  const w = WONDERS[id];
  if (w) {
    if (has.has(id)) return false;
    if (w.tech != null && !known.has(w.tech)) return false;
    if (!allowClaimedWonder && worldWonders(state).claimed.has(id)) return false;
    return true;
  }

  const part = SPACESHIP[id];
  if (part) {
    if (!worldWonders(state).apollo) return false;
    if (part.tech != null && !known.has(part.tech)) return false;
    const ship = state.gameSpecific.civ[city.ownerId]?.spaceship;
    if (ship && ship[part.part] >= part.cap) return false;
    return true;
  }

  return false;
}

// Every id a city could ever be set to, in the order the UI lists them.
const ALL_BUILDABLE_IDS = [
  ...Object.keys(UNITS), ...Object.keys(IMPROVEMENTS),
  ...Object.keys(WONDERS), ...Object.keys(SPACESHIP),
];

// What a given city may be told to build right now: every buildable id that passes
// canProduce above.
export function buildableForCity(state, city, ctx = null) {
  return ALL_BUILDABLE_IDS.filter(id => canProduce(state, city, id, ctx));
}

// What a city falls back to when what it was building can never be built again (see
// the Production block below), and what a newly founded city starts on. Militia is
// the one item gated behind no advance at all, so it is always a legal thing to be
// building — which is what a fallback has to be.
export const DEFAULT_PRODUCTION = 'militia';

// Cost in shields of any buildable id (unit, improvement, wonder, or spaceship part).
export function buildCost(id) {
  return UNITS[id]?.cost ?? IMPROVEMENTS[id]?.cost ?? WONDERS[id]?.cost ?? SPACESHIP[id]?.cost ?? 10;
}

// Pick the next advance to research when none is chosen: the cheapest reachable one,
// tie-broken by id so it is deterministic.
function pickResearch(known) {
  const opts = researchableTechs(known);
  return opts.length ? opts.slice().sort()[0] : null;
}

// ── End-of-turn economy for one civilization ────────────────────────────────────
//
// Returns new cities/units/civ plus the running unit-id counter. Pure: it reads
// `state` and returns replacements, mutating nothing. `makeUnit` is passed in from
// Civ1Game so unit shape stays defined in one place.
export function processOwnerEconomy(state, ownerId, nextId, makeUnit) {
  const ctx = buildOwnerCtx(state, ownerId);
  const civ = { ...state.gameSpecific.civ[ownerId] };
  const known = new Set(civ.techs);
  let units = state.units.slice();
  let idCounter = nextId;
  let gold = civ.gold;
  let bulbs = civ.bulbs;

  const wonderClaimed = claimedWonders(state);
  const spaceship = { ...civ.spaceship };
  const events = [];
  // Set when this civ takes the world-first Philosophy bonus below; the caller writes
  // it back into gameSpecific (via `worldPatch`) so no later civ can claim it too.
  let philosophyClaimed = false;

  const ownerCityIds = new Set(state.cities.filter(c => c.ownerId === ownerId).map(c => c.id));
  const cities = state.cities.map(city => {
    if (city.ownerId !== ownerId) return city;
    const out = computeCity(city, ctx);
    for (const w of out.worked) ctx.takenTiles.add(`${w.x},${w.y}`);

    gold += out.gold - out.maintenance;
    bulbs += out.science;

    let { size, food, shields } = city;
    const buildings = (city.buildings ?? []).slice();
    let production = city.production;

    // A city's production is chosen once and then sits there for many turns, so by
    // the time the shields land it may no longer be something this owner can build.
    // The reachable case is capture: a city taken from a more advanced civ arrives
    // still set to Battleship, and nothing else re-reads that field — so a civ that
    // has never heard of Steel would go on launching battleships out of it forever.
    // Point it back at the starter; the owner's ordinary set-production picks up
    // from there. A wonder claimed elsewhere is exempt (see canProduce) because the
    // block below deliberately banks the shields and keeps trying instead.
    if (!canProduce(state, city, production, ctx, { allowClaimedWonder: true })) {
      // Cap the banked shields at what the starter costs. A city taken mid-Battleship
      // can be sitting on 150 shields, and the Production block below only ever
      // subtracts the finished item's cost — so carrying them over would turn one
      // capture into fifteen free militia over the following turns.
      production = DEFAULT_PRODUCTION;
      shields = Math.min(shields, buildCost(DEFAULT_PRODUCTION));
    }

    // ── Growth / starvation ──────────────────────────────────────────────────
    food += out.foodSurplus;
    if (food < 0) {                       // famine: lose a citizen
      size = Math.max(1, size - 1);
      food = 0;
    } else if (food >= foodBox(size)) {   // full food box: grow (Aqueduct past size 8)
      if (size < 8 || buildings.includes('aqueduct')) {
        food = buildings.includes('granary') ? Math.floor(foodBox(size) / 2) : 0;
        size += 1;
      } else {
        food = foodBox(size);             // capped without an aqueduct
      }
    }

    // ── Production ─────────────────────────────────────────────────────────────
    shields += out.shields;
    const cost = buildCost(production);
    if (shields >= cost) {
      const info = improvementDef(production);
      if (info) {
        // Improvement or wonder: add to the city (wonders only if still unclaimed).
        if (info.wonder && wonderClaimed.has(production)) {
          shields = cost;                 // wonder taken elsewhere: hold shields, keep trying
        } else {
          buildings.push(production);
          if (info.wonder) {
            wonderClaimed.add(production);
            applyWonderOnComplete(production, known, events);
          }
          shields -= cost;
          // What was just built can never be built here again — buildableForCity
          // drops it from the moment it lands in `buildings`. `production` still
          // names it, though, and nothing below re-reads that list, so the next
          // time the shields fill the city builds a SECOND one: left alone, a city
          // reached nine Temples in a 200-turn game, paying nine lots of upkeep
          // (cityMaintenance sums the list, duplicates and all) for one Temple's
          // effect and burning eight Temples' worth of shields to get there. Point
          // it back at the starter instead; the owner's ordinary once-per-turn
          // set-production chooses something better from there.
          production = DEFAULT_PRODUCTION;
        }
      } else if (SPACESHIP[production]) {
        // A spaceship part: adds to the owner's ship (capped) rather than the city.
        const part = SPACESHIP[production].part;
        if (spaceship[part] < SPACESHIP[production].cap) {
          spaceship[part] += 1;
          shields -= cost;
        }
        // Same trap as an improvement, and worse: a berth that is already full
        // takes no part, so every further completion charged the shields and
        // delivered nothing at all. Bank them and move the city on.
        if (spaceship[part] >= SPACESHIP[production].cap) production = DEFAULT_PRODUCTION;
      } else if (UNITS[production]) {
        const spawn = findAdjacentFree(city.position, state.board, units);
        if (spawn) {
          const u = { ...makeUnit(`u${idCounter++}`, ownerId, production, spawn.x, spawn.y, 0), homeCityId: city.id };
          // Barracks make every unit a veteran; the Lighthouse does the same for ships.
          if (buildings.includes('barracks') || (UNITS[production].domain === 'sea' && ctx.wonderEffects.has('naval-veteran'))) {
            u.attrs = { ...u.attrs, veteran: true };
          }
          units = [...units, u];
          shields -= cost;
        }
      }
    }

    return { ...city, size, food, shields, buildings, production, _out: out };
  });

  // ── Research ───────────────────────────────────────────────────────────────
  // `futureTechs` counts completions of Future Tech, the one repeatable advance.
  // Adding it to a Set does nothing the second time, so without a separate tally a
  // civ that finished the tree would buy Future Tech over and over at whatever price
  // the last real advance cost — and every score that reads techs.length (see
  // Civ1Game's evaluate) would stay frozen while it did.
  let futureTechs = civ.futureTechs ?? 0;
  const priceOfNext = () => techCost(known.size + futureTechs);

  if (!civ.research) civ.research = pickResearch(known);
  if (civ.research) {
    const cost = priceOfNext();
    if (bulbs >= cost) {
      bulbs -= cost;
      const learned = civ.research;
      if (learned === 'future-tech') futureTechs += 1; else known.add(learned);
      events.push({ type: 'tech', tech: learned });

      // Philosophy: the first civ in the world to discover it gets an immediate free
      // advance. It is the original's one research-order bonus, and the only reason
      // to route through Philosophy rather than around it.
      if (learned === 'philosophy' && !state.gameSpecific.philosophyClaimedBy) {
        philosophyClaimed = true;
        const free = pickResearch(known);
        if (free && free !== 'future-tech') {
          known.add(free);
          events.push({ type: 'tech', tech: free, free: 'philosophy' });
        }
      }
      civ.research = pickResearch(known);
    }
  }

  // Great Library: gain any advance every rival civ already knows.
  if (ctx.wonderEffects.has('free-known-techs')) {
    const rivals = state.players.map(p => p.id).filter(id => id !== ownerId);
    if (rivals.length) {
      for (const id of Object.keys(TECHS)) {
        if (known.has(id)) continue;
        if (rivals.every(r => new Set(state.gameSpecific.civ[r]?.techs ?? []).has(id))) known.add(id);
      }
    }
  }

  // Apply any free advances granted by finishing a wonder this turn (Darwin's Voyage).
  for (const ev of events) if (ev.type === 'free-tech') { const t = pickResearch(known); if (t) known.add(t); }

  // Leonardo's Workshop upgrades one obsolete unit per turn to its successor, once the
  // successor's advance is known (the original quietly modernises the whole army; one
  // a turn keeps it cheap and visible).
  if (ctx.wonderEffects.has('auto-upgrade')) {
    const idx = units.findIndex(u => u.alive && u.ownerId === ownerId
      && UNIT_UPGRADE[u.type] && known.has(UNITS[UNIT_UPGRADE[u.type]].tech));
    if (idx >= 0) {
      const to = UNIT_UPGRADE[units[idx].type];
      units = units.slice();
      units[idx] = { ...units[idx], type: to, hp: UNITS[to].hp, maxHp: UNITS[to].hp };
    }
  }

  civ.techs = [...known];
  civ.futureTechs = futureTechs;
  civ.bulbs = Math.max(0, bulbs);
  civ.gold = Math.max(0, Math.round(gold));
  civ.spaceship = spaceship;

  // Revolution countdown: after the anarchy period the pending government takes hold.
  if (civ.anarchyTurns > 0) {
    civ.anarchyTurns -= 1;
    if (civ.anarchyTurns === 0 && civ.pendingGovernment) {
      civ.government = civ.pendingGovernment;
      civ.pendingGovernment = null;
    }
  }

  const cleanCities = cities.map(({ _out, ...c }) => c);
  // `worldPatch` is merged into state.gameSpecific by the caller — the few results of
  // one civ's turn that are facts about the WORLD rather than about that civ.
  const worldPatch = philosophyClaimed ? { philosophyClaimedBy: ownerId } : null;
  return { cities: cleanCities, units, civ, nextId: idCounter, events, worldPatch };
}

// Successor unit for Leonardo's Workshop upgrades — old type -> the modern unit of the
// same role. Each successor is gated by its own advance (checked at upgrade time).
const UNIT_UPGRADE = {
  militia: 'phalanx', phalanx: 'musketeers', musketeers: 'riflemen', riflemen: 'infantry',
  archers: 'legion', legion: 'musketeers', catapult: 'cannon', cannon: 'artillery',
  cavalry: 'knights', chariot: 'knights', knights: 'cav-modern', crusaders: 'cav-modern',
  trireme: 'sail', sail: 'frigate', frigate: 'ironclad', ironclad: 'destroyer',
};

// Effects that fire the moment a wonder is completed (as opposed to the ongoing
// civ-wide effects handled in city.js). Darwin's Voyage yields two free advances.
function applyWonderOnComplete(wonderId, known, events) {
  const w = WONDERS[wonderId];
  if (w?.effect === 'free-techs-2') { events.push({ type: 'free-tech' }, { type: 'free-tech' }); }
}
