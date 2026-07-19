import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Civ1Game } from './index.js';
import { DIFFICULTIES, resolveRules } from './difficulty.js';
import { computeHappiness } from './city.js';

const players = () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];

// Minimal happiness context: no buildings, wonders, martial law — only the baseline.
const baseCtx = (contentBaseline) => ({
  contentBaseline, techs: new Set(), wonderEffects: new Set(), wonderIds: [],
  gov: { martialLaw: 0 }, garrison: 0,
});

// ── resolveRules ─────────────────────────────────────────────────────────────

test('difficulty: default is Prince', () => {
  assert.equal(resolveRules({}).difficulty, 'prince');
  assert.equal(resolveRules({}).contentBaseline, DIFFICULTIES.prince.contentBaseline);
});

test('difficulty: each preset sets its content baseline', () => {
  for (const [id, d] of Object.entries(DIFFICULTIES))
    assert.equal(resolveRules({ difficulty: id }).contentBaseline, d.contentBaseline);
});

test('difficulty: an explicit override beats the preset; blank falls back', () => {
  assert.equal(resolveRules({ difficulty: 'deity', contentBaseline: 5 }).contentBaseline, 5);
  assert.equal(resolveRules({ difficulty: 'deity', contentBaseline: '' }).contentBaseline, DIFFICULTIES.deity.contentBaseline);
});

test('difficulty: an unknown level falls back to the default', () => {
  assert.equal(resolveRules({ difficulty: 'nonsense' }).difficulty, 'prince');
});

// ── Effect on the game ───────────────────────────────────────────────────────

test('difficulty: a size-5 city is content on Chieftain but in disorder on Emperor', () => {
  const city = { size: 5, buildings: [] };
  assert.equal(computeHappiness(city, 0, baseCtx(DIFFICULTIES.chieftain.contentBaseline)).disorder, false);
  assert.equal(computeHappiness(city, 0, baseCtx(DIFFICULTIES.emperor.contentBaseline)).disorder, true);
});

test('difficulty: createInitialState stores one shared rules object (symmetric, not per-civ)', () => {
  const s = Civ1Game.createInitialState(players(), { difficulty: 'king' });
  assert.equal(s.gameSpecific.rules.contentBaseline, DIFFICULTIES.king.contentBaseline);
  // The same rules apply to whichever civ works a city — there is no per-player copy.
  assert.ok(!('rules' in s.gameSpecific.civ.p1));
  assert.ok(!('rules' in s.gameSpecific.civ.p2));
});

// ── Anti-cheat ───────────────────────────────────────────────────────────────

test("anti-cheat: getVisibleState hides a rival's advances, treasury and research", () => {
  const s = Civ1Game.createInitialState(players(), { fogOfWar: true });
  s.gameSpecific.civ.p2 = { ...s.gameSpecific.civ.p2, techs: ['bronze-working', 'currency'], gold: 500, research: 'trade' };
  const view = Civ1Game.getVisibleState(s, 'p1');
  assert.deepEqual(view.gameSpecific.civ.p2.techs, [], 'rival advances hidden');
  assert.equal(view.gameSpecific.civ.p2.gold, 0, 'rival treasury hidden');
  assert.equal(view.gameSpecific.civ.p2.research, null, 'rival research hidden');
  // The viewer still sees their own ledger in full.
  assert.equal(view.gameSpecific.civ.p1, s.gameSpecific.civ.p1);
});
