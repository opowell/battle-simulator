// The core ruleset's scenarios, each a battle spec (src/battle/spec.js) in a
// JSON file of its own, `<id>.json`: every one in this folder is a scenario,
// and the spec editor (the Browser's Specs) writes new ones here. A scenario's
// config names its spec by id. Each one shows off part of the model, and none
// borrows a name or a picture from another game:
//
//   magic            mana, statuses (haste, slow, poison, stop, regen, shell,
//                    blind), area spells, heals, a teleport, a push; royal victory
//   scifi            energy and shields (absorbing), cloak and detection, air
//                    units over ground, a siege-mode transform, high ground and
//                    concealing craters; reach / survive / royal objectives
//   hex              a hex board with a two-level hill, facing with flank and rear
//                    arcs, vision cones; hold the summit
//   regions          territories with an adjacency list, armies as counts that
//                    merge; points at the turn limit for cities held
//   close-quarters   a building of walls, doors and windows on a shape board;
//                    vision cones, facing, ammo that must be reloaded
//
// The mixed scenarios (mixed-*) put units of several games on maps from the
// library — a square, a hex, a regions and a shape map — so they need the
// library loaded (src/server/library.js) and are offered only when it is. What
// makes one mixed is that it plays on a library `map`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPECS_DIR = fileURLToPath(new URL('.', import.meta.url));

const all = readdirSync(SPECS_DIR).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(join(SPECS_DIR, f), 'utf8')));
const byId = (list) => Object.fromEntries(list.map(s => [s.id, s]));

export const SPECS = byId(all.filter(s => !s.map));
export const MIXED_SPECS = byId(all.filter(s => s.map));

// A spec's `display` rides along, so a setup form can show how it will look.
const scenarioOf = (s) => ({ id: s.id, name: s.name ?? s.id, description: s.description ?? '', config: { spec: s.id, ...(s.modes ?? {}) }, ...(s.display ? { display: s.display } : {}) });

/**
 * The scenarios of the specs a BattleGame holds now (its specBook, which the
 * spec editor changes while the server runs): the plain ones, then the mixed
 * ones when `mixed` (the library is loaded).
 */
export function specScenarios(book, { mixed }) {
  const specs = book.ids().map(book.get);
  return [
    ...specs.filter(s => !s.map).map(scenarioOf),
    ...(mixed ? specs.filter(s => s.map).map(s => ({ ...scenarioOf(s), group: 'Mixed' })) : []),
  ];
}
