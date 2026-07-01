import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKingInCheck, isAttackedBy, getVisibleSquares } from './board.js';
import { getAllLegalMoves } from './moves.js';
import { ChessGame } from './index.js';
import { ChessAgent } from './ChessAgent.js';
import { Belief } from './belief.js';
import { GameEngine } from '../../engine/index.js';
import { RandomAgent } from '../../agents/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyBoard() { return {}; }

function unit(id, ownerId, type, position) {
  return { id, ownerId, type, position, alive: true };
}

function gs(castlingRights = null, enPassantTarget = null) {
  return {
    enPassantTarget,
    castlingRights: castlingRights ?? {
      white: { kingSide: false, queenSide: false },
      black: { kingSide: false, queenSide: false },
    },
    halfMoveClock: 0,
    inCheck: false,
  };
}

function movesFrom(board, gameSpecific, color) {
  return getAllLegalMoves(board, color, gameSpecific);
}

// ---------------------------------------------------------------------------
// Pawn
// ---------------------------------------------------------------------------

test('pawn: single push on empty square', () => {
  const board = { e2: unit('wPe', 'white', 'pawn', 'e2') };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(moves.some(m => m.from === 'e2' && m.to === 'e3'));
});

test('pawn: double push from starting rank', () => {
  const board = { e2: unit('wPe', 'white', 'pawn', 'e2') };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(moves.some(m => m.from === 'e2' && m.to === 'e4' && m.isDoublePush));
});

test('pawn: blocked by own piece cannot push', () => {
  const board = {
    e2: unit('wPe', 'white', 'pawn', 'e2'),
    e3: unit('wN', 'white', 'knight', 'e3'),
  };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(!moves.some(m => m.unitId === 'wPe'));
});

test('pawn: diagonal capture', () => {
  const board = {
    e4: unit('wPe', 'white', 'pawn', 'e4'),
    d5: unit('bPd', 'black', 'pawn', 'd5'),
  };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(moves.some(m => m.unitId === 'wPe' && m.to === 'd5' && m.isCapture));
});

test('pawn: en passant capture', () => {
  // Black pawn on e5 just double-pushed; en passant target is e6
  // White pawn on d5 can capture en passant to e6
  const board = {
    d5: unit('wPd', 'white', 'pawn', 'd5'),
    e5: unit('bPe', 'black', 'pawn', 'e5'),
  };
  const moves = movesFrom(board, gs(null, 'e6'), 'white');
  const ep = moves.find(m => m.isEnPassant);
  assert.ok(ep, 'en passant move should exist');
  assert.equal(ep.to, 'e6');
  assert.equal(ep.capturedSquare, 'e5');
});

test('pawn: promotion generates 4 actions', () => {
  const board = { e7: unit('wPe', 'white', 'pawn', 'e7') };
  const moves = movesFrom(board, gs(), 'white');
  const promos = moves.filter(m => m.payload?.promote);
  assert.equal(promos.length, 4);
  assert.ok(promos.some(m => m.payload.promote === 'queen'));
  assert.ok(promos.some(m => m.payload.promote === 'rook'));
});

test('black pawn pushes toward rank 1', () => {
  const board = { e7: unit('bPe', 'black', 'pawn', 'e7') };
  const moves = movesFrom(board, gs(), 'black');
  assert.ok(moves.some(m => m.from === 'e7' && m.to === 'e6'));
  assert.ok(moves.some(m => m.from === 'e7' && m.to === 'e5' && m.isDoublePush));
});

// ---------------------------------------------------------------------------
// Sliding pieces
// ---------------------------------------------------------------------------

test('rook slides along rank and file', () => {
  const board = { a1: unit('wR', 'white', 'rook', 'a1') };
  const moves = movesFrom(board, gs(), 'white');
  // Should reach all squares on a-file and rank 1
  assert.ok(moves.some(m => m.to === 'a8'));
  assert.ok(moves.some(m => m.to === 'h1'));
});

test('rook is blocked by own piece', () => {
  const board = {
    a1: unit('wR', 'white', 'rook', 'a1'),
    a4: unit('wP', 'white', 'pawn', 'a4'),
  };
  const moves = movesFrom(board, gs(), 'white').filter(m => m.unitId === 'wR');
  assert.ok(!moves.some(m => m.to === 'a5'), 'should not reach past own piece');
  assert.ok(moves.some(m => m.to === 'a3'), 'should reach a3');
});

test('bishop slides diagonally', () => {
  const board = { d4: unit('wB', 'white', 'bishop', 'd4') };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(moves.some(m => m.to === 'h8'));
  assert.ok(moves.some(m => m.to === 'a7'));
  assert.ok(moves.some(m => m.to === 'g1'));
});

test('knight jumps over pieces', () => {
  const board = {
    b1: unit('wN', 'white', 'knight', 'b1'),
    a2: unit('wP', 'white', 'pawn', 'a2'),
    b2: unit('wP', 'white', 'pawn', 'b2'),
    c2: unit('wP', 'white', 'pawn', 'c2'),
  };
  const moves = movesFrom(board, gs(), 'white').filter(m => m.unitId === 'wN');
  assert.ok(moves.some(m => m.to === 'a3'));
  assert.ok(moves.some(m => m.to === 'c3'));
});

// ---------------------------------------------------------------------------
// Check detection
// ---------------------------------------------------------------------------

test('isKingInCheck: rook gives check', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    e8: unit('bR', 'black', 'rook', 'e8'),
  };
  assert.ok(isKingInCheck(board, 'white'));
});

test('isKingInCheck: blocked rook does not give check', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    e4: unit('wP', 'white', 'pawn', 'e4'),
    e8: unit('bR', 'black', 'rook', 'e8'),
  };
  assert.ok(!isKingInCheck(board, 'white'));
});

test('move into check is illegal', () => {
  // White king on e1, black rook on e8 — king cannot move to e2 (still on e-file)
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    e8: unit('bR', 'black', 'rook', 'e8'),
  };
  const moves = movesFrom(board, gs(), 'white');
  assert.ok(!moves.some(m => m.unitId === 'wK' && m.to === 'e2'));
  // But king CAN move off the e-file
  assert.ok(moves.some(m => m.unitId === 'wK' && m.to === 'd1'));
});

// ---------------------------------------------------------------------------
// Castling
// ---------------------------------------------------------------------------

test('kingside castling when rights are set and path is clear', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    h1: unit('wR2', 'white', 'rook', 'h1'),
  };
  const rights = { white: { kingSide: true, queenSide: false }, black: { kingSide: false, queenSide: false } };
  const moves = movesFrom(board, gs(rights), 'white');
  assert.ok(moves.some(m => m.type === 'castle' && m.side === 'kingside'));
});

test('castling blocked when path has a piece', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    f1: unit('wB', 'white', 'bishop', 'f1'),
    h1: unit('wR2', 'white', 'rook', 'h1'),
  };
  const rights = { white: { kingSide: true, queenSide: false }, black: { kingSide: false, queenSide: false } };
  const moves = movesFrom(board, gs(rights), 'white');
  assert.ok(!moves.some(m => m.type === 'castle' && m.side === 'kingside'));
});

test('castling blocked when king is in check', () => {
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    h1: unit('wR2', 'white', 'rook', 'h1'),
    e8: unit('bR', 'black', 'rook', 'e8'),  // gives check
  };
  const rights = { white: { kingSide: true, queenSide: false }, black: { kingSide: false, queenSide: false } };
  const moves = movesFrom(board, gs(rights), 'white');
  assert.ok(!moves.some(m => m.type === 'castle'));
});

// ---------------------------------------------------------------------------
// Checkmate and stalemate
// ---------------------------------------------------------------------------

test('checkmate: queen + king corner mate (King c6, Queen b7 vs King a8)', () => {
  // Verified position: Qb7 checks Ka8 diagonally; b8 covered by file, a7 by rank, Qb7 defended by Kc6.
  // All three escape squares (a7, b8, b7-capture) are controlled → checkmate.
  const board = {
    c6: unit('wK', 'white', 'king',  'c6'),
    b7: unit('wQ', 'white', 'queen', 'b7'),
    a8: unit('bK', 'black', 'king',  'a8'),
  };
  const gameSpecific = gs();

  assert.ok(isKingInCheck(board, 'black'), 'black king should be in check');
  const moves = getAllLegalMoves(board, 'black', gameSpecific);
  assert.equal(moves.length, 0, 'black should have no legal moves (checkmate)');
});

test('stalemate: no legal moves and not in check → draw', () => {
  // Classic stalemate: black king in corner, white queen one knight-move away
  const board = {
    a8: unit('bK', 'black', 'king',  'a8'),
    c7: unit('wQ', 'white', 'queen', 'c7'), // controls b8 and b7
    a1: unit('wK', 'white', 'king',  'a1'), // controls nothing relevant
  };
  const gameSpecific = gs();
  assert.ok(!isKingInCheck(board, 'black'), 'black should not be in check');
  const moves = getAllLegalMoves(board, 'black', gameSpecific);
  assert.equal(moves.length, 0, 'black should have no legal moves');
});

// ---------------------------------------------------------------------------
// ChessGame self-play smoke test
// ---------------------------------------------------------------------------

test('chess self-play completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: RandomAgent },
    { id: 'black', name: 'Black', agent: RandomAgent },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 150 });
  const { result } = await engine.run();
  assert.ok(['win', 'draw'].includes(result.outcome));
  assert.ok(typeof result.reason === 'string');
});

// ---------------------------------------------------------------------------
// Fog-of-war belief tracking
// ---------------------------------------------------------------------------

test('belief: a seen enemy piece is pinned to its square', () => {
  const belief = new Belief('white'); // opponent = black
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    c6: unit('bN', 'black', 'knight', 'c6'), // black queenside knight id is 'bN'
  };
  belief.beginTurn(board);
  assert.deepEqual([...belief.pieces.get('bN').possible], ['c6']);
});

test('belief: an unseen pawn is inferred to have advanced into attacking range', () => {
  // Black to move; the entire white half of the board is hidden, so black must
  // reason that white's e-pawn (last "known" on e2 as common knowledge) could
  // have advanced to e4 — from where it would attack f5.
  const belief = new Belief('black'); // opponent = white
  const board = {
    e8: unit('bK', 'black', 'king', 'e8'),
    g8: unit('bN2', 'black', 'knight', 'g8'),
  };
  // Advance a few plies (as in a real opening) so the move budget allows the
  // pawn to be sampled forward, not just inferred.
  for (let i = 0; i < 4; i++) belief.beginTurn(board);

  assert.ok(belief.pieces.get('wPe').possible.has('e4'),
    'e-pawn belief should include e4 after fog advances');

  // Sampling should sometimes realise a concrete world with a white pawn on e4.
  let sawE4Pawn = false;
  for (let i = 0; i < 200 && !sawE4Pawn; i++) {
    for (const p of belief.sample(board, 12)) {
      if (p.e4 && p.e4.ownerId === 'white' && p.e4.type === 'pawn') { sawE4Pawn = true; break; }
    }
  }
  assert.ok(sawE4Pawn, 'a sampled particle should place a white pawn on e4');
});

test('belief: sampled particles never contradict what we can see', () => {
  const belief = new Belief('white');
  const board = {
    e1: unit('wK', 'white', 'king', 'e1'),
    d4: unit('wP', 'white', 'pawn', 'd4'),
    c5: unit('bP', 'black', 'pawn', 'c5'), // a visible black pawn
  };
  belief.beginTurn(board);
  for (const p of belief.sample(board, 12)) {
    // Visible squares must match the observation exactly.
    assert.equal(p.c5?.id, 'bP');
    assert.equal(p.e1?.id, 'wK');
    assert.equal(p.d4?.id, 'wP');
    // No phantom enemy may sit on an empty square we can actually see.
    assert.equal(p.e2, undefined); // e2 is seen (pawn d4 + king reveal nearby); stays empty
  }
});

test('belief: sampled worlds keep most of the hidden army home (no phantom swarm)', () => {
  // The opponent can only have moved as many pieces as moves it has made, so a
  // particle must not place more than that many hidden pieces off their start
  // squares. This is what stops the AI imagining a fully-developed attacking
  // army after a few moves (which made it huddle instead of saving material).
  const belief = new Belief('black'); // opponent = white, fully hidden
  // Black's full starting array: its vision reaches only rank 6, so White's home
  // squares stay hidden and pieces can legitimately be placed at home.
  const board = {};
  const back = [['R','a'],['N','b'],['B','c'],['Q','d'],['K','e'],['B','f'],['N','g'],['R','h']];
  const sym = { R: 'rook', N: 'knight', B: 'bishop', Q: 'queen', K: 'king' };
  for (const [s, f] of back) board[f + '8'] = unit('b' + s + (f > 'e' && s !== 'Q' && s !== 'K' ? '2' : ''), 'black', sym[s], f + '8');
  for (const f of 'abcdefgh') board[f + '7'] = unit('bP' + f, 'black', 'pawn', f + '7');
  belief.beginTurn(board); // black's first turn => white has moved once => oppPlies = 1
  assert.equal(belief.oppPlies, 1);
  for (const p of belief.sample(board, 16)) {
    let movedFromHome = 0;
    for (const sq of Object.keys(p)) {
      const pc = p[sq];
      if (!pc || pc.ownerId !== 'white') continue;
      const anchor = belief.pieces.get(pc.id)?.anchor;
      if (anchor && sq !== anchor) movedFromHome++;
    }
    assert.ok(movedFromHome <= belief.oppPlies, `particle has ${movedFromHome} pieces off home, budget ${belief.oppPlies}`);
  }
});

test('belief: capturing a piece removes it from the belief', () => {
  const belief = new Belief('white');
  const board = {
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bR', 'black', 'rook', 'a8'),
  };
  belief.beginTurn(board);
  belief.commitOurMove({ type: 'move', unitId: 'wR', from: 'a1', to: 'a8', isCapture: true, targetId: 'bR' }, board);
  assert.equal(belief.pieces.get('bR').alive, false);
});

// ---------------------------------------------------------------------------
// Fog-of-war visibility (getVisibleSquares)
// ---------------------------------------------------------------------------

test('fog: pawn does not reveal blocked push square', () => {
  // Scenario from gameplay: white pawn on c4, black bishop on c5.
  // Before the fix, the push square (c5) was always added, leaking the bishop.
  // After the fix, c5 must be invisible because the pawn cannot move there.
  const board = {
    c4: unit('wPc', 'white', 'pawn', 'c4'),
    c5: unit('bB',  'black', 'bishop', 'c5'),
  };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(!visible.has('c5'), 'blocked push square must not be visible');
});

test('fog: pawn reveals unblocked push square', () => {
  const board = {
    c4: unit('wPc', 'white', 'pawn', 'c4'),
  };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(visible.has('c5'), 'clear push square should be visible');
});

test('fog: pawn always reveals diagonal attack squares even when empty', () => {
  const board = {
    c4: unit('wPc', 'white', 'pawn', 'c4'),
    c5: unit('bB',  'black', 'bishop', 'c5'), // blocks push
  };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(visible.has('b5'), 'left diagonal always visible');
  assert.ok(visible.has('d5'), 'right diagonal always visible');
});

test('fog: e4 pawn does not reveal e5 when black pawn blocks it', () => {
  // Regression: white pawn on e4, black pawn on e5. The e5 square must be hidden
  // even though the c1 bishop's diagonal (via d2,e3,f4) reaches nearby squares.
  const board = {
    e1: unit('wK',  'white', 'king',   'e1'),
    c1: unit('wBc', 'white', 'bishop', 'c1'),
    c4: unit('wPc', 'white', 'pawn',   'c4'),
    e4: unit('wPe', 'white', 'pawn',   'e4'),
    d5: unit('wPd', 'white', 'pawn',   'd5'),
    e5: unit('bPe', 'black', 'pawn',   'e5'),
    c6: unit('bN',  'black', 'knight', 'c6'),
    g5: unit('bPg', 'black', 'pawn',   'g5'),
  };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(!visible.has('e5'), 'e5 blocked by own pawn — must not be visible');
  assert.ok(visible.has('c6'), 'c6 visible via d5 pawn diagonal attack');
  assert.ok(visible.has('g5'), 'g5 visible via c1 bishop diagonal');
});

test('fog: pawn does not reveal double-push square when single-push is blocked', () => {
  const board = {
    e2: unit('wPe', 'white', 'pawn', 'e2'),
    e3: unit('bN',  'black', 'knight', 'e3'), // blocks single push
  };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(!visible.has('e3'), 'blocked push square hidden');
  assert.ok(!visible.has('e4'), 'double-push square hidden when single is blocked');
});

test('fog: white pawn on e6 does not reveal e7 when blocked by black pawn', () => {
  // Exact board state from gameplay: 1.d4 bNa6 2.c4 Ra8b8 3.d5 c6 4.e4 f5 5.e5 d6 6.e6 Ke8d7
  // White pawn advanced to e6; black pawn still on e7 (never moved). e7 must be hidden.
  // Moved-from squares are stored as undefined keys (matching real applyActions behaviour).
  const board = {
    a1: unit('wR',  'white', 'rook',   'a1'),
    b1: unit('wN',  'white', 'knight', 'b1'),
    c1: unit('wBc', 'white', 'bishop', 'c1'),
    d1: unit('wQ',  'white', 'queen',  'd1'),
    e1: unit('wK',  'white', 'king',   'e1'),
    f1: unit('wBf', 'white', 'bishop', 'f1'),
    g1: unit('wN2', 'white', 'knight', 'g1'),
    h1: unit('wR2', 'white', 'rook',   'h1'),
    a2: unit('wPa', 'white', 'pawn', 'a2'),
    b2: unit('wPb', 'white', 'pawn', 'b2'),
    c2: undefined, d2: undefined, e2: undefined, d4: undefined, e4: undefined, e5: undefined,
    c4: unit('wPc', 'white', 'pawn', 'c4'),
    d5: unit('wPd', 'white', 'pawn', 'd5'),
    e6: unit('wPe', 'white', 'pawn', 'e6'),
    f2: unit('wPf', 'white', 'pawn', 'f2'),
    g2: unit('wPg', 'white', 'pawn', 'g2'),
    h2: unit('wPh', 'white', 'pawn', 'h2'),
    a6: unit('bNa', 'black', 'knight', 'a6'),
    a7: unit('bPa', 'black', 'pawn',   'a7'),
    a8: undefined,
    b7: unit('bPb', 'black', 'pawn',   'b7'),
    b8: unit('bRa', 'black', 'rook',   'b8'),
    c6: unit('bPc', 'black', 'pawn',   'c6'),
    c7: undefined,
    c8: unit('bBc', 'black', 'bishop', 'c8'),
    d6: unit('bPd', 'black', 'pawn',   'd6'),
    d7: unit('bK',  'black', 'king',   'd7'),
    d8: unit('bQ',  'black', 'queen',  'd8'),
    e7: unit('bPe', 'black', 'pawn',   'e7'), // never moved — must stay hidden
    e8: undefined,
    f5: unit('bPf', 'black', 'pawn',   'f5'),
    f7: undefined,
    f8: unit('bBf', 'black', 'bishop', 'f8'),
    g7: unit('bPg', 'black', 'pawn',   'g7'),
    g8: unit('bN2', 'black', 'knight', 'g8'),
    h7: unit('bPh', 'black', 'pawn',   'h7'),
    h8: unit('bR2', 'black', 'rook',   'h8'),
  };

  const visible = getVisibleSquares(board, 'white');
  assert.ok(!visible.has('e7'), 'e7 blocked by white e6 pawn — must not be visible');
  assert.ok(visible.has('d7'), 'd7 (black king) visible via e6 pawn left-diagonal');
  assert.ok(visible.has('f7'), 'f7 (empty) visible via e6 pawn right-diagonal');
});

// ---------------------------------------------------------------------------
// Fog-of-war state filtering (getVisibleState) — a player NEVER receives state
// information it cannot legitimately see, and debug AI never changes that.
// ---------------------------------------------------------------------------

function fogState(board, { fogOfWar = true, debugAI = false } = {}) {
  return {
    board,
    units: Object.values(board).filter(Boolean),
    players: [{ id: 'white' }, { id: 'black' }],
    gameSpecific: { fogOfWar, debugAI },
  };
}

test('getVisibleState: hidden enemy piece is stripped from a player view', () => {
  // White cannot see a3 (rook a1 stops at its own pawn a2; pawn a2 push is blocked
  // by the bishop; king c1 and pawn b3 do not reach a3), so the bishop must vanish.
  const board = {
    a1: unit('wR',  'white', 'rook',   'a1'),
    a2: unit('wPa', 'white', 'pawn',   'a2'),
    b3: unit('wPb', 'white', 'pawn',   'b3'),
    c1: unit('wK',  'white', 'king',   'c1'),
    a3: unit('bB',  'black', 'bishop', 'a3'),
  };
  const view = ChessGame.getVisibleState(fogState(board), 'white');
  assert.equal(view.board.a3, undefined, 'hidden enemy bishop must be stripped');
  assert.ok(!view.units.some(u => u.id === 'bB'), 'hidden enemy absent from units');
  assert.equal(view.board.a1?.id, 'wR', 'own pieces remain');
});

test('getVisibleState: enemy on a square we can see is kept', () => {
  // Clear a-file: white rook on a1 sees all the way up to the black rook on a8.
  const board = {
    a1: unit('wR', 'white', 'rook', 'a1'),
    a8: unit('bR', 'black', 'rook', 'a8'),
  };
  const view = ChessGame.getVisibleState(fogState(board), 'white');
  assert.equal(view.board.a8?.id, 'bR', 'visible enemy rook is kept');
});

test('getVisibleState: debug AI does NOT reveal the board (only the log is exempt)', () => {
  const board = {
    a1: unit('wR',  'white', 'rook',   'a1'),
    a2: unit('wPa', 'white', 'pawn',   'a2'),
    c1: unit('wK',  'white', 'king',   'c1'),
    a3: unit('bB',  'black', 'bishop', 'a3'),
  };
  const view = ChessGame.getVisibleState(fogState(board, { debugAI: true }), 'white');
  assert.equal(view.board.a3, undefined, 'debug AI must not reveal hidden board pieces');
});

test('getVisibleState: no fog returns the full state unchanged', () => {
  const board = { a3: unit('bB', 'black', 'bishop', 'a3') };
  const state = fogState(board, { fogOfWar: false });
  assert.equal(ChessGame.getVisibleState(state, 'white'), state);
});

test('getVisibleState: visibleSquares excludes a square blocked by a hidden enemy', () => {
  // Screenshot bug: white pawn e4, black pawn e5 (hidden). e5 must be reported as NOT
  // visible (the push is blocked), so the UI fogs it instead of drawing an empty square.
  // The client cannot derive this once e5's pawn is stripped, so the server must send it.
  const board = {
    e1: unit('wK',  'white', 'king', 'e1'),
    d5: unit('wPd', 'white', 'pawn', 'd5'),
    e4: unit('wPe', 'white', 'pawn', 'e4'),
    e5: unit('bPe', 'black', 'pawn', 'e5'),   // hidden blocker
    c6: unit('bNb', 'black', 'knight', 'c6'), // seen via the d5 pawn's diagonal
  };
  const view = ChessGame.getVisibleState(fogState(board), 'white');
  const vis = new Set(view.visibleSquares);
  assert.ok(!vis.has('e5'), 'e5 is blocked by a hidden pawn — must be fogged, not visible');
  assert.equal(view.board.e5, undefined, 'hidden e5 pawn is stripped from the board');
  assert.ok(vis.has('c6'), 'c6 (black knight) is seen via d5 pawn diagonal');
  assert.ok(vis.has('f5'), 'f5 is seen via e4 pawn diagonal');
  assert.ok(vis.has('e6'), 'e6 is seen via d5 pawn diagonal');
});

test('toGrid: emits visible coords in fog mode and omits them otherwise', () => {
  const board = {
    e1: unit('wK',  'white', 'king', 'e1'),
    e4: unit('wPe', 'white', 'pawn', 'e4'),
    e5: unit('bPe', 'black', 'pawn', 'e5'),
  };
  const view = ChessGame.getVisibleState(fogState(board), 'white');
  const grid = ChessGame.toGrid(view);
  const coords = new Set(grid.visible.map(([x, y]) => `${x},${y}`));
  assert.ok(!coords.has('4,3'), 'e5 -> grid [4,3] must not be in the visible set');
  assert.ok(coords.has('5,3'), 'f5 -> grid [5,3] is visible (e4 diagonal)');
  // No fog ⇒ no visibility set is computed.
  assert.equal(ChessGame.toGrid({ board, players: [{ id: 'white' }, { id: 'black' }] }).visible, null);
});

test('fog: an empty square a piece can move to is visible', () => {
  // User rule: empty reachable squares count as visible, not just occupied/attacked ones.
  const board = { d4: unit('wR', 'white', 'rook', 'd4') };
  const visible = getVisibleSquares(board, 'white');
  assert.ok(visible.has('d8'), 'empty square along the rook ray is visible');
  assert.ok(visible.has('h4'), 'empty square along the rook ray is visible');
});

test('chess fog self-play completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ChessAgent },
    { id: 'black', name: 'Black', agent: ChessAgent },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 40, fogOfWar: true, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
});
