// Tests for the fog-chess game database (games/chess/fowDatabase.js).
//
// The property that matters most here is not "the counts add up" — it is that
// the grouping key is a function of WHAT THE MOVER CAN SEE and nothing else. A
// key that quietly depended on the hidden half of the board would still produce
// plausible-looking statistics, and would be answering a question the player
// cannot ask.

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

const levelOf = (res, id) => res.levels.find(l => l.id === id);

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
// The view signature knows what the mover can see, and only that
// ---------------------------------------------------------------------------

const sig = (state, color, withSeen = true) =>
  viewSignature(state.board, color, state.gameSpecific, withSeen);

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

test('the wider level ignores even the enemy pieces in sight', () => {
  const hidden = play(['d4', 'Na6']);
  const seen   = play(['d4', 'c5']);
  assert.equal(sig(hidden, 'white', false), sig(seen, 'white', false));
  // Own pieces still count, of course.
  const other = play(['e4', 'c5']);
  assert.notEqual(sig(seen, 'white', false), sig(other, 'white', false));
});

test('own castling rights key, and en passant only when it is ours to take', () => {
  const kept = play(['e4', 'a6', 'Nf3', 'b6']);
  const lost = play(['e4', 'a6', 'Ke2', 'b6', 'Ke1', 'c6']);
  // Same white pieces on the same squares in both lines, but the king has been
  // out and back in the second, so white can no longer castle.
  assert.notEqual(sig(kept, 'white', false), sig(lost, 'white', false));

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

// The whole point of the trail level: white's knight on f3 watches h4, and
// something black arrives there in plain view. Then the knight goes home and the
// square goes dark. Both games leave white looking at an identical board — but
// one white knows a QUEEN is sitting on h4 and the other knows it is a PAWN,
// which is not remotely the same decision.
const SIGHTED_QUEEN = ['Nf3', 'e6', 'a3', 'Qh4', 'Ng1', 'a6'];
const SIGHTED_PAWN  = ['Nf3', 'h5', 'a3', 'h4',  'Ng1', 'a6'];

test('a sighting the fog has since swallowed still separates two games', () => {
  const queen = line(SIGHTED_QUEEN);
  const pawn  = line(SIGHTED_PAWN);
  // It really was in plain view at ply 4, and really is gone from view at ply 6.
  assert.notEqual(sig(queen[4], 'white'), sig(pawn[4], 'white'));
  assert.equal(sig(queen[6], 'white'), sig(pawn[6], 'white'), 'views end up identical');

  const index = buildIndex(corpusOf(game('1', [...SIGHTED_QUEEN, 'h3'], '1-0')));
  const hits = (states, id) => levelOf(ask(index, states, 'white'), id).total;

  // The recorded game is the queen one, so only that trail matches...
  assert.equal(hits(queen, 'trail'), 1);
  assert.equal(hits(pawn, 'trail'), 0, 'same view, but a different game was watched');
  // ...while the view level, which forgets, cannot tell them apart. That is
  // exactly what it trades away for a sample.
  assert.equal(hits(queen, 'view'), 1);
  assert.equal(hits(pawn, 'view'), 1);
});

test("the trail is the seat's own moves too, not just what it saw", () => {
  const index = buildIndex(corpusOf(game('1', ['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6', 'h3'], '1-0')));
  // Same white pieces on the same squares at the same move number, reached in a
  // different order: knight out and back before d4, or d4 first.
  const recorded = line(['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6']);
  const reversed = line(['d4', 'a6', 'Nf3', 'b6', 'Ng1', 'c6']);
  assert.equal(sig(recorded.at(-1), 'white'), sig(reversed.at(-1), 'white'));

  assert.equal(levelOf(ask(index, recorded, 'white'), 'trail').total, 1);
  assert.equal(levelOf(ask(index, reversed, 'white'), 'trail').total, 0);
  // The view level pools the transposition, which is the point of having it.
  assert.equal(levelOf(ask(index, reversed, 'white'), 'view').total, 1);
});

test('the move number keys: the same view at a different ply is a different question', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'a6', 'Nf3', 'b6'], '1-0')));
  // The identical white view, four plies later, after a knight went out, home,
  // and out again. The mover knows what move it is, so this must not pool.
  const later = line(['Nf3', 'a6', 'Ng1', 'b6', 'd4', 'c6', 'Nf3', 'd6']);
  assert.equal(sig(later[8], 'white'), sig(line(['d4', 'a6', 'Nf3', 'b6'])[4], 'white'));
  assert.equal(levelOf(ask(index, later, 'white'), 'view').total, 0);
  assert.equal(levelOf(ask(index, later, 'white'), 'own').total, 0);
});

test('a query with no history still answers at the levels that need none', () => {
  const index = buildIndex(corpusOf(game('1', [...SIGHTED_QUEEN, 'h3'], '1-0')));
  const states = line(SIGHTED_QUEEN);
  // Same position, asked without the plies behind it: the trail cannot be
  // rebuilt, so that level matches nothing rather than matching the wrong thing.
  const blind = queryIndex(index, states.at(-1), 'white', { legalActions: [] });
  assert.equal(levelOf(blind, 'trail').total, 0);
  assert.equal(levelOf(ask(index, states, 'white'), 'trail').total, 1);
});

// ---------------------------------------------------------------------------
// Index + query
// ---------------------------------------------------------------------------

test('the index pools games by what the mover saw, with results from their seat', () => {
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

  const view = levelOf(res, 'view');
  assert.equal(view.total, 2, 'only the two games where white saw nothing');
  assert.deepEqual(view.moves.map(m => m.san), ['Nf3']);
  assert.equal(view.moves[0].games, 2);
  assert.equal(view.moves[0].win, 1);   // game 1, from white's seat
  assert.equal(view.moves[0].loss, 1);  // game 2, likewise

  const own = levelOf(res, 'own');
  assert.equal(own.total, 3, 'the c5 game pools in once the sighting is dropped');
  assert.deepEqual(own.moves.map(m => m.san).sort(), ['Nf3', 'd5']);

  // The trail level matches the same two games, and that is not a bug: black's
  // reply differed in all three, but white never SAW the difference in these
  // two, so nothing in white's history distinguishes them. An information set
  // is what the player knows, not what happened.
  assert.equal(levelOf(res, 'trail').total, 2);
  assert.equal(res.best, 'trail');
});

test('rows carry a playable action, and rows that are not playable say so', () => {
  // In the recorded game white captured on c5. In OUR game black went elsewhere,
  // so dxc5 is not available — but "same own pieces" still pools that game.
  const index = buildIndex(corpusOf(game('1', ['d4', 'c5', 'dxc5'], '1-0')));
  const states = line(['d4', 'Na6']);
  const legal = ChessGame.getLegalActions(states.at(-1), 'white');
  const res = ask(index, states, 'white', legal);

  const own = levelOf(res, 'own');
  const row = own.moves.find(m => m.san === 'dxc5');
  assert.ok(row, 'the recorded capture is listed');
  assert.equal(row.move, null, 'but it is not offered as a move here');

  // A row that IS available comes with the real action, grid coordinates and all,
  // so the board can draw and play it.
  const index2 = buildIndex(corpusOf(game('2', ['d4', 'Na6', 'Nf3'], '1-0')));
  const res2 = ask(index2, states, 'white', legal);
  const playable = levelOf(res2, 'trail').moves.find(m => m.san === 'Nf3');
  assert.equal(playable.move.from, 'g1');
  assert.equal(playable.move.to, 'f3');
  assert.ok(Array.isArray(playable.move.gridFrom));
});

test('a position no recorded game reached answers empty, not wrong', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'Na6', 'Nf3'], '1-0')));
  const res = ask(index, line(['h4', 'Na6']), 'white');
  assert.deepEqual(res.levels.map(l => l.total), [0, 0, 0]);
  assert.equal(res.best, 'trail');
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

  const hits = (states, color) => levelOf(ask(index, states, color), 'trail').total;
  assert.equal(hits([fresh()], 'white'), 1, 'ply 0 is stored');
  assert.equal(hits(line(['d4']), 'black'), 1, 'ply 1 is stored');
  assert.equal(hits(line(['d4', 'd5']), 'white'), 0, 'ply 2 is past the cap');
});
