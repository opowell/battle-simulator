import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKingInCheck, isAttackedBy } from './board.js';
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
  belief.beginTurn(board); // black's first turn => accounts for white's first move

  assert.ok(belief.pieces.get('wPe').possible.has('e4'),
    'e-pawn belief should include e4 after one ply of fog advance');

  // Sampling should sometimes realise a concrete world with a white pawn on e4.
  let sawE4Pawn = false;
  for (let i = 0; i < 60 && !sawE4Pawn; i++) {
    for (const p of belief.sample(board, 8)) {
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

test('chess fog self-play completes with a valid result', async () => {
  const players = [
    { id: 'white', name: 'White', agent: ChessAgent },
    { id: 'black', name: 'Black', agent: ChessAgent },
  ];
  const engine = new GameEngine(ChessGame, players, { maxTurns: 40, fogOfWar: true, difficulty: 'easy' });
  const { result } = await engine.run();
  assert.ok(result === null || ['win', 'draw'].includes(result.outcome));
});
