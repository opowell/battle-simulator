// display.js — how a game is shown, as a few named options and presets of them.
//
// A game's `ui` flags (GET /games) say how its screen looks; a scenario may say
// otherwise (a BattleGame spec's `display`, which toGrid hands over as
// `grid.display`), and a session may say otherwise again (its `display` option,
// which the setup form and the in-game settings both edit). Each of the last two
// is { preset, …options }: a preset's options first, then any named on their own.
//
// Nothing here knows a game: a preset is a kind of screen, not a game's screen.

/** The options a player can switch, one by one, and the ui flags each one sets. */
export const DISPLAY_OPTIONS = [
  { id: 'showHpBars', label: 'Hit point bars', description: 'A bar of hit points under every unit' },
  { id: 'unitHighlight', label: 'Unit highlighting', description: 'Plates in team colours under the units, and a ring round the one in hand. Off, a unit is drawn as it is and the square it stands on is tinted instead' },
  { id: 'showRoster', label: 'Roster panel', description: 'Every unit of each side, listed beside the board' },
  { id: 'showActionsPanel', label: 'Actions panel', description: 'The list of orders beside the board. Off, units are moved on the board itself' },
  { id: 'highlightLastMove', label: 'Last move', description: 'Tint the squares the last move was made between' },
  { id: 'hideGridLines', label: 'No grid lines', description: 'Leave out the lines between squares (a board that is chequered already needs none)' },
  { id: 'dragToMove', label: 'Drag to move', description: 'Move a unit by dragging it to its square, as well as by clicking' },
];

// What each option's switch means in ui flags. Most are one flag; unit
// highlighting is three: the plates, the ring round the unit in hand (which free
// selection leaves off), and the tinted square that marks the selection instead.
const FLAGS = {
  unitHighlight: (on) => ({ unitPlates: on, freeSelection: !on, highlightSelectedSquare: !on }),
};

/**
 * Kinds of screen. Each sets every option, so switching between them is a clean
 * switch; `rules` are game options a preset also sets where a game has them.
 */
export const DISPLAY_PRESETS = {
  board: {
    label: 'Board game',
    description: 'Pieces on a board: no hit points or plates, no roster or actions panel; one piece a turn, moved on the board',
    options: { showHpBars: false, unitHighlight: false, showRoster: false, showActionsPanel: false, highlightLastMove: true, hideGridLines: true, dragToMove: true },
    flags: { moveAnimation: 'none', clearSelectedAtEndOfTurn: true, gridLabelsBottom: true },
    rules: { unitsPerTurn: '1' },
  },
  tactics: {
    label: 'Tactics',
    description: 'Units with hit points, highlighted in their colours, with the roster and the actions panel; every unit moves each turn',
    options: { showHpBars: true, unitHighlight: true, showRoster: true, showActionsPanel: true, highlightLastMove: false, hideGridLines: false, dragToMove: false },
    flags: {},
    rules: { unitsPerTurn: '0' },
  },
};

/** The ui flags one { preset, …options } (or a preset's name alone) stands for (empty for none). */
export function displayFlags(d) {
  if (typeof d === 'string' && DISPLAY_PRESETS[d]) d = { preset: d };
  if (!d || typeof d !== 'object') return {};
  const p = DISPLAY_PRESETS[d.preset];
  const options = { ...(p?.options ?? {}), ...Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'preset')) };
  const out = { ...(p?.flags ?? {}) };
  for (const [k, v] of Object.entries(options)) Object.assign(out, FLAGS[k] ? FLAGS[k](!!v) : { [k]: v });
  return out;
}

/** A game's ui flags with a scenario's display, then a session's, laid over them. */
export function resolveDisplay(ui, scenario, session) {
  return { ...(ui ?? {}), ...displayFlags(scenario), ...displayFlags(session) };
}

/** What each option reads as under these ui flags (for showing it switched on or off). */
export function optionValues(ui) {
  const u = ui ?? {};
  return {
    showHpBars: u.showHpBars !== false,
    unitHighlight: u.unitPlates !== false && !u.highlightSelectedSquare,
    showRoster: u.showRoster !== false,
    showActionsPanel: u.showActionsPanel !== false,
    highlightLastMove: !!u.highlightLastMove,
    hideGridLines: !!u.hideGridLines,
    dragToMove: !!u.dragToMove,
  };
}

/** A display value in words: "Board game", "Tactics, roster panel off", "hit point bars off". */
export function displayText(d) {
  if (typeof d === 'string') d = { preset: d };
  if (!d || typeof d !== 'object') return "the scenario's own";
  const parts = [];
  if (DISPLAY_PRESETS[d.preset]) parts.push(DISPLAY_PRESETS[d.preset].label);
  for (const o of DISPLAY_OPTIONS) if (o.id in d) parts.push(`${o.label.toLowerCase()} ${d[o.id] ? 'on' : 'off'}`);
  return parts.join(', ') || "the scenario's own";
}
