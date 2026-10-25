import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strike, checkStrike } from './strike.js';

const draws = (...xs) => { const left = [...xs]; return () => left.shift() ?? 0; };

// StarCraft's shape: shields soak first, armor takes from what gets through, a
// ranged shot up onto high ground misses three times in ten.
const RULES = {
  steps: [{ miss: 'if(a.range > 1 && d.high && !a.high, 30, 0)' }, { unless: 'd.air || !a.antiAir' }],
  damage: 'a.attack + if(d.air, a.bonusAir, 0)',
  absorb: { pool: 'shields', cap: 'if(d.hardened, 10, total)' },
  through: 'if(left > 0, max(1, left - d.armor), 0)',
};
const A = { attack: 20, range: 4, high: 0, antiAir: 0, bonusAir: 0 };
const D = { shields: 15, armor: 2, high: 0, air: 0, hardened: 0 };

test('a blow: the pool soaks first, the rest less armor reaches hit points', () => {
  assert.deepEqual(strike(RULES, { a: A, d: D }), { hit: true, total: 20, absorbed: 15, through: 3 });
  assert.deepEqual(strike(RULES, { a: A, d: { ...D, shields: 0 } }), { hit: true, total: 20, absorbed: 0, through: 18 });
  assert.equal(strike(RULES, { a: { ...A, attack: 16 }, d: { ...D, shields: 0, armor: 20 } }).through, 1, 'at least 1 gets through');
  assert.equal(strike(RULES, { a: A, d: { ...D, shields: 40 } }).through, 0, 'all soaked: nothing left to reduce');
  assert.deepEqual(strike(RULES, { a: A, d: { ...D, hardened: 1 } }), { hit: true, total: 20, absorbed: 10, through: 8 }, 'a capped pool');
});

test('the steps run in order: a die where the rules throw one, none where a blow cannot land', () => {
  let thrown = 0;
  const rng = () => { thrown++; return 0.5; };
  assert.equal(strike(RULES, { a: A, d: { ...D, high: 1 } }, rng).roll, 51);
  assert.equal(thrown, 1);
  assert.equal(strike(RULES, { a: A, d: { ...D, high: 1 } }, draws(0.29)).hit, false, 'roll 30 misses');
  assert.equal(strike(RULES, { a: A, d: { ...D, high: 1 } }, draws(0.3)).hit, true, 'roll 31 lands');
  thrown = 0;
  assert.equal(strike(RULES, { a: { ...A, antiAir: 1 }, d: D }, rng).hit, false, 'anti-air at a ground unit');
  assert.equal(thrown, 0, 'and no die for it');
  thrown = 0;
  assert.equal(strike(RULES, { a: { ...A, antiAir: 1 }, d: { ...D, high: 1 } }, rng).hit, false);
  assert.equal(thrown, 1, 'the miss step comes first in these rules, so its die is thrown');
});

test('checkStrike names what is wrong', () => {
  assert.deepEqual(checkStrike(RULES), []);
  const errs = checkStrike({ steps: [{ maybe: '1' }], absorb: {}, through: 'max(' });
  for (const want of [/damage: missing/, /steps\[0\]/, /absorb.pool/, /through/]) assert.ok(errs.some(e => want.test(e)), `${want} in ${errs.join(' | ')}`);
});
