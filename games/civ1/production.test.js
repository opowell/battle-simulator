import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCivState } from './economy.js';
import {
  attackStrength, defenceStrength, productionContext, scoreProduction,
  turnsToBuild, chooseProductionAction, rankProductionActions,
  RESEARCH_PRIORITY, IMPROVEMENT_PRIORITY, SWITCH_MARGIN,
} from './production.js';
import { turnYear, yearLabel } from './year.js';
import { UNITS } from './units.js';
import { IMPROVEMENTS } from './improvements.js';

function players() {
  return [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
}

// One city on flat grassland, so its shield yield is predictable, plus whatever units
// a test wants placed. `terrain` and `buildings` let a test change the city's own
// defensive multiplier; `size` changes how fast it builds.
function fixture({
  size = 1, buildings = ['palace'], terrain = 'grassland', units = [],
  production = 'militia', shields = 0, techs = ['bronze-working', 'masonry'],
} = {}) {
  const width = 20, height = 20;
  const tiles = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[`${x},${y}`] = { terrain: 'grassland' };
  tiles['5,5'] = { terrain };
  const state = {
    gameName: 'Civ1', turnNumber: 20, activePlayers: ['p1'], players: players(),
    board: { width, height, tiles },
    units: units.map((u, i) => ({
      id: u.id ?? `u${i}`, ownerId: u.ownerId ?? 'p1', type: u.type, alive: true,
      position: { x: u.x, y: u.y }, hp: UNITS[u.type].hp, movesLeft: UNITS[u.type].moves,
      attrs: u.attrs ?? {},
    })),
    cities: [{
      id: 'c1', name: 'Rome', ownerId: 'p1', position: { x: 5, y: 5 },
      size, food: 0, shields, production, buildings,
    }],
    lastActions: null,
    gameSpecific: {
      nextId: 0, fogOfWar: false,
      civ: { p1: { ...newCivState(), techs }, p2: { ...newCivState(), techs } },
    },
  };
  return state;
}

const ctxFor = (opts, cityOpts = {}) =>
  productionContext(fixture(opts), fixture(opts).cities[0], 'p1', cityOpts);

const acts = items => items.map(item => ({ type: 'set-production', cityId: 'c1', item }));

// ── Unit strength ────────────────────────────────────────────────────────────

test('defence strength ranks the defenders the way Civ1 combat does', () => {
  assert.equal(defenceStrength('militia'), 1);
  assert.equal(defenceStrength('phalanx'), 2);
  // Musketeers are defence 3 on 20 hp: twice the body as well as half again the
  // defence, which defence alone would miss.
  assert.equal(defenceStrength('musketeers'), 6);
  // Settlers are defence 1 on 20 hp, so they score 2 — they are kept out of a
  // city's cover by type in productionContext, not by scoring zero here.
  assert.equal(defenceStrength('settlers'), 2);
  assert.equal(defenceStrength('catapult'), 1);
  // Attack-only and non-combat units contribute nothing.
  assert.equal(defenceStrength('nuclear'), 0);
});

test('attack strength breaks the ties attack*moves/cost left', () => {
  // The old scorer gave militia, archers, legion and catapult the identical
  // attack*moves/cost of 0.1, and broke the tie on key order in UNITS — militia.
  for (const t of ['archers', 'legion', 'catapult']) {
    assert.equal((UNITS[t].attack * UNITS[t].moves) / UNITS[t].cost,
      (UNITS.militia.attack * UNITS.militia.moves) / UNITS.militia.cost,
      `${t} used to tie with militia`);
    assert.ok(attackStrength(t) > attackStrength('militia'), `${t} must now outrank militia`);
  }
  // Movement is a mild multiplier, not a linear one: a chariot is not twice a legion.
  assert.ok(attackStrength('chariot') < 2 * attackStrength('legion'));
});

// ── Defence: value against build time ────────────────────────────────────────

test('an undefended city prefers a phalanx to a militia', () => {
  // The bug this module was written for: a flat "+100 for any defender" made the
  // cheapest body win, 103 to 101.5, and SWITCH_MARGIN then hid the phalanx.
  const ctx = ctxFor({});
  assert.ok(scoreProduction('phalanx', ctx) > scoreProduction('militia', ctx));
  assert.equal(chooseProductionAction(acts(['phalanx', 'militia']), ctx, null).item, 'phalanx');
});

test('a militia wins when a phalanx cannot arrive before the enemy does', () => {
  // A legion three tiles out: the deadline is 3 turns. In a city producing enough
  // to finish a militia inside that window but not a phalanx, the militia is the
  // right answer and the scorer has to say so.
  const state = fixture({
    size: 4, terrain: 'forest',
    units: [{ type: 'legion', ownerId: 'p2', x: 8, y: 5 }],
  });
  const ctx = productionContext(state, state.cities[0], 'p1');
  assert.equal(ctx.threatEta, 3);
  assert.ok(turnsToBuild('militia', ctx) <= ctx.threatEta,
    'fixture must let a militia finish inside the deadline');
  assert.ok(turnsToBuild('phalanx', ctx) > ctx.threatEta,
    'fixture must not let a phalanx finish inside the deadline');
  assert.ok(scoreProduction('militia', ctx) > scoreProduction('phalanx', ctx));
});

test('the same city with time to spare goes back to the phalanx', () => {
  // Identical to the test above but with no enemy in sight: no deadline, so the
  // better unit wins. This is the balance the scorer exists to strike — the militia
  // above is not a preference for cheap units, it is a deadline being met.
  const state = fixture({ size: 4, terrain: 'forest' });
  const ctx = productionContext(state, state.cities[0], 'p1');
  assert.equal(ctx.threatEta, null);
  assert.ok(scoreProduction('phalanx', ctx) > scoreProduction('militia', ctx));
});

test('a bigger visible army raises the garrison the city wants', () => {
  const quiet = ctxFor({});
  const raided = ctxFor({ units: [{ type: 'legion', ownerId: 'p2', x: 8, y: 5 }] });
  assert.ok(raided.defenceTarget > quiet.defenceTarget);
  const swarmed = ctxFor({ units: [{ type: 'knights', ownerId: 'p2', x: 8, y: 5 }] });
  assert.ok(swarmed.defenceTarget > raided.defenceTarget,
    'knights are a bigger warning than a legion');
});

// ── Reinforcements ───────────────────────────────────────────────────────────

test('a defender already standing in the city covers it', () => {
  const bare = ctxFor({ size: 3 });
  const held = ctxFor({ size: 3, units: [{ type: 'phalanx', x: 5, y: 5 }] });
  assert.equal(bare.cover, 0);
  assert.ok(held.cover >= held.defenceTarget, 'one phalanx should satisfy a quiet city');
  // With the gap closed the defensive term is zero, so all a phalanx is worth here
  // is its own feeble offence — and a temple beats that comfortably.
  assert.ok(scoreProduction('phalanx', held) < scoreProduction('phalanx', bare) / 5);
  assert.ok(scoreProduction('temple', held) > scoreProduction('phalanx', held),
    'a covered city should get on with its economy');
});

test('a defender walking home counts, discounted by how far off it is', () => {
  const near = ctxFor({ units: [{ type: 'phalanx', x: 6, y: 5 }] });
  const far  = ctxFor({ units: [{ type: 'phalanx', x: 8, y: 5 }] });
  const gone = ctxFor({ units: [{ type: 'phalanx', x: 15, y: 5 }] });
  assert.ok(near.cover > far.cover, 'closer reinforcements count for more');
  assert.equal(gone.cover, 0, 'past the horizon it is not a reinforcement');
  // And a reinforcement on the way is a reason not to start a second defender.
  assert.ok(scoreProduction('phalanx', near) < scoreProduction('phalanx', ctxFor({})));
});

test('a unit garrisoning another city is not a reinforcement', () => {
  // Pulling it out just moves the hole. Two cities, one phalanx, sitting on the
  // other one: this city is uncovered.
  const state = fixture({ units: [{ type: 'phalanx', x: 8, y: 5 }] });
  state.cities.push({
    id: 'c2', name: 'Veii', ownerId: 'p1', position: { x: 8, y: 5 },
    size: 1, food: 0, shields: 0, production: 'militia', buildings: [],
  });
  const ctx = productionContext(state, state.cities[0], 'p1');
  assert.equal(ctx.cover, 0);
});

test('a fortified veteran counts for more than a raw unit', () => {
  const raw = ctxFor({ units: [{ type: 'militia', x: 5, y: 5 }] });
  const dug = ctxFor({ units: [{ type: 'militia', x: 5, y: 5, attrs: { veteran: true, fortified: true } }] });
  assert.ok(dug.cover > raw.cover);
});

test('settlers never count as cover', () => {
  // Settlers have defence 1 but are captured rather than killed, so a city holding
  // only settlers is an undefended city.
  const ctx = ctxFor({ units: [{ type: 'settlers', x: 5, y: 5 }] });
  assert.equal(ctx.cover, 0);
});

// ── The city's own defensive multiplier ──────────────────────────────────────

test('terrain and walls reduce the garrison a city needs', () => {
  const flat  = ctxFor({});
  const hilly = ctxFor({ terrain: 'hills' });
  const walled = ctxFor({ buildings: ['palace', 'city-walls'] });
  // Same militia is worth more standing in a better city, so the same build closes
  // more of the gap.
  const withMilitia = t => productionContext(
    fixture({ terrain: t, units: [{ type: 'militia', x: 5, y: 5 }] }),
    fixture({ terrain: t }).cities[0], 'p1').cover;
  assert.ok(withMilitia('hills') > withMilitia('grassland'));
  assert.ok(hilly.defenceFactor > flat.defenceFactor);
  assert.ok(walled.defenceFactor > flat.defenceFactor * 2, 'walls triple the defence');
});

test('city walls are worth building only where there is a garrison and a threat', () => {
  const empty = ctxFor({ units: [] });
  const held  = ctxFor({ units: [{ type: 'phalanx', x: 5, y: 5 }] });
  const heldAndThreatened = ctxFor({
    units: [{ type: 'phalanx', x: 5, y: 5 }, { type: 'legion', ownerId: 'p2', x: 8, y: 5 }],
  });
  assert.equal(scoreProduction('city-walls', empty), 0, 'nothing to multiply');
  assert.ok(scoreProduction('city-walls', heldAndThreatened) > scoreProduction('city-walls', held),
    'walls are a reaction to a threat, not a habit');
});

// ── Offence ──────────────────────────────────────────────────────────────────

test('a covered city buys the stronger attacker, not the cheaper one', () => {
  const ctx = ctxFor({ units: [{ type: 'phalanx', x: 5, y: 5 }] });
  assert.ok(scoreProduction('legion', ctx) > scoreProduction('militia', ctx));
  assert.ok(scoreProduction('catapult', ctx) > scoreProduction('militia', ctx));
  assert.ok(scoreProduction('knights', ctx) > scoreProduction('legion', ctx));
});

test('the offence term cannot swamp the rest of the scale', () => {
  const ctx = ctxFor({ size: 8, units: [{ type: 'musketeers', x: 5, y: 5 }] });
  // An empire that can build armour should still be able to want a temple.
  const best = Math.max(...['armor', 'artillery', 'battleship', 'cannon']
    .map(u => scoreProduction(u, ctx)));
  assert.ok(best <= 60, `offence capped, got ${best}`);
});

test('units the empire cannot support are penalised, settlers excepted', () => {
  // A covered size-3 city with six units in the field: under Despotism it supports
  // three free and pays a shield a turn for each one after that.
  const over = ctxFor({
    size: 3,
    units: [
      { type: 'phalanx', x: 5, y: 5 },
      ...Array.from({ length: 5 }, (_, i) => ({ type: 'militia', x: 5 + i, y: 15 })),
    ],
  });
  assert.ok(over.overSupported);
  assert.ok(over.cover >= over.defenceTarget, 'the city must be covered already');
  assert.ok(scoreProduction('legion', over) < 0);
  assert.ok(scoreProduction('settlers', ctxFor({ size: 2 })) > 0, 'settlers raise the ceiling');
});

// ── Churn ────────────────────────────────────────────────────────────────────

test('a city is left alone unless the alternative clears the switch margin', () => {
  const ctx = ctxFor({});
  // Already building the thing the scorer wants: nothing is offered.
  assert.equal(chooseProductionAction(acts(['militia', 'temple']), ctx, 'phalanx'), null);
  assert.deepEqual(rankProductionActions(acts(['militia', 'temple']), ctx, 'phalanx', 3), []);
  // And a marginal improvement is not worth re-tasking for.
  const current = scoreProduction('militia', ctx);
  const offered = acts(['phalanx']);
  const margin = scoreProduction('phalanx', ctx) - current;
  assert.ok(margin > SWITCH_MARGIN, 'phalanx over militia should clear the margin');
  assert.equal(chooseProductionAction(offered, ctx, 'militia').item, 'phalanx');
});

test('the ranked list is the same decision as the single pick', () => {
  const ctx = ctxFor({});
  const offered = acts(['militia', 'phalanx', 'temple', 'barracks', 'settlers']);
  const top = rankProductionActions(offered, ctx, null, 3);
  assert.equal(top[0].item, chooseProductionAction(offered, ctx, null).item);
  assert.ok(top.length <= 3);
});

// ── Build time ───────────────────────────────────────────────────────────────

test('banked shields shorten the build', () => {
  const fresh = ctxFor({});
  const part  = ctxFor({ shields: 15 });
  assert.ok(turnsToBuild('phalanx', part) < turnsToBuild('phalanx', fresh));
});

test('a city producing nothing still yields a finite build time', () => {
  // Disorder zeroes a city's shields; dividing by that would rank everything as
  // infinitely far away and flatten the whole comparison.
  const ctx = { ...ctxFor({}), shieldsPerTurn: 0, banked: 0 };
  assert.ok(Number.isFinite(turnsToBuild('phalanx', ctx)));
});

// ── Priority lists ───────────────────────────────────────────────────────────

test('the research order reaches a real attacker early', () => {
  // Horseback Riding was absent from both agents' lists entirely and Iron Working
  // sat twelfth, so for a dozen advances the only attacker available was a militia.
  assert.ok(RESEARCH_PRIORITY.includes('horseback-riding'));
  assert.ok(RESEARCH_PRIORITY.indexOf('horseback-riding') < 4);
  assert.ok(RESEARCH_PRIORITY.indexOf('iron-working') < 6);
  // Bronze Working stays first: the phalanx is what the defence model wants to buy.
  assert.equal(RESEARCH_PRIORITY[0], 'bronze-working');
});

test('both priority lists name only real things', () => {
  for (const t of RESEARCH_PRIORITY) assert.ok(t, 'empty tech id');
  assert.equal(new Set(RESEARCH_PRIORITY).size, RESEARCH_PRIORITY.length, 'duplicate tech');
  for (const b of IMPROVEMENT_PRIORITY) {
    assert.ok(IMPROVEMENTS[b] || b.startsWith('ss-') || ['pyramids', 'hanging-gardens',
      'great-library', 'copernicus', 'michelangelo', 'apollo'].includes(b), `unknown build ${b}`);
  }
});

// ── The calendar ─────────────────────────────────────────────────────────────

test('the year follows the original schedule', () => {
  assert.equal(yearLabel(1), '4000 BC');
  assert.equal(turnYear(2), -3980);          // 20 years a turn to start
  assert.equal(turnYear(200), -20);
  assert.equal(yearLabel(201), '1 AD');      // no year zero
  assert.equal(turnYear(202), 20);
  assert.equal(turnYear(251), 1000);         // ten years a turn from 1000 AD
  assert.equal(turnYear(301), 1500);         // five from 1500
  assert.equal(turnYear(351), 1750);         // two from 1750
  assert.equal(turnYear(401), 1850);         // one from 1850
  assert.equal(yearLabel(551), '2000 AD');
});

test('the year never runs backwards', () => {
  for (let t = 1; t < 600; t++) assert.ok(turnYear(t + 1) > turnYear(t), `turn ${t}`);
});

test('the year is defined for a turn before the game starts', () => {
  assert.equal(yearLabel(0), '4000 BC');
  assert.equal(yearLabel(undefined), '4000 BC');
});
