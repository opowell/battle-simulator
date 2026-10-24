// ---------------------------------------------------------------------------
// spec.js — a battle spec: the data a BattleGame is driven by.
//
// A spec is JSON (so a scenario is a file, and the Browser can edit one). Every
// key is optional; what a spec leaves out is the base ruleset's, which is Arena's:
//
//   id, name, description
//   terrain     { id: { name, color, description, cost, passable, cover,
//                       blocksSight, concealment, elevation } }
//               merged over the base table (open, forest, hill, water, rock).
//               cost / passable may be per movement class: { land: 2, air: 1 }.
//   attributes  { id: { kind: 'number' | 'pool' | 'tag' | 'status', … } }  see units.js
//   abilities   { id: { cost, cooldown, range, targets, filter, area, los,
//                       windup, effects: [ … ] } }                          see abilities.js
//   unitTypes   { type: { name, glyph, hp, attack, defense, range, speed, rate,
//                         vision, domain, facing: { fov, arcs, turnCost },
//                         attrs, pools, tags, resist, abilities: [ids],
//                         strike: false | { …overrides of the default attack },
//                         jump, points, value } }
//   formulas    { damage: 'expression' | { fn } }                         see exact.js
//   board       { topology: 'square' | 'hex' | 'regions' | 'shapes', width,
//                 height, terrain: { 'x,y': id } | rows: ['..ff..'] + legend,
//                 elevation, wrap, neighbours, regions, shapes, walls,
//                 stacking: 'one' | 'stack' | 'count', stackDeath, climb }
//   armies      [[type, …] per seat]   laid along each seat's edge, or
//   units       [{ type, seat, at: [x, y], facing }]
//   victory     [{ type: 'eliminate' | 'royal' | 'hold' | 'reach' | 'survive' |
//                  'points', … } | { fn }]                                 see victory.js
//   orientation { fov, arcs, turnCost }  facing for every unit type that has none
//   modes       { space, time, play }  the defaults the setup form starts at
//   fog         'off' | 'on' | 'remembered'
//
// Behaviour the data can't say is named, not written: anywhere an effect, a
// formula or a victory test is expected, `{ fn: 'name' }` calls `hooks.name`,
// the hooks a BattleGame was made with. The spec stays serialisable.
// ---------------------------------------------------------------------------

import { checkFormula } from './exact.js';
import { TOPOLOGIES } from './board.js';

/** Arena's terrain: the base table every spec's terrain is merged over. */
export const BASE_TERRAIN = {
  open:   { name: 'Open',   cost: 1, cover: 0,  passable: true,  blocksSight: false, color: '#c2b77e', description: 'Open ground. No effect.' },
  forest: { name: 'Forest', cost: { land: 2, air: 1 }, cover: 50, passable: { land: true, sea: false }, blocksSight: false, color: '#4d7f3f', description: 'Costs double to cross; +50% defense to a unit inside.' },
  hill:   { name: 'Hill',   cost: { land: 2, air: 1 }, cover: 25, passable: { land: true, sea: false }, blocksSight: false, color: '#a08a5a', description: 'Costs double to climb; +25% defense to a unit on it.' },
  water:  { name: 'Water',  cost: { land: Infinity, sea: 1, air: 1 }, cover: 0, passable: { land: false, sea: true, air: true }, blocksSight: false, color: '#4a86c8', description: 'Impassable; can be seen and shot across.' },
  rock:   { name: 'Rock',   cost: { land: Infinity, air: 1 }, cover: 0, passable: { land: false, sea: false, air: true }, blocksSight: true, color: '#6d6a66', description: 'Impassable; blocks sight and missiles.' },
};

/** Arena's unit presets. */
export const BASE_UNIT_TYPES = {
  infantry:  { name: 'Infantry',  glyph: 'I', hp: 10, attack: 4, defense: 4, range: 1, speed: 3, rate: 1, vision: 4 },
  archer:    { name: 'Archer',    glyph: 'A', hp: 7,  attack: 4, defense: 2, range: 4, speed: 3, rate: 1, vision: 5 },
  cavalry:   { name: 'Cavalry',   glyph: 'C', hp: 10, attack: 5, defense: 3, range: 1, speed: 6, rate: 1, vision: 5 },
  knight:    { name: 'Knight',    glyph: 'K', hp: 16, attack: 6, defense: 6, range: 1, speed: 2, rate: 1, vision: 3 },
  artillery: { name: 'Artillery', glyph: 'G', hp: 6,  attack: 8, defense: 1, range: 6, speed: 2, rate: 1, vision: 4 },
  scout:     { name: 'Scout',     glyph: 'S', hp: 5,  attack: 2, defense: 2, range: 1, speed: 8, rate: 2, vision: 8 },
};

/**
 * Arena's strike, generalised: `power` is the ability's (1 for a plain attack),
 * `cover` the defender's terrain bonus in percent, `height` the attacker's ground
 * over the defender's (a defender on higher ground gets 25% cover a level), `arc`
 * the defense modifier for the side it is struck on (percent, from its facing).
 * With power 1 and no height or arc this is exactly Arena's
 *     max(1, ⌊attack² / (attack + defense × (1 + cover)) ⌋).
 */
export const DEFAULT_DAMAGE = 'max(1, floor(power * a.attack^2 / (a.attack + d.defense * (1 + (cover + 25 * max(0, -height)) / 100) * (1 + arc / 100))))';

/** The stats every unit carries in `unit.stats` (hit points live on the unit). */
export const STAT_KEYS = ['attack', 'defense', 'range', 'speed', 'rate', 'vision'];

export const BASE_SPEC = {
  id: 'arena',
  name: 'Arena',
  terrain: BASE_TERRAIN,
  attributes: {},
  abilities: {},
  unitTypes: BASE_UNIT_TYPES,
  formulas: { damage: DEFAULT_DAMAGE },
  board: { topology: 'square', width: 14, height: 10, generator: 'river' },
  armies: [['infantry', 'infantry', 'archer', 'cavalry', 'artillery']],
  victory: [{ type: 'eliminate' }],
};

// JSON has no Infinity: a spec file writes impassable as passable: false, and a
// cost of null or "Infinity" reads as Infinity.
function reviveTerrain(t) {
  const inf = (v) => (v == null || v === 'Infinity' ? Infinity : v);
  const cost = t.cost != null && typeof t.cost === 'object'
    ? Object.fromEntries(Object.entries(t.cost).map(([k, v]) => [k, inf(v)])) : t.passable === false ? Infinity : inf(t.cost ?? 1);
  return { cover: 0, blocksSight: false, passable: true, ...t, cost };
}

/**
 * The full spec: `spec` over `base` (Arena's, unless a game has its own).
 * `terrain` merges with the base table; every other key a spec gives replaces
 * the base's.
 */
export function resolveSpec(spec = {}, base = BASE_SPEC) {
  const out = { ...base, ...spec };
  out.terrain = Object.fromEntries(Object.entries({ ...(base.terrain ?? BASE_TERRAIN), ...(spec.terrain ?? {}) }).map(([k, t]) => [k, reviveTerrain(t)]));
  out.board = { ...(spec.board ?? base.board ?? BASE_SPEC.board) };
  // A spec with units of its own fields those, not the base's armies.
  if (!spec.armies && (spec.units || spec.unitTypes)) {
    if (spec.units) delete out.armies;
    else out.armies = [Object.keys(spec.unitTypes)];
  }
  return out;
}

const KINDS = new Set(['number', 'pool', 'tag', 'status']);
const TARGETS = new Set(['enemy', 'ally', 'self', 'any', 'ground']);
const EFFECTS = new Set(['damage', 'heal', 'modify', 'status', 'cleanse', 'move', 'spawn', 'transform', 'reveal', 'conceal', 'fn']);
const VICTORY = new Set(['eliminate', 'royal', 'hold', 'reach', 'survive', 'points']);

/**
 * What is wrong with a (resolved) spec, as a list of messages — empty when it
 * can be played. `hooks` are the functions `{ fn }` may name.
 */
export function checkSpec(spec, hooks = {}) {
  const errs = [];
  const fnOk = (where, v) => { if (v?.fn != null && typeof hooks[v.fn] !== 'function') errs.push(`${where}: no hook "${v.fn}"`); };
  const types = spec.unitTypes ?? {};
  if (!Object.keys(types).length) errs.push('unitTypes: none');
  const attrs = spec.attributes ?? {};
  for (const [id, a] of Object.entries(attrs)) {
    if (!KINDS.has(a.kind)) errs.push(`attributes.${id}: kind "${a.kind}" is not one of ${[...KINDS].join(', ')}`);
    for (const e of a.tick ?? []) checkEffect(`attributes.${id}.tick`, e);
  }
  const abilities = spec.abilities ?? {};
  for (const [id, ab] of Object.entries(abilities)) checkAbility(`abilities.${id}`, ab);
  for (const [type, t] of Object.entries(types)) {
    for (const k of ['hp', 'attack', 'defense', 'range', 'speed', 'rate', 'vision']) {
      if (t[k] != null && !(typeof t[k] === 'number' && t[k] >= 0)) errs.push(`unitTypes.${type}.${k}: not a number ≥ 0`);
    }
    if (!(t.hp > 0)) errs.push(`unitTypes.${type}.hp: must be > 0`);
    for (const a of t.abilities ?? []) if (!abilities[a]) errs.push(`unitTypes.${type}.abilities: no ability "${a}"`);
    for (const k of Object.keys(t.pools ?? {})) if (attrs[k]?.kind !== 'pool') errs.push(`unitTypes.${type}.pools.${k}: not a declared pool`);
    for (const k of Object.keys(t.attrs ?? {})) if (attrs[k]?.kind !== 'number') errs.push(`unitTypes.${type}.attrs.${k}: not a declared number`);
    if (t.strike && typeof t.strike === 'object') checkAbility(`unitTypes.${type}.strike`, t.strike, true);
  }
  const dmg = spec.formulas?.damage;
  if (typeof dmg === 'string') { try { checkFormula(dmg); } catch (e) { errs.push(`formulas.damage: ${e.message}`); } } else fnOk('formulas.damage', dmg);
  const b = spec.board ?? {};
  if (!TOPOLOGIES.includes(b.topology ?? 'square')) errs.push(`board.topology: "${b.topology}" is not one of ${TOPOLOGIES.join(', ')}`);
  if ((b.topology ?? 'square') !== 'regions' && !(b.width > 0 && b.height > 0)) errs.push('board: needs a width and height');
  for (const id of new Set([...Object.values(b.terrain ?? {}), ...(b.shapes ?? []).map(s => s.terrain), ...Object.values(b.regions ?? {}).map(r => r.terrain)].filter(Boolean))) {
    if (!spec.terrain?.[id]) errs.push(`board: no terrain "${id}"`);
  }
  for (const v of spec.victory ?? []) {
    if (v.fn != null) fnOk('victory', v);
    else if (!VICTORY.has(v.type)) errs.push(`victory: "${v.type}" is not one of ${[...VICTORY].join(', ')}`);
  }
  for (const [i, u] of (spec.units ?? []).entries()) if (!types[u.type]) errs.push(`units[${i}]: no unit type "${u.type}"`);
  for (const army of spec.armies ?? []) for (const t of army) if (!types[t]) errs.push(`armies: no unit type "${t}"`);
  return errs;

  function checkAbility(where, ab, isAttack = false) {
    if (ab.targets && !TARGETS.has(ab.targets)) errs.push(`${where}.targets: "${ab.targets}" is not one of ${[...TARGETS].join(', ')}`);
    for (const k of Object.keys(ab.cost ?? {})) if (attrs[k]?.kind !== 'pool' && k !== 'hp') errs.push(`${where}.cost.${k}: not a declared pool`);
    if (!isAttack && !Array.isArray(ab.effects)) errs.push(`${where}.effects: missing`);
    for (const e of ab.effects ?? []) checkEffect(`${where}.effects`, e);
  }
  function checkEffect(where, e) {
    const kinds = Object.keys(e).filter(k => EFFECTS.has(k));
    if (kinds.length !== 1) { errs.push(`${where}: an effect is exactly one of ${[...EFFECTS].join(', ')} (got ${Object.keys(e).join(', ')})`); return; }
    if (e.fn != null) fnOk(where, e);
    if (e.status && !attrs[e.status.id ?? e.status]) errs.push(`${where}: no status "${e.status.id ?? e.status}"`);
    if (e.spawn && !types[e.spawn.type]) errs.push(`${where}: spawn of unknown type "${e.spawn.type}"`);
    if (e.transform && !types[e.transform.into]) errs.push(`${where}: transform into unknown type "${e.transform.into}"`);
    const f = e.damage?.formula ?? e.heal?.formula;
    if (typeof f === 'string') { try { checkFormula(f); } catch (err) { errs.push(`${where}: ${err.message}`); } }
  }
}
