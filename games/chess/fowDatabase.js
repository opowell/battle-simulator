// ---------------------------------------------------------------------------
// The fog-chess game database — "what did people play from here?", answered for
// a position nobody can fully see.
//
// A normal opening explorer keys on the POSITION: the board is common knowledge,
// so two games that reach the same board are the same question. Under fog that
// is exactly wrong. The player to move does not know the position — they know
// their own pieces, the enemy pieces their pieces currently watch, and nothing
// else. Grouping recorded games by the true board would answer a question the
// player cannot ask, and would silently leak the hidden half of the board into
// the answer (the set of games that reached board X is itself information about
// where the enemy is). So this indexes games by the MOVER'S INFORMATION SET, not
// by the board: see `infosetKey` below.
//
// TWO KEY LEVELS, both coarsenings of what the mover can see — never refinements:
//
//   level 0 "view"  own pieces + the enemy pieces currently visible + own
//                   castling rights + an en-passant capture if one is available.
//                   This is precisely the board the app draws for that seat.
//   level 1 "own"   own pieces only. Drops the sighted enemies, so games where
//                   the mover had the same army in the same places pool together
//                   even if they were looking at different things.
//
// Level 1 exists because level 0 runs out of games fast: past the first handful
// of moves, one seat's exact view is nearly unique across a few thousand games.
// Both keys deliberately ignore the move NUMBER and the history behind the
// position, so transpositions pool (the mover does know both — dropping them
// pools games the mover could tell apart, which is the safe direction; adding
// hidden information is the unsafe one, and neither key does that).
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
 * A string identifying everything `color` can see about `board` — their own
 * pieces, the enemy pieces they currently watch, their own castling rights, and
 * an available en-passant capture. Nothing else about the position enters it.
 *
 * @param {number} level 0 = the full visible view, 1 = own pieces only.
 */
export function infosetKey(board, color, gameSpecific = {}, level = 0) {
  const own = [];
  const seen = [];
  const visible = level === 0 ? getVisibleSquares(board, color) : null;

  for (const sq of Object.keys(board)) {
    const piece = board[sq];
    if (!piece) continue;
    if (piece.ownerId === color) own.push(sq + TYPE_LETTER[piece.type]);
    else if (visible?.has(sq)) seen.push(sq + TYPE_LETTER[piece.type].toLowerCase());
  }
  own.sort();
  seen.sort();

  const rights = gameSpecific.castlingRights?.[color] ?? {};
  const castling = `${rights.kingSide ? 'K' : ''}${rights.queenSide ? 'Q' : ''}` || '-';
  // An en-passant target only belongs in the key when the mover can actually
  // take it — otherwise it is a fact about the opponent's last move, which is
  // the very thing the fog hides.
  const ep = epCaptureAvailable(board, color, gameSpecific) ? gameSpecific.enPassantTarget : '-';

  return `${level}|${color[0]}|${castling}|${ep}|${own.join('')}|${seen.join('')}`;
}

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
// the median number of games sharing one seat's view is ~3000 at ply 0, ~30 by
// ply 4, and exactly 1 from ply 10 on (own-pieces-only lasts a few plies
// longer). Past that the index is storing "one game once", which the panel can
// only report as a single anonymous game — so the plies past the cap cost real
// memory and answer nothing. Raise it with FOW_DB_MAX_PLY if a much larger
// corpus ever makes deep views pool again.
const MAX_PLY = Number(process.env.FOW_DB_MAX_PLY ?? 30);

/**
 * 64-bit FNV-1a as a base-36 string.
 *
 * The keys themselves are long (a placement list, up to ~200 chars) and there
 * are hundreds of thousands of them; storing them whole costs more than the
 * counts they point at. Nothing ever needs to read a key back — a query hashes
 * its own key the same way and looks it up — so only the hash is kept.
 */
function hashKey(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(36);
}

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

  const plies = replayGame(game.moves, ({ state, seat, action, ply, san }) => {
    if (ply >= maxPly) return;
    const rating = seat === 'white' ? game.whiteRating : game.blackRating;
    // Result from the MOVER's seat: this database answers "how did it go for
    // the player who was looking at this", so black's losses are black's.
    const outcome = score == null ? null : (seat === 'white' ? score : -score);

    for (const level of [0, 1]) {
      const key = hashKey(infosetKey(state.board, seat, state.gameSpecific, level));
      let moves = byKey.get(key);
      if (!moves) byKey.set(key, moves = new Map());
      let row = moves.get(san);
      if (!row) {
        moves.set(san, row = {
          san, from: action.from, to: action.to,
          games: 0, win: 0, draw: 0, loss: 0, ratingSum: 0, ratingN: 0, examples: [],
        });
      }
      row.games++;
      if (outcome === 1) row.win++;
      else if (outcome === -1) row.loss++;
      else if (outcome === 0) row.draw++;
      if (rating != null) { row.ratingSum += rating; row.ratingN++; }
      if (row.examples.length < MAX_EXAMPLES) row.examples.push(packExample(gi, ply));
    }
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

const LEVELS = [
  { level: 0, id: 'view', label: 'Same view', hint: 'your pieces and the enemy pieces you can see' },
  { level: 1, id: 'own',  label: 'Own pieces', hint: 'your pieces only, whatever you could see' },
];

function summarize(moves, games, level, byMove) {
  const rows = [...moves.values()].map(r => ({
    san: r.san, from: r.from, to: r.to,
    games: r.games, win: r.win, draw: r.draw, loss: r.loss,
    avgRating: r.ratingN ? Math.round(r.ratingSum / r.ratingN) : null,
    // The action to play/draw for this row, when the viewer has it available.
    // At level 0 every row is available by construction — same view means the
    // same legal moves, which is the fog invariant the whole search rests on.
    // Level 1 pools games whose hidden half differed, so some of its rows are
    // captures of pieces that are not there in this game; the viewer can already
    // tell (their own legal moves are common knowledge to them), so those rows
    // are marked rather than hidden.
    move: byMove.get(`${r.from}${r.to}`) ?? null,
    examples: r.examples.map((packed) => {
      const ply = packed % 128;
      return { ...games[(packed - ply) / 128], ply, seat: ply % 2 === 0 ? 'white' : 'black' };
    }),
  }));
  rows.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
  const total = rows.reduce((n, r) => n + r.games, 0);
  const ratingRows = rows.filter(r => r.avgRating != null);
  return {
    ...level,
    total,
    moves: rows,
    avgRating: ratingRows.length
      ? Math.round(ratingRows.reduce((s, r) => s + r.avgRating * r.games, 0)
                   / ratingRows.reduce((s, r) => s + r.games, 0))
      : null,
  };
}

function answer(index, state, color, legalActions) {
  // Keyed off the TRUE board, which is the only place the mover's view can be
  // derived from: a board already stripped of hidden pieces cannot say which
  // squares are seen (a hidden pawn blocking a push reads as "empty and
  // visible"). `infosetKey` does the stripping itself, and nothing but the key
  // leaves this function — the answer is corpus statistics, never this game's
  // hidden half.
  const byMove = new Map((legalActions ?? []).map(a => [`${a.from}${a.to}`, a]));
  const levels = LEVELS.map((lv) => {
    const key = hashKey(infosetKey(state.board, color, state.gameSpecific ?? {}, lv.level));
    return summarize(index.byKey.get(key) ?? new Map(), index.games, lv, byMove);
  });
  return {
    levels,
    best: (levels.find(l => l.total > 0) ?? levels[0]).id,
    corpusSize: index.corpusSize,
    maxPly: index.maxPly,
    color,
  };
}

/**
 * What recorded players did from the position `color` is looking at.
 *
 * Answers at BOTH key levels in one call — the caller shows the finest one that
 * has games and lets the viewer widen — so the client never has to know what a
 * level means. `legalActions` (the mover's own, which under fog they always
 * know in full) is what lets each row carry a playable action.
 *
 * @returns {Promise<{levels: object[], best: string, corpusSize: number, maxPly: number}>}
 */
export async function queryDatabase(state, color, { dir, legalActions } = {}) {
  return answer(await getIndexAsync({ dir }), state, color, legalActions);
}

/** `queryDatabase`, for callers that can afford to block (tests, CLI). */
export function queryDatabaseSync(state, color, { dir, legalActions } = {}) {
  return answer(getIndex({ dir }), state, color, legalActions);
}

/** The same question against an index you built yourself (see `buildIndex`). */
export function queryIndex(index, state, color, { legalActions } = {}) {
  return answer(index, state, color, legalActions);
}
