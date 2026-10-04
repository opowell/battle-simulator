// keyBindings.js — keyboard play for the design battlefield.
//
// Loaded as a classic global <script> in index.html (like vision.js/data.js) — this
// repo's no-bundler UI runs .vue files through vue3-sfc-loader, which CANNOT parse
// `import`/`export` inside a plain .js, so shared helper code lives on a global
// instead. Everything here is pure (no DOM, no live state), published on `KEYS`:
//   • browser — the classic <script> assigns window.KEYS; SFCs call KEYS.foo(...)
//   • node    — `await import('./keyBindings.js')` exposes globalThis.KEYS for the
//               unit tests (see keyBindings.test.js).
//
// Nothing in this file knows any game. A game declares its own bindings in its
// `ui.keys` (see games/civ1/Civ1Game.js for the real one) and Battlefield.vue
// executes whatever this resolver reports:
//
//   ui.keys = {
//     directionMove: true,   // direction keys move the selected unit one square
//     directionPan:  true,   // shift + direction scrolls the map
//     bindings: [
//       { key: 'b',  action: 'found-city',                  label: 'Found new city' },
//       { key: 'i',  action: ['irrigate', 'clear-terrain'], label: 'Improve terrain' },
//       { key: 'c',  command: 'center',                     label: 'Centre the map' },
//       { key: 'F1', panel: 'cities',                       label: 'City status' },
//     ],
//     notes: [{ keys: '↑ ↓ ← →', label: 'Move', group: 'Unit orders' }],
//   }
//
// A binding carries exactly one effect:
//   action   — an action TYPE (or a list of types, first legal one wins) to submit
//              for the selected unit, or for the player ('__player__' actions like
//              end-turn). The game's getLegalActions stays the only authority on
//              whether it is available at all — an unavailable key simply does nothing.
//   command  — a named UI behaviour Battlefield.vue implements (center, next-unit, help).
//   panel    — a named overview overlay to open (cities/military/rates/science).
//
// Modifiers: ctrl/alt/meta always disqualify a binding (they belong to the browser and
// the OS). Shift is deliberately ignored for printable single-character keys, so 'b'
// fires on both B and shift-B, and a key that only exists shifted ('?', '=') matches
// the character the keyboard actually produced. Shift on a DIRECTION key means "pan"
// rather than "move", which is how the original Civ1 bindings read it too.

// Direction keys, in this engine's grid orientation (y grows downward, so "north"
// is dy -1). Three ways to say the same eight directions, because the machines this
// runs on differ: the arrow keys (every keyboard), the numeric keypad (the original
// game's own controls — reported as e.code Numpad1…Numpad9 regardless of NumLock),
// and the plain digit row (a laptop with no keypad still needs the four diagonals).
const NUMERIC_DIRECTIONS = {
  1: { dx: -1, dy:  1 }, 2: { dx: 0, dy:  1 }, 3: { dx: 1, dy:  1 },
  4: { dx: -1, dy:  0 },                       6: { dx: 1, dy:  0 },
  7: { dx: -1, dy: -1 }, 8: { dx: 0, dy: -1 }, 9: { dx: 1, dy: -1 },
};
const ARROW_DIRECTIONS = {
  ArrowUp:    { dx:  0, dy: -1 },
  ArrowDown:  { dx:  0, dy:  1 },
  ArrowLeft:  { dx: -1, dy:  0 },
  ArrowRight: { dx:  1, dy:  0 },
};

// The direction a key event asks for, or null if it isn't a direction key at all.
// Numpad 5 is intentionally absent: it is the keypad's centre, not a direction.
function direction(e) {
  if (ARROW_DIRECTIONS[e.key]) return ARROW_DIRECTIONS[e.key];
  const numpad = /^Numpad([1-9])$/.exec(e.code ?? '');
  if (numpad) return NUMERIC_DIRECTIONS[Number(numpad[1])] ?? null;
  if (/^[1-9]$/.test(e.key)) return NUMERIC_DIRECTIONS[Number(e.key)] ?? null;
  return null;
}

// Whether a declared binding key matches this event. Single-character keys compare
// case-insensitively (and ignore shift, see the header); everything else is a named
// key ('Enter', 'F1', 'ArrowUp', ' ' is a character) compared exactly.
function keyMatches(key, e) {
  if (typeof key !== 'string' || !key) return false;
  if (key.length === 1) return e.key.length === 1 && e.key.toLowerCase() === key.toLowerCase();
  return e.key === key;
}

function matchBinding(e, keys) {
  for (const b of keys?.bindings ?? []) {
    if (keyMatches(b.key, e)) return b;
  }
  return null;
}

// What this key press means, given the game's declaration — the whole decision, so
// Battlefield.vue's handler stays a switch over intents rather than a pile of key
// comparisons. null means "not ours": the caller keeps its own default handling
// (arrow keys stepping through history, Escape closing overlays) and must NOT
// preventDefault. Declared bindings win over direction keys, so a game is free to
// bind a digit to something of its own.
function resolve(e, keys) {
  if (!keys || e.ctrlKey || e.altKey || e.metaKey) return null;
  const binding = matchBinding(e, keys);
  if (binding) {
    if (binding.action != null)
      return { kind: 'action', types: Array.isArray(binding.action) ? binding.action : [binding.action], binding };
    if (binding.command) return { kind: 'command', command: binding.command, binding };
    if (binding.panel)   return { kind: 'panel', panel: binding.panel, binding };
    return null;
  }
  const dir = direction(e);
  if (!dir) return null;
  if (e.shiftKey) return keys.directionPan ? { kind: 'pan', ...dir } : null;
  return keys.directionMove ? { kind: 'move', ...dir } : null;
}

// ── help rendering ────────────────────────────────────────────
// The same declaration drives the help overlay's key list, so a binding can never
// be documented as something other than what it does.
const KEY_LABELS = {
  ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab',
};

function keyLabel(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

// Rows for the help overlay, grouped by each entry's `group` (declaration order
// decides both the group order and the order within a group). Keys bound to the
// same label in the same group collapse into one row ("F5 / =") instead of
// repeating the description. `notes` entries are documentation-only rows (their
// `keys` string is already display-ready) — that is how a behaviour with no single
// key, like the eight direction keys, gets described in the game's own words.
function helpGroups(keys) {
  if (!keys) return [];
  const groups = new Map();
  const rowFor = (group, label) => {
    if (!groups.has(group)) groups.set(group, new Map());
    const rows = groups.get(group);
    if (!rows.has(label)) rows.set(label, { keys: [], label });
    return rows.get(label);
  };
  for (const b of keys.bindings ?? []) {
    if (!b.label) continue;
    rowFor(b.group ?? '', b.label).keys.push(keyLabel(b.key));
  }
  for (const n of keys.notes ?? []) {
    if (!n.label) continue;
    rowFor(n.group ?? '', n.label).keys.push(n.keys);
  }
  return [...groups].map(([heading, rows]) => ({
    heading,
    rows: [...rows.values()].map(r => ({ keys: r.keys.join(' / '), label: r.label })),
  }));
}

// Public API — attached to the global so browser and node see the same object
// (see the header).
const KEYS = {
  resolve, direction, keyLabel, helpGroups,
  _internal: { matchBinding, keyMatches, NUMERIC_DIRECTIONS, ARROW_DIRECTIONS },
};
(typeof window !== 'undefined' ? window : globalThis).KEYS = KEYS;
