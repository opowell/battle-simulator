// gridStatics.js — send a board's static parts once, not in every snapshot.
//
// A shape map's terrain (`grid.shapes`: Combat Mission's dressed bocage is ~1,700
// shapes, ~160 KB) is part of every snapshot a client is sent, yet it does not change
// during a game. So the wire carries such fields by CONTENT KEY: every snapshot names
// the key of each one in `grid.statics` ({ shapes: '<key>' }), and leaves the value
// itself out whenever the receiver already holds that key. The client puts it back
// (apps/console/play/api.js), so nothing downstream ever sees a board without its
// shapes.
//
// Content-addressed rather than "sent once, assumed thereafter", so it stays right
// for a field that DOES change — a mid-game rebuild's new map, CS's smoke in `los` —
// at the price of sending that field again whenever it differs.
//
// Which fields: `shapes` and `los` always (content-keyed — they are static on every
// shape map, and change only with a rebuild or a smoke cloud). Any OTHER field is
// carried by key once a game hands back the very same object for it a second time:
// a game that caches part of its board per map (Combat Mission's terrain-only cells)
// is saying that part is static, and it costs nothing to notice — a field rebuilt for
// every snapshot (civ1's cells) is never serialised or hashed here at all.
//
// Who holds what:
//   - a WebSocket connection (`socketHolder`): the keys the client said it holds when
//     it connected (`?have=k1,k2` — the console re-opens its socket at every turn, so
//     this is what keeps a new socket from re-sending the map), plus the last key of
//     each field the server has sent on it since. The client keeps the same record per
//     subscription, updated on the same messages, so the two cannot disagree; a client
//     that is ever missing one asks for a resync, which forgets the record and sends
//     everything again.
//   - a REST request: the client names the keys it holds in an `X-Grid-Have` header
//     (it keeps a few), and the response leaves those out.
// A caller that sends neither (scripts, tests, other tools) always gets whole boards.

import { createHash } from 'node:crypto';

// The grid fields carried by key. Generic: any game whose board has terrain shapes
// (cs, doom, combatmission, sc1/sc2, …) or exact LOS geometry (`los`) benefits.
export const STATIC_GRID_KEYS = ['shapes', 'los'];

// Key of a value, memoised on the value's identity: a game that builds its art once
// per board (CombatMissionGame's boardArt) hands back the same array every snapshot,
// so it is serialised and hashed once, not on every send. A board part is never
// edited in place once built (engine states are replaced, not mutated; the client's
// own caches — the minimap's — already key on identity), which is what makes
// remembering by identity safe.
const keyCache = new WeakMap();
export function staticKey(value) {
  if (value !== null && typeof value === 'object') {
    const hit = keyCache.get(value);
    if (hit) return hit;
  }
  const key = createHash('sha1').update(JSON.stringify(value)).digest('base64url').slice(0, 16);
  if (value !== null && typeof value === 'object') keyCache.set(value, key);
  return key;
}

// Is this grid field carried by key? (See "Which fields" above.)
const seenOnce = new WeakSet();
function isStatic(field, value) {
  if (value == null) return false;
  if (STATIC_GRID_KEYS.includes(field)) return true;
  if (typeof value !== 'object' || field === 'statics') return false;
  if (keyCache.has(value)) return true;
  if (seenOnce.has(value)) return true;
  seenOnce.add(value);
  return false;
}

/**
 * The grid to put on the wire: a copy naming each static field's key in `statics`,
 * without the fields the receiver already holds — `has(field, key)` says which.
 * `sent(field, key)`, if given, is told of each field this grid DOES carry (the
 * receiver holds it from then on). The input grid is never modified (a game may
 * hand back a cached object).
 */
export function stripStatics(grid, has, sent = null) {
  if (!grid || typeof grid !== 'object') return grid;
  let out = null;
  for (const [field, value] of Object.entries(grid)) {
    if (!isStatic(field, value)) continue;
    out ??= { ...grid, statics: {} };
    const key = staticKey(value);
    out.statics[field] = key;
    if (has(field, key)) delete out[field];
    else sent?.(field, key);
  }
  return out ?? grid;
}

/**
 * What one WebSocket connection holds: the keys it named on connecting, and the last
 * key of each field sent on it since. `forget()` is a resync: send everything again.
 */
export function socketHolder(haveParam) {
  let named = new Set(String(haveParam ?? '').split(',').map(s => s.trim()).filter(Boolean));
  let last = {};
  return {
    has: (field, key) => last[field] === key || named.has(key),
    sent: (field, key) => { last[field] = key; },
    forget: () => { named = new Set(); last = {}; },
  };
}

/** Keys named in an `X-Grid-Have` request header, as a lookup for stripStatics. */
export function haveFromHeader(header) {
  const keys = new Set(String(header ?? '').split(',').map(s => s.trim()).filter(Boolean));
  return (_field, key) => keys.has(key);
}

/**
 * A response body with its boards stripped for a REST caller holding `have`
 * (see haveFromHeader). Boards ride at `body.grid` (a session snapshot, a fork move,
 * a past position), `body.session.grid` (a reconfigure's answer) and the whole
 * boards a history page opens with (`body.frames[i].full`) — the same places the
 * client fills back in.
 */
export function stripBodyStatics(body, have) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  let out = body;
  if (body.grid) out = { ...out, grid: stripStatics(body.grid, have) };
  if (body.session?.grid) out = { ...out, session: { ...body.session, grid: stripStatics(body.session.grid, have) } };
  if (Array.isArray(body.frames) && body.frames.some(f => f?.full)) {
    out = { ...out, frames: body.frames.map(f => (f?.full ? { ...f, full: stripStatics(f.full, have) } : f)) };
  }
  return out;
}
