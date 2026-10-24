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
import magic from './magic.json' with { type: 'json' };
import scifi from './scifi.json' with { type: 'json' };
import hex from './hex.json' with { type: 'json' };
import regions from './regions.json' with { type: 'json' };
import closeQuarters from './close-quarters.json' with { type: 'json' };

export const SPECS = Object.fromEntries([magic, scifi, hex, regions, closeQuarters].map(s => [s.id, s]));

export const SPEC_SCENARIOS = Object.values(SPECS).map(s => ({
  id: s.id, name: s.name, description: s.description ?? '', config: { spec: s.id, ...(s.modes ?? {}) },
}));
