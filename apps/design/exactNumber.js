// exactNumber.js — prints a game quantity as the exact number it is: 2/3, not
// 0.6666666666666666; 1 1/3, not 1.3333333333333333.
//
// Loaded as a classic global <script> in index.html, like boardMoves.js (the SFC
// loader can't parse `import`/`export` in a plain .js), and published on `EXACT`:
//   • browser — window.EXACT, registered as a template global in index.html;
//   • node    — `await import('./exactNumber.js')` exposes globalThis.EXACT.
//
// Games keep their state exact themselves (civ1 counts moves in whole thirds, as the
// original did), but what reaches the UI is a plain JSON number, and a third has no
// exact binary form. So this reads a number back as the fraction it stands for: the
// one with the smallest denominator that the number is the nearest double to. Two
// fractions with small denominators are never that close together, so this recovers
// the game's value exactly and nothing else. A number that isn't such a fraction is
// printed in full rather than cut short.
(function (root) {
  'use strict';

  const MAX_DENOMINATOR = 64;

  /** `{ n, d }` with d in 1..MAX_DENOMINATOR and n/d === v as doubles, or null. */
  function asFraction(v) {
    if (!Number.isFinite(v)) return null;
    for (let d = 1; d <= MAX_DENOMINATOR; d++) {
      const n = Math.round(v * d);
      if (n / d === v) return { n, d };
    }
    return null;
  }

  /** "2", "2/3", "1 1/3", "-1/3"; anything that is not a small fraction prints as is. */
  function fmt(v) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return String(v);
    const f = asFraction(v);
    if (!f) return String(v);
    if (f.d === 1) return String(f.n);
    const sign = f.n < 0 ? '-' : '';
    const whole = Math.floor(Math.abs(f.n) / f.d);
    const part = `${Math.abs(f.n) % f.d}/${f.d}`;
    return sign + (whole ? `${whole} ${part}` : part);
  }

  root.EXACT = { fmt, asFraction };
})(typeof window !== 'undefined' ? window : globalThis);
