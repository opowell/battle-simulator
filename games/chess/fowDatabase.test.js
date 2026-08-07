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
  infosetKey, sanToAction, normalizeMoveList, replayGame,
  gamesFromCrawl, buildIndex, queryIndex,
} from './fowDatabase.js';

const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
const fresh = () => ChessGame.createInitialState(players, { fogOfWar: true });

/** Play a list of SAN moves from the initial position. */
function play(sans, state = fresh()) {
  for (const san of sans) {
    const seat = state.activePlayers[0];
    const legal = ChessGame.getLegalActions(state, seat)
      .map(a => ({ ...a, pieceType: state.board[a.from]?.type }));
    const action = sanToAction(san, legal);
    assert.ok(action, `no legal action for ${san}`);
    state = ChessGame.applyActions(state, [{ playerId: seat, action }]);
  }
  return state;
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
// The key only knows what the mover can see
// ---------------------------------------------------------------------------

test('a hidden enemy move does not change the key; a visible one does', () => {
  // White plays d4 either way. Black's reply is a queenside knight move white
  // cannot see (a6/c6 are nowhere near white's pieces), so white's information
  // set — and therefore the key — must be identical in both lines.
  const a = play(['d4', 'Na6']);
  const b = play(['d4', 'Nc6']);
  assert.equal(
    infosetKey(a.board, 'white', a.gameSpecific, 0),
    infosetKey(b.board, 'white', b.gameSpecific, 0),
  );

  // ...whereas a black pawn landing on c5, which white's d4 pawn watches, is
  // something white can see, so it must key differently.
  const seen = play(['d4', 'c5']);
  assert.notEqual(
    infosetKey(a.board, 'white', a.gameSpecific, 0),
    infosetKey(seen.board, 'white', seen.gameSpecific, 0),
  );
});

test('the wider level ignores even the enemy pieces in sight', () => {
  const hidden = play(['d4', 'Na6']);
  const seen   = play(['d4', 'c5']);
  assert.equal(
    infosetKey(hidden.board, 'white', hidden.gameSpecific, 1),
    infosetKey(seen.board, 'white', seen.gameSpecific, 1),
  );
  // Own pieces still count, of course.
  const other = play(['e4', 'c5']);
  assert.notEqual(
    infosetKey(seen.board, 'white', seen.gameSpecific, 1),
    infosetKey(other.board, 'white', other.gameSpecific, 1),
  );
});

test('transpositions share a key: the mover sees a position, not a history', () => {
  const a = play(['d4', 'Na6', 'Nf3', 'Nb8']);
  const b = play(['Nf3', 'Na6', 'd4', 'Nb8']);
  assert.equal(
    infosetKey(a.board, 'white', a.gameSpecific, 0),
    infosetKey(b.board, 'white', b.gameSpecific, 0),
  );
});

test('own castling rights key, and en passant only when it is ours to take', () => {
  const kept = play(['e4', 'a6', 'Nf3', 'b6']);
  const lost = play(['e4', 'a6', 'Ke2', 'b6', 'Ke1', 'c6']);
  // Same white pieces on the same squares in both lines, but the king has been
  // out and back in the second, so white can no longer castle.
  assert.notEqual(
    infosetKey(kept.board, 'white', kept.gameSpecific, 1),
    infosetKey(lost.board, 'white', lost.gameSpecific, 1),
  );

  // A double push next to our pawn is capturable en passant, and the mover knows
  // it — it belongs in the key. The same board reached without the double push
  // must key differently.
  const ep = play(['e4', 'a6', 'e5', 'd5']);
  assert.equal(ep.gameSpecific.enPassantTarget, 'd6');
  const noEp = play(['e4', 'a6', 'e5', 'd6', 'a3', 'd5']);
  assert.equal(noEp.gameSpecific.enPassantTarget, null);
  assert.notEqual(
    infosetKey(ep.board, 'white', ep.gameSpecific, 0),
    infosetKey(noEp.board, 'white', noEp.gameSpecific, 0),
  );
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

  const state = play(['d4', 'Nf6']); // a third hidden reply, unseen by white
  const legal = ChessGame.getLegalActions(state, 'white');
  const res = queryIndex(index, state, 'white', { legalActions: legal });

  const view = res.levels.find(l => l.id === 'view');
  assert.equal(view.total, 2, 'only the two games where white saw nothing');
  assert.deepEqual(view.moves.map(m => m.san), ['Nf3']);
  assert.equal(view.moves[0].games, 2);
  assert.equal(view.moves[0].win, 1);   // game 1, from white's seat
  assert.equal(view.moves[0].loss, 1);  // game 2, likewise

  const own = res.levels.find(l => l.id === 'own');
  assert.equal(own.total, 3, 'the c5 game pools in once the sighting is dropped');
  assert.deepEqual(own.moves.map(m => m.san).sort(), ['Nf3', 'd5']);
  assert.equal(res.best, 'view');
});

test('rows carry a playable action, and rows that are not playable say so', () => {
  // In the recorded game white captured on c5. In OUR game black went elsewhere,
  // so dxc5 is not available — but "same own pieces" still pools that game.
  const index = buildIndex(corpusOf(game('1', ['d4', 'c5', 'dxc5'], '1-0')));
  const state = play(['d4', 'Na6']);
  const legal = ChessGame.getLegalActions(state, 'white');
  const res = queryIndex(index, state, 'white', { legalActions: legal });

  const own = res.levels.find(l => l.id === 'own');
  const row = own.moves.find(m => m.san === 'dxc5');
  assert.ok(row, 'the recorded capture is listed');
  assert.equal(row.move, null, 'but it is not offered as a move here');

  // A row that IS available comes with the real action, grid coordinates and all,
  // so the board can draw and play it.
  const index2 = buildIndex(corpusOf(game('2', ['d4', 'Na6', 'Nf3'], '1-0')));
  const res2 = queryIndex(index2, state, 'white', { legalActions: legal });
  const playable = res2.levels[0].moves.find(m => m.san === 'Nf3');
  assert.equal(playable.move.from, 'g1');
  assert.equal(playable.move.to, 'f3');
  assert.ok(Array.isArray(playable.move.gridFrom));
});

test('a position no recorded game reached answers empty, not wrong', () => {
  const index = buildIndex(corpusOf(game('1', ['d4', 'Na6', 'Nf3'], '1-0')));
  const state = play(['h4', 'Na6']);
  const res = queryIndex(index, state, 'white', { legalActions: [] });
  assert.deepEqual(res.levels.map(l => l.total), [0, 0]);
  assert.equal(res.best, 'view');
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

  const hits = (state, color) =>
    queryIndex(index, state, color, { legalActions: [] }).levels[0].total;
  assert.equal(hits(fresh(), 'white'), 1, 'ply 0 is stored');
  assert.equal(hits(play(['d4']), 'black'), 1, 'ply 1 is stored');
  assert.equal(hits(play(['d4', 'd5']), 'white'), 0, 'ply 2 is past the cap');
});
