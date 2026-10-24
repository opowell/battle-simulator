// What FFTA lends the battle-simulator core's library: its units in the common
// vocabulary (the core's scripts/export-pack.mjs and src/engine/foreignUnits.js).
// The game itself fields only its own units, so nothing here is read in play.
//
// The conversion factor is the soldier: 28 hp, 10 attack, 8 defense, a sword's
// reach, 3 squares. A job's attack is the stronger of its weapon and its magic,
// its range the farthest its abilities strike.
import { ABILITIES } from './abilities.js';
import { JOB_DEFS } from './units.js';
import { JOB_LABELS } from './FFTAGame.js';

export const pack = {
  scale: { hp: 28, attack: 10, defense: 8, range: 1, move: 3 },
  profiles: () => Object.fromEntries(Object.entries(JOB_DEFS).map(([job, d]) => [job, {
    hp: d.stats.hp, attack: Math.max(d.stats.atk, d.stats.mag), defense: d.stats.def,
    range: Math.max(1, ...d.abilities.map(k => (ABILITIES[k]?.target === 'enemy' ? ABILITIES[k].range ?? 0 : 0))),
    move: d.moveRange, domain: 'land',
  }])),
  art: (job) => ({ imagePath: JOB_DEFS[job] ? `/images/ffta/${job}/portrait` : null, glyph: JOB_DEFS[job]?.symbol, name: JOB_LABELS[job] ?? job }),
};
