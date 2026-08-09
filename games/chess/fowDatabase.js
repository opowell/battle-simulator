// ---------------------------------------------------------------------------
// The fog-chess game database — "what did people play from here?", answered for
// a position nobody can fully see.
//
// A normal opening explorer keys on the POSITION: the board is common knowledge,
// so two games that reach the same board are the same question. Under fog that
// is exactly wrong. The player to move does not know the position — they know
// their own pieces, the enemy pieces their pieces currently watch, everything
// they have watched EARLIER in the game, and nothing else. Grouping recorded
// games by the true board would answer a question the player cannot ask, and
// would silently leak the hidden half of the board into the answer (the set of
// games that reached board X is itself information about where the enemy is). So
// this indexes games by the MOVER'S INFORMATION SET, not by the board.
//
// WHAT THE INFORMATION SET ACTUALLY IS: the whole TRAIL of observations, not the
// current view. A pawn of mine has been blocked on d4 since move 8, and I saw
// what blocked it back when my bishop still watched that square: I know it is
// their knight and not their bishop, and every plan I have from here is built on
// that. Two games whose current views are pixel-identical but whose trails differ
// are two different decisions, and pooling them answers the wrong question. The
// move NUMBER is known to the player too, so it keys as well.
//
// ONE GROUPING, and it is that trail: every view this seat has been shown this
// game, in order, with the moves it played between them. Wider groupings were
// tried and dropped. Keying on the current view alone, or on one's own pieces
// alone, does buy a bigger sample — but a bigger sample of somebody else's
// question, from players who knew different things, and a plausible number
// computed from the wrong games is worse than no number. An exact trail turns
// unique within a handful of moves on a corpus this size; that is a fact about
// the corpus, and the panel says so rather than papering over it.
//
// The index is built by replaying every recorded game with THIS engine's chess
// rules (games/chess/ChessGame.js), so the keys the panel asks with are produced
// by the same code that produced the keys it stores. It is built lazily on first
// query and kept in memory — see `getIndex`.
//
// Corpus files live in ./vendor (see that directory's README): any
// `fow-*.json` crawl of recorded fog games, in the shape
//
//   { games: [ { gameId, white, black, result, moves: ["d4","c5",…],
//                players: [{ username, rating }, …] }, … ] }
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getVisibleSquares } from '../../vendor/obscuro-chess/src/index.js';
import { ChessGame } from './ChessGame.js';

const CORPUS_DIR = fileURLToPath(new URL('./vendor/', import.meta.url));

const TYPE_LETTER = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
const LETTER_TYPE = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

// ---------------------------------------------------------------------------
// SAN → action
// ---------------------------------------------------------------------------

const SAN_RE = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?[+#]?$/;

/**
 * The action in `legal` that a SAN token names, or null. Actions carry a unitId
 * rather than a piece type, so each one must arrive with a `pieceType` stamped
 * on from the board it was generated against (see `replayGame`).
 *
 * Deliberately strict about ambiguity: a token that matches two different moves
 * means the replay has lost track of the game, and guessing would corrupt every
 * key after it. The one exception is a promotion written without its piece
 * (`e8` rather than `e8=Q`), which some scrapes produce; there the four
 * candidates differ only in the promoted piece and queen is the reading.
 */
export function sanToAction(san, legal) {
  const tok = String(san).replace(/\s+/g, '').replace(/[!?]+$/, '');

  const castle = tok.replace(/[+#]$/, '').replace(/0/g, 'O');
  if (castle === 'O-O' || castle === 'O-O-O') {
    const side = castle === 'O-O' ? 'kingside' : 'queenside';
    return legal.find(a => a.type === 'castle' && a.side === side) ?? null;
  }

  const m = SAN_RE.exec(tok);
  if (!m) return null;
  const [, pieceLetter, fromFile, fromRank, to, promo] = m;
  const type = pieceLetter ? LETTER_TYPE[pieceLetter] : 'pawn';

  const hits = legal.filter(a =>
    a.type === 'move' && a.to === to && a.pieceType === type
    && (!fromFile || a.from[0] === fromFile)
    && (!fromRank || a.from[1] === fromRank)
    && (!promo || a.payload?.promote === LETTER_TYPE[promo]));

  if (hits.length === 1) return hits[0];
  if (!hits.length) return null;
  // Promotion with the piece left off: the candidates are one move with four
  // different promotions.
  if (!promo && hits.every(a => a.from === hits[0].from && a.payload?.promote)) {
    return hits.find(a => a.payload.promote === 'queen') ?? hits[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// The information-set key
// ---------------------------------------------------------------------------

/**
 * A string for everything `color` can see about `board` at one moment: WHICH
 * SQUARES they can see, what stands on the ones that are occupied, their own
 * castling rights, and an available en-passant capture. Nothing else about the
 * position enters it. One of these per turn is what the trail is made of.
 *
 * THE SQUARE SET IS NOT REDUNDANT with the pieces, and the case that proves it
 * is a blocked pawn. A pawn's forward square is visible only when it is EMPTY
 * (see getVisibleSquares in the vendored board.js — a pawn cannot see through
 * whatever is standing in its way). So my pawn on d4 with a hidden enemy piece
 * on d5, and my pawn on d4 with d5 genuinely empty, list exactly the same
 * pieces — and yet I can tell them apart at a glance, because in the first one
 * my push is not among my legal moves. Encoding only the pieces would pool two
 * positions whose owner knows they are different.
 */
export function viewSignature(board, color, gameSpecific = {}) {
  const own = [];
  const seen = [];
  const visible = getVisibleSquares(board, color);

  for (const sq of Object.keys(board)) {
    const piece = board[sq];
    if (!piece) continue;
    if (piece.ownerId === color) own.push(sq + TYPE_LETTER[piece.type]);
    else if (visible.has(sq)) seen.push(sq + TYPE_LETTER[piece.type].toLowerCase());
  }
  own.sort();
  seen.sort();
  const squares = [...visible].sort();

  const rights = gameSpecific.castlingRights?.[color] ?? {};
  const castling = `${rights.kingSide ? 'K' : ''}${rights.queenSide ? 'Q' : ''}` || '-';
  // An en-passant target only belongs in the key when the mover can actually
  // take it — otherwise it is a fact about the opponent's last move, which is
  // the very thing the fog hides.
  const ep = epCaptureAvailable(board, color, gameSpecific) ? gameSpecific.enPassantTarget : '-';

  return `${color[0]}|${castling}|${ep}|${own.join('')}|${seen.join('')}|${squares.join('')}`;
}

/**
 * How a move is written into an observation trail.
 *
 * Squares, not SAN: the corpus side has SAN and the live side has action
 * objects, and the two must agree exactly or a game and the position it came
 * from would land in different groups. From/to/promotion is what both sides
 * hold, and it names a move uniquely.
 */
export function moveToken(action) {
  if (!action) return '?';
  if (action.type === 'castle') return `${action.from}${action.to}`;
  return `${action.from}${action.to}${action.payload?.promote ? TYPE_LETTER[action.payload.promote] : ''}`;
}

// ── hashing ──────────────────────────────────────────────────────────────
// A trail is the whole game so far — every view, every move — and there is one
// per indexed ply per seat, so storing them whole would cost more than the
// counts they point at. Nothing ever reads a trail back: a query folds its own
// the same way and looks it up. So it lives as a 64-bit FNV-1a, folded forward
// one turn at a time.

const FNV_PRIME = 0x100000001b3n;
const FNV_MASK  = 0xffffffffffffffffn;

function foldHash(h, str) {
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * FNV_PRIME) & FNV_MASK;
  }
  return h;
}

// ── the observation trail ────────────────────────────────────────────────
// One seat's whole game so far, rolled into a hash: at each of their turns, what
// they were looking at; between those turns, the move they chose. Kept as a
// rolling fold rather than a stored transcript because nothing ever reads it
// back — a query rebuilds its own trail the same way and looks it up.

/** A fresh trail, before the game has shown this seat anything. */
export const newTrail = () => 0xcbf29ce484222325n;

/** Fold in a turn: the move number, and the view the seat had at it. */
export function trailObserve(trail, ply, view) {
  return foldHash(trail, `@${ply}:${view}`);
}

/** Fold in the move the seat then played. */
export function trailMove(trail, action) {
  return foldHash(trail, `>${moveToken(action)}`);
}

/** What a trail is stored and looked up under. */
export const trailKey = (trail) => trail.toString(36);

function epCaptureAvailable(board, color, gameSpecific) {
  const target = gameSpecific.enPassantTarget;
  if (!target) return false;
  const rank = Number(target[1]);
  const fromRank = color === 'white' ? rank - 1 : rank + 1;
  const file = target.charCodeAt(0);
  for (const df of [-1, 1]) {
    const sq = String.fromCharCode(file + df) + fromRank;
    const piece = board[sq];
    if (piece && piece.ownerId === color && piece.type === 'pawn') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Corpus reading + replay
// ---------------------------------------------------------------------------

const FOG_VARIANTS = new Set(['fog of war', 'fogofwar', 'fog-of-war', 'fog']);

/** Is this variant name one of the ways "fog chess" gets spelled? */
function isFogVariant(name) {
  return FOG_VARIANTS.has(String(name ?? '').trim().toLowerCase());
}

/**
 * Strip the trailing run of tokens that are not moves.
 *
 * A crawl of a rendered move list ends with how the game ENDED, not a move —
 * `R` (resigned), `T` (timed out) — and those count in the crawl's own ply
 * total. Only a TRAILING run is dropped: one in the middle means the scrape lost
 * a real move, and every ply after it would be replayed against a board that
 * never existed, so it is left in to fail the replay loudly.
 */
export function normalizeMoveList(moves) {
  const tokens = moves.map(m => String(m).replace(/\s+/g, ''));
  const movelike = t => /[a-h][1-8]/.test(t) || /^[O0]-[O0](-[O0])?$/.test(t.replace(/[+#!?]+$/, ''));
  let end = tokens.length;
  while (end > 0 && !movelike(tokens[end - 1])) end--;
  return tokens.slice(0, end);
}

/** `1` / `0` / `-1` for white, from a `"1-0"`-style result string; null if unknown. */
function whiteScore(result) {
  const r = String(result ?? '').trim();
  if (r === '1-0') return 1;
  if (r === '0-1') return -1;
  if (r.startsWith('1/2') || r === '½-½') return 0;
  return null;
}

function parseRating(v) {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Replay one recorded game, calling `onPly` before each move with the position
 * the mover faced. Returns how many plies replayed.
 */
export function replayGame(moves, onPly) {
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  let state = ChessGame.createInitialState(players, { fogOfWar: true });
  let ply = 0;

  for (const token of moves) {
    const seat = state.activePlayers[0];
    // The action set is the FOG one (pseudo-legal: moving into check is legal in
    // fog chess and recorded games contain such moves), generated against the
    // true board — we are the omniscient replayer here, not a player.
    const legal = ChessGame.getLegalActions(state, seat)
      .map(a => ({ ...a, pieceType: state.board[a.from]?.type }));
    const action = sanToAction(token, legal);
    if (!action) break;
    onPly({ state, seat, action, ply, san: token });
    state = ChessGame.applyActions(state, [{ playerId: seat, action }]);
    ply++;
    if (ChessGame.getResult?.(state)) break;
  }
  return ply;
}

/** Every fog game in a crawl document, normalized. */
export function* gamesFromCrawl(doc, source) {
  for (const [i, g] of (doc?.games ?? []).entries()) {
    if (g?.variant && !isFogVariant(g.variant)) continue;
    if (!Array.isArray(g?.moves) || !g.moves.length) continue;
    const moves = normalizeMoveList(g.moves);
    if (!moves.length) continue;

    // `players` is in crawl order, not white-then-black, so the ratings have to
    // be joined on the username rather than read positionally.
    const byName = new Map((g.players ?? []).map(p => [p.username, p]));
    yield {
      id: g.gameId != null ? String(g.gameId) : `${source}#${i}`,
      white: g.white ?? null,
      black: g.black ?? null,
      whiteRating: parseRating(byName.get(g.white)?.rating),
      blackRating: parseRating(byName.get(g.black)?.rating),
      result: g.result ?? null,
      playedAt: g.playedAt ?? null,
      timeControl: g.timeControl ?? null,
      moves,
    };
  }
}

/** Read every corpus file in `dir` (default ./vendor), de-duplicated by game id. */
export function loadCorpus(dir = CORPUS_DIR) {
  const out = [];
  const seen = new Set();
  let files = [];
  try { files = readdirSync(dir).filter(f => /^fow-.*\.json$/.test(f)).sort(); } catch { return out; }

  for (const file of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
    for (const game of gamesFromCrawl(doc, file)) {
      // A crawl that walks several players' archives meets the same game from
      // both sides; keeping both would weight one game double.
      if (seen.has(game.id)) continue;
      seen.add(game.id);
      out.push(game);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

const MAX_EXAMPLES = 6;

// How deep into a game positions are indexed. This is a MEMORY bound with
// essentially no cost in answers: measured on the 3k-game corpus in ./vendor,
// the median number of games sharing one seat's trail is ~3000 at ply 0, 17 by
// ply 4, and 1 from ply 8 on. Past that the index is mostly storing "one game
// once", which the panel can only report as a single anonymous game — so the
// plies past the cap cost real memory and answer nothing. Raise it with
// FOW_DB_MAX_PLY if a much larger corpus ever makes deep trails pool again.
const MAX_PLY = Number(process.env.FOW_DB_MAX_PLY ?? 30);

// One example game reference packed into a single number: which game, and at
// which ply it was looking at this. The seat is the ply's parity (white moves
// on even plies), so it needs no bits of its own.
const packExample = (gameIndex, ply) => gameIndex * 128 + ply;

/** Fold one recorded game into the accumulating index. */
function indexGame(index, game) {
  const { byKey, games, maxPly } = index;
  const score = whiteScore(game.result);
  const gi = games.length;
  games.push({
    id: game.id, white: game.white, black: game.black,
    whiteRating: game.whiteRating, blackRating: game.blackRating,
    result: game.result, playedAt: game.playedAt, timeControl: game.timeControl,
  });

  // One trail per seat, advanced only at that seat's own turns — a player
  // observes the board when it is handed to them, not while the other side is
  // thinking.
  const trails = { white: newTrail(), black: newTrail() };

  const plies = replayGame(game.moves, ({ state, seat, action, ply, san }) => {
    trails[seat] = trailObserve(trails[seat], ply, viewSignature(state.board, seat, state.gameSpecific));
    const trail = trails[seat];
    // The move is folded in AFTER the keys are taken: the trail a decision is
    // filed under is everything known BEFORE making it.
    trails[seat] = trailMove(trail, action);
    if (ply >= maxPly) return;

    // BOTH ratings, kept apart: how strong the player who chose this move was,
    // and how strong the player they were choosing it against was. A move that
    // scores well for 2100s facing 1600s is not the same recommendation as one
    // that scores well between equals, and one averaged number cannot say which
    // of the two this is.
    const own = seat === 'white' ? game.whiteRating : game.blackRating;
    const opp = seat === 'white' ? game.blackRating : game.whiteRating;
    // Result from the MOVER's seat: this database answers "how did it go for
    // the player who was looking at this", so black's losses are black's.
    const outcome = score == null ? null : (seat === 'white' ? score : -score);

    const key = trailKey(trail);
    let moves = byKey.get(key);
    if (!moves) byKey.set(key, moves = new Map());
    let row = moves.get(san);
    if (!row) {
      moves.set(san, row = {
        san, from: action.from, to: action.to,
        games: 0, win: 0, draw: 0, loss: 0,
        ownSum: 0, ownN: 0, oppSum: 0, oppN: 0, examples: [],
      });
    }
    row.games++;
    if (outcome === 1) row.win++;
    else if (outcome === -1) row.loss++;
    else if (outcome === 0) row.draw++;
    if (own != null) { row.ownSum += own; row.ownN++; }
    if (opp != null) { row.oppSum += opp; row.oppN++; }
    if (row.examples.length < MAX_EXAMPLES) row.examples.push(packExample(gi, ply));
  });
  games[gi].plies = plies;
}

const emptyIndex = (maxPly) => ({ byKey: new Map(), games: [], maxPly, corpusSize: 0 });
const sealIndex = (index, t0) => Object.assign(index, {
  corpusSize: index.games.length, keyCount: index.byKey.size, buildMs: Date.now() - t0,
});

/**
 * Build the lookup: for each information-set key, what each side played from it
 * and how those games ended, from the MOVER's point of view.
 */
export function buildIndex(corpus, { maxPly = MAX_PLY } = {}) {
  const t0 = Date.now();
  const index = emptyIndex(maxPly);
  for (const game of corpus) indexGame(index, game);
  return sealIndex(index, t0);
}

/**
 * The same build, but handing the event loop back every few games.
 *
 * Replaying three thousand games takes ~10 seconds of straight-line CPU. Doing
 * that inside a request handler would wedge the whole server — every other
 * session, every AI move, every poll — for those ten seconds. The panel that
 * triggers it can wait; the rest of the process cannot.
 */
export async function buildIndexAsync(corpus, { maxPly = MAX_PLY, chunk = 25 } = {}) {
  const t0 = Date.now();
  const index = emptyIndex(maxPly);
  for (const [i, game] of corpus.entries()) {
    indexGame(index, game);
    if (i % chunk === chunk - 1) await new Promise(setImmediate);
  }
  return sealIndex(index, t0);
}

let cached = null;
let building = null;

/** The index, built on first use and kept for the life of the process. */
export function getIndex({ dir, reload = false } = {}) {
  if (!cached || reload) cached = buildIndex(loadCorpus(dir));
  return cached;
}

/**
 * The index, built without blocking the event loop. Concurrent callers share
 * one build rather than each starting their own.
 */
export function getIndexAsync({ dir } = {}) {
  if (cached) return Promise.resolve(cached);
  building ??= buildIndexAsync(loadCorpus(dir))
    .then((index) => { cached = index; building = null; return index; },
          (err) => { building = null; throw err; });
  return building;
}

/** Drop the cached index (tests). */
export function clearIndex() { cached = null; building = null; }

// How the one grouping describes itself to whatever is displaying it (the panel
// is generic and knows nothing about fog).
const GROUPING = {
  id: 'trail',
  label: 'Players who knew what you know',
  hint: 'games grouped by everything this seat had been shown at this point — which squares were visible each turn, what stood on them, and the moves played between — so a piece seen ten moves ago and long since swallowed by the fog still counts',
};

const mean = (sum, n) => (n ? Math.round(sum / n) : null);

function summarize(moves, games, byMove) {
  const rows = [...moves.values()].map(r => ({
    san: r.san, from: r.from, to: r.to,
    games: r.games, win: r.win, draw: r.draw, loss: r.loss,
    // Whose strength these numbers came from: the players who chose this move,
    // and the players they faced.
    avgRating: mean(r.ownSum, r.ownN),
    avgOppRating: mean(r.oppSum, r.oppN),
    // The action to play and to draw on the board for this row. Every row should
    // have one: the recorded player's information set is ours, and under fog an
    // information set fixes the legal move set exactly. A row without an action
    // therefore means something is wrong rather than "not your turn to have it",
    // so it is shown, marked unplayable, rather than quietly dropped.
    move: byMove.get(`${r.from}${r.to}`) ?? null,
    examples: r.examples.map((packed) => {
      const ply = packed % 128;
      return { ...games[(packed - ply) / 128], ply, seat: ply % 2 === 0 ? 'white' : 'black' };
    }),
  }));
  rows.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

  // The whole group's averages, weighted by how many games each row speaks for
  // (a row played 300 times should not count the same as one played once).
  const weighted = (pick) => {
    let sum = 0, n = 0;
    for (const r of rows) { const v = pick(r); if (v != null) { sum += v * r.games; n += r.games; } }
    return mean(sum, n);
  };
  return {
    ...GROUPING,
    total: rows.reduce((n, r) => n + r.games, 0),
    moves: rows,
    avgRating: weighted(r => r.avgRating),
    avgOppRating: weighted(r => r.avgOppRating),
  };
}

/**
 * Rebuild `color`'s observation trail from the positions they have been handed
 * so far — the same fold the index does while replaying a recorded game.
 *
 * `priorStates[p]` is the position at ply p, so the seat's own turns are the
 * ones where they are to move, and the move they played at ply p is the one
 * that produced ply p+1 (`lastActions` on the next state; `current` supplies
 * the last step). A missing or partial history just yields a shorter trail —
 * which will simply match nothing, never the wrong thing.
 */
function trailFor(color, priorStates, current) {
  let trail = newTrail();
  for (const [ply, s] of (priorStates ?? []).entries()) {
    if ((s.activePlayers?.[0] ?? null) !== color) continue;
    trail = trailObserve(trail, ply, viewSignature(s.board, color, s.gameSpecific ?? {}));
    const next = priorStates[ply + 1] ?? current;
    const played = next?.lastActions?.find(pa => pa.playerId === color)?.action ?? null;
    trail = trailMove(trail, played);
  }
  return trail;
}

function answer(index, state, color, { legalActions, priorStates }) {
  // Keyed off the TRUE boards, which is the only place a seat's view can be
  // derived from: a board already stripped of hidden pieces cannot say which
  // squares are seen (a hidden pawn blocking a push reads as "empty and
  // visible"). `viewSignature` does the stripping itself, and nothing but the
  // key leaves this function — the answer is corpus statistics, never this
  // game's hidden half.
  const ply = (priorStates ?? []).length;
  const trail = trailObserve(
    trailFor(color, priorStates, state), ply,
    viewSignature(state.board, color, state.gameSpecific ?? {}),
  );

  const byMove = new Map((legalActions ?? []).map(a => [`${a.from}${a.to}`, a]));
  const found = index.byKey.get(trailKey(trail)) ?? new Map();

  return {
    ...summarize(found, index.games, byMove),
    corpusSize: index.corpusSize,
    maxPly: index.maxPly,
    ply,
    color,
  };
}

/**
 * What players who knew exactly what `color` knows went on to play.
 *
 * The answer describes its own grouping (`label`, `hint`) so the panel showing
 * it needs no idea what fog is.
 *
 * @param {object[]} opts.priorStates The positions at plies 0..ply-1, in order.
 *   Not optional in any meaningful sense: a seat's information set is the whole
 *   game it has watched, not the board in front of it. Omit them and the answer
 *   is empty rather than wrong.
 * @param {object[]} opts.legalActions The mover's own legal actions (which under
 *   fog they always know in full) — what lets each row carry a playable move.
 * @returns {Promise<{total: number, moves: object[], label: string, hint: string,
 *   avgRating: number|null, corpusSize: number, maxPly: number, ply: number}>}
 */
export async function queryDatabase(state, color, opts = {}) {
  return answer(await getIndexAsync({ dir: opts.dir }), state, color, opts);
}

/** `queryDatabase`, for callers that can afford to block (tests, CLI). */
export function queryDatabaseSync(state, color, opts = {}) {
  return answer(getIndex({ dir: opts.dir }), state, color, opts);
}

/** The same question against an index you built yourself (see `buildIndex`). */
export function queryIndex(index, state, color, opts = {}) {
  return answer(index, state, color, opts);
}
