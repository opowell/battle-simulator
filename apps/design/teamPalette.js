// teamPalette.js — the colour of seat i, for any i.
//
// Seat colours are GENERATED, not listed, so a table of any size gets distinct
// players: a hard-coded list only ever covers as many seats as someone thought
// to type out, and the seat past the end falls back to a grey that makes two
// rivals look like one.
//
// The hue walks by the golden angle (137.508°) from a base hue. That angle is
// the standard trick for "spread out an unknown number of samples on a circle":
// every prefix of the sequence is near-evenly spaced, so 3 seats are as well
// separated as 3 can be and 9 seats are as well separated as 9 can be — and
// adding a seat never re-colours the seats before it (seat i depends only on i).
//
// Hues crowd once the walk has been round the circle a few times (by the 9th
// seat the closest pair is ~20° apart), so every BAND_SIZE seats it also steps
// into a different saturation/lightness band: seat 8 sits near seat 0's blue but
// is visibly paler, seat 16 visibly darker. Three bands then a repeat, i.e. ~24
// clearly distinct seats — far past any game here, and past that it degrades
// gently rather than colliding at seat 7.
//
// Seats 0 and 1 are the exception: they take the theme's own two team colours
// (--teamA / --teamB, repainted by the theme picker in App.vue), because those
// two seats are what nearly every game shows and the themes exist to colour them.
// The generated sequence still starts at seat 0's blue, so the generated seats
// read as a continuation of the themed pair rather than a separate palette.

const GOLDEN_ANGLE = 137.508;
const BASE_HUE     = 210;   // the blue of seat 0
const THEMED_SEATS = 2;     // seats using --teamA / --teamB
const BAND_SIZE    = 8;     // seats per band before shifting saturation/lightness
const BANDS        = [{ s: 70, l: 62 }, { s: 58, l: 76 }, { s: 78, l: 46 }];

function hslToHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// The generated colour of seat i — defined for every seat, including the two
// themed ones (it is what they fall back to when the CSS variable can't be read).
function generatedColor(i) {
  const band = BANDS[Math.floor(i / BAND_SIZE) % BANDS.length];
  return hslToHex((BASE_HUE + i * GOLDEN_ANGLE) % 360, band.s, band.l);
}

function themeVar(i) { return `var(--team${'AB'[i]})`; }

function readThemeVar(i) {
  if (typeof getComputedStyle !== 'function') return null;
  return getComputedStyle(document.documentElement).getPropertyValue(`--team${'AB'[i]}`).trim() || null;
}

// The CSS colour for seat i: a variable for the themed seats (so the theme
// picker repaints them live), a generated colour for the rest.
function seatColor(i) {
  return i < THEMED_SEATS ? themeVar(i) : generatedColor(i);
}

// The same colour as a concrete value, for the places that can't use a CSS
// variable — sprite tinting, canvas fills (see teamSprite.js).
function seatColorRaw(i) {
  return (i < THEMED_SEATS ? readThemeVar(i) : null) ?? generatedColor(i);
}

// Seat i's colours for a specific game. A game may bring its own player palette
// (ui.teamColors, a list of raw colours) when the generic one would misread —
// e.g. civ1 keeps red for the barbarians. Seats past the end of a game's own
// list fall back to the generated sequence, so its length is never a ceiling.
function seatColorFor(game, i) {
  const own = game?.ui?.teamColors;
  const c = Array.isArray(own) ? own[i] : null;
  return c ? { color: c, raw: c } : { color: seatColor(i), raw: seatColorRaw(i) };
}

// The first n seat colours as CSS colours (form swatches, colour cycling).
function seatColors(game, n) {
  return Array.from({ length: n }, (_, i) => seatColorFor(game, i).color);
}

window.teamPalette = { seatColor, seatColorRaw, seatColorFor, seatColors, generatedColor };
