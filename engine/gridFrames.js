/**
 * gridFrames.js — storing a board's timeline as differences instead of as a stack of
 * whole boards.
 *
 * The scrub bar wants every position a game passed through, which used to mean
 * keeping a complete `toGrid` snapshot per step: ~460 KB each on a civ1 map, ~275 MB
 * for a session's worth, held until the session was explicitly deleted. A turn moves
 * around 14 of 1500 cells, so almost all of that was the same board copied again.
 *
 * A FRAME is either a whole grid (`{ full }`) or a difference from the frame before
 * it: `patch` is [cellIndex, cell] pairs, `rest` carries any non-cell grid field that
 * changed, and `removed` names fields that went away. `rest` is what keeps this
 * correct for games this file knows nothing about — continuous-location boards (cs,
 * doom) move their units in `grid.units` rather than between cells, and a game may
 * stamp anything it likes onto its grid.
 *
 * No game knowledge and no engine dependency: a grid here is just an object that may
 * have a `cells` array. api-server.js stores frames with this; apps/design/api.js
 * mirrors applyGridFrame to rebuild them in the browser.
 */

/** A diff that rewrites more than this fraction of the board is not worth taking. */
const REWRITE_FRACTION = 0.5;

/**
 * The running state `encodeGridFrame` diffs against: the last whole grid, plus its
 * per-cell serialisation so comparing is a string check rather than a deep walk.
 */
export function gridCursor(grid) {
  return {
    grid,
    cellJson: Array.isArray(grid?.cells) ? grid.cells.map(c => JSON.stringify(c)) : null,
  };
}

/**
 * Encode `grid` as its difference from `prev` (a cursor from a previous call, or null
 * for the first frame). Returns `{ frame, cursor }` — pass `cursor` back in next time.
 *
 * Falls back to a whole-grid frame for the first grid, for a board that changed
 * shape, and for one that changed more than half its cells, where a diff would be
 * the bigger of the two.
 */
export function encodeGridFrame(prev, grid) {
  const cells = Array.isArray(grid?.cells) ? grid.cells : null;
  if (!prev || !cells || !prev.cellJson || prev.cellJson.length !== cells.length) {
    return { frame: { full: grid }, cursor: gridCursor(grid) };
  }

  const cellJson = cells.map(c => JSON.stringify(c));
  const patch = [];
  for (let i = 0; i < cellJson.length; i++) {
    if (cellJson[i] !== prev.cellJson[i]) patch.push([i, cells[i]]);
  }
  if (patch.length > cellJson.length * REWRITE_FRACTION) {
    return { frame: { full: grid }, cursor: { grid, cellJson } };
  }

  const rest = {};
  for (const k of Object.keys(grid)) {
    if (k === 'cells') continue;
    if (JSON.stringify(grid[k]) !== JSON.stringify(prev.grid[k])) rest[k] = grid[k];
  }
  const removed = Object.keys(prev.grid).filter(k => k !== 'cells' && !(k in grid));

  const frame = { patch };
  if (Object.keys(rest).length) frame.rest = rest;
  if (removed.length) frame.removed = removed;
  return { frame, cursor: { grid, cellJson } };
}

/**
 * Rebuild the grid a frame describes, given the one before it. Always a NEW object:
 * the timeline is handed out frame by frame, and a consumer holding two aliases of
 * one grid would show the same position at both points.
 */
export function applyGridFrame(prev, frame) {
  if (!frame) return prev;
  if (frame.full) return frame.full;
  const cells = (prev?.cells ?? []).slice();
  for (const [i, cell] of frame.patch ?? []) cells[i] = cell;
  const next = { ...(prev ?? {}), ...(frame.rest ?? {}), cells };
  for (const k of frame.removed ?? []) delete next[k];
  return next;
}

/**
 * Fold two consecutive frames into one describing the whole span — what thinning a
 * timeline needs, since dropping a frame must not drop the changes it carried.
 */
export function mergeGridFrames(a, b) {
  // Anything following a whole-grid frame collapses onto that grid.
  if (b.full) return b;
  if (a.full) return { full: applyGridFrame(a.full, b) };

  const cells = new Map();
  for (const [i, c] of a.patch ?? []) cells.set(i, c);
  for (const [i, c] of b.patch ?? []) cells.set(i, c);   // the later value wins
  const merged = { patch: [...cells].sort((x, y) => x[0] - y[0]) };

  const rest = { ...(a.rest ?? {}), ...(b.rest ?? {}) };
  // A field `b` sets is no longer removed; one `b` removes is no longer set.
  const removed = [...new Set([
    ...(a.removed ?? []).filter(k => !(k in (b.rest ?? {}))),
    ...(b.removed ?? []),
  ])];
  for (const k of removed) delete rest[k];

  if (Object.keys(rest).length) merged.rest = rest;
  if (removed.length) merged.removed = removed;
  return merged;
}

/**
 * The board timeline behind a scrub bar: every position a game passed through, held
 * as diffs and bounded however long the game runs.
 *
 * Frames are sampled at `stride` (1 to begin with, i.e. every position). On reaching
 * `max` the timeline is thinned to every other frame — the dropped frames' changes
 * folded into their successors — and the stride doubles, so a long game keeps frames
 * spread across its whole length instead of losing either end.
 *
 * The three moving parts (the frames, the cursor the next diff is taken against, and
 * the stride) have to agree, which is why they live behind one object: thinning drops
 * the frame just pushed, so a cursor left pointing at it would have every later frame
 * decoding onto a board no reader ever reaches — a few stale cells, silently, for the
 * rest of the game.
 */
export class GridTimeline {
  constructor({ max = 600 } = {}) {
    this.max = max;
    this.reset();
    this.revision = 0;   // survives reset()'s bump so it only ever climbs
  }

  get length() { return this.frames.length; }

  /** Forget everything — for a take-back, which rewrites the positions themselves. */
  reset() {
    this.frames = [];
    this.cursor = null;
    this.stride = 1;
    this.count = 0;
    this.revision = (this.revision ?? 0) + 1;
  }

  /** Record a position, if this one falls on the sampling stride. */
  push(grid) {
    if (!grid) return;
    this.count++;
    if ((this.count - 1) % this.stride !== 0) return;
    const { frame, cursor } = encodeGridFrame(this.cursor, grid);
    this.cursor = cursor;
    this.frames.push(frame);
    if (this.frames.length >= this.max) this._thin();
  }

  _thin() {
    // Keep positions 0, 2, 4 … — the frame just pushed goes, and each dropped
    // frame's changes are folded into the one that follows it.
    const kept = [this.frames[0]];
    for (let i = 2; i < this.frames.length; i += 2) {
      kept.push(mergeGridFrames(this.frames[i - 1], this.frames[i]));
    }
    this.frames = kept;
    this.stride *= 2;
    this.revision++;
    // Re-anchor the cursor on the newest SURVIVING position (see the class comment).
    this.cursor = gridCursor(this.frames.reduce((g, f) => applyGridFrame(g, f), null));
  }

  /**
   * One page, self-contained: `frames[0]` is a whole grid and the rest are diffs
   * against the frame before them IN THIS PAGE, so a reader can rebuild any page
   * without having fetched the ones before it. `revision` changes whenever thinning
   * (or a reset) re-indexes the timeline, which is how a paging reader knows its page
   * boundaries have moved and it should start again.
   */
  read(from = 0, limit = 200) {
    const total = this.frames.length;
    const start = Math.max(0, Math.min(Number(from) || 0, total));
    const end = Math.min(total, start + Math.max(1, Number(limit) || 200));
    const frames = [];
    // Walk up to `start` only to learn the board this page opens on; the frames
    // walked through are not kept.
    let cur = null;
    for (let i = 0; i < end; i++) {
      cur = applyGridFrame(cur, this.frames[i]);
      if (i >= start) frames.push(i === start ? { full: cur } : this.frames[i]);
    }
    return { from: start, total, revision: this.revision, frames };
  }
}
