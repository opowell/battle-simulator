import { isKingInCheck, renderBoard, getVisibleSquares, squareToXY, squareToGrid } from './board.js';
import { getAllLegalMoves, getAllFogMoves } from './moves.js';
import { ChessAgent, evaluate } from './ChessAgent.js';
import { ObscuroAgent } from './ObscuroAgent.js';
import { getBelief } from './belief.js';

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
// Fog-of-war "ghost" markers: each side's last-known sighting of every enemy
// piece, persisted in gameSpecific so it survives page reloads and API polling.
// Seeded at the common-knowledge starting position, then kept in sync once per
// real move (in applyActions) — never inside getVisibleState, which the API
// re-runs on every poll/reload and must stay a pure function of state.
// ---------------------------------------------------------------------------

function seedFogMarkers(board) {
  const markers = { white: {}, black: {} };
  for (const piece of Object.values(board)) {
    if (!piece) continue; // vacated squares are set to undefined, not deleted
    const viewer = piece.ownerId === 'white' ? 'black' : 'white';
    markers[viewer][piece.id] = { id: piece.id, type: piece.type, position: piece.position };
  }
  return markers;
}

function updateFogMarkers(prevMarkers, board) {
  const next = {};
  for (const viewer of ['white', 'black']) {
    const visible = getVisibleSquares(board, viewer);
    const aliveEnemyIds = new Set(Object.values(board).filter(u => u && u.ownerId !== viewer).map(u => u.id));
    const updated = {};
    for (const [id, m] of Object.entries(prevMarkers[viewer] ?? {})) {
      if (!aliveEnemyIds.has(id)) continue;                                  // captured — drop
      if (visible.has(m.position) && board[m.position]?.id !== id) continue; // proven stale
      updated[id] = m;
    }
    for (const sq of Object.keys(board)) {
      const piece = board[sq];
      if (piece && piece.ownerId !== viewer && visible.has(sq)) {
        updated[piece.id] = { id: piece.id, type: piece.type, position: sq };
      }
    }
    next[viewer] = updated;
  }
  return next;
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
    { id: 'obscuro',  name: 'Obscuro (CFR)', agent: ObscuroAgent },
  ],
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Each side sees only squares their pieces can reach', type: 'boolean', default: false },
    { id: 'debugAI',  label: 'Debug AI',   description: 'Show all AI-controlled pieces even through Fog of War', type: 'boolean', default: false },
    {
      id: 'difficulty', label: 'AI Difficulty', type: 'ai-difficulty', default: 25,
      timeKey: 'aiTimeMs', maxTimeMs: 600000, timeDefault: 5000,
      description: 'Pick ONE: a power level (0 = random … 100 = strongest), or a per-move time limit (0 = random … 10 min). Higher/longer = deeper search, more sampled worlds.',
    },
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
    clearSelectedAtEndOfTurn: true,
    moveAnimation: 'none',
    highlightLastMove: true,
    dragToMove: true,
    highlightSelectedSquare: true, // selection shown as a square tint, not a ring around the piece
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
        fogOfWar:    config.fogOfWar   ?? false,
        debugAI:     config.debugAI    ?? false,
        // Exactly one of difficulty (power 0–100) / aiTimeMs (per-move ms) is
        // active; if a time limit is given it wins and difficulty is left null.
        aiTimeMs:    typeof config.aiTimeMs === 'number' ? config.aiTimeMs : null,
        difficulty:  typeof config.aiTimeMs === 'number' ? null : (config.difficulty ?? 25),
        fogMarkers:  config.fogOfWar ? seedFogMarkers(board) : undefined,
        // Player-placed guesses on squares with no real sighting yet (e.g. "I think the
        // knight went to f6"). Kept server-side, distinct from `fogMarkers` (which only
        // ever holds actually-observed positions), so a reload doesn't lose a guess either.
        manualMarkers: config.fogOfWar ? { white: {}, black: {} } : undefined,
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
    const fogMarkers = state.gameSpecific.fogMarkers
      ? updateFogMarkers(state.gameSpecific.fogMarkers, board)
      : undefined;

    return {
      ...state,
      board,
      units: boardToUnits(board),
      activePlayers: [opponent],
      turnNumber: newTurn,
      lastActions: playerActions,
      gameSpecific: {
        enPassantTarget, castlingRights, halfMoveClock, inCheck,
        fogOfWar:    state.gameSpecific.fogOfWar,
        debugAI:     state.gameSpecific.debugAI,
        difficulty:  state.gameSpecific.difficulty,
        fogMarkers,
        manualMarkers: state.gameSpecific.manualMarkers,
      },
    };
  },

  // Record or clear a player's manual fog-square guess. This is UI metadata, not a game
  // action: it doesn't touch the board, consume a turn, or require it to be that player's
  // turn — the engine applies it via `patchState`, bypassing normal action validation.
  setManualMarker(state, playerId, square, type) {
    if (!state.gameSpecific.fogOfWar) return state;
    const prevForPlayer = state.gameSpecific.manualMarkers?.[playerId] ?? {};
    const updatedForPlayer = { ...prevForPlayer };
    if (type) updatedForPlayer[square] = type;
    else delete updatedForPlayer[square];
    return {
      ...state,
      gameSpecific: {
        ...state.gameSpecific,
        manualMarkers: { ...state.gameSpecific.manualMarkers, [playerId]: updatedForPlayer },
      },
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
    // A player NEVER sees the board through the fog — every requester (human or AI)
    // gets only the squares its own pieces can see. Debug AI does not change this; it
    // only reveals the move log (handled where the log is served), never the board.
    const visible = getVisibleSquares(state.board, playerId);
    const filteredBoard = { ...state.board };
    for (const sq of Object.keys(filteredBoard)) {
      const piece = filteredBoard[sq];
      if (piece && piece.ownerId !== playerId && !visible.has(sq)) {
        filteredBoard[sq] = undefined;
      }
    }
    // Ghost markers: this player's last-known sighting of each hidden enemy piece
    // (seeded at the starting position, updated in applyActions as pieces are seen
    // or lost), for squares the UI should render faded rather than blank. Persisted
    // in gameSpecific so it survives a page reload, unlike a client-only cache.
    const markers = state.gameSpecific.fogMarkers?.[playerId] ?? {};
    const fogGhosts = Object.values(markers).filter(m => !visible.has(m.position));

    // This player's own manual guesses, similarly hidden once their square is actually seen
    // (a real sighting always supersedes a guess there).
    const manual = state.gameSpecific.manualMarkers?.[playerId] ?? {};
    const fogManualMarkers = Object.entries(manual)
      .filter(([sq]) => !visible.has(sq))
      .map(([position, type]) => ({ position, type }));

    return {
      ...state,
      board: filteredBoard,
      units: boardToUnits(filteredBoard),
      // The authoritative set of squares this player can see, computed on the FULL board
      // so hidden enemies still block and occupy. The UI must render fog from this — it
      // cannot re-derive visibility from the filtered board, where a stripped piece (e.g. a
      // hidden pawn on e5 blocking our e4 pawn's push) would wrongly look like empty + seen.
      visibleSquares: [...visible],
      fogGhosts,
      fogManualMarkers,
      viewerId: playerId, // so toGrid can tell which colour's sprites a manual guess should use
    };
  },

  // --- Imperfect-information interface (drives the generic ObscuroAgent) -----

  // Heuristic leaf value of a position to `playerId` (white/black), reusing the
  // chess agent's material + piece-square evaluation.
  evaluateState(state, playerId) {
    return evaluate(state.board, playerId);
  },

  // Canonical identity of a move, so the same opponent reply across different
  // sampled worlds maps to the same payoff-matrix column. from+to(+promotion) is
  // unique per move, including the king's two-square castling hop.
  actionKey(action) {
    const promo = action.payload?.promote ? '=' + action.payload.promote[0] : '';
    return (action.from ?? '') + (action.to ?? '') + promo;
  },

  // Belief sampler: draw up to `n` full boards consistent with what `playerId`
  // can see, via the fog-of-war particle tracker (belief.js). With fog off there
  // is nothing hidden, so we return [] and the agent treats the position as the
  // single known world (perfect-information minimax).
  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    const belief = getBelief(observation, playerId);
    belief.beginTurn(observation.board);
    const boards = belief.sample(observation.board, n, rng);
    return boards.map(board => ({
      ...observation,
      board,
      units: boardToUnits(board),
    }));
  },

  // Let the belief tracker record the move we just chose, so next turn it can
  // detect our own captured pieces and drop enemies we captured.
  onActionCommitted(observation, playerId, action) {
    if (!observation.gameSpecific.fogOfWar) return;
    getBelief(observation, playerId).commitOurMove(action, observation.board);
  },

  toGrid(state) {
    const FILES = 'abcdefgh';
    const SYMS = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
    const pidIdx = {};
    (state.players ?? []).forEach((p, i) => { pidIdx[p.id] = i + 1; });
    const visSet = state.visibleSquares ? new Set(state.visibleSquares) : null;
    const cells = [];
    const visible = visSet ? [] : null; // grid coords [x,y] the player can see (fog mode only)
    // Fog ghosts: server-persisted last-known sighting of each hidden enemy piece,
    // converted from algebraic squares to the same [x,y] grid coords as `visible`.
    const ghosts = (state.fogGhosts ?? []).map(g => {
      const fi = FILES.indexOf(g.position[0]);
      const rank = parseInt(g.position.slice(1), 10);
      const sym = SYMS[g.type] ?? g.type[0].toUpperCase();
      return { x: fi, y: 8 - rank, type: g.type, imagePath: `/images/chess/${g.id[0]}${sym}` };
    });
    // Manual guesses: always about the opponent, so use the enemy colour's sprites.
    const enemyPrefix = state.viewerId === 'white' ? 'b' : 'w';
    const manualMarkers = (state.fogManualMarkers ?? []).map(m => {
      const fi = FILES.indexOf(m.position[0]);
      const rank = parseInt(m.position.slice(1), 10);
      const sym = SYMS[m.type] ?? m.type[0].toUpperCase();
      return { x: fi, y: 8 - rank, type: m.type, imagePath: `/images/chess/${enemyPrefix}${sym}` };
    });
    for (let rank = 1; rank <= 8; rank++) {
      for (let fi = 0; fi < 8; fi++) {
        const algSq = FILES[fi] + rank;
        const piece = state.board?.[algSq];
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
        if (visSet && visSet.has(algSq)) visible.push([fi, 8 - rank]);
      }
    }
    return { width: 8, height: 8, cells, xLabels: FILES.split(''), yLabels: '87654321'.split(''), visible, ghosts, manualMarkers };
  },

  // Convert a grid [col,row] click into the algebraic square setManualMarker expects.
  gridToSquare(col, row) {
    const FILES = 'abcdefgh';
    return `${FILES[col]}${8 - row}`;
  },
};
