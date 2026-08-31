// ---------------------------------------------------------------------------
// Chess in the other three quadrants of the (space × time) plane.
//
// Ordinary chess sits in one corner of games/spacetime.js's table: discrete
// space (pieces stand on squares), discrete time (a turn is one move), played
// sequentially. This module is the other three corners — the rules that take
// over once you stop assuming a move is instantaneous, or that a piece is only
// ever *on* a square.
//
//                        DISCRETE TIME                   CONTINUOUS TIME
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ DISCRETE   standard chess (and fog chess):   a piece is ordered to a  │
//   │ SPACE      ChessGame.js proper. Not this     destination and HOPS     │
//   │            file.                             square by square toward  │
//   │                                              it, one hop per cooldown.│
//   ├──────────────────────────────────────────────────────────────────────┤
//   │ CONTINUOUS pieces SLIDE, one order per       pieces slide, everyone   │
//   │ SPACE      turn, resolved to a standstill    at once, on one clock.   │
//   │            before the turn passes.                                    │
//   └──────────────────────────────────────────────────────────────────────┘
//
// What every non-standard quadrant has in common, and why they share a file:
//
//   • A move is a JOURNEY, not a relocation. It has a path (a list of squares),
//     a speed (games/spacetime.js's one spec number — see PIECE_SPEED), and a
//     duration. The board can change under a piece while it travels.
//   • Because the board changes mid-move, a destination cannot be filtered by
//     what stands on it when the order is given. Destinations are therefore
//     GEOMETRIC — every square the piece's move shape reaches on an empty board
//     — and blockers are resolved on arrival, hop by hop or contact by contact.
//   • A knight no longer teleports over the pieces between it and its target.
//     Its L is walked as three orthogonal steps, and WHICH of the three orders
//     it walks them in is part of the order (`pathId`): the routes differ in
//     what they run into. This is the single biggest change to how chess plays
//     here, and it is the user-visible reason "choose a destination" is not
//     enough information to describe a knight move any more.
//   • Check, checkmate, stalemate and castling all presuppose that a move is
//     atomic and that the opponent must answer it. None of that survives a
//     clock, so these quadrants are won by DESTROYING THE KING, exactly as fog
//     chess is (see ChessGame.getResult).
//
// The two continuous-SPACE quadrants add bodies: a piece is a disk of radius
// HITBOX_R centred on its square, it has hit points, and enemy disks that
// overlap grind each other down at a rate set by the attacker's power until one
// of them dies or they come apart. Contact times are solved in closed form
// (`contactWindow`) rather than sampled, so a fast piece cannot tunnel through a
// slow one, and the same interval maths gives the exact instant a piece dies
// mid-slide.
//
// Everything here is driven from ChessGame.js, which decides per session which
// quadrant is in force (games/spacetime.js `resolveSpaceTime`) and delegates
// createInitialState / getLegalActions / applyActions / getResult / renderState
// / toGrid here when it isn't the standard one.
// ---------------------------------------------------------------------------

import { resolveSpaceTime } from '../spacetime.js';

// ── The spec numbers ─────────────────────────────────────────────────────────

/**
 * THE one movement spec number, per games/spacetime.js: squares covered in one
 * turn window. Continuous time reads it as a rate (a hop of length d is followed
 * by d/speed of cooldown; a slide of length d takes d/speed); continuous space
 * reads it as how fast the disk travels. Deliberately the same table
 * ChessGame.getActionDuration already used for the engine's continuous mode —
 * one fact about a piece, not two.
 */
export const PIECE_SPEED = { queen: 5, rook: 4, bishop: 4, knight: 3, king: 2, pawn: 1 };

/** Classic material values. Drives hit points, damage output and the heuristic. */
export const PIECE_POWER = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 4 };

/** Hit points per point of power, so a pawn has 10 and a queen 90. */
export const HP_PER_POWER = 10;

/**
 * Damage per time unit, per point of the ATTACKER's power. Contact is mutual but
 * not symmetric: both pieces are in it for the same time, and each deals damage
 * by its own power, so the exchange preserves the material ordering chess is
 * built on. A pawn that walks into a queen dies in 10/(9·10) ≈ 0.11 time units
 * having taken about 1 point off her; a queen sweeping a file kills every pawn
 * she passes through and is barely scratched.
 */
export const DAMAGE_PER_POWER = 10;

/**
 * Disk radius, in squares, for continuous space. Under 0.5 on purpose: two
 * pieces on adjacent squares (centres 1 apart) must NOT start the game already
 * overlapping, or every opening order would cancel itself on its own neighbour.
 */
export const HITBOX_R = 0.4;

/** Length of one turn window in clock units. */
export const TURN_DURATION = 1;

/** Clock advance when a real-time position is completely idle (see `advanceClock`). */
const IDLE_TICK = TURN_DURATION;

/** Consecutive idle advances tolerated before the game is called a draw. */
const MAX_IDLE_TICKS = 40;

/**
 * How many orders a piece may have lined up at once — the one it is carrying out
 * plus what is queued behind it.
 *
 * A cap, rather than no cap, is what keeps the clock able to move at all. Giving
 * an order costs no clock, so the only thing stopping a player (or an agent)
 * queueing for ever at a single instant is that each order strictly fills the
 * queue and the queue is finite. The matching half of that rule is `rt.locked`:
 * TAKING an order back is the one queue edit that doesn't shrink the space of
 * further edits, so it locks the piece for the rest of the instant.
 */
export const MAX_ORDERS = 4;

/**
 * Delays a piece can be told to hold for, in turn windows. A delay is how you say
 * "go, but not yet" — the thing continuous time makes possible and discrete time
 * cannot express, since there a turn is the smallest unit of waiting there is.
 */
export const DELAYS = [0.5, 1, 2];

const EPS = 1e-9;
const FILES = 'abcdefgh';

// ── Squares, grid coordinates and continuous points ──────────────────────────
//
// Internal coordinates ARE the UI's grid coordinates (x = file index 0..7, y =
// 8 − rank, so y = 0 is the eighth rank at the top of the screen). That is what
// toGrid/gridFrom/gridTo already speak, so the browser needs no conversion, and
// it means "white advances" is y − 1 in every function below.
//
// A continuous position is the CENTRE of a square: (x + 0.5, y + 0.5), matching
// how SchematicLayer places a token on a cell.

/** Algebraic square for grid cell (x, y). */
export const sqOf = (x, y) => FILES[x] + (8 - y);
/** Grid cell {x, y} for an algebraic square. */
export const gridOf = (sq) => ({ x: FILES.indexOf(sq[0]), y: 8 - parseInt(sq[1], 10) });
/** Continuous point at the centre of grid cell (x, y). */
export const centreOf = (c) => ({ x: c.x + 0.5, y: c.y + 0.5 });
/** Grid cell containing a continuous point. */
export const cellOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

const inBounds = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const speedOf = (u) => PIECE_SPEED[u.type] ?? 1;
const powerOf = (u) => PIECE_POWER[u.type] ?? 1;
const maxHpOf = (type) => (PIECE_POWER[type] ?? 1) * HP_PER_POWER;
const opponentOf = (id) => (id === 'white' ? 'black' : 'white');
/** Which way this colour's pawns advance, in grid rows. */
const pawnDir = (ownerId) => (ownerId === 'white' ? -1 : 1);

// ── Move geometry: destinations and the routes to them ───────────────────────

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL8 = [...ORTHO, ...DIAG];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

const RAY_DIRS = { rook: ORTHO, bishop: DIAG, queen: ALL8 };

/**
 * The three routes a knight can walk its L. The jump is spent as three
 * orthogonal single-square steps — two along the long axis, one along the short
 * — and the choice is WHERE in the sequence the short step falls. They are
 * genuinely different moves here: each passes over different squares, and in
 * these quadrants the squares a piece passes over are what it fights.
 */
function knightRoutes(from, dx, dy) {
  const long = Math.abs(dx) === 2 ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  const short = Math.abs(dx) === 2 ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 };
  const orders = [[short, long, long], [long, short, long], [long, long, short]];
  return orders.map((steps) => {
    const path = [];
    let cur = { ...from };
    for (const s of steps) { cur = { x: cur.x + s.x, y: cur.y + s.y }; path.push(cur); }
    return path;
  });
}

/**
 * Every destination `piece` could move to on an EMPTY board, each with the
 * route(s) that get it there.
 *
 * Occupancy is deliberately ignored. In these quadrants the order is given now
 * and executed later, over squares whose contents will have changed by the time
 * the piece arrives — so a slider may be aimed clean through a blocker (it takes
 * enemies on the way and is stopped by friends, see `resolveHop`), and a pawn
 * may be aimed at its capture diagonals whether or not anything is standing
 * there yet. The one thing still filtered is the edge of the board.
 *
 * @param {{type: string, ownerId: string}} piece
 * @param {{x: number, y: number}} from  grid cell the piece stands on
 * @returns {{to: {x,y}, path: {x,y}[], pathId: number}[]} one entry per (destination, route)
 */
export function geometricMoves(piece, from) {
  const out = [];
  const add = (path, pathId = 0) => out.push({ to: path[path.length - 1], path, pathId });

  if (piece.type === 'knight') {
    for (const [dx, dy] of KNIGHT) {
      const to = { x: from.x + dx, y: from.y + dy };
      if (!inBounds(to.x, to.y)) continue;
      // Every intermediate square must be on the board too — the knight walks now.
      knightRoutes(from, dx, dy).forEach((path, i) => {
        if (path.every((c) => inBounds(c.x, c.y))) add(path, i);
      });
    }
    return out;
  }

  if (piece.type === 'pawn') {
    const d = pawnDir(piece.ownerId);
    const startRow = piece.ownerId === 'white' ? 6 : 1;
    const one = { x: from.x, y: from.y + d };
    if (inBounds(one.x, one.y)) add([one]);
    if (from.y === startRow) {
      const two = { x: from.x, y: from.y + 2 * d };
      if (inBounds(two.x, two.y)) add([one, two]);
    }
    for (const dx of [-1, 1]) {
      const c = { x: from.x + dx, y: from.y + d };
      if (inBounds(c.x, c.y)) add([c]);
    }
    return out;
  }

  if (piece.type === 'king') {
    for (const [dx, dy] of ALL8) {
      const c = { x: from.x + dx, y: from.y + dy };
      if (inBounds(c.x, c.y)) add([c]);
    }
    return out;
  }

  for (const [dx, dy] of RAY_DIRS[piece.type] ?? []) {
    const path = [];
    for (let k = 1; k < 8; k++) {
      const c = { x: from.x + dx * k, y: from.y + dy * k };
      if (!inBounds(c.x, c.y)) break;
      path.push(c);
      add([...path]);
    }
  }
  return out;
}

/** Total path length in squares (diagonal steps count √2, as they must). */
export function pathLength(from, path) {
  let d = 0, cur = from;
  for (const c of path) { d += dist(cur, c); cur = c; }
  return d;
}

/** Is this pawn's destination its promotion rank? */
const promotesAt = (piece, cell) =>
  piece.type === 'pawn' && cell.y === (piece.ownerId === 'white' ? 0 : 7);

// ── Which quadrant are we in ─────────────────────────────────────────────────

/**
 * Resolve the session's quadrant and name the variant it selects. `standard` is
 * ChessGame.js's own code path; the other three are this module's.
 * @returns {{space, time, play, turnDuration, variant: 'standard'|'clockwork'|'melee'|'sliding'}}
 */
export function resolveVariant(game, config = {}) {
  const st = resolveSpaceTime(game, config);
  const variant =
    st.space === 'discrete' && st.time === 'discrete' ? 'standard'
      : st.space === 'discrete' ? 'clockwork'   // discrete space, continuous time
        : st.time === 'continuous' ? 'melee'    // continuous space + time
          : 'sliding';                          // continuous space, discrete time
  return { ...st, variant };
}

/** True when ChessGame should hand this state to this module. */
export const isSpacetimeVariant = (state) =>
  !!state?.gameSpecific?.rt && state.gameSpecific.rt.variant !== 'standard';

// ── Initial position ─────────────────────────────────────────────────────────

const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

function startingPieces(space) {
  const units = [];
  const place = (ownerId, type, x, y, n) => {
    const cell = { x, y };
    const id = `${ownerId === 'white' ? 'w' : 'b'}${{ king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' }[type]}${n}`;
    units.push({
      id, ownerId, type, alive: true,
      // Discrete space keeps the algebraic square as the position (what the rest
      // of ChessGame reads); continuous space keeps an exact point.
      cell,
      position: space === 'continuous' ? centreOf(cell) : sqOf(x, y),
      hp: maxHpOf(type), maxHp: maxHpOf(type),
    });
  };
  for (let x = 0; x < 8; x++) {
    place('black', BACK_RANK[x], x, 0, x + 1);
    place('black', 'pawn', x, 1, x + 1);
    place('white', 'pawn', x, 6, x + 1);
    place('white', BACK_RANK[x], x, 7, x + 1);
  }
  return units;
}

/** The board object (square → piece) ChessGame's renderer and fog expect. */
function boardFromUnits(units) {
  const board = {};
  for (const u of units) {
    if (!u.alive) continue;
    board[sqOf(u.cell.x, u.cell.y)] = { id: u.id, ownerId: u.ownerId, type: u.type, position: sqOf(u.cell.x, u.cell.y) };
  }
  return board;
}

/**
 * Initial state for one of the three non-standard quadrants.
 * @param {{id: string}[]} players  [white, black]
 */
export function createInitialState(players, config, st) {
  const units = startingPieces(st.space);
  const base = {
    gameName: 'Chess',
    turnNumber: 1,
    activePlayers: ['white'],
    currentPhase: 'action',
    players,
    units,
    lastActions: null,
    gameSpecific: {
      // Standard chess's own bookkeeping still has to be present and inert:
      // ChessGame's renderer, summary and fog all read gameSpecific, and the
      // Obscuro plumbing reads difficulty/aiTimeMs whichever quadrant is on.
      enPassantTarget: null,
      castlingRights: { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } },
      halfMoveClock: 0,
      inCheck: false,
      // Fog is a discrete-space, discrete-time feature (getVisibleSquares walks a
      // board of squares, and the belief trackers assume atomic alternating moves).
      // None of that holds once pieces are mid-journey, so these quadrants are
      // full-information; the scenarios that select them don't offer the switch.
      fogOfWar: false,
      debugAI: config.debugAI ?? false,
      aiTimeMs: typeof config.aiTimeMs === 'number' ? config.aiTimeMs : null,
      difficulty: typeof config.aiTimeMs === 'number' ? null : (config.difficulty ?? 25),
      markers: undefined,
      // Each side's queued future moves (games/planQueue.js). Only meaningful in
      // discrete time — see ChessGame's `planningIsTurnBased`.
      plan: { white: [], black: [] },
      rt: {
        variant: st.variant,
        space: st.space,
        time: st.time,
        turnDuration: st.turnDuration ?? TURN_DURATION,
        clock: 0,
        // unitId → the piece's order queue, oldest first. The HEAD is what it is
        // doing now; the rest is what it will do next, without being asked again.
        // An entry is either
        //   { kind: 'move',  path, idx, pathId }  a journey, `idx` steps in
        //   { kind: 'delay', duration }           hold here for that long
        // Empty queues are deleted rather than left as [], so "does this piece
        // have anything to do" is one property lookup everywhere below.
        queues: {},
        // unitId → clock time the piece may next act. Written by a hop's cooldown
        // and by a delay alike: to the rest of the machinery a delay simply IS a
        // cooldown the player asked for.
        ready: {},
        // Who has finished giving orders at the CURRENT instant (continuous time).
        passed: { white: false, black: false },
        // Pieces whose queue has been shortened at the current instant, and which
        // therefore get no further say until the clock moves. See MAX_ORDERS for
        // why one of the two queue edits has to be the one that locks.
        locked: [],
        idleTicks: 0,
        // Human-readable trace of what the last clock advance did, for renderState.
        events: [],
      },
    },
  };
  if (st.space === 'discrete') base.board = boardFromUnits(units);
  return base;
}

// ── Legal actions ────────────────────────────────────────────────────────────

const liveUnits = (state) => state.units.filter((u) => u.alive);
const unitCell = (u) => (u.cell ? u.cell : gridOf(u.position));

/** Annotate an order with the coordinates the browser's click-to-move reads. */
function withGrid(action, from, to) {
  return { ...action, gridFrom: [from.x, from.y], gridTo: [to.x, to.y] };
}

/** The queue a piece is working through (empty array if it has nothing to do). */
export const queueOf = (rt, id) => rt.queues[id] ?? [];

/**
 * Where a piece will be standing once it has worked through its whole queue —
 * which is where the NEXT order it is given has to start from. With an empty
 * queue that is simply where it stands now.
 */
export function tailCell(rt, unit) {
  const q = queueOf(rt, unit.id);
  for (let i = q.length - 1; i >= 0; i--) {
    if (q[i].kind === 'move') return { ...q[i].path[q[i].path.length - 1] };
  }
  return { ...unitCell(unit) };
}

/**
 * Orders available to `playerId`.
 *
 * Continuous time (`clockwork`, `melee`) is real-time play squeezed through a
 * turn-based interface: giving an order costs no clock, so a player issues as
 * many as they like and then plays `wait`, which hands the instant to the
 * opponent and — once both have waited — lets the clock run to the next thing
 * that actually happens. Discrete time (`sliding`) is ordinary alternating play:
 * one order, resolved, turn over.
 *
 * A piece is never limited to the order it is carrying out. It has a QUEUE, and
 * an order given to a busy piece joins the back of it — enumerated from where the
 * queue leaves the piece standing (`tailCell`), not from where it is now, so a
 * plan chains: knight to f3, then f3 to g5, then hold half a turn, all committed
 * at one instant. `delay` is a first-class entry in that queue rather than an
 * afterthought: continuous time is the only quadrant in which "not yet" is a
 * thing a player can say at all.
 */
export function getLegalActions(state, playerId) {
  const { rt } = state.gameSpecific;
  const actions = [];
  const alive = liveUnits(state);
  const mine = alive.filter((u) => u.ownerId === playerId);
  // Squares this side is standing on right now (see the route filter below). A
  // piece's own square is in here too, harmlessly: a route's first step is always
  // a square away from where the piece stands.
  const friends = new Set(mine.map((f) => { const c = unitCell(f); return `${c.x},${c.y}`; }));
  const continuous = rt.time === 'continuous';

  for (const u of mine) {
    const queue = continuous ? queueOf(rt, u.id) : [];
    const queued = queue.length > 0;

    if (continuous) {
      // A piece whose queue has already been shortened this instant is done
      // being fiddled with until the clock moves (see MAX_ORDERS).
      if (rt.locked.includes(u.id)) continue;
      if (queued) {
        actions.push({
          type: 'cancel', unitId: u.id, gridFrom: [unitCell(u).x, unitCell(u).y],
          label: `Call off ${u.id}`,
        });
        if (queue.length > 1)
          actions.push({ type: 'queue-pop', unitId: u.id, label: `Drop ${u.id}'s last queued order` });
      }
      if (queue.length >= MAX_ORDERS) continue;
      for (const d of DELAYS) {
        actions.push({
          type: queued ? 'queue-delay' : 'delay', unitId: u.id, duration: d,
          label: `${queued ? 'Then hold' : 'Hold'} ${d} turn${d === 1 ? '' : 's'}`,
        });
      }
    }

    // Where this order starts: where the piece stands, or — for one joining a
    // queue — where the queue will have left it.
    const from = continuous ? tailCell(rt, u) : unitCell(u);
    for (const m of geometricMoves(u, from)) {
      // A route whose very first square is one of our own is not an order, it is
      // a bounce: the piece would set off and be stopped where it stands. Leaving
      // those in costs a hop's cooldown for nothing, and — since giving an order
      // is free — lets an agent re-aim the same piece at the same wall of its own
      // pawns every instant, which is how the opening position stops the clock
      // dead. Blockers FURTHER along the route stay in, because by the time the
      // piece gets there they may well have moved. A QUEUED order is not filtered
      // this way at all: it starts from a square the piece has yet to reach, in a
      // position nobody can predict, so there is no "right now" to test against.
      const first = m.path[0];
      if (!queued && friends.has(`${first.x},${first.y}`)) continue;
      const via = m.path.length > 1 && u.type === 'knight'
        ? ` via ${m.path.slice(0, -1).map((c) => sqOf(c.x, c.y)).join('-')}` : '';
      const label = `${queued ? 'Then ' : ''}${sqOf(from.x, from.y)} → ${sqOf(m.to.x, m.to.y)}${via}`;
      actions.push(withGrid({
        type: continuous ? (queued ? 'queue-order' : 'order') : 'move',
        unitId: u.id,
        from: sqOf(from.x, from.y),
        to: sqOf(m.to.x, m.to.y),
        path: m.path,
        pathId: m.pathId,
        label,
      }, from, m.to));
    }
  }

  // `__player__` is the client's marker for an order that belongs to the side
  // rather than to a piece, so the panel offers it whatever is selected (see
  // Battlefield.vue's displayedActions under ui.freeSelection).
  if (continuous)
    actions.push({ type: 'wait', unitId: '__player__', label: 'Wait — let the clock run' });
  return actions;
}

/**
 * The subset of the above a search agent should reason over: everything except
 * the PLANNING affordances. Queueing behind a busy piece is a convenience for a
 * player who wants to commit now and stop watching — it can always be replaced by
 * giving the same order later, so to a one-ply agent it is a move that changes
 * nothing it can see, which is exactly the shape of thing that makes an agent
 * loop instead of playing (see games/sc1's skip-unit). Taking an order back is
 * dropped for the same reason. What stays is every order that actually does
 * something now: `order`, `delay`, `cancel`, `move`, `wait`.
 */
const PLANNING_ACTIONS = new Set(['queue-order', 'queue-delay', 'queue-pop', 'queue-move']);
export const isPlanningAction = (a) => PLANNING_ACTIONS.has(a.type);
export function getSearchActions(state, playerId) {
  return getLegalActions(state, playerId).filter((a) => !isPlanningAction(a));
}

// ── Applying an action ───────────────────────────────────────────────────────

export function applyActions(state, playerActions) {
  const { playerId, action } = playerActions[0];
  switch (action.type) {
    case 'order':
    case 'queue-order':
      return pushOrder(state, playerId, action, { kind: 'move', path: action.path, idx: 0, pathId: action.pathId ?? 0 });
    case 'delay':
    case 'queue-delay':
      return pushOrder(state, playerId, action, { kind: 'delay', duration: action.duration });
    case 'cancel':    return editQueue(state, playerId, action, () => []);
    case 'queue-pop': return editQueue(state, playerId, action, (q) => q.slice(0, -1));
    case 'wait':      return waitOut(state, playerId, action);
    case 'move':      return resolveSingleMove(state, playerId, action);
    default:          return state;
  }
}

const withRt = (state, patch, extra = {}) => ({
  ...state,
  ...extra,
  gameSpecific: { ...state.gameSpecific, rt: { ...state.gameSpecific.rt, ...patch } },
});

/** Replace one piece's queue, dropping the entry entirely when it empties. */
function setQueue(queues, id, next) {
  const out = { ...queues };
  if (next.length) out[id] = next; else delete out[id];
  return out;
}

/** Append an order to the back of a piece's queue (starting it if it was idle). */
function pushOrder(state, playerId, action, entry) {
  const rt = state.gameSpecific.rt;
  // The passes are deliberately NOT reset. Both sides order into the same
  // instant, and neither gets to see the other's orders before committing its
  // own — that is what makes this simultaneous play rather than a very fast
  // alternating game.
  return withRt(state, {
    queues: setQueue(rt.queues, action.unitId, [...queueOf(rt, action.unitId), entry]),
  }, { lastActions: [{ playerId, action }] });
}

/**
 * Shorten a piece's queue, and lock it for the rest of the instant. Shortening is
 * the edit that would otherwise let a player undo their way round in a circle
 * while the clock stood still (see MAX_ORDERS), so it is the one that costs the
 * piece its say.
 */
function editQueue(state, playerId, action, edit) {
  const rt = state.gameSpecific.rt;
  const next = edit(queueOf(rt, action.unitId));
  const ready = { ...rt.ready };
  // A piece called off mid-delay is free again the moment it is called off; one
  // called off mid-hop keeps whatever cooldown that hop bought.
  if (!next.length && rt.space === 'continuous') delete ready[action.unitId];
  return withRt(state, {
    queues: setQueue(rt.queues, action.unitId, next),
    ready,
    locked: [...rt.locked, action.unitId],
  }, { lastActions: [{ playerId, action }] });
}

/**
 * `wait` — this player is done giving orders at this instant. If the opponent
 * hasn't waited yet, hand them the instant. If they have, run the clock.
 */
function waitOut(state, playerId, action) {
  const rt = state.gameSpecific.rt;
  const other = opponentOf(playerId);
  const passed = { ...rt.passed, [playerId]: true };
  if (!passed[other]) {
    return withRt(state, { passed }, { activePlayers: [other], lastActions: [{ playerId, action }] });
  }
  return advanceClock(withRt(state, { passed }, { lastActions: [{ playerId, action }] }));
}

// ── Running the clock ────────────────────────────────────────────────────────

/**
 * Advance to the next moment at which anything happens, resolve it, and reopen
 * the instant for orders. "Anything" is a hop coming off cooldown (discrete
 * space) or a contact/arrival/death (continuous space).
 */
function advanceClock(state) {
  const rt = state.gameSpecific.rt;
  const next = rt.space === 'discrete' ? advanceHops(state) : advanceSlides(state);
  const turnNumber = Math.floor(next.gameSpecific.rt.clock / (rt.turnDuration || TURN_DURATION)) + 1;
  return {
    ...next,
    activePlayers: ['white'],
    turnNumber,
    gameSpecific: {
      ...next.gameSpecific,
      rt: { ...next.gameSpecific.rt, passed: { white: false, black: false }, locked: [] },
    },
  };
}

// ── Clockwork: discrete space, continuous time — hop, cool down, hop again ───

/**
 * One step of every piece that is due one, at the earliest time any piece is due.
 *
 * "A step" is whatever the head of that piece's queue asks for. A DELAY is
 * consumed the moment it comes up: it sets the piece's ready time and leaves the
 * queue, because to everything downstream a delay is just a cooldown the player
 * asked for rather than one a hop imposed. A MOVE lands on the next square of the
 * route:
 *   • empty          → it lands and cools down for stepLength/speed.
 *   • enemy piece    → that piece is taken, and the journey CONTINUES; a slider
 *                      aimed down a file eats what stands in it, one hop at a time.
 *   • friendly piece → the order is called off and the piece stays put. This is
 *                      what keeps a route honest without pre-filtering it.
 * When a route runs out, the next order in the queue takes over with no gap and
 * without anyone being asked again.
 */
function advanceHops(state) {
  const rt = state.gameSpecific.rt;
  const busy = Object.keys(rt.queues);
  if (busy.length === 0) return idleAdvance(state);

  const units = state.units.map((u) => ({ ...u, cell: { ...u.cell } }));
  const byId = new Map(units.map((u) => [u.id, u]));
  let queues = { ...rt.queues };
  const ready = { ...rt.ready };

  // The next moment a piece is due. A freshly-given order is due immediately.
  let t = Infinity;
  for (const id of busy) {
    if (!byId.get(id)?.alive) continue;
    t = Math.min(t, Math.max(ready[id] ?? 0, rt.clock));
  }
  if (!Number.isFinite(t)) return idleAdvance(state);

  const events = [];
  // Deterministic order when several pieces are due at the same instant: the
  // first to land owns the square, and the rest meet it there.
  const due = busy.filter((id) => byId.get(id)?.alive && Math.max(ready[id] ?? 0, rt.clock) <= t + EPS).sort();

  const occupant = (cell) => units.find((u) => u.alive && sameCell(u.cell, cell));
  const shift = (id) => { queues = setQueue(queues, id, (queues[id] ?? []).slice(1)); };

  for (const id of due) {
    const u = byId.get(id);
    if (!u?.alive) continue;
    const order = (queues[id] ?? [])[0];
    if (!order) continue;

    if (order.kind === 'delay') {
      ready[id] = t + order.duration;
      shift(id);
      events.push(`${u.id} holds until t=${(t + order.duration).toFixed(2)}`);
      continue;
    }

    const target = order.path[order.idx];
    const blocker = occupant(target);

    if (blocker && blocker.ownerId === u.ownerId) {
      // The hop is spent even though the piece doesn't move: it costs the same
      // cooldown as if it had landed. Without that the clock would stand still —
      // a piece could be re-aimed at the same friend and bounce off it forever
      // at zero cost, and nothing else would ever come due. The rest of the queue
      // goes with it: every order behind this one was planned from a square this
      // piece is now never going to reach.
      queues = setQueue(queues, id, []);
      ready[id] = t + dist(u.cell, target) / speedOf(u);
      events.push(`${u.id} blocked at ${sqOf(target.x, target.y)}`);
      continue;
    }
    if (blocker) {
      blocker.alive = false;
      blocker.hp = 0;
      queues = setQueue(queues, blocker.id, []);   // a taken piece has no plans
      events.push(`${u.id} takes ${blocker.id} on ${sqOf(target.x, target.y)}`);
    }

    const step = dist(u.cell, target);
    u.cell = { ...target };
    u.position = sqOf(target.x, target.y);
    if (promotesAt(u, target)) { u.type = 'queen'; u.maxHp = maxHpOf('queen'); u.hp = u.maxHp; events.push(`${u.id} promotes`); }

    const nextIdx = order.idx + 1;
    if (nextIdx >= order.path.length) shift(id);
    else queues = setQueue(queues, id, [{ ...order, idx: nextIdx }, ...(queues[id] ?? []).slice(1)]);
    ready[id] = t + step / speedOf(u);
  }

  return {
    ...state,
    units,
    board: boardFromUnits(units),
    gameSpecific: {
      ...state.gameSpecific,
      rt: { ...rt, clock: t, queues, ready, idleTicks: 0, events },
    },
  };
}

/**
 * Nothing is under way. If pieces are still cooling down from their last hop,
 * run the clock to the first of them coming free — that IS the next thing that
 * happens, and skipping past it would silently give the players a free turn's
 * worth of orders. Otherwise the position is genuinely stalled: run on by a
 * fixed tick so a game where neither side ever moves still reaches a result.
 */
function idleAdvance(state) {
  const rt = state.gameSpecific.rt;
  let next = Infinity;
  for (const u of state.units) {
    if (!u.alive) continue;
    const r = rt.ready[u.id] ?? 0;
    if (r > rt.clock + EPS) next = Math.min(next, r);
  }
  const stalled = !Number.isFinite(next);
  const clock = stalled ? rt.clock + IDLE_TICK : next;
  return {
    ...state,
    gameSpecific: {
      ...state.gameSpecific,
      rt: { ...rt, clock, idleTicks: stalled ? rt.idleTicks + 1 : 0, events: [] },
    },
  };
}

// ── Continuous space: sliding bodies that hurt each other ────────────────────

/**
 * The window during which two disks moving at constant velocity are within R of
 * each other, as times relative to now. Both roots of |Δp + Δv·τ|² = R², solved
 * in closed form so a fast piece can never step over a slow one between samples.
 * Returns null if they never touch; `{enter: -Infinity, exit: Infinity}` when
 * they are already overlapping and not moving relative to each other.
 */
export function contactWindow(dp, dv, R) {
  const a = dv.x * dv.x + dv.y * dv.y;
  const b = 2 * (dp.x * dv.x + dp.y * dv.y);
  const c = dp.x * dp.x + dp.y * dp.y - R * R;
  if (a < EPS) return c < 0 ? { enter: -Infinity, exit: Infinity } : null;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return { enter: (-b - s) / (2 * a), exit: (-b + s) / (2 * a) };
}

/**
 * Current velocity of a unit under the head of its queue. Zero for a piece with
 * nothing to do, for one whose head is a delay, and for one still holding out a
 * delay it was given earlier (`ready`) — all three are the same fact to the
 * integrator: this body is not going anywhere yet.
 */
function velocityOf(u, order, holdingUntil = 0, now = 0) {
  if (!order || !u.alive || order.kind === 'delay') return { x: 0, y: 0, arrive: Infinity };
  if (holdingUntil > now + EPS) return { x: 0, y: 0, arrive: Infinity };
  const target = centreOf(order.path[order.idx]);
  const d = dist(u.position, target);
  if (d < EPS) return { x: 0, y: 0, arrive: 0 };
  const sp = speedOf(u);
  return { x: ((target.x - u.position.x) / d) * sp, y: ((target.y - u.position.y) / d) * sp, arrive: d / sp };
}

/**
 * Integrate the continuous-space world forward by at most `span` clock units,
 * stopping at the first moment that is worth showing a player.
 *
 * Between events every piece moves in a straight line at constant speed and
 * every overlapping enemy pair grinds at a constant rate, so the state anywhere
 * in between is exact arithmetic, never a sampled approximation. The events are:
 *
 *   • a piece reaches the next waypoint of its route (turns a corner, or arrives);
 *   • two enemy disks start or stop overlapping;
 *   • a moving piece touches a FRIENDLY disk, which calls its order off where it
 *     stands — the continuous-space reading of "the destination is cancelled";
 *   • a piece runs out of hit points.
 *
 * Only the last two, plus a completed journey, interrupt the run: contact
 * starting and stopping are internal bookkeeping, and waking the players for
 * every graze would turn a slide into a slideshow.
 *
 * Overlap is decided at the MIDPOINT of each step rather than at its endpoints,
 * which is what keeps the boundary cases honest: at the exact instant two disks
 * touch, `|Δp| == 2R` classifies neither as apart nor as overlapping, and either
 * choice loses — one skips the damage of the interval just entered, the other
 * re-enters an interval just left and stalls the clock.
 *
 * `span` of Infinity means "run until everything has come to rest", which is
 * what a discrete-time turn (`sliding`) wants: one order, resolved to a
 * standstill, then the turn passes.
 */
function integrate(unitsIn, queuesIn, readyIn, t0, span) {
  const units = unitsIn.map((u) => ({ ...u, position: { ...u.position } }));
  let queues = { ...queuesIn };
  const ready = { ...readyIn };
  const events = [];
  const deadline = span === Infinity ? Infinity : t0 + span;
  const TOUCH = 2 * HITBOX_R;
  let t = t0;
  const head = (id) => (queues[id] ?? [])[0];
  const shift = (id) => { queues = setQueue(queues, id, (queues[id] ?? []).slice(1)); };
  const velOf = (u) => velocityOf(u, head(u.id), ready[u.id] ?? 0, t);

  for (let guard = 0; guard < 5000; guard++) {
    const alive = units.filter((u) => u.alive);
    let interrupted = false;

    // A delay at the head of a queue is consumed the moment it comes up: it sets
    // the piece's ready time and leaves, so from here down "waiting" and "cooling
    // down" are the same state and only `ready` has to be consulted.
    let consumed = false;
    for (const u of alive) {
      const h = head(u.id);
      if (h?.kind !== 'delay') continue;
      ready[u.id] = t + h.duration;
      shift(u.id);
      events.push(`${u.id} holds until t=${(t + h.duration).toFixed(2)}`);
      consumed = true;
    }
    if (consumed) continue;

    // A piece that is already touching a friend and is pointed at it never gets
    // to move: its order is off before the step, so nothing interpenetrates.
    let blocked = false;
    for (const u of alive) {
      if (!head(u.id)) continue;
      const v = velOf(u);
      if (!v.x && !v.y) continue;
      const hit = alive.find((o) => o !== u && o.ownerId === u.ownerId
        && dist(o.position, u.position) <= TOUCH + 1e-7
        && (o.position.x - u.position.x) * v.x + (o.position.y - u.position.y) * v.y > 0);
      if (hit) {
        // The rest of the queue goes too: everything behind this order was
        // planned from a square the piece is now never going to stand on.
        queues = setQueue(queues, u.id, []);
        events.push(`${u.id} blocked by ${hit.id}`);
        blocked = true;
      }
    }
    if (blocked) {
      // Every block at this instant has now been dealt with, so continuous time
      // hands control back — a piece stopped by its own side wants new orders,
      // and making it stand there until the next arrival wastes it. Only once the
      // clock has actually moved, though: returning at the caller's own clock
      // would clear `locked` and let the same piece be re-aimed at the same
      // friend forever.
      if (span !== Infinity && t > t0 + EPS) break;
      continue;
    }

    const vel = new Map(alive.map((u) => [u.id, velOf(u)]));
    const moving = alive.some((u) => vel.get(u.id).x || vel.get(u.id).y);
    // A piece holding out a delay is going nowhere, but the moment it comes free
    // IS an event — otherwise a world in which nothing else is happening would
    // read as settled and the delay would never end.
    const nextFree = Math.min(...alive.map((u) => (
      queues[u.id] && (ready[u.id] ?? 0) > t + EPS ? ready[u.id] : Infinity)));

    // Every pair's separation as a function of the step: dp + dv·τ. FRIENDLY
    // pairs are in here too, and have to be: their contact is what stops a slide,
    // so the step must end the instant one begins — otherwise a queen ordered
    // down her own file sails straight through the pawn in front of her.
    const pairs = [];
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const va = vel.get(a.id), vb = vel.get(b.id);
        pairs.push({
          a, b, foe: a.ownerId !== b.ownerId,
          dp: { x: b.position.x - a.position.x, y: b.position.y - a.position.y },
          dv: { x: vb.x - va.x, y: vb.y - va.y },
        });
      }
    }
    const overlapAt = (tau) => pairs.filter((p) => p.foe
      && Math.hypot(p.dp.x + p.dv.x * tau, p.dp.y + p.dv.y * tau) < TOUCH);

    if (!moving && overlapAt(0).length === 0 && !Number.isFinite(nextFree))
      return { units, queues, ready, t, events, settled: true };

    // How far can the step run before the pieces' arrangement changes?
    let dt = deadline - t;
    const consider = (c) => { if (c > EPS && c < dt) dt = c; };
    for (const u of alive) {
      const arrive = vel.get(u.id).arrive;
      if (Number.isFinite(arrive)) consider(arrive);
    }
    if (Number.isFinite(nextFree)) consider(nextFree - t);
    for (const p of pairs) {
      const w = contactWindow(p.dp, p.dv, TOUCH);
      if (!w) continue;
      consider(w.enter);
      // Friends never overlap, so they have no exit to wait for — the step ends
      // where they touch and the block check above takes it from there.
      if (p.foe) consider(w.exit);
    }

    // Who is grinding whom for the whole of this step — read off its midpoint,
    // where the answer is unambiguous (see the note above).
    const rate = new Map(alive.map((u) => [u.id, 0]));
    for (const p of overlapAt(Number.isFinite(dt) ? dt / 2 : 1e-6)) {
      rate.set(p.a.id, rate.get(p.a.id) + powerOf(p.b) * DAMAGE_PER_POWER);
      rate.set(p.b.id, rate.get(p.b.id) + powerOf(p.a) * DAMAGE_PER_POWER);
    }
    // A death inside the step cuts it short. Shrinking the step cannot change
    // who is overlapping (the new step is a prefix of the old one), so the rates
    // just computed stay valid.
    for (const u of alive) {
      const r = rate.get(u.id);
      if (r > 0) consider(u.hp / r);
    }
    if (!Number.isFinite(dt)) return { units, queues, ready, t, events, settled: true };
    if (dt <= EPS) break;

    for (const u of alive) {
      const v = vel.get(u.id);
      u.position = { x: u.position.x + v.x * dt, y: u.position.y + v.y * dt };
      const r = rate.get(u.id);
      if (r > 0) u.hp = Math.max(0, u.hp - r * dt);
    }
    t += dt;

    for (const u of alive) {
      if (u.alive && u.hp <= EPS) {
        u.alive = false;
        u.hp = 0;
        queues = setQueue(queues, u.id, []);
        events.push(`${u.id} destroyed`);
        interrupted = true;
      }
    }

    // Waypoints reached: turn the corner, finish the journey, or start the next
    // order in the queue with no gap and nobody asked.
    for (const u of units) {
      const order = head(u.id);
      if (!u.alive || order?.kind !== 'move') continue;
      const target = centreOf(order.path[order.idx]);
      if (dist(u.position, target) > 1e-7) continue;
      u.position = { ...target };
      const nextIdx = order.idx + 1;
      if (nextIdx >= order.path.length) {
        shift(u.id);
        if (promotesAt(u, order.path[order.idx])) {
          u.type = 'queen';
          u.maxHp = maxHpOf('queen');
          u.hp = u.maxHp;
          events.push(`${u.id} promotes`);
        }
        events.push(`${u.id} arrives on ${sqOf(order.path[order.idx].x, order.path[order.idx].y)}`);
        interrupted = true;
      } else queues = setQueue(queues, u.id, [{ ...order, idx: nextIdx }, ...(queues[u.id] ?? []).slice(1)]);
    }

    if (t >= deadline - EPS) break;
    // Continuous time hands control back at every event a player might answer;
    // a discrete-time slide (span Infinity) plays the whole journey out.
    if (interrupted && span !== Infinity) break;
  }

  for (const u of units) u.cell = cellOf(u.position);
  return { units, queues, ready, t, events, settled: false };
}

/**
 * Melee: continuous space + continuous time. Run the world to its next event.
 * With nothing moving and nothing touching there is no event to run to, so the
 * clock takes an idle tick instead (and enough of those in a row is a draw).
 */
function advanceSlides(state) {
  const rt = state.gameSpecific.rt;
  const anythingToDo = Object.keys(rt.queues).length > 0 || hasContact(state.units);
  if (!anythingToDo) return idleAdvance(state);

  const res = integrate(state.units, rt.queues, rt.ready, rt.clock, IDLE_TICK);
  for (const u of res.units) u.cell = cellOf(u.position);
  return {
    ...state,
    units: res.units,
    gameSpecific: {
      ...state.gameSpecific,
      rt: { ...rt, clock: res.t, queues: res.queues, ready: res.ready, idleTicks: 0, events: res.events },
    },
  };
}

/**
 * Are any two enemy bodies overlapping? A world where they are is never idle, even
 * with nothing moving: the grinding is what will end it.
 */
const hasContact = (units) => {
  const alive = units.filter((u) => u.alive);
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++)
      if (alive[i].ownerId !== alive[j].ownerId
        && dist(alive[i].position, alive[j].position) < 2 * HITBOX_R - EPS) return true;
  return false;
};

/**
 * Continuous space + DISCRETE time (`sliding`): one order per turn, resolved to a
 * standstill before the turn passes. The slide is the same integration the
 * real-time quadrant runs, with a single mover and no deadline — so a piece that
 * ends its slide still overlapping an enemy keeps grinding until one of them
 * dies, which is what "until they are separated" has to mean when neither of
 * them is going anywhere.
 */
function resolveSingleMove(state, playerId, action) {
  const rt = state.gameSpecific.rt;
  const queues = { [action.unitId]: [{ kind: 'move', path: action.path, idx: 0, pathId: action.pathId ?? 0 }] };
  const res = integrate(state.units, queues, {}, rt.clock, Infinity);
  for (const u of res.units) u.cell = cellOf(u.position);
  const opponent = opponentOf(playerId);
  return {
    ...state,
    units: res.units,
    activePlayers: [opponent],
    turnNumber: playerId === 'black' ? state.turnNumber + 1 : state.turnNumber,
    lastActions: [{ playerId, action }],
    // No half-move clock: the fifty-move rule is a draw rule for a game that can
    // shuffle without contact, and this one always ends on a destroyed king.
    gameSpecific: {
      ...state.gameSpecific,
      rt: { ...rt, clock: res.t, queues: {}, ready: {}, idleTicks: 0, events: res.events },
    },
  };
}

// ── Result ───────────────────────────────────────────────────────────────────

export function getResult(state) {
  const rt = state.gameSpecific.rt;
  const kingOf = (owner) => state.units.find((u) => u.alive && u.ownerId === owner && u.type === 'king');
  const white = kingOf('white'), black = kingOf('black');
  if (!white && !black) return { outcome: 'draw', winnerId: null, reason: 'both-kings-destroyed' };
  if (!white) return { outcome: 'win', winnerId: 'black', reason: 'king-destroyed' };
  if (!black) return { outcome: 'win', winnerId: 'white', reason: 'king-destroyed' };
  if (rt.idleTicks >= MAX_IDLE_TICKS) return { outcome: 'draw', winnerId: null, reason: 'mutual-inaction' };
  return null;
}

// ── Heuristic value, for the generic greedy agent ────────────────────────────

/**
 * Value of a position to `playerId`.
 *
 * The subtlety that makes this worth writing rather than reusing ChessGame's
 * material+piece-square evaluator: in continuous time the greedy agent's
 * candidate actions are ORDERS, and giving an order does not move anything. Score
 * only the position and every order looks identical, so the agent would rank them
 * all equal and effectively play at random. So a standing order is valued for
 * what it is aimed at: the enemies on the squares it still has to cross, and how
 * much closer it takes the piece to the enemy king.
 */
export function evaluateState(state, playerId) {
  const rt = state.gameSpecific.rt;
  const enemyId = opponentOf(playerId);
  const alive = liveUnits(state);
  const enemyKing = alive.find((u) => u.ownerId === enemyId && u.type === 'king');

  let score = 0;
  for (const u of alive) {
    // Hit points exist only in continuous space; elsewhere a piece is whole.
    const health = u.maxHp ? u.hp / u.maxHp : 1;
    score += (u.ownerId === playerId ? 1 : -1) * powerOf(u) * health;
  }

  const cellAt = new Map(alive.map((u) => [`${unitCell(u).x},${unitCell(u).y}`, u]));
  for (const u of alive) {
    if (u.ownerId !== playerId) continue;
    const here = unitCell(u);
    if (enemyKing) score -= 0.01 * dist(here, unitCell(enemyKing));

    // Only the HEAD of the queue is scored: it is the order actually under way,
    // and what a queued one will be worth depends on a board nobody can see yet.
    // (A one-ply agent never queues anyway — `getSearchActions` keeps the
    // planning orders out of its reach entirely — so this only has to price what
    // a piece is doing now.)
    const order = queueOf(rt, u.id)[0];
    if (order?.kind !== 'move') continue;
    // What this journey is pointed at: the best enemy still standing on the part
    // of the route the piece has yet to walk, discounted by how far off it is.
    for (let i = order.idx; i < order.path.length; i++) {
      const target = cellAt.get(`${order.path[i].x},${order.path[i].y}`);
      if (!target) continue;
      if (target.ownerId === playerId) break;  // a friend on the route stops us there
      score += 0.6 * powerOf(target) / (1 + i - order.idx);
    }
    const dest = order.path[order.path.length - 1];
    if (enemyKing) score += 0.01 * (dist(here, unitCell(enemyKing)) - dist(dest, unitCell(enemyKing)));
  }
  return score;
}

// ── Presentation ─────────────────────────────────────────────────────────────

const GLYPH = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };

/**
 * A piece's queue in the shape the client's goto-queue overlay wants: a waypoint
 * per order, oldest first. A move contributes the square it ends on; a delay has
 * no square at all, so it contributes a labelled entry with no coordinates and
 * the overlay simply doesn't draw a leg for it.
 */
const queueEntriesForUi = (queue) => queue.map((e) => (e.kind === 'delay'
  ? { label: `hold ${e.duration}` }
  : { x: e.path[e.path.length - 1].x, y: e.path[e.path.length - 1].y }));

/**
 * A player-level plan (games/planQueue.js), re-cut as per-PIECE waypoint lists so
 * the client's goto-queue overlay can draw it: `Map(square the piece stands on
 * now → the squares it will visit, in order)`.
 *
 * The re-cutting is the whole job. A plan is a list of MOVES, and the second move
 * of a piece starts from a square it has not reached yet, so the waypoints have to
 * be traced back to where each piece stands today or they attach to empty squares.
 */
export function planWaypoints(plan) {
  const originOf = new Map();   // square a piece will be on → square it is on now
  const routes = new Map();     // that original square → waypoints, in order
  for (const move of plan ?? []) {
    if (!move?.from || !move?.to) continue;
    const origin = originOf.get(move.from) ?? move.from;
    const cell = gridOf(move.to);
    routes.set(origin, [...(routes.get(origin) ?? []), { x: cell.x, y: cell.y }]);
    originOf.delete(move.from);
    originOf.set(move.to, origin);
  }
  return routes;
}

/** One queue entry, said out loud: a destination square, or a hold. */
const describeEntry = (e) => (e.kind === 'delay'
  ? `hold ${e.duration}`
  : sqOf(e.path[e.path.length - 1].x, e.path[e.path.length - 1].y));

export function renderState(state) {
  const rt = state.gameSpecific.rt;
  const label = {
    clockwork: 'hop / continuous time',
    melee:     'slide / continuous time',
    sliding:   'slide / turn-based',
  }[rt.variant];
  const head = `t=${rt.clock.toFixed(3)} — ${state.activePlayers[0]} to order [${label}]`;
  const rows = [];
  for (let y = 0; y < 8; y++) {
    const cells = [];
    for (let x = 0; x < 8; x++) {
      const u = state.units.find((p) => p.alive && sameCell(unitCell(p), { x, y }));
      cells.push(u ? (u.ownerId === 'white' ? GLYPH[u.type] : GLYPH[u.type].toLowerCase()) : '.');
    }
    rows.push(`${8 - y} ${cells.join(' ')}`);
  }
  rows.push('  ' + FILES.split('').join(' '));
  const orders = Object.entries(rt.queues).map(([id, q]) => {
    const held = (rt.ready[id] ?? 0) > rt.clock + EPS ? `(held to ${rt.ready[id].toFixed(2)})` : '';
    return `${id}${held}→${q.map(describeEntry).join('→')}`;
  });
  const lines = [head, ...rows];
  if (orders.length) lines.push(`orders: ${orders.join(' ')}`);
  if (rt.events?.length) lines.push(...rt.events.map((e) => `  · ${e}`));
  return lines.join('\n');
}

/**
 * The board as the browser draws it.
 *
 * Discrete space keeps ChessGame's own cell-based grid (pieces sit in cells).
 * Continuous space has to hand the positions over in the separate `units`
 * channel instead, because a piece mid-slide is nowhere near a cell centre —
 * that is what `locationType: 'continuous'` selects (see SchematicLayer.vue).
 * `gridDestinations` then tells the client that, unlike every other continuous
 * game, a click still has to pick one of the enumerated legal destinations
 * rather than freely aiming at the exact point clicked: chess destinations are
 * squares even when the journey between them isn't.
 */
export function toGrid(state, colors) {
  const rt = state.gameSpecific.rt;
  const pidIdx = {};
  (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });

  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const light = (x + (8 - y)) % 2 === 0;
      cells.push({ x, y, color: (light ? colors.light : colors.dark) ?? '#808070' });
    }
  }

  // In discrete time the queue on the board is the PLAYER's plan, re-cut per piece
  // (planWaypoints); in continuous time it is each piece's own order queue.
  // Either way only the viewer's own is drawn in full — see the enemy rule below.
  const viewer = state.viewerId ?? null;
  const planRoutes = rt.time === 'continuous'
    ? new Map()
    : (viewer ? planWaypoints(state.gameSpecific.plan?.[viewer]) : new Map());

  const units = liveUnits(state).map((u) => {
    const queue = queueOf(rt, u.id);
    const mine = !viewer || u.ownerId === viewer;
    const holding = (rt.ready[u.id] ?? 0) > rt.clock + EPS;
    // Continuous space hands over the exact point; discrete space hands over the
    // integer cell index and lets the client centre it (App.vue's
    // `positionedOffset` adds the half-cell for a positioned grid game — adding
    // it here too would sit every piece half a square down and to the right).
    const p = rt.space === 'continuous' ? u.position : u.cell;
    return {
      id: u.id,
      x: p.x, y: p.y,
      owner: pidIdx[u.ownerId] ?? 0,
      glyph: GLYPH[u.type],
      unitName: `${u.ownerId === 'white' ? 'White' : 'Black'} ${u.type}`,
      type: u.type,
      hp: rt.space === 'continuous' ? Math.ceil(u.hp) : undefined,
      maxHp: rt.space === 'continuous' ? u.maxHp : undefined,
      imagePath: `/images/chess/${u.ownerId === 'white' ? 'w' : 'b'}${GLYPH[u.type]}`,
      // The piece's plan, in the shape the generic goto-queue UI already draws
      // (games/moveQueue.js): a dashed, numbered route on the board and a chip
      // list in the side panel. A `delay` has no square to draw, so it carries a
      // `label` and no coordinates — see HtmlLayer's queueSegments.
      //
      // An ENEMY piece shows only the leg it is on, never the rest of its queue.
      // Where a body is heading right now is a physical fact — you can watch it
      // move — but what it means to do after that is intent, and in a game both
      // sides play into the same instant, reading the opponent's whole plan off
      // the board would be the end of the game as a contest.
      queue: rt.time === 'continuous'
        ? (mine ? queueEntriesForUi(queue) : queueEntriesForUi(queue.slice(0, 1)))
        : (mine ? planRoutes.get(sqOf(unitCell(u).x, unitCell(u).y)) : undefined),
      statusEffects: [
        ...(holding && mine ? [`holding to t=${rt.ready[u.id].toFixed(2)}`] : []),
        ...(queue.length && mine ? [`→ ${queue.map(describeEntry).join(' → ')}`] : []),
      ],
      radius: rt.space === 'continuous' ? HITBOX_R : undefined,
    };
  });

  return {
    width: 8, height: 8,
    boardType: 'grid',
    spaceType: rt.space,
    timeType: rt.time,
    locationType: 'continuous',
    cells, units,
    xLabels: FILES.split(''), yLabels: '87654321'.split(''),
    clock: rt.clock,
    ui: {
      showFacing: false,
      showHpBars: rt.space === 'continuous',
      gridLabelsBottom: true,
      hideGridLines: true,
      ownTileColors: true,
      freeSelection: true,
      showRoster: false,
      showUnitsLost: true,
      highlightLastMove: false,
      // A piece that travels should be seen to travel; standard chess deliberately
      // teleports (ChessGame.ui.moveAnimation 'none'), and that override has to be
      // undone here or a slide arrives with no journey.
      moveAnimation: rt.space === 'continuous' ? 'slide' : 'hop',
      // Destinations are grid squares picked from the legal list, not free points
      // (see Battlefield.vue handleSqClick).
      gridDestinations: true,
    },
  };
}

/** Battle summary for the end-of-game screen. */
export function getBattleSummary(finalState) {
  return {
    turns: finalState.turnNumber,
    teams: finalState.players.map((p) => {
      const remaining = finalState.units.filter((u) => u.alive && u.ownerId === p.id).length;
      return { id: p.id, name: p.name, piecesLost: 16 - remaining, piecesRemaining: remaining };
    }),
  };
}

/** Canonical identity of an order, for the search/greedy payoff bookkeeping. */
export function actionKey(action) {
  if (action.type === 'wait') return 'wait';
  if (action.type === 'cancel') return `cancel:${action.unitId}`;
  return `${action.unitId}:${action.from}${action.to}#${action.pathId ?? 0}`;
}
