// The civ1 roster is the 1991 original's: its 28 units and no others, each at the
// original's own price, attack, defence, moves and required advance. The table below
// is transcribed from CivOne (github.com/SWY1985/CivOne, src/Units/*.cs, CC0), whose
// constructor reads base(price in tens of shields, attack, defence, moves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { UNITS } from './units.js';
import { TECHS } from './tech.js';

//            id            price atk def mv  required advance
const ORIGINAL = [
  ['settlers',     4,  0,  1,  1, null],
  ['militia',      1,  1,  1,  1, null],
  ['phalanx',      2,  1,  2,  1, 'bronze-working'],
  ['legion',       2,  3,  1,  1, 'iron-working'],
  ['chariot',      4,  4,  1,  2, 'the-wheel'],
  ['knights',      4,  4,  2,  2, 'chivalry'],
  ['catapult',     4,  6,  1,  1, 'mathematics'],
  ['cavalry',      2,  2,  1,  2, 'horseback-riding'],
  ['musketeers',   3,  2,  3,  1, 'gunpowder'],
  ['cannon',       4,  8,  1,  1, 'metallurgy'],
  ['riflemen',     3,  3,  5,  1, 'conscription'],
  ['artillery',    6, 12,  2,  2, 'robotics'],
  ['armor',        8, 10,  5,  3, 'automobile'],
  ['mech-inf',     5,  6,  6,  3, 'labor-union'],
  ['diplomat',     3,  0,  0,  2, 'writing'],
  ['caravan',      5,  0,  1,  1, 'trade'],
  ['fighter',      6,  4,  2, 10, 'flight'],
  ['bomber',      12, 12,  1,  8, 'advanced-flight'],
  ['nuclear',     16, 99,  0, 16, 'rocketry'],
  ['trireme',      4,  1,  0,  3, 'mapmaking'],
  ['sail',         4,  1,  1,  3, 'navigation'],
  ['frigate',      4,  2,  2,  3, 'magnetism'],
  ['ironclad',     6,  4,  4,  4, 'steam-engine'],
  ['cruiser',      8,  6,  6,  6, 'combustion'],
  ['battleship',  16, 18, 12,  4, 'steel'],
  ['submarine',    5,  8,  2,  3, 'mass-production'],
  ['carrier',     16,  1, 12,  5, 'advanced-flight'],
  ['transport',    5,  0,  3,  4, 'industrialization'],
];

test('civ1 units: exactly the 28 units of the 1991 roster', () => {
  assert.deepEqual(Object.keys(UNITS).sort(), ORIGINAL.map(r => r[0]).sort());
});

test('civ1 units: each at the original\'s cost, attack, defence, moves and advance', () => {
  for (const [id, price, attack, defense, moves, tech] of ORIGINAL) {
    const u = UNITS[id];
    assert.deepEqual(
      { cost: u.cost, attack: u.attack, defense: u.defense, moves: u.moves, tech: u.tech },
      { cost: price * 10, attack, defense, moves, tech },
      id);
    if (tech) assert.ok(TECHS[tech], `${id} needs ${tech}, which must be an advance`);
  }
});

test('civ1 units: every unit has its icon, and no icon is left for a unit that is gone', async () => {
  const dir = new URL('./images/units/', import.meta.url);
  for (const id of Object.keys(UNITS)) assert.ok(existsSync(new URL(`${id}.png`, dir)), `${id}.png`);
  for (const gone of ['archers', 'crusaders', 'cav-modern', 'infantry', 'paratroopers', 'marines', 'helicopter', 'destroyer']) {
    assert.ok(!existsSync(new URL(`${gone}.png`, dir)), `${gone}.png should be gone`);
  }
});
