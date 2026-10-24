// ---------------------------------------------------------------------------
// Arena — the core's own battle: a BattleGame (src/battle/BattleGame.js) and
// its scenarios.
//
// The default battle is the original Arena: a board of terrain cells, and armies
// of units that are nothing but numbers (hp, attack, defense, range, speed, rate,
// vision), wiped out to win. Every other scenario is a battle spec in specs/ —
// data — that adds what the core model can express: facing and vision cones,
// declared attributes (pools, tags, statuses), abilities, hex and regions
// boards, elevation, stacking, objectives. And the library's maps
// (library/<game>/maps/) are scenarios too, where units of every game mix.
//
// A unit's numbers live on the unit (`unit.stats`), so a roster can field
// anything — including other games' units from the library, converted by
// src/engine/foreignUnits.js — and no rule asks what a unit IS, only what its
// numbers (and declared attributes) are.
// ---------------------------------------------------------------------------

import { makeBattleGame, MAX_WAIT, UNIT_R, TURN_DURATION, ATTACK_TIME, MIN_WAIT } from '#core/battle/BattleGame.js';
import { BASE_UNIT_TYPES, STAT_KEYS } from '#core/battle/spec.js';
import { strikeDamage as damage, seenBy as seen, gapBetween as between, pointOf as point } from '#core/battle/world.js';
import { whole } from '#core/engine/foreignUnits.js';
import { libraryScenarios, librarySpec, libraryMaps } from '#core/battle/library.js';
import { SPECS, SPEC_SCENARIOS, MIXED_SPECS, MIXED_SCENARIOS } from './specs/index.js';
import * as hooks from './hooks.js';

export const UNIT_TYPES = BASE_UNIT_TYPES;
export { STAT_KEYS, MAX_WAIT, UNIT_R, TURN_DURATION, ATTACK_TIME, MIN_WAIT };

const BASE_SCENARIOS = [
  { id: 'skirmish', name: 'Skirmish', description: '14×10 — a river with two fords, woods, hills; five units a side', config: {} },
  { id: 'open-field', name: 'Open field', description: '12×8 of open ground — nothing but the numbers', config: { width: 12, height: 8, map: 'open' } },
  { id: 'real-time', name: 'Real-time skirmish', description: 'The skirmish on one clock, everyone ordering at once, free movement',
    config: { space: 'continuous', time: 'continuous', simultaneousTurns: true } },
];

const freshBudget = (u, stats) => (u.perTurn ? { ...u.perTurn, moveLeft: stats.speed, attacksLeft: stats.rate } : u.perTurn);

export const ArenaGame = makeBattleGame({
  name: 'Arena',
  specs: { ...SPECS, ...MIXED_SPECS },
  hooks,
  // The library's maps, and the mixed scenarios on them, once the library is loaded.
  scenarios: () => [...BASE_SCENARIOS, ...SPEC_SCENARIOS, ...(libraryMaps().length ? MIXED_SCENARIOS : []), ...libraryScenarios()],
  findSpec: librarySpec,
  extend: {
    // Units from every game in the library (src/engine/foreignUnits.js): Arena, the
    // core's own ruleset, is where they mix. The conversion factor is the
    // infantryman, except range, where it is the archer's reach. A unit keeps its
    // own movement class (a trireme sails, a dropship flies).
    foreignUnits: {
      host: true,
      scale: { hp: 10, attack: 4, defense: 4, range: 4, move: 3 },
      profiles: () => ArenaGame.unitStats(),
      adopt: (u, s, spec) => {
        const hp = whole(s.hp);
        const stats = { ...u.stats, attack: whole(s.attack, 0), defense: whole(s.defense, 0), range: Math.max(1, s.range), speed: s.move };
        const domain = spec?.source?.domain;
        return { ...u, hp, maxHp: hp, stats, perTurn: freshBudget(u, stats), ...(domain && domain !== 'land' ? { domain } : {}) };
      },
      realize: (_type, s) => ({ hp: whole(s.hp), attack: whole(s.attack, 0), defense: whole(s.defense, 0), range: Math.max(1, s.range), move: s.move }),
      art: (type) => ({ glyph: UNIT_TYPES[type]?.glyph ?? type[0].toUpperCase(), name: UNIT_TYPES[type]?.name ?? type }),
    },
  },
});

/** The damage one strike of `a` deals to `d` where `d` stands now. Always an integer. */
export const strikeDamage = (state, a, d) => damage(state, a, d);
export const seenBy = seen;
export const gapBetween = between;
export const pointOf = point;
export const waitAction = (unitId, duration) => ({ type: 'wait', unitId, duration });
