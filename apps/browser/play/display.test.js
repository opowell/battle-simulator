import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_OPTIONS, DISPLAY_PRESETS, displayFlags, resolveDisplay, optionValues, displayText } from './display.js';

test('a preset sets every option, so switching between presets is a clean switch', () => {
  for (const p of Object.values(DISPLAY_PRESETS)) {
    assert.deepEqual(Object.keys(p.options).sort(), DISPLAY_OPTIONS.map(o => o.id).sort());
  }
});

test('the scenario\'s display lays over the game\'s ui, and the session\'s over that', () => {
  const game = { showHpBars: true, moveAnimation: 'hop', keys: { a: 1 } };
  const ui = resolveDisplay(game, { preset: 'board' }, null);
  assert.equal(ui.showHpBars, false);
  assert.equal(ui.showRoster, false);
  assert.equal(ui.showActionsPanel, false);
  assert.equal(ui.moveAnimation, 'none');
  assert.deepEqual(ui.keys, { a: 1 }, 'flags no option touches are the game\'s');
  // Unit highlighting off is three flags: no plates, no ring, the square tinted.
  assert.equal(ui.unitPlates, false);
  assert.equal(ui.freeSelection, true);
  assert.equal(ui.highlightSelectedSquare, true);
  // A session switches one option back on, or picks another kind of screen.
  assert.equal(resolveDisplay(game, { preset: 'board' }, { showHpBars: true }).showHpBars, true);
  assert.equal(resolveDisplay(game, { preset: 'board' }, 'tactics').showRoster, true);
  assert.deepEqual(resolveDisplay(game, null, null), game);
});

test('what each option reads as, and a display in words', () => {
  const v = optionValues(displayFlags({ preset: 'board', showRoster: true }));
  assert.equal(v.showRoster, true);
  assert.equal(v.unitHighlight, false);
  assert.equal(v.showHpBars, false);
  assert.equal(displayText(null), "the scenario's own");
  assert.equal(displayText({ preset: 'tactics', showHpBars: false }), 'Tactics, hit point bars off');
});
