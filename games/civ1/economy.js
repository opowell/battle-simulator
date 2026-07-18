// Civ1 owner-level economy: the per-turn bookkeeping that sits above single cities —
// treasury, research, government, wonders — plus the context object city.js needs.
//
// createInitialState seeds each player a civ record (see newCivState). At the end of a
// player's turn Civ1Game calls processOwnerEconomy, which runs every city through
// city.js, banks the gold and science, grows or starves cities, finishes production,
// pays maintenance, and advances research.

import { UNITS } from './units.js';
import { TECHS, researchableTechs, techCost } from './tech.js';
import { IMPROVEMENTS, WONDERS, improvementDef } from './improvements.js';
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
    research: null,        // advance currently being researched
    bulbs: 0,              // accumulated science toward `research`
    gold: 0,
    taxRate: 50,           // % of trade to the treasury
    luxRate: 0,            // % of trade to luxuries; science gets the rest
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
    civSciBonus: wonderEffects.has('science-all') ? 0.5 : 0,
    civShieldBonus: wonderEffects.has('power-all') ? 0.5 : 0,
    supportedUnits, settlersHomed, garrisonByCity,
    takenTiles: new Set(),
  };
}

// Wonders already built (or under construction) anywhere in the world — one per world.
function claimedWonders(state) {
  const claimed = new Set();
  for (const c of state.cities) for (const b of c.buildings ?? []) if (WONDERS[b]) claimed.add(b);
  return claimed;
}

// What a given city may be told to build right now: units and improvements/wonders
// whose prerequisite advance the owner has, that the city doesn't already have, and
// (for improvements) whose required prior improvement is present.
export function buildableForCity(state, city, ctx = null) {
  const known = ctx ? ctx.techs : new Set(state.gameSpecific.civ[city.ownerId].techs);
  const has = new Set(city.buildings ?? []);
  const out = [];

  for (const [id, u] of Object.entries(UNITS)) {
    if (u.tech == null || known.has(u.tech)) out.push(id);
  }
  for (const [id, imp] of Object.entries(IMPROVEMENTS)) {
    if (has.has(id)) continue;
    if (imp.tech != null && !known.has(imp.tech)) continue;
    if (imp.requires && !has.has(imp.requires)) continue;
    if (id === 'palace') continue; // capital only; not a manual build here
    out.push(id);
  }
  const claimed = claimedWonders(state);
  for (const [id, w] of Object.entries(WONDERS)) {
    if (has.has(id) || claimed.has(id)) continue;
    if (w.tech != null && !known.has(w.tech)) continue;
    out.push(id);
  }
  return out;
}

// Cost in shields of any buildable id (unit, improvement, or wonder).
export function buildCost(id) {
  return UNITS[id]?.cost ?? IMPROVEMENTS[id]?.cost ?? WONDERS[id]?.cost ?? 10;
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
  const events = [];

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
        }
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
  if (!civ.research) civ.research = pickResearch(known);
  if (civ.research) {
    const cost = techCost(known.size);
    if (bulbs >= cost) {
      bulbs -= cost;
      known.add(civ.research);
      events.push({ type: 'tech', tech: civ.research });
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
  civ.bulbs = Math.max(0, bulbs);
  civ.gold = Math.max(0, Math.round(gold));

  // Revolution countdown: after the anarchy period the pending government takes hold.
  if (civ.anarchyTurns > 0) {
    civ.anarchyTurns -= 1;
    if (civ.anarchyTurns === 0 && civ.pendingGovernment) {
      civ.government = civ.pendingGovernment;
      civ.pendingGovernment = null;
    }
  }

  const cleanCities = cities.map(({ _out, ...c }) => c);
  return { cities: cleanCities, units, civ, nextId: idCounter, events };
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
