// Continuous-coordinate helpers for the "continuous" location games (doom, cs,
// combatmission — see each game's `locationType`). Their unit positions are real
// points on the board, not integer tile indices, so a unit moves to exactly where
// a player clicks. The authoritative server-side value is a bignumber.js BigNumber
// (see plans/discrete-vs-continuous-coordinates.md §2): a decimal string on the
// wire round-trips losslessly, and the server never drifts a stored coordinate.
//
// Precision policy: one global rounding/precision setting so distance (`.sqrt`) and
// any other non-terminating op are deterministic regardless of caller. 20 decimal
// places is vastly finer than the "≥1000× finer than a tile" target.
//
// The heavy geometry (terrainShapes.js pointInShape, continuousMove.js line
// sampling) stays plain float64 — those author-scale numbers never need BigNumber
// precision — so callers convert BigNumber → Number at that boundary via `num`.
// Tile-space code (BFS/Dijkstra occupancy, Bresenham LOS, fog belief possible-sets,
// tile-keyed rendering) keys off the integer tile a position sits in, via `tileNum`.

import BigNumber from 'bignumber.js';

BigNumber.set({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });

export { BigNumber };

// Coerce a number | decimal-string | BigNumber to a BigNumber coordinate.
export function C(v) { return BigNumber.isBigNumber(v) ? v : new BigNumber(v); }

// A {x, y} position with BigNumber components, from numbers/strings/BigNumbers.
export function makePos(x, y) { return { x: C(x), y: C(y) }; }

// Parse a wire position ({x, y} as decimal strings — or numbers, for AI-enumerated
// destinations) into an authoritative BigNumber position.
export function parsePos(p) { return { x: C(p.x), y: C(p.y) }; }

// Serialize a BigNumber position to the wire as decimal strings (JSON has no
// arbitrary-precision number type), lossless in both directions.
export function posToWire(p) { return { x: C(p.x).toString(), y: C(p.y).toString() }; }

// Plain-Number view of a single coordinate — use right before handing coordinates
// to float geometry. Tolerates BigNumber, number, or decimal string.
export function num(v) { return BigNumber.isBigNumber(v) ? v.toNumber() : Number(v); }

// Plain-Number {x, y} view of a position, for feeding float geometry.
export function numPos(p) { return { x: num(p.x), y: num(p.y) }; }

// Integer tile a coordinate/position falls in (floored). A continuous position
// resolves to its containing cell so tile-keyed / grid code keeps working.
export function tileNum(v) { return Math.floor(num(v)); }
export function tilePos(p) { return { x: tileNum(p.x), y: tileNum(p.y) }; }
