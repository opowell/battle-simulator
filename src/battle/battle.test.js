import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattleGame } from './BattleGame.js';
import { checkSpec, resolveSpec } from './spec.js';
import { formula, whole, toNumber } from './exact.js';
import { strikeDamage, seenBy, stat } from './world.js';

// A BattleGame of its own for these tests, with hooks its specs can name.
const hooks = {
  halve: (env) => Math.floor(env.a.attack / 2),
  drain: (state, { caster, targets }) => ({ ...state, units: state.units.map(u => (u.id === targets[0]?.id ? { ...u, hp: u.hp - 1 } : u.id === caster.id ? { ...u, hp: u.hp + 1 } : u)) }),
  firstToTurnThree: (state) => (state.turnNumber >= 3 ? { outcome: 'win', winnerId: state.players[1].id, reason: 'hook' } : null),
};
const G = makeBattleGame({ name: 'BattleTest', hooks });
const P = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const MAN = { hp: 10, attack: 6, defense: 6, range: 1, speed: 3, rate: 1, vision: 5 };
const OPEN = (w = 8, h = 6, extra = {}) => ({ topology: 'square', width: w, height: h, generator: 'open', ...extra });

const start = (spec, config = {}) => G.createInitialState(P, { spec, ...config });
const act = (s, playerId, action) => G.applyActions(s, [{ playerId, action }]);
const unit = (s, id) => s.units.find(u => u.id === id);
const END = { type: 'end-turn', unitId: '__player__' };
const endBoth = (s) => act(act(s, 'p1', END), 'p2', END);
const legal = (s, pid) => G.getLegalActions(s, pid);
const has = (s, pid, pred) => legal(s, pid).some(pred);

// ── Exact formulas ──────────────────────────────────────────────────────────

test('formulas are exact rationals: 1/3·3 is 1, and a written 0.1 is a tenth', () => {
  assert.equal(toNumber(formula('1/3 * 3')({})), 1);
  assert.equal(toNumber(formula('0.1 + 0.2')({})), 0.3);
  assert.equal(whole(formula('max(1, floor(a.attack^2 / (a.attack + d.defense * (1 + cover/100))))')({ a: { attack: 6 }, d: { defense: 4 }, cover: 50 })), 3);
  assert.equal(toNumber(formula('if(x > 2, clamp(x, 0, 3), -x)')({ x: 5 })), 3);
  assert.throws(() => formula('sqrt(2)')({}), /unknown function/);
});

// ── The spec ────────────────────────────────────────────────────────────────

test('checkSpec names what is wrong with a spec', () => {
  const errs = checkSpec(resolveSpec({
    attributes: { mp: { kind: 'pool' }, odd: { kind: 'colour' } },
    abilities: { zap: { cost: { mana: 2 }, effects: [{ damage: {}, heal: {} }] } },
    unitTypes: { a: { hp: 5, abilities: ['nope'], pools: { mp: 3 } } },
    formulas: { damage: { fn: 'missing' } },
    board: { topology: 'square', width: 4, height: 4, terrain: { '1,1': 'lava' } },
    victory: [{ type: 'conquer' }],
  }), hooks);
  for (const want of [/odd: kind "colour"/, /zap.cost.mana: not a declared pool/, /exactly one of/, /no ability "nope"/, /no hook "missing"/, /no terrain "lava"/, /"conquer"/]) {
    assert.ok(errs.some(e => want.test(e)), `${want} in ${errs.join(' | ')}`);
  }
  assert.deepEqual(checkSpec(resolveSpec({}), hooks), []);
});

test('a spec replaces the unit types and keeps the base terrain; rows draw the board', () => {
  const s = start({ unitTypes: { man: MAN }, board: OPEN(5, 3, { generator: undefined, rows: ['..f..', '.~#..', '.....'] }) });
  assert.deepEqual(s.board.terrain, { '2,0': 'forest', '1,1': 'water', '2,1': 'rock' });
  assert.deepEqual(G.setupUnitTypes(s), ['man']);
  assert.equal(s.units.length, 2, 'one of each type a side');
});

test('the rules travel with the state: a state read back from JSON plays on', () => {
  const spec = { unitTypes: { man: MAN }, board: OPEN(), units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [2, 1] }] };
  const s = JSON.parse(JSON.stringify(start(spec)));
  const next = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(next, 'p2-1').hp, 7);
});

test('a ruleset names its damage formula, or a hook for it', () => {
  const armour = {
    attributes: { armor: { kind: 'number', default: 0 } },
    unitTypes: { man: { ...MAN, attrs: { armor: 2 } } },
    formulas: { damage: 'max(1, a.attack - d.armor)' },
    board: OPEN(), units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [2, 1] }],
  };
  let s = start(armour);
  assert.equal(strikeDamage(s, unit(s, 'p1-1'), unit(s, 'p2-1')), 4);
  s = start({ ...armour, formulas: { damage: { fn: 'halve' } } });
  assert.equal(strikeDamage(s, unit(s, 'p1-1'), unit(s, 'p2-1')), 3);
});

// ── Facing ──────────────────────────────────────────────────────────────────

const FACING = {
  orientation: { fov: 90, arcs: { front: 0, flank: -25, rear: -50 }, turnCost: 1 },
  unitTypes: { man: MAN },
  board: OPEN(),
};

test('a move leaves a unit facing its last step; a strike turns it to its target', () => {
  let s = start({ ...FACING, units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [6, 4] }] });
  assert.equal(unit(s, 'p1-1').facing, 0);
  assert.equal(unit(s, 'p2-1').facing, 180);
  s = act(s, 'p1', { type: 'move', unitId: 'p1-1', from: { x: 1, y: 1 }, to: { x: 1, y: 4 } });
  assert.equal(unit(s, 'p1-1').facing, 90, 'south, screen y down');
});

test('a unit strikes only inside its cone, and turning costs movement points', () => {
  let s = start({ ...FACING, units: [{ type: 'man', seat: 0, at: [2, 2] }, { type: 'man', seat: 1, at: [1, 2] }] });
  assert.ok(!has(s, 'p1', a => a.type === 'attack'), 'the enemy is behind it');
  assert.ok(!G.isActionLegal(s, 'p1', { type: 'face', unitId: 'p1-1', facing: 180 }), 'an about-face costs 4 > 3');
  assert.ok(has(s, 'p1', a => a.type === 'face' && a.facing === 135));
  s = act(s, 'p1', { type: 'face', unitId: 'p1-1', facing: 135 });
  assert.equal(unit(s, 'p1-1').perTurn.moveLeft, 0);
  assert.ok(!has(s, 'p1', a => a.type === 'face'), 'one turn a turn');
  assert.ok(has(s, 'p1', a => a.type === 'attack' && a.targetId === 'p2-1'), '45° off: in the cone now');
  s = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(s, 'p1-1').facing, 180, 'the strike turned it square on');
});

test('a blow from behind or the flank lands harder (defense arcs)', () => {
  const s = start({ ...FACING, orientation: { ...FACING.orientation, fov: 360 }, units: [
    { type: 'man', seat: 0, at: [3, 2] }, { type: 'man', seat: 1, at: [4, 2], facing: 0 },
    { type: 'man', seat: 1, at: [2, 2], facing: 0 }, { type: 'man', seat: 1, at: [3, 3], facing: 180 },
  ] });
  const a = unit(s, 'p1-1');
  assert.equal(strikeDamage(s, a, unit(s, 'p2-1')), 4, 'struck from behind: 36 / (6 + 3)');
  assert.equal(strikeDamage(s, a, unit(s, 'p2-2')), 3, 'from the front: 36 / 12');
  assert.equal(strikeDamage(s, a, unit(s, 'p2-3')), 3, 'from the flank: ⌊36 / 10.5⌋');
});

test('under fog a cone sees only ahead (and whatever is close enough to touch)', () => {
  const s = start({ ...FACING, units: [{ type: 'man', seat: 0, at: [3, 2] }, { type: 'man', seat: 1, at: [0, 2] }, { type: 'man', seat: 1, at: [5, 3] }] }, { fogOfWar: true });
  const view = G.getVisibleState(s, 'p1');
  assert.deepEqual(view.units.map(u => u.id).sort(), ['p1-1', 'p2-2']);
});

test('on a clock a turn takes time', () => {
  let s = start({ ...FACING, units: [{ type: 'man', seat: 0, at: [2, 2] }, { type: 'man', seat: 1, at: [6, 4] }] }, { time: 'continuous' });
  assert.equal(G.getActionDuration(s, { type: 'face', unitId: 'p1-1', facing: 90 }), 2 / 3);
  s = act(s, 'p1', { type: 'face', unitId: 'p1-1', facing: 90 });
  assert.equal(unit(s, 'p1-1').task.type, 'face');
});

// ── Declared attributes ─────────────────────────────────────────────────────

const ATTRS = {
  attributes: {
    mp: { kind: 'pool', max: 10, regen: 3, start: 4 },
    shields: { kind: 'pool', absorbs: true, regen: 1 },
    haste: { kind: 'status', turns: 2, mods: { speed: '*3/2' } },
    poison: { kind: 'status', turns: 2, stack: 'stack', max: 2, tick: [{ damage: { amount: 1 } }], harmful: true },
    stop: { kind: 'status', turns: 1, blocks: ['move', 'act'], harmful: true },
  },
  abilities: {
    hasten: { cost: { mp: 4 }, range: 3, targets: 'ally', effects: [{ status: { id: 'haste' } }] },
    venom: { range: 1, targets: 'enemy', effects: [{ status: { id: 'poison' } }] },
    freeze: { range: 3, targets: 'enemy', cooldown: 2, effects: [{ status: { id: 'stop' } }] },
    zap: { cost: { mp: 4 }, range: 3, targets: 'enemy', effects: [{ damage: { amount: 5 } }] },
  },
  unitTypes: {
    mage: { ...MAN, pools: { mp: 10 }, abilities: ['hasten', 'venom', 'freeze', 'zap'] },
    guard: { ...MAN, pools: { shields: 3 } },
  },
  board: OPEN(),
  units: [{ type: 'mage', seat: 0, at: [1, 1] }, { type: 'mage', seat: 0, at: [2, 2] }, { type: 'mage', seat: 1, at: [3, 1] }],
};

test('a pool is spent on abilities and refills a window at a time', () => {
  let s = start(ATTRS);
  assert.deepEqual(unit(s, 'p1-1').pools, { mp: { value: 4, max: 10 } });
  s = act(s, 'p1', { type: 'ability', ability: 'zap', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(s, 'p1-1').pools.mp.value, 0);
  assert.ok(!has(endBoth(s), 'p1', a => a.ability === 'zap' && a.unitId === 'p1-1'), 'not before it has 4 again');
  s = endBoth(s);
  assert.equal(unit(s, 'p1-1').pools.mp.value, 3);
});

test('shields soak damage before hit points, and regenerate', () => {
  let s = start({ ...ATTRS, units: [{ type: 'mage', seat: 0, at: [1, 1] }, { type: 'guard', seat: 1, at: [3, 1] }] });
  s = act(s, 'p1', { type: 'ability', ability: 'zap', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(s, 'p2-1').pools.shields.value, 0);
  assert.equal(unit(s, 'p2-1').hp, 8);
  s = endBoth(s);
  assert.equal(unit(s, 'p2-1').pools.shields.value, 1);
});

test('statuses modify numbers, tick, stack, stop a unit, and run out', () => {
  let s = start(ATTRS);
  s = act(s, 'p1', { type: 'ability', ability: 'hasten', unitId: 'p1-1', targetId: 'p1-2' });
  assert.equal(stat(s, unit(s, 'p1-2'), 'speed'), 4, '3 × 3/2, floored');
  s = act(s, 'p1', { type: 'ability', ability: 'venom', unitId: 'p1-2', targetId: 'p2-1' });
  s = endBoth(s);
  assert.equal(unit(s, 'p1-2').perTurn.moveLeft, 4, 'the hasted unit\'s budget');
  assert.equal(unit(s, 'p2-1').hp, 9, 'one poison tick');
  s = act(s, 'p1', { type: 'ability', ability: 'venom', unitId: 'p1-2', targetId: 'p2-1' });
  assert.equal(unit(s, 'p2-1').statuses.find(x => x.id === 'poison').stacks, 2);
  s = act(s, 'p1', { type: 'ability', ability: 'freeze', unitId: 'p1-1', targetId: 'p2-1' });
  assert.ok(!legal(s, 'p2').some(a => a.unitId === 'p2-1'), 'stopped: no move, no act');
  s = endBoth(s);
  assert.equal(unit(s, 'p2-1').hp, 7, 'two stacks tick for two');
  assert.ok(legal(s, 'p2').some(a => a.unitId === 'p2-1'), 'the stop ran out');
  assert.equal(stat(s, unit(s, 'p1-2'), 'speed'), 3, 'haste ran out after its two windows');
  assert.ok(!has(s, 'p1', a => a.ability === 'freeze' && a.unitId === 'p1-1'), 'freeze is on cooldown');
  s = endBoth(s);
  assert.ok(has(s, 'p1', a => a.ability === 'freeze' && a.unitId === 'p1-1'));
});

test('on a clock pools refill and statuses tick at each window\'s end', () => {
  let s = start(ATTRS, { time: 'continuous' });
  s = act(s, 'p1', { type: 'ability', ability: 'venom', unitId: 'p1-2', targetId: 'p2-1' });
  for (let i = 0; i < 20 && s.gameSpecific.rt.clock < 1.2; i++) {
    const pid = s.activePlayers[0];
    const u = s.units.find(x => x.alive && x.ownerId === pid && !x.task);
    s = act(s, pid, u ? { type: 'wait', unitId: u.id, duration: 0.4 } : END);
  }
  assert.ok(s.gameSpecific.rt.clock >= 1);
  assert.equal(unit(s, 'p2-1').hp, 9, 'the poison ticked at t=1');
  assert.equal(unit(s, 'p1-1').pools.mp.value, 7, 'mp regenerated at t=1');
});

// ── Abilities ───────────────────────────────────────────────────────────────

const ABIL = {
  attributes: { cloaked: { kind: 'tag' }, flier: { kind: 'tag' } },
  abilities: {
    blast: { range: 4, targets: 'ground', area: { radius: 1 }, effects: [{ damage: { amount: 3 } }] },
    mend: { range: 2, targets: 'ally', effects: [{ heal: { amount: 50 } }] },
    bash: { range: 1, targets: 'enemy', effects: [{ move: { kind: 'push', distance: 2 } }] },
    blink: { range: 3, targets: 'ground', los: false, effects: [{ move: { kind: 'teleport' } }] },
    summon: { range: 1, targets: 'self', effects: [{ spawn: { type: 'imp', count: 2 } }] },
    morph: { targets: 'self', effects: [{ transform: { into: 'tower' } }] },
    groundShot: { range: 5, targets: 'enemy', filter: { not: 'air' }, effects: [{ damage: { amount: 1 } }] },
    leech: { range: 2, targets: 'enemy', effects: [{ fn: 'drain' }] },
  },
  unitTypes: {
    adept: { ...MAN, abilities: ['blast', 'mend', 'bash', 'blink', 'summon', 'morph', 'groundShot', 'leech'] },
    imp: { hp: 2, attack: 1, defense: 1, range: 1, speed: 2, rate: 1, vision: 2 },
    tower: { hp: 20, attack: 8, defense: 8, range: 4, speed: 0, rate: 1, vision: 6 },
    bird: { ...MAN, domain: 'air' },
  },
  board: OPEN(),
};

test('an area ability hits every enemy in its radius and no friend', () => {
  let s = start({ ...ABIL, units: [{ type: 'adept', seat: 0, at: [1, 1] }, { type: 'adept', seat: 0, at: [4, 3] }, { type: 'adept', seat: 1, at: [4, 2] }, { type: 'adept', seat: 1, at: [5, 2] }, { type: 'adept', seat: 1, at: [6, 2] }] });
  assert.ok(has(s, 'p1', a => a.ability === 'blast' && a.at.x === 4 && a.at.y === 2));
  s = act(s, 'p1', { type: 'ability', ability: 'blast', unitId: 'p1-1', at: { x: 4, y: 2 } });
  assert.deepEqual(s.units.map(u => u.hp), [10, 10, 7, 7, 10]);
});

test('heal stops at full; a push shoves back; a blink jumps to a free spot', () => {
  let s = start({ ...ABIL, units: [{ type: 'adept', seat: 0, at: [1, 1] }, { type: 'adept', seat: 0, at: [2, 2], hp: 4 }, { type: 'adept', seat: 1, at: [2, 1] }] });
  s = act(s, 'p1', { type: 'ability', ability: 'mend', unitId: 'p1-1', targetId: 'p1-2' });
  assert.equal(unit(s, 'p1-2').hp, 10);
  s = act(s, 'p1', { type: 'ability', ability: 'bash', unitId: 'p1-2', targetId: 'p2-1' });
  assert.deepEqual(unit(s, 'p2-1').position, { x: 2, y: 0 }, 'shoved straight back, and stopped by the edge');
  s = endBoth(s);
  assert.ok(!G.isActionLegal(s, 'p1', { type: 'ability', ability: 'blink', unitId: 'p1-1', at: { x: 2, y: 2 } }), 'not onto a friend');
  s = act(s, 'p1', { type: 'ability', ability: 'blink', unitId: 'p1-1', at: { x: 4, y: 1 } });
  assert.deepEqual(unit(s, 'p1-1').position, { x: 4, y: 1 });
});

test('summons and transformations', () => {
  let s = start({ ...ABIL, units: [{ type: 'adept', seat: 0, at: [3, 3], hp: 5 }, { type: 'adept', seat: 1, at: [7, 5] }] });
  s = act(s, 'p1', { type: 'ability', ability: 'summon', unitId: 'p1-1', targetId: 'p1-1' });
  assert.deepEqual(s.units.filter(u => u.type === 'imp').map(u => u.id), ['p1-s1', 'p1-s2']);
  assert.equal(s.gameSpecific.alive.p1, 3);
  s = endBoth(s);
  s = act(s, 'p1', { type: 'ability', ability: 'morph', unitId: 'p1-1', targetId: 'p1-1' });
  const t = unit(s, 'p1-1');
  assert.deepEqual([t.type, t.hp, t.maxHp, t.stats.range], ['tower', 10, 20, 4], 'half its hit points, as before');
});

test('target filters read tags and movement classes; a hook can be an effect', () => {
  let s = start({ ...ABIL, units: [{ type: 'adept', seat: 0, at: [1, 1] }, { type: 'bird', seat: 1, at: [3, 1] }, { type: 'adept', seat: 1, at: [2, 3] }] });
  const shots = legal(s, 'p1').filter(a => a.ability === 'groundShot').map(a => a.targetId);
  assert.deepEqual(shots, ['p2-2'], 'the bird is in the air');
  s = act(s, 'p1', { type: 'ability', ability: 'leech', unitId: 'p1-1', targetId: 'p2-2' });
  assert.deepEqual([unit(s, 'p1-1').hp, unit(s, 'p2-2').hp], [11, 9]);
});

test('a cloaked unit can be neither seen nor struck until a detector or a reveal shows it', () => {
  const spec = {
    abilities: { cloak: { targets: 'self', effects: [{ conceal: { turns: 3 } }] }, flare: { targets: 'ground', range: 6, los: false, area: { radius: 2 }, effects: [{ reveal: { turns: 1 } }] } },
    unitTypes: { ghost: { ...MAN, range: 4, abilities: ['cloak'] }, eye: { ...MAN, tags: ['detector'], vision: 2, abilities: ['flare'] } },
    board: OPEN(),
    units: [{ type: 'ghost', seat: 0, at: [1, 1] }, { type: 'ghost', seat: 1, at: [4, 1] }, { type: 'eye', seat: 1, at: [7, 5] }],
  };
  let s = start(spec);
  s = act(s, 'p1', { type: 'ability', ability: 'cloak', unitId: 'p1-1', targetId: 'p1-1' });
  assert.ok(!seenBy(s, 'p2', unit(s, 'p1-1')));
  assert.ok(!G.getVisibleState(s, 'p2').units.some(u => u.id === 'p1-1'), 'hidden even without fog');
  s = act(s, 'p1', END);
  assert.ok(!has(s, 'p2', a => a.targetId === 'p1-1'));
  s = act(s, 'p2', { type: 'ability', ability: 'flare', unitId: 'p2-2', at: { x: 2, y: 1 } });
  assert.ok(seenBy(s, 'p2', unit(s, 'p1-1')), 'the flare shows it');
  assert.ok(has(s, 'p2', a => a.type === 'attack' && a.targetId === 'p1-1'));
});

test('on a clock an ability winds up and lands later — and misses a target that left', () => {
  const spec = { ...ABIL, abilities: { ...ABIL.abilities, slowShot: { range: 2, windup: 1, targets: 'enemy', effects: [{ damage: { amount: 4 } }] } },
    unitTypes: { ...ABIL.unitTypes, adept: { ...ABIL.unitTypes.adept, abilities: ['slowShot'] } },
    units: [{ type: 'adept', seat: 0, at: [1, 1] }, { type: 'adept', seat: 1, at: [3, 1] }] };
  let s = start(spec, { time: 'continuous' });
  assert.equal(G.getActionDuration(s, { type: 'ability', ability: 'slowShot', unitId: 'p1-1', targetId: 'p2-1' }), 1);
  s = act(s, 'p1', { type: 'ability', ability: 'slowShot', unitId: 'p1-1', targetId: 'p2-1' });
  s = act(s, 'p2', { type: 'move', unitId: 'p2-1', from: { x: 3, y: 1 }, to: { x: 6, y: 1 } });
  assert.equal(unit(s, 'p2-1').hp, 10, 'it walked out of range before the shot landed');
  let t = start(spec, { time: 'continuous' });
  t = act(t, 'p1', { type: 'ability', ability: 'slowShot', unitId: 'p1-1', targetId: 'p2-1' });
  t = act(t, 'p2', { type: 'wait', unitId: 'p2-1', duration: 1.5 });
  assert.equal(unit(t, 'p2-1').hp, 6);
});

// ── Boards ──────────────────────────────────────────────────────────────────

test('hex: six neighbours, hex distance, sight blocked by rock between', () => {
  const s = start({ unitTypes: { man: { ...MAN, range: 3, speed: 1 } }, board: { topology: 'hex', width: 7, height: 5, terrain: { '3,2': 'rock' } },
    units: [{ type: 'man', seat: 0, at: [1, 2] }, { type: 'man', seat: 1, at: [5, 2] }, { type: 'man', seat: 1, at: [3, 0] }] });
  const steps = legal(s, 'p1').filter(a => a.type === 'move').map(a => `${a.to.x},${a.to.y}`).sort();
  assert.deepEqual(steps, ['0,1', '0,2', '0,3', '1,1', '1,3', '2,2']);
  const shots = legal(s, 'p1').filter(a => a.type === 'attack').map(a => a.targetId);
  assert.deepEqual(shots, ['p2-2'], 'the rock hides the one four hexes along the row; the other is three away');
});

test('regions: moves follow the adjacency list, distance is hops, and there is no continuous space', () => {
  const spec = { unitTypes: { man: { ...MAN, speed: 1, range: 1 } },
    board: { topology: 'regions', layout: 'square', regions: {
      a: { cells: [[0, 0], [1, 0]] }, b: { cells: [[2, 0], [2, 1]], terrain: 'forest' }, c: { cells: [[0, 1], [1, 1]] }, d: { cells: [[3, 0], [3, 1]] } } },
    units: [{ type: 'man', seat: 0, at: 'a' }, { type: 'man', seat: 1, at: 'd' }] };
  const s = start(spec, { space: 'continuous' });
  assert.equal(s.gameSpecific.spacetime.space, 'discrete');
  const to = legal(s, 'p1').filter(a => a.type === 'move').map(a => a.to);
  assert.deepEqual(to.length, 1, 'b costs 2 (forest) and c is next door');
  const into = act(s, 'p1', { type: 'move', unitId: 'p1-1', from: unit(s, 'p1-1').position, to: to[0] });
  assert.ok(into.units[0].position);
});

test('elevation: climbing costs, high ground sees over a wall, and a defender above has cover', () => {
  const spec = { unitTypes: { man: { ...MAN, range: 4, speed: 2 } },
    board: { topology: 'square', width: 6, height: 2, generator: 'open', terrain: { '2,0': 'rock' }, elevation: { '0,0': 2, '1,0': 1, '0,1': 1 } },
    units: [{ type: 'man', seat: 0, at: [0, 0] }, { type: 'man', seat: 0, at: [1, 0] }, { type: 'man', seat: 1, at: [4, 0] }] };
  const s = start(spec);
  const shots = legal(s, 'p1').filter(a => a.type === 'attack').map(a => a.unitId);
  assert.deepEqual(shots, ['p1-1'], 'from two up the line clears the rock; from one up it does not');
  assert.ok(has(s, 'p2', a => a.type === 'attack' && a.targetId === 'p1-1'), 'and sight is the same both ways');
  const climb = start({ ...spec, units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [5, 1] }] });
  const tos = legal(climb, 'p1').filter(a => a.type === 'move').map(a => `${a.to.x},${a.to.y}`);
  assert.ok(tos.includes('1,0') && !tos.includes('0,0'), 'one level up costs 2; two up (0,0 from 1,1) costs 1 + 2 = 3 > 2');
  const down = start({ ...spec, units: [{ type: 'man', seat: 0, at: [3, 0] }, { type: 'man', seat: 1, at: [1, 0] }] });
  assert.equal(strikeDamage(down, unit(down, 'p1-1'), unit(down, 'p2-1')), 2, '36 / (6 + 6 × 1.25) for one level up');
});

test('terrain prices by movement class: a flier crosses water, a walker cannot', () => {
  const spec = { unitTypes: { walker: { ...MAN, speed: 3 }, flier: { ...MAN, speed: 3, domain: 'air' } },
    board: { topology: 'square', width: 6, height: 1, generator: 'open', terrain: { '2,0': 'water' } },
    units: [{ type: 'walker', seat: 0, at: [1, 0] }, { type: 'flier', seat: 0, at: [0, 0] }, { type: 'walker', seat: 1, at: [5, 0] }] };
  const s = start(spec);
  const tos = (id) => legal(s, 'p1').filter(a => a.type === 'move' && a.unitId === id).map(a => a.to.x).sort();
  assert.deepEqual(tos('p1-1'), [], 'a walker stops at the water');
  assert.deepEqual(tos('p1-2'), [2, 3], 'a flier goes over it');
});

test('stacks: friends share a cell, the best defender takes the blow, and the stack falls with it', () => {
  const spec = { unitTypes: { man: MAN, wall: { ...MAN, defense: 12, hp: 2 } },
    board: { ...OPEN(), stacking: 'stack', stackDeath: true },
    units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [2, 1] }, { type: 'wall', seat: 1, at: [2, 1] }, { type: 'man', seat: 1, at: [3, 1] }] };
  let s = start(spec);
  assert.ok(has(s, 'p2', a => a.type === 'move' && a.unitId === 'p2-3' && a.to.x === 2 && a.to.y === 1), 'may join the stack');
  s = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(s, 'p2-2').alive, false, 'the wall took it: 36 / (6 + 12) = 2, its last two');
  assert.equal(unit(s, 'p2-1').alive, false, 'and the man under it died with the stack');
});

test('counted groups merge, and strike once per member', () => {
  const spec = { unitTypes: { band: { hp: 4, attack: 2, defense: 2, range: 1, speed: 2, rate: 1, vision: 3, count: 3 } },
    board: { ...OPEN(), stacking: 'count' },
    units: [{ type: 'band', seat: 0, at: [1, 1] }, { type: 'band', seat: 0, at: [2, 2] }, { type: 'band', seat: 1, at: [3, 1] }] };
  let s = start(spec);
  assert.deepEqual([unit(s, 'p1-1').hp, unit(s, 'p1-1').maxHp, unit(s, 'p1-1').memberHp], [12, 12, 4]);
  s = act(s, 'p1', { type: 'move', unitId: 'p1-2', from: { x: 2, y: 2 }, to: { x: 1, y: 1 } });
  assert.equal(s.units.filter(u => u.ownerId === 'p1').length, 1);
  assert.equal(unit(s, 'p1-1').hp, 24);
  s = act(s, 'p1', { type: 'move', unitId: 'p1-1', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  s = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(s, 'p2-1').hp, 12 - 6, 'six members × ⌊4/4⌋');
});

test('a placement may say how many members its counted group starts with', () => {
  const spec = { unitTypes: { band: { hp: 4, attack: 2, defense: 2, range: 1, speed: 2, rate: 1, vision: 3, count: 3 } },
    board: { ...OPEN(), stacking: 'count' },
    units: [{ type: 'band', seat: 0, at: [1, 1], count: 7 }, { type: 'band', seat: 1, at: [3, 1] }] };
  const s = start(spec);
  assert.deepEqual([unit(s, 'p1-1').hp, unit(s, 'p1-1').maxHp, unit(s, 'p1-1').memberHp], [28, 28, 4]);
  assert.equal(unit(s, 'p2-1').hp, 12, 'its type\'s three');
});

test('a wrapped board joins its left and right edges; four neighbours measure Manhattan', () => {
  const wrap = start({ unitTypes: { man: { ...MAN, speed: 1 } }, board: { ...OPEN(6, 3), wrap: true }, units: [{ type: 'man', seat: 0, at: [0, 1] }, { type: 'man', seat: 1, at: [5, 1] }] });
  assert.ok(has(wrap, 'p1', a => a.type === 'attack'), 'next door across the seam');
  const four = start({ unitTypes: { man: { ...MAN, speed: 1 } }, board: { ...OPEN(), neighbours: 4 }, units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'man', seat: 1, at: [2, 2] }] });
  assert.ok(!has(four, 'p1', a => a.type === 'attack'), 'a diagonal is two steps');
  assert.equal(legal(four, 'p1').filter(a => a.type === 'move').length, 4);
});

test('shape boards: walls stop movement, windows let sight through, crates block both', () => {
  const spec = {
    terrain: { crate: { cost: 1, passable: false, blocksSight: true } },
    unitTypes: { man: { ...MAN, range: 6, speed: 2, vision: 8 } },
    board: { topology: 'shapes', width: 10, height: 6, shapes: [{ x: 6, y: 4, w: 1, h: 2, terrain: 'crate' }],
      walls: [{ x0: 3, y0: 0, x1: 3, y1: 2 }, { x0: 3, y0: 2, x1: 3, y1: 3, window: true }, { x0: 3, y0: 3, x1: 3, y1: 6 }] },
    units: [{ type: 'man', seat: 0, at: [2, 2] }, { type: 'man', seat: 1, at: [5, 2] }, { type: 'man', seat: 1, at: [8, 5] }],
  };
  for (const space of ['discrete', 'continuous']) {
    const s = start(spec, { space });
    const moves = legal(s, 'p1').filter(a => a.type === 'move');
    assert.ok(moves.every(a => a.to.x < 3), `${space}: the wall holds`);
    const shots = legal(s, 'p1').filter(a => a.type === 'attack').map(a => a.targetId);
    assert.deepEqual(shots, ['p2-1'], `${space}: through the window, and not past the crate`);
  }
});

// ── Victory ─────────────────────────────────────────────────────────────────

const DUEL = (victory, extra = {}) => ({ unitTypes: { man: MAN, king: { ...MAN, hp: 1, tags: ['royal'] } }, board: OPEN(), victory, ...extra });

test('royal: losing the royal unit loses the battle, and fog does not hide that', () => {
  let s = start(DUEL([{ type: 'royal' }, { type: 'eliminate' }], { units: [{ type: 'man', seat: 0, at: [1, 1] }, { type: 'king', seat: 1, at: [2, 1] }, { type: 'man', seat: 1, at: [6, 4] }] }), { fogOfWar: true });
  s = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.deepEqual(G.getResult(G.getVisibleState(s, 'p2')), { outcome: 'win', winnerId: 'p1', reason: 'royal-lost' });
});

test('hold: standing alone on the cells for N windows wins, and being dislodged starts over', () => {
  let s = start(DUEL([{ type: 'hold', cells: [[3, 3]], windows: 2 }], { units: [{ type: 'man', seat: 0, at: [3, 2] }, { type: 'man', seat: 1, at: [7, 5] }] }));
  s = act(s, 'p1', { type: 'move', unitId: 'p1-1', from: { x: 3, y: 2 }, to: { x: 3, y: 3 } });
  s = endBoth(s);
  assert.equal(G.getResult(s), null);
  s = endBoth(s);
  assert.deepEqual(G.getResult(s), { outcome: 'win', winnerId: 'p1', reason: 'held' });
});

test('reach, survive, points and a hook decide battles too', () => {
  let s = start(DUEL([{ type: 'reach', side: 1, cells: [[0, 0]] }], { units: [{ type: 'man', seat: 0, at: [7, 5] }, { type: 'man', seat: 1, at: [1, 1] }] }));
  s = act(act(s, 'p1', END), 'p2', { type: 'move', unitId: 'p2-1', from: { x: 1, y: 1 }, to: { x: 0, y: 0 } });
  assert.deepEqual(G.getResult(s), { outcome: 'win', winnerId: 'p2', reason: 'reached' });

  s = start(DUEL([{ type: 'survive', side: 1, windows: 2 }], { units: [{ type: 'man', seat: 0, at: [7, 5] }, { type: 'man', seat: 1, at: [0, 0] }] }));
  s = endBoth(endBoth(s));
  assert.deepEqual(G.getResult(s), { outcome: 'win', winnerId: 'p2', reason: 'survived' });

  s = start(DUEL([{ type: 'points', windows: 2, hold: { cells: [[0, 0]], per: 3 } }], { units: [{ type: 'man', seat: 0, at: [7, 5] }, { type: 'man', seat: 0, at: [6, 5] }, { type: 'man', seat: 1, at: [0, 0] }] }));
  s = endBoth(endBoth(s));
  assert.deepEqual(G.getResult(s), { outcome: 'win', winnerId: 'p2', reason: 'points', score: { p1: 2, p2: 7 } });

  s = start(DUEL([{ fn: 'firstToTurnThree' }], { units: [{ type: 'man', seat: 0, at: [7, 5] }, { type: 'man', seat: 1, at: [0, 0] }] }));
  s = endBoth(endBoth(s));
  assert.equal(G.getResult(s)?.reason, 'hook');
});

// ── Action points, chance, and grid sight (phase 5: rules a game rebuilt on a spec needs) ──

// The rng a test throws its dice with: a fixed list of draws, then 0.
const draws = (...xs) => { const left = [...xs]; return () => left.shift() ?? 0; };

test('action points: a move costs one, a shot all that is left, and nothing moves after it', () => {
  const s = start({
    turn: { actionPoints: 2, move: 1 }, strike: { ap: 'all' },
    unitTypes: { man: { ...MAN, range: 9 } }, board: OPEN(10, 3), armies: [['man']],
    units: [{ type: 'man', seat: 0, at: [0, 1] }, { type: 'man', seat: 1, at: [9, 1] }],
  });
  assert.deepEqual(unit(s, 'p1-1').perTurn, { ap: 2, moveLeft: 3, attacksLeft: 1 });
  let t = act(s, 'p1', { type: 'move', unitId: 'p1-1', from: { x: 0, y: 1 }, to: { x: 3, y: 1 } });
  assert.equal(unit(t, 'p1-1').perTurn.ap, 1);
  t = act(t, 'p1', { type: 'move', unitId: 'p1-1', from: { x: 3, y: 1 }, to: { x: 6, y: 1 } });
  assert.deepEqual(unit(t, 'p1-1').perTurn, { ap: 0, moveLeft: 0, attacksLeft: 0 }, 'two moves of a full speed each');
  const u = act(s, 'p1', { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' });
  assert.equal(unit(u, 'p1-1').perTurn.ap, 0, 'a shot spends every point left');
  assert.ok(!has(u, 'p1', a => a.unitId === 'p1-1'), 'so nothing follows it');
  assert.equal(unit(endBoth(u), 'p1-1').perTurn.ap, 2, 'a new turn, a full purse');
});

test('chance: a d100 against the hit chance, a crit on the same roll, damage dice from roll(n), all on the action', () => {
  const spec = {
    attributes: { aim: { kind: 'number' } },
    strike: { hit: 'clamp(a.aim - 4 * dist - cover, 5, 95)', crit: 'floor(hit / 4)', effects: [{ damage: { formula: '3 + roll(3)' } }] },
    unitTypes: { gun: { ...MAN, hp: 40, range: 9, attrs: { aim: 75 } } }, board: OPEN(10, 3),
    units: [{ type: 'gun', seat: 0, at: [0, 1] }, { type: 'gun', seat: 1, at: [5, 1] }],
  };
  const s = start(spec);
  const shoot = (rng) => G.applyActions(s, [{ playerId: 'p1', action: { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' } }], rng);
  // 75 − 4·5 = 55%. A roll of 13 is under ⌊55/4⌋ = 13: a crit, (3 + 2) × 2.
  const crit = shoot(draws(0.12, 0.99));
  assert.equal(unit(crit, 'p2-1').hp, 30);
  assert.deepEqual(crit.lastActions[0].action, { type: 'attack', unitId: 'p1-1', targetId: 'p2-1', hitChance: 55, roll: 13, hit: true, crit: true, damage: 10 });
  const hit = shoot(draws(0.5, 0));
  assert.equal(unit(hit, 'p2-1').hp, 37, 'roll 51: a plain hit, 3 + 0');
  const miss = shoot(draws(0.55, 0.99));
  assert.equal(unit(miss, 'p2-1').hp, 40, 'roll 56 misses');
  assert.equal(miss.lastActions[0].action.damage, 0);
  assert.equal(miss.lastActions[0].action.hit, false);
});

test('a missed blow lands none of its other effects', () => {
  const spec = {
    attributes: { slow: { kind: 'status', turns: 2, modifiers: { speed: '-1' } } },
    strike: { hit: '50', effects: [{ damage: {} }, { status: 'slow' }] },
    unitTypes: { man: MAN }, board: OPEN(4, 1),
    units: [{ type: 'man', seat: 0, at: [0, 0] }, { type: 'man', seat: 1, at: [1, 0] }],
  };
  const shoot = (rng) => G.applyActions(start(spec), [{ playerId: 'p1', action: { type: 'attack', unitId: 'p1-1', targetId: 'p2-1' } }], rng);
  assert.ok(unit(shoot(draws(0.1)), 'p2-1').statuses?.some(x => x.id === 'slow'));
  assert.ok(!unit(shoot(draws(0.9)), 'p2-1').statuses?.length);
});

test('passFriends: false keeps a unit from walking through its own side', () => {
  const spec = (passFriends) => ({
    unitTypes: { man: MAN }, board: OPEN(5, 1, { neighbours: 4, passFriends }),
    units: [{ type: 'man', seat: 0, at: [0, 0] }, { type: 'man', seat: 0, at: [1, 0] }, { type: 'man', seat: 1, at: [4, 0] }],
  });
  const goes = (s) => legal(s, 'p1').filter(a => a.type === 'move' && a.unitId === 'p1-1').map(a => a.to.x).sort();
  assert.deepEqual(goes(start(spec(undefined))), [2, 3]);
  assert.deepEqual(goes(start(spec(false))), []);
});

test('sightLine bresenham and visionMetric chebyshev: grid sight as a tile game draws it', () => {
  const rows = ['.....', '.#...', '.....'];
  const spec = (extra) => ({
    unitTypes: { man: { ...MAN, vision: 2 } }, board: OPEN(5, 3, { generator: undefined, rows, neighbours: 4, ...extra }),
    units: [{ type: 'man', seat: 0, at: [0, 0] }, { type: 'man', seat: 1, at: [2, 2] }],
  });
  // (0,0)→(2,2): the Bresenham line runs through the rock at (1,1); the two are
  // 4 apart by Manhattan, 2 by Chebyshev.
  const open = (s) => ({ ...s, board: { ...s.board, terrain: {} } });
  const manhattan = open(start(spec({ sightLine: 'bresenham' })));
  assert.equal(seenBy(manhattan, 'p1', unit(manhattan, 'p2-1')), false, 'Manhattan: 4 squares, beyond vision 2');
  const cheb = open(start(spec({ sightLine: 'bresenham', visionMetric: 'chebyshev' })));
  assert.equal(seenBy(cheb, 'p1', unit(cheb, 'p2-1')), true, 'Chebyshev: 2 squares');
  const walled = start(spec({ sightLine: 'bresenham', visionMetric: 'chebyshev' }));
  assert.equal(seenBy(walled, 'p1', unit(walled, 'p2-1')), false, 'the rock on the line');
});

test('a terrain\'s extrude is the height an isometric board draws it at', () => {
  const s = start({ terrain: { crate: { name: 'Crate', cover: 20, extrude: 0.35, color: '#c8943a' } }, unitTypes: { man: MAN },
    board: OPEN(3, 1, { generator: undefined, rows: ['.c.'], legend: { c: 'crate' } }) });
  const cells = G.toGrid(s).cells;
  assert.equal(cells[1].height, 0.35);
  assert.equal(cells[0].height, undefined);
});

test('checkSpec reads the new keys, and a die is only thrown where it is evaluated', () => {
  const errs = checkSpec(resolveSpec({
    turn: { actionPoints: 0 }, strike: { hit: 'roll(100)', crit: 'nope(', ap: 'some' },
    abilities: { zap: { crit: '5', effects: [{ damage: {} }] } },
    board: { width: 4, height: 4, sightLine: 'ray', visionMetric: 'euclid' },
  }), hooks);
  for (const want of [/turn.actionPoints/, /strike.hit: a chance is a percent/, /strike.crit/, /strike.ap/, /zap.crit: needs a hit chance/, /sightLine/, /visionMetric/]) {
    assert.ok(errs.some(e => want.test(e)), `${want} in ${errs.join(' | ')}`);
  }
  assert.throws(() => formula('roll(6)')({}), /needs the battle's dice/);
  assert.equal(toNumber(formula('if(1, 2, roll(6))')({})), 2, 'the branch not taken throws no die');
});
