import { test } from 'node:test';
import assert from 'node:assert/strict';
// keyBindings.js is a classic browser global (no ESM export, so vue3-sfc-loader can
// load it); importing it for its side effect publishes the API on globalThis.KEYS.
await import('./keyBindings.js');
const { resolve, direction, keyLabel, helpGroups } = globalThis.KEYS;

// A keydown event, as the resolver sees it. `code` matters only for the keypad.
const ev = (key, opts = {}) => ({ key, code: opts.code ?? '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...opts });

const keys = {
  directionMove: true,
  directionPan: true,
  bindings: [
    { key: 'b', action: 'found-city', label: 'Found new city', group: 'Unit orders' },
    { key: 'i', action: ['irrigate', 'clear-terrain'], label: 'Improve terrain', group: 'Unit orders' },
    { key: ' ', action: 'skip-unit', label: 'No orders', group: 'Unit orders' },
    { key: 'c', command: 'center', label: 'Centre map', group: 'Map' },
    { key: 'F5', panel: 'rates', label: 'Rates', group: 'Advisors' },
    { key: '=', panel: 'rates', label: 'Rates', group: 'Advisors' },
    { key: 'F1', panel: 'cities', label: 'Cities', group: 'Advisors' },
  ],
  notes: [{ keys: '↑ ↓ ← →', label: 'Move one square', group: 'Unit orders' }],
};

test('a declared key resolves to its action type', () => {
  assert.deepEqual(resolve(ev('b'), keys), { kind: 'action', types: ['found-city'], binding: keys.bindings[0] });
});

test('a list of action types keeps its declared order (first legal one wins downstream)', () => {
  assert.deepEqual(resolve(ev('i'), keys).types, ['irrigate', 'clear-terrain']);
});

test('letter bindings ignore shift and case', () => {
  assert.equal(resolve(ev('B', { shiftKey: true }), keys).kind, 'action');
  assert.equal(resolve(ev('B'), keys).kind, 'action');
});

test('space is a bindable character key', () => {
  assert.deepEqual(resolve(ev(' '), keys).types, ['skip-unit']);
});

test('command and panel bindings resolve to their own kinds', () => {
  assert.equal(resolve(ev('c'), keys).command, 'center');
  assert.equal(resolve(ev('F5'), keys).panel, 'rates');
  assert.equal(resolve(ev('F1'), keys).panel, 'cities');
});

test('a shifted-only character matches the character the keyboard produced', () => {
  assert.equal(resolve(ev('=', { shiftKey: true }), keys).panel, 'rates');
});

test('ctrl / alt / meta chords are never ours (they belong to browser and OS)', () => {
  for (const mod of ['ctrlKey', 'altKey', 'metaKey'])
    assert.equal(resolve(ev('b', { [mod]: true }), keys), null);
});

test('an unbound key is not ours — the caller keeps its own default', () => {
  assert.equal(resolve(ev('z'), keys), null);
  assert.equal(resolve(ev('Escape'), keys), null);
});

test('a game with no declaration gets nothing at all', () => {
  assert.equal(resolve(ev('b'), null), null);
  assert.equal(resolve(ev('ArrowUp'), undefined), null);
});

test('arrows, keypad and digit row all give the same eight directions', () => {
  assert.deepEqual(resolve(ev('ArrowUp'), keys), { kind: 'move', dx: 0, dy: -1 });
  assert.deepEqual(resolve(ev('8', { code: 'Numpad8' }), keys), { kind: 'move', dx: 0, dy: -1 });
  assert.deepEqual(resolve(ev('8'), keys), { kind: 'move', dx: 0, dy: -1 });
  // Diagonals: 7 = north-west, 3 = south-east (y grows downward).
  assert.deepEqual(resolve(ev('7'), keys), { kind: 'move', dx: -1, dy: -1 });
  assert.deepEqual(resolve(ev('3'), keys), { kind: 'move', dx: 1, dy: 1 });
});

test('the keypad reads through e.code, so NumLock-off arrows still move', () => {
  // NumLock off reports e.key as 'ArrowLeft'/'Home'… but e.code stays Numpad4/Numpad7.
  assert.deepEqual(resolve(ev('ArrowLeft', { code: 'Numpad4' }), keys), { kind: 'move', dx: -1, dy: 0 });
  assert.deepEqual(resolve(ev('Home', { code: 'Numpad7' }), keys), { kind: 'move', dx: -1, dy: -1 });
});

test('keypad 5 is the centre, not a direction', () => {
  assert.equal(direction(ev('5', { code: 'Numpad5' })), null);
  assert.equal(resolve(ev('5'), keys), null);
});

test('shift + direction pans instead of moving', () => {
  assert.deepEqual(resolve(ev('ArrowRight', { shiftKey: true }), keys), { kind: 'pan', dx: 1, dy: 0 });
});

test('the direction flags gate their own behaviour', () => {
  const moveOnly = { ...keys, directionPan: false };
  assert.equal(resolve(ev('ArrowRight', { shiftKey: true }), moveOnly), null);
  const panOnly = { ...keys, directionMove: false };
  assert.equal(resolve(ev('ArrowRight'), panOnly), null);
  assert.deepEqual(resolve(ev('ArrowRight', { shiftKey: true }), panOnly), { kind: 'pan', dx: 1, dy: 0 });
});

test('declared bindings win over direction keys', () => {
  const withDigit = { ...keys, bindings: [...keys.bindings, { key: '4', action: 'sentry' }] };
  assert.deepEqual(resolve(ev('4'), withDigit).types, ['sentry']);
  // …and the digits it does not claim still move.
  assert.equal(resolve(ev('6'), withDigit).kind, 'move');
});

test('key labels are display-ready', () => {
  assert.equal(keyLabel(' '), 'Space');
  assert.equal(keyLabel('b'), 'B');
  assert.equal(keyLabel('F1'), 'F1');
  assert.equal(keyLabel('ArrowUp'), '↑');
});

test('help groups follow declaration order and merge keys sharing one label', () => {
  const groups = helpGroups(keys);
  assert.deepEqual(groups.map(g => g.heading), ['Unit orders', 'Map', 'Advisors']);
  assert.deepEqual(groups[0].rows, [
    { keys: 'B', label: 'Found new city' },
    { keys: 'I', label: 'Improve terrain' },
    { keys: 'Space', label: 'No orders' },
    { keys: '↑ ↓ ← →', label: 'Move one square' },
  ]);
  // F5 and = both open the rates overlay: one row, both keys.
  assert.deepEqual(groups[2].rows[0], { keys: 'F5 / =', label: 'Rates' });
});

test('help of an undeclared game is empty, not a crash', () => {
  assert.deepEqual(helpGroups(null), []);
  assert.deepEqual(helpGroups({}), []);
});
