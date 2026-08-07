// Tests for the fog-chess game database (games/chess/fowDatabase.js).
//
// The property that matters most here is not "the counts add up" — it is that
// games are grouped by exactly what the mover KNOWS: everything that seat has
// been shown so far and the moves it played, no more and no less. A grouping
// that quietly leaked the hidden half of the board would still produce
// plausible-looking statistics while answering a question the player cannot ask;
// one that forgot a sighting would pool games the player can tell apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChessGame } from './ChessGame.js';
import {
  viewSignature, sanToAction, normalizeMoveList, replayGame,
  gamesFromCrawl, buildIndex, queryIndex,
} from './fowDatabase.js';

const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
const fresh = () => ChessGame.createInitialState(players, { fogOfWar: true });

/**
 * Play a list of SAN moves from the initial position, returning every position
 * along the way — `line(…).at(-1)` is the final one, and the whole array is the
 * history a query needs to rebuild a seat's observation trail.
 */
function line(sans, states = [fresh()]) {
  let state = states.at(-1);
  for (const san of sans) {
    const seat = state.activePlayers[0];
    const legal = ChessGame.getLegalActions(state, seat)
      .map(a => ({ ...a, pieceType: state.board[a.from]?.type }));
    const action = sanToAction(san, legal);
    assert.ok(action, `no legal action for ${san}`);
    state = ChessGame.applyActions(state, [{ playerId: seat, action }]);
    states.push(state);
  }
  return states;
}

/** Just the final position of a line. */
const play = (sans, state) => line(sans, state ? [state] : undefined).at(-1);

/** Ask the index what `color` played from the end of `states`. */
function ask(index, states, color, legalActions = []) {
  const priorStates = states.slice(0, -1);
  return queryIndex(index, states.at(-1), color, { legalActions, priorStates });
}

const crawl = (games) => ({ games });
const game = (id, moves, result, extra = {}) => ({
  gameId: id, variant: 'Fog of War', white: 'w' + id, black: 'b' + id, result, moves,
  players: [{ username: 'w' + id, rating: 2000 }, { username: 'b' + id, rating: 1800 }],
  ...extra,
});

const corpusOf = (...games) => [...gamesFromCrawl(crawl(games), 'test.json')];

// ---------------------------------------------------------------------------
// SAN → action
// ---------------------------------------------------------------------------

test('SAN parses pushes, captures, castling and promotion', () => {
  let state = play(['e4', 'd5', 'exd5', 'Qxd5', 'Nf3', 'Nc6', 'Bc4', 'Qe4+']);
  // Castling short with the f1-bishop and g1-knight already gone from home.
  state = play(['O-O'], state);
  assert.equal(state.board.g1?.type, 'king');
  assert.equal(state.board.f1?.type, 'rook');
});

test('SAN disambiguation picks the one named piece', () => {
  // With the d-pawn out of the way both the b1 and f3 knights can reach d2; the
  // file hint has to decide which one goes.
  const state = play(['d4', 'a6', 'Nf3', 'b6', 'Nbd2']);
  assert.equal(state.board.d2?.type, 'knight');
  assert.equal(state.board.b1, undefined);
  assert.equal(state.board.f3?.type, 'knight');
});

test('an unreadable token stops the replay rather than guessing', () => {
  const plies = replayGame(['e4', 'e5', 'Zz9'], () => {});
  assert.equal(plies, 2);
});

test('normalizeMoveList drops trailing termination glyphs but not real moves', () => {
  assert.deepEqual(normalizeMoveList(['e4', 'e5', 'R']), ['e4', 'e5']);
  assert.deepEqual(normalizeMoveList(['e4', 'R  4g3', 'P', 'R']), ['e4', 'R4g3']);
});

// ---------------------------------------------------------------------------
// The per-turn view signature: what the mover can see, and only that
// ---------------------------------------------------------------------------

const sig = (state, color) => viewSignature(state.board, color, state.gameSpecific);

test('a hidden enemy move does not change the view; a visible one does', () => {
  // White plays d4 either way. Black's reply is a queenside knight move white
  // cannot see (a6/c6 are nowhere near white's pieces), so white's view — and
  // therefore the key — must be identical in both lines.
  const a = play(['d4', 'Na6']);
  const b = play(['d4', 'Nc6']);
  assert.equal(sig(a, 'white'), sig(b, 'white'));

  // ...whereas a black pawn landing on c5, which white's d4 pawn watches, is
  // something white can see, so it must key differently.
  const seen = play(['d4', 'c5']);
  assert.notEqual(sig(a, 'white'), sig(seen, 'white'));
});

test('a blocked pawn is not the same as an open one, though both show no piece', () => {
  // A pawn cannot see through whatever stands in front of it, so a hidden
  // blocker shows up as NO piece and NO visible square — while an empty square
  // in front shows up as no piece but a visible square. The mover can tell:
  // in the first, the push is missing from their legal moves. The signature has
  // to encode the squares, not only the pieces, or those two pool.
  const blocked = play(['d4', 'Nf6', 'a3', 'Nd5']);  // knight parks in front of the pawn
  const open    = play(['d4', 'Nf6', 'a3', 'Ne4']);  // ...or somewhere white cannot see
  assert.equal(blocked.board.d5?.type, 'knight');
  assert.equal(open.board.d5, undefined);
  // Neither white sees an enemy piece anywhere: the blocker is invisible exactly
  // because it blocks. The one on the left has no d4-d5 push, and knows it.
  assert.ok(!ChessGame.getLegalActions(blocked, 'white').some(a => a.from === 'd4' && a.to === 'd5'));
  assert.ok(ChessGame.getLegalActions(open, 'white').some(a => a.from === 'd4' && a.to === 'd5'));
  assert.notEqual(sig(blocked, 'white'), sig(open, 'white'));
});

test('own castling rights key, and en passant only when it is ours to take', () => {
  const kept = play(['e4', 'a6', 'Nf3', 'b6']);
  const lost = play(['e4', 'a6', 'Ke2', 'b6', 'Ke1', 'c6']);
  // Same white pieces on the same squares in both lines, but the king has been
  // out and back in the second, so white can no longer castle.
  assert.notEqual(sig(kept, 'white'), sig(lost, 'white'));

  // A double push next to our pawn is capturable en passant, and the mover knows
  // it — it belongs in the key. The same board reached without the double push
  // must key differently.
  const ep = play(['e4', 'a6', 'e5', 'd5']);
  assert.equal(ep.gameSpecific.enPassantTarget, 'd6');
  const noEp = play(['e4', 'a6', 'e5', 'd6', 'a3', 'd5']);
  assert.equal(noEp.gameSpecific.enPassantTarget, null);
  assert.notEqual(sig(ep, 'white'), sig(noEp, 'white'));
});

// ---------------------------------------------------------------------------
// The trail: what the mover has seen EARLIER is part of the question
// ---------------------------------------------------------------------------

// The whole point of the grouping: white's knight on f3 watches h4, and
// something black arrives there in plain view. Then the knight goes home and the
// square goes dark. Both games leave white looking at an identical board — but
// one white knows a QUEEN is sitting on h4 and the other knows it is a PAWN,
// which is not remotely the same decision.
const SIGHTED_QUEEN = ['Nf3', 'e6', 'a3', 'Qh4', 'Ng1', 'a6'];
const SIGHTED_PAWN  = ['Nf3', 'h5', 'a3', 'h4',  'Ng1', 'a6'];

test('a sighting the fog has since swallowed still separates two games', () => {
  const queen = line(SIGHTED_QUEEN);
  const pawn  = line(SIGHTED_PAWN);
  // It really was in plain view at ply 4, and really is gone from view at ply 6:
  // by then the two boards are identical as far as white can see.
  assert.notEqual(sig(queen[4], 'white'), sig(pawn[4], 'white'));
  assert.equal(sig(queen[6], 'white'), sig(pawn[6], 'white'), 'views end up identical');

  const index = buildIndex(corpusOf(game('1', [...SIGHTED_QUEEN, 'h3'], '1-0')));
  assert.equal(ask(index, queen, 'white').total, 1);
  assert.equal(ask(index, pawn, 'white').total, 0, 'a different game was watched');
});

test("the grouping is the seat's own moves too, not just what it saw", () => {
  const index = buildIndex(corpusOf(game('1', ['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6', 'h3'], '1-0')));
  // Same white pieces on the same squares at the same move number, reached in a
  // different order: knight out and back before d4, or d4 first.
  const recorded = line(['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6']);
  const reversed = line(['d4', 'a6', 'Nf3', 'b6', 'Ng1', 'c6']);
  assert.equal(sig(recorded.at(-1), 'white'), sig(reversed.at(-1), 'white'));

  assert.equal(ask(index, recorded, 'white').total, 1);
  assert.equal(ask(index, reversed, 'white').total, 0, 'a transposition is a different game watched');
});

test('the move number is part of it: the same view at a different ply is a different question', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'a6', 'Nf3', 'b6', 'h3'], '1-0')));
  const early = line(['d4', 'a6', 'Nf3', 'b6']);
  // The identical white view, four plies later, after a knight went out, home,
  // and out again. The mover knows what move it is, so this must not pool.
  const later = line(['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6', 'Nf3', 'd6']);
  assert.equal(sig(early[4], 'white'), sig(later[8], 'white'));
  assert.equal(ask(index, early, 'white').total, 1);
  assert.equal(ask(index, later, 'white').total, 0);
});

test('a query without the history behind it answers empty, not wrong', () => {
  const index = buildIndex(corpusOf(game('1', [...SIGHTED_QUEEN, 'h3'], '1-0')));
  const states = line(SIGHTED_QUEEN);
  const blind = queryIndex(index, states.at(-1), 'white', { legalActions: [] });
  assert.equal(blind.total, 0);
  assert.equal(ask(index, states, 'white').total, 1);
});

// ---------------------------------------------------------------------------
// Index + query
// ---------------------------------------------------------------------------

test('games pool by what the mover knew, with results from their seat', () => {
  // Three games. White opens d4 in all of them; black's first reply is hidden
  // from white in two of them (knight moves) and visible in the third (c5).
  const index = buildIndex(corpusOf(
    game('1', ['d4', 'Na6', 'Nf3'], '1-0'),
    game('2', ['d4', 'Nc6', 'Nf3'], '0-1'),
    game('3', ['d4', 'c5', 'd5'],   '1-0'),
  ));

  const states = line(['d4', 'Nf6']); // a third hidden reply, unseen by white
  const legal = ChessGame.getLegalActions(states.at(-1), 'white');
  const res = ask(index, states, 'white', legal);

  // Two of the three pool, and that black played something different in each is
  // beside the point: white never SAW the difference, so nothing in white's
  // history separates them. An information set is what the player knows, not
  // what happened. The c5 game is out because white did see that pawn.
  assert.equal(res.total, 2);
  assert.deepEqual(res.moves.map(m => m.san), ['Nf3']);
  assert.equal(res.moves[0].games, 2);
  assert.equal(res.moves[0].win, 1);   // game 1, from white's seat
  assert.equal(res.moves[0].loss, 1);  // game 2, likewise
  assert.equal(res.moves[0].avgRating, 2000);
});

test('rows carry a playable action', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'Na6', 'Nf3'], '1-0')));
  const states = line(['d4', 'Nc6']);  // black's reply differs, but unseen
  const legal = ChessGame.getLegalActions(states.at(-1), 'white');
  const res = ask(index, states, 'white', legal);

  // The action comes back whole, grid coordinates and all, so the board can draw
  // an arrow for it and play it into the fork sandbox.
  const row = res.moves.find(m => m.san === 'Nf3');
  assert.equal(row.move.from, 'g1');
  assert.equal(row.move.to, 'f3');
  assert.ok(Array.isArray(row.move.gridFrom));

  // Asked without the legal actions, the row is still listed but unplayable —
  // the panel marks those rather than dropping them.
  assert.equal(ask(index, states, 'white').moves[0].move, null);
});

test('a game nobody in the corpus was ever in answers empty, not wrong', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'Na6', 'Nf3'], '1-0')));
  const res = ask(index, line(['h4', 'Na6']), 'white');
  assert.equal(res.total, 0);
  assert.deepEqual(res.moves, []);
  assert.equal(res.corpusSize, 1);
});

test('the crawl reader keeps ratings per seat and skips non-fog games', () => {
  const games = [...gamesFromCrawl(crawl([
    game('1', ['d4'], '1-0'),
    { ...game('2', ['d4'], '1-0'), variant: 'Standard' },
  ]), 'test.json')];
  assert.equal(games.length, 1);
  assert.equal(games[0].whiteRating, 2000);
  assert.equal(games[0].blackRating, 1800);
});

test('the index caps how deep it stores, and says so', () => {
  const moves = ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'Bf5'];
  const index = buildIndex(corpusOf(game('1', moves, '1-0')), { maxPly: 2 });
  assert.equal(index.maxPly, 2);

  const hits = (states, color) => ask(index, states, color).total;
  assert.equal(hits([fresh()], 'white'), 1, 'ply 0 is stored');
  assert.equal(hits(line(['d4']), 'black'), 1, 'ply 1 is stored');
  assert.equal(hits(line(['d4', 'd5']), 'white'), 0, 'ply 2 is past the cap');
});
