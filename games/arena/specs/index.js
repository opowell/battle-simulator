// The core ruleset's scenarios, each a battle spec (src/battle/spec.js) in a
// JSON file of its own. A scenario's config names its spec by id. Each one shows
// off part of the model, and none borrows a name or a picture from another game:
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
// The mixed scenarios put units of several games on maps from the library — a
// square, a hex, a regions and a shape map — so they need the library loaded
// (src/server/library.js) and are offered only when it is.
import magic from './magic.json' with { type: 'json' };
import scifi from './scifi.json' with { type: 'json' };
import hex from './hex.json' with { type: 'json' };
import regions from './regions.json' with { type: 'json' };
import closeQuarters from './close-quarters.json' with { type: 'json' };
import mixedTwoRivers from './mixed-two-rivers.json' with { type: 'json' };
import mixedEncounter from './mixed-encounter.json' with { type: 'json' };
import mixedWorld from './mixed-world.json' with { type: 'json' };
import mixedDust2 from './mixed-dust2.json' with { type: 'json' };

const byId = (list) => Object.fromEntries(list.map(s => [s.id, s]));
const scenarioOf = (s) => ({ id: s.id, name: s.name, description: s.description ?? '', config: { spec: s.id, ...(s.modes ?? {}) } });

export const SPECS = byId([magic, scifi, hex, regions, closeQuarters]);
export const MIXED_SPECS = byId([mixedTwoRivers, mixedEncounter, mixedWorld, mixedDust2]);

export const SPEC_SCENARIOS = Object.values(SPECS).map(scenarioOf);
export const MIXED_SCENARIOS = Object.values(MIXED_SPECS).map(s => ({ ...scenarioOf(s), group: 'Mixed' }));
