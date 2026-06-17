import { isKingInCheck, renderBoard, getVisibleSquares, squareToXY, squareToGrid } from './board.js';
import { getAllLegalMoves, getAllFogMoves } from './moves.js';
import { ChessAgent } from './ChessAgent.js';

// ---------------------------------------------------------------------------
// Initial board setup
// ---------------------------------------------------------------------------

function makeUnit(id, ownerId, type, position) {
  return { id, ownerId, type, position, alive: true };
}

function initialBoard() {
  const board = {};
  const backRank = (color) => color === 'white' ? 1 : 8;
  const pawnRank = (color) => color === 'white' ? 2 : 7;
  const prefix = (color) => color === 'white' ? 'w' : 'b';

  for (const color of ['white', 'black']) {
    const br = backRank(color);
    const pr = pawnRank(color);
    const p = prefix(color);

    const backPieces = [
      ['R', 'rook',   'a'],
      ['N', 'knight', 'b'],
      ['B', 'bishop', 'c'],
      ['Q', 'queen',  'd'],
      ['K', 'king',   'e'],
      ['B', 'bishop', 'f', '2'],
      ['N', 'knight', 'g', '2'],
      ['R', 'rook',   'h', '2'],
    ];
    for (const [sym, type, file, suffix = ''] of backPieces) {
      const sq = file + br;
      board[sq] = makeUnit(p + sym + suffix, color, type, sq);
    }

    for (const file of 'abcdefgh') {
      const sq = file + pr;
      board[sq] = makeUnit(p + 'P' + file, color, 'pawn', sq);
    }
  }
  return board;
}

function boardToUnits(board) {
  return Object.values(board).filter(Boolean);
}

// ---------------------------------------------------------------------------
// applyActions helpers
// ---------------------------------------------------------------------------

function updateCastlingRights(rights, unit, square) {
  let { white, black } = rights;
  if (unit.type === 'king') {
    if (unit.ownerId === 'white') white = { kingSide: false, queenSide: false };
    else black = { kingSide: false, queenSide: false };
  }
  if (unit.type === 'rook') {
    if (square === 'a1') white = { ...white, queenSide: false };
    if (square === 'h1') white = { ...white, kingSide: false };
    if (square === 'a8') black = { ...black, queenSide: false };
    if (square === 'h8') black = { ...black, kingSide: false };
  }
  return { white, black };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const ChessGame = {
  name: 'Chess',
  colors: { light: '#f0d9b5', dark: '#b58863' },
  agents: [
    { id: 'chess-ai', name: 'Chess AI', agent: ChessAgent },
  ],
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only squares their pieces can reach', type: 'boolean', default: false },
  ],
  axisLabels: { x: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  ui: {
    freeSelection:  true,   // any piece can be moved; UI should not pre-pick the "active" unit
    showHpBars:    false,   // pieces don't have HP bars
    showFacing:    false,   // pieces have no facing direction
    gridFog:        true,   // fog of war is square-grid based (not radial blob)
    allowDiagonalHopsWhileMoving: true,
    showRoster:    false,   // hide roster (pieces shown on board)
    showUnitsLost:  true,   // show captured pieces panel
    unitShapes: { king: 'circle', queen: 'circle', rook: 'square', bishop: 'triangle', knight: 'triangle', pawn: 'circle' },
    gridLabelsBottom: true, // file letters read below the board, like algebraic notation
  },

  createInitialState(players, config = {}) {
    const board = initialBoard();
    return {
      gameName: 'Chess',
      turnNumber: 1,
      activePlayers: ['white'],
      currentPhase: 'action',
      players,
      board,
      units: boardToUnits(board),
      lastActions: null,
      gameSpecific: {
        enPassantTarget: null,
        castlingRights: {
          white: { kingSide: true, queenSide: true },
          black: { kingSide: true, queenSide: true },
        },
        halfMoveClock: 0,
        inCheck: false,
        fogOfWar: config.fogOfWar ?? false,
      },
    };
  },

  getLegalActions(state, playerId) {
    const moves = state.gameSpecific.fogOfWar
      ? getAllFogMoves(state.board, playerId, state.gameSpecific)
      : getAllLegalMoves(state.board, playerId, state.gameSpecific);
    // Annotate with display-grid coordinates so the UI works generically without parsing algebraic notation.
    return moves.map(a => ({
      ...a,
      gridFrom: a.from ? squareToGrid(a.from) : undefined,
      gridTo:   a.to   ? squareToGrid(a.to)   : undefined,
    }));
  },

  applyActions(state, playerActions) {
    const { playerId, action } = playerActions[0]; // chess: always 1 active player
    const opponent = playerId === 'white' ? 'black' : 'white';
    let board = { ...state.board };
    let { castlingRights, halfMoveClock } = state.gameSpecific;
    let enPassantTarget = null; // cleared by default

    if (action.type === 'castle') {
      const king = board[action.from];
      const rook = board[action.rookFrom];
      board[action.from] = undefined;
      board[action.to] = { ...king, position: action.to };
      board[action.rookFrom] = undefined;
      board[action.rookTo] = { ...rook, position: action.rookTo };
      castlingRights = updateCastlingRights(castlingRights, king, action.from);
      halfMoveClock++;
    } else {
      // Regular move / capture / en passant / promotion
      const piece = board[action.from];
      board[action.from] = undefined;
      const newType = action.payload?.promote ?? piece.type;
      board[action.to] = { ...piece, position: action.to, type: newType };

      if (action.isEnPassant && action.capturedSquare) {
        board[action.capturedSquare] = undefined;
      }

      // Update half-move clock
      halfMoveClock = (piece.type === 'pawn' || action.isCapture) ? 0 : halfMoveClock + 1;

      // Track en passant target for next move
      if (action.isDoublePush) {
        const fi = action.from.charCodeAt(0) - 'a'.charCodeAt(0);
        const fromRank = parseInt(action.from[1], 10);
        const dir = playerId === 'white' ? 1 : -1;
        enPassantTarget = String.fromCharCode('a'.charCodeAt(0) + fi) + (fromRank + dir);
      }

      // Update castling rights if king or rook moved
      castlingRights = updateCastlingRights(castlingRights, piece, action.from);
      // Also revoke if a rook is captured on its starting square
      if (action.isCapture && action.to) {
        const captured = state.board[action.to];
        if (captured?.type === 'rook') {
          castlingRights = updateCastlingRights(castlingRights, captured, action.to);
        }
      }
    }

    const inCheck = isKingInCheck(board, opponent);
    const newTurn = playerId === 'black' ? state.turnNumber + 1 : state.turnNumber;

    return {
      ...state,
      board,
      units: boardToUnits(board),
      activePlayers: [opponent],
      turnNumber: newTurn,
      lastActions: playerActions,
      gameSpecific: { enPassantTarget, castlingRights, halfMoveClock, inCheck, fogOfWar: state.gameSpecific.fogOfWar },
    };
  },

  getResult(state) {
    if (state.gameSpecific.fogOfWar) {
      // Win by capturing the king; no checkmate or stalemate
      const hasWhiteKing = state.units.some(u => u.ownerId === 'white' && u.type === 'king');
      const hasBlackKing = state.units.some(u => u.ownerId === 'black' && u.type === 'king');
      if (!hasWhiteKing) return { outcome: 'win', winnerId: 'black', reason: 'king-captured' };
      if (!hasBlackKing) return { outcome: 'win', winnerId: 'white', reason: 'king-captured' };
      if (state.gameSpecific.halfMoveClock >= 100) {
        return { outcome: 'draw', winnerId: null, reason: 'fifty-move-rule' };
      }
      return null;
    }
    const [activePlayer] = state.activePlayers;
    const legal = getAllLegalMoves(state.board, activePlayer, state.gameSpecific);
    if (legal.length > 0) {
      if (state.gameSpecific.halfMoveClock >= 100) {
        return { outcome: 'draw', winnerId: null, reason: 'fifty-move-rule' };
      }
      return null;
    }
    // No legal moves
    if (state.gameSpecific.inCheck) {
      const winner = activePlayer === 'white' ? 'black' : 'white';
      return { outcome: 'win', winnerId: winner, reason: 'checkmate' };
    }
    return { outcome: 'draw', winnerId: null, reason: 'stalemate' };
  },

  renderState(state) {
    const { turnNumber, activePlayers, gameSpecific } = state;
    const fogNote = gameSpecific.fogOfWar ? ' [Fog of War]' : '';
    const check = (!gameSpecific.fogOfWar && gameSpecific.inCheck) ? ' (CHECK)' : '';
    return [
      `Turn ${turnNumber} — ${activePlayers[0]} to move${check}${fogNote}`,
      renderBoard(state.board),
    ].join('\n');
  },

  getBattleSummary(finalState, _log) {
    const STARTING_PIECES = 16;
    return {
      turns: finalState.turnNumber,
      teams: finalState.players.map(p => {
        const remaining = finalState.units.filter(u => u.ownerId === p.id).length;
        return {
          id: p.id,
          name: p.name,
          piecesLost: STARTING_PIECES - remaining,
          piecesRemaining: remaining,
        };
      }),
    };
  },

  getActionDuration(_state, action) {
    // Speed in squares per second: faster pieces complete moves sooner.
    const PIECE_SPEED = { queen: 5, rook: 4, bishop: 4, knight: 3, king: 2, pawn: 1 };
    const from = action.from ?? action.rookFrom;
    const to   = action.to   ?? action.rookTo;
    if (!from || !to) return 1;
    const a = squareToXY(from), b = squareToXY(to);
    const dist = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    // Look up the piece type from the action's unitId prefix (e.g. 'wQ' → queen)
    const pieceSymbol = action.unitId?.slice(1, 2)?.toLowerCase() ?? '';
    const typeMap = { r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king', p: 'pawn' };
    const speed = PIECE_SPEED[typeMap[pieceSymbol]] ?? 2;
    return dist / speed;
  },

  getVisibleState(state, playerId) {
    if (!state.gameSpecific.fogOfWar) return state;
    const visible = getVisibleSquares(state.board, playerId);
    const filteredBoard = { ...state.board };
    for (const sq of Object.keys(filteredBoard)) {
      const piece = filteredBoard[sq];
      if (piece && piece.ownerId !== playerId && !visible.has(sq)) {
        filteredBoard[sq] = undefined;
      }
    }
    return {
      ...state,
      board: filteredBoard,
      units: boardToUnits(filteredBoard),
    };
  },

  toGrid(state) {
    const FILES = 'abcdefgh';
    const SYMS = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const cells = [];
    for (let rank = 1; rank <= 8; rank++) {
      for (let fi = 0; fi < 8; fi++) {
        const piece = state.board?.[FILES[fi] + rank];
        const sq = (fi + rank) % 2 === 0 ? 'light' : 'dark';
        const sym = piece ? (SYMS[piece.type] ?? piece.type[0].toUpperCase()) : '';
        cells.push({
          x: fi, y: 8 - rank,
          glyph: sym,
          owner: piece ? (pidIdx[piece.ownerId] ?? 0) : 0,
          color: this.colors[sq] ?? '#808070',
          unitId: piece?.id,
          imagePath: piece ? `/images/chess/${piece.ownerId === 'white' ? 'w' : 'b'}${sym}` : null,
        });
      }
    }
    return { width: 8, height: 8, cells, xLabels: FILES.split(''), yLabels: '87654321'.split('') };
  },
};
