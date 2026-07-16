import { isKingInCheck, renderBoard, getVisibleSquares, squareToXY, squareToGrid } from './board.js';
import { getAllLegalMoves, getAllFogMoves } from './moves.js';
import { ChessAgent, evaluate } from './ChessAgent.js';
import { ObscuroAgent } from './ObscuroAgent.js';
import { getBelief } from './belief.js';
import { getExactBelief } from './exactBelief.js';

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
// Fog-of-war square markers: one per-square, per-viewer slot for every square
// that viewer can't currently see, persisted in gameSpecific so it survives
// page reloads and API polling. A square's marker is (re)seeded with whatever
// enemy piece (if any) the viewer last actually saw there — i.e. its occupant
// the moment *before* the square went dark, not after. This matters when a
// square goes dark because the viewer's own piece there was just captured:
// the viewer legitimately learns their piece is gone (it drops out of their
// unit list), but never observed the capturing piece arrive, so it must not
// be seeded from the post-move board — that would leak the identity of
// whatever just captured them. The marker is otherwise freely user-editable
// (see setManualMarker) — there is no separate "confirmed" vs "guessed"
// state, just one square-keyed value that starts out true and can be cycled
// to a different guess at any time. The one exception is when the engine
// itself can rule a guess out with certainty from information it already
// has (ground-truth board + the move just played): a newly-revealed piece
// that's the opponent's only one of its type proves any other same-type
// marker wrong, and watching a tracked piece slide away from a square (still
// along the same line of sight) proves it isn't there anymore either — both
// are pruned/carried forward automatically in updateMarkers. Kept in sync
// once per real move (in applyActions) — never inside getVisibleState,
// which the API re-runs on every poll/reload and must stay a pure function
// of state.
// ---------------------------------------------------------------------------

// Marker values are the single-letter piece codes used by the UI's marker-cycle
// (see SchematicLayer.vue's `MARKER_CYCLE`), not the board's full type names —
// otherwise a freshly-seeded 'pawn' marker wouldn't be found in the cycle and the
// first click would silently reset it to 'p' instead of advancing to the next type.
const TYPE_LETTER = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

function seedMarkers(board) {
  const markers = { white: {}, black: {} };
  for (const viewer of ['white', 'black']) {
    const visible = getVisibleSquares(board, viewer);
    for (const [sq, piece] of Object.entries(board)) {
      // A square in `visible` always either holds the viewer's own piece or is
      // otherwise seen, so anything left over here is a currently-hidden square.
      if (piece && !visible.has(sq)) markers[viewer][sq] = TYPE_LETTER[piece.type];
    }
  }
  return markers;
}

function updateMarkers(prevMarkers, prevBoard, newBoard, moved = []) {
  const next = {};
  for (const viewer of ['white', 'black']) {
    const opponent = viewer === 'white' ? 'black' : 'white';
    const visibleBefore = getVisibleSquares(prevBoard, viewer);
    const visibleAfter  = getVisibleSquares(newBoard, viewer);
    const updated = { ...(prevMarkers[viewer] ?? {}) };
    for (const sq of visibleAfter) delete updated[sq]; // currently seen — the real board shows through
    for (const sq of visibleBefore) {
      if (visibleAfter.has(sq)) continue; // still visible, not a transition
      const priorPiece = prevBoard[sq];
      if (!priorPiece || priorPiece.ownerId === viewer) { delete updated[sq]; continue; }
      // If we watched this exact piece move away this turn (e.g. it was visible
      // sliding along a queen's line and stepped to a square still on that line),
      // we know for certain it isn't still at sq — don't re-seed a stale marker
      // there. Instead carry the marker to wherever it actually went, unless that
      // square is itself visible (then the real board already shows it, no marker
      // needed at all).
      const move = moved.find(m => m.from === sq);
      if (move) {
        // Use the post-move type (not priorPiece's), so a promotion carries the
        // marker over as the new piece, not the pawn it used to be.
        const destType = newBoard[move.to]?.type ?? priorPiece.type;
        if (!visibleAfter.has(move.to)) updated[move.to] = TYPE_LETTER[destType];
        continue;
      }
      // Otherwise seed from what the viewer last actually saw (prevBoard), not the
      // post-move board — otherwise a piece of ours getting captured there would
      // leak the capturing piece's identity, which was never actually observed.
      updated[sq] = TYPE_LETTER[priorPiece.type];
    }
    // A piece newly seen at a square proves it isn't anywhere else. If the opponent
    // has exactly one surviving piece of that type (always true for the king; often
    // true for others before any promotion), any other marker of the same type is
    // now known to be stale and can be dropped rather than left as a ghost.
    for (const sq of visibleAfter) {
      if (visibleBefore.has(sq)) continue; // not newly revealed this move
      const piece = newBoard[sq];
      if (!piece || piece.ownerId !== opponent) continue;
      const remaining = Object.values(newBoard)
        .filter(p => p && p.ownerId === opponent && p.type === piece.type).length;
      if (remaining !== 1) continue;
      const letter = TYPE_LETTER[piece.type];
      for (const markerSq of Object.keys(updated)) {
        if (markerSq !== sq && updated[markerSq] === letter) delete updated[markerSq];
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
    { id: 'initialMarkers', label: 'Initial piece markers', description: "Start with fog markers on every hidden enemy piece's opening square (Fog of War only)", type: 'boolean', default: false },
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
    hideGridLines: true,   // the light/dark checkerboard already delineates squares; extra per-cell borders look busy
    ownTileColors: true,   // tiles are coloured as the checkerboard already — skip the synthetic square overlay
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
        // Per-player, per-square fog markers (see `seedMarkers`/`updateMarkers` above).
        // With `initialMarkers` off (the default) fog starts with no markers at all —
        // the player only accrues them from pieces that actually pass out of view.
        markers: config.fogOfWar
          ? (config.initialMarkers ? seedMarkers(board) : { white: {}, black: {} })
          : undefined,
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

  // NOTE: there is deliberately NO getSearchLegalActions here. The search tree
  // must use the REAL fog action set (pseudo-legal: moving into check is legal,
  // it just loses), because in FoW chess a player's legal-move set is fully
  // determined by its own observation — so every node in one infoset shares one
  // action set, which the Obscuro tree requires. An earlier fix modelled the
  // tree with CHECK-FILTERED moves to stop "opponent hangs its king → phantom
  // win for us" value flips, but that broke the invariant the other way: in the
  // belief worlds where OUR move self-checks (exactly the dangerous ones!) the
  // move vanished from the world's action set and was scored as a neutral pass,
  // so a real king-hang was priced at material value. Self-check is instead
  // handled by the VALUE model: such children evaluate to −SEARCH_WIN for the
  // mover (games/chess/ObscuroAgent.js), new infosets seed to the best child,
  // and CFR then keeps suicide moves out of both players' strategies.

  applyActions(state, playerActions) {
    const { playerId, action } = playerActions[0]; // chess: always 1 active player
    const opponent = playerId === 'white' ? 'black' : 'white';
    let board = { ...state.board };
    let { castlingRights, halfMoveClock } = state.gameSpecific;
    let enPassantTarget = null; // cleared by default
    let moved; // ground-truth {from,to} pairs for updateMarkers — which piece went where

    if (action.type === 'castle') {
      const king = board[action.from];
      const rook = board[action.rookFrom];
      board[action.from] = undefined;
      board[action.to] = { ...king, position: action.to };
      board[action.rookFrom] = undefined;
      board[action.rookTo] = { ...rook, position: action.rookTo };
      castlingRights = updateCastlingRights(castlingRights, king, action.from);
      halfMoveClock++;
      moved = [{ from: action.from, to: action.to }, { from: action.rookFrom, to: action.rookTo }];
    } else {
      // Regular move / capture / en passant / promotion
      const piece = board[action.from];
      board[action.from] = undefined;
      const newType = action.payload?.promote ?? piece.type;
      board[action.to] = { ...piece, position: action.to, type: newType };
      moved = [{ from: action.from, to: action.to }];

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
    const markers = state.gameSpecific.markers
      ? updateMarkers(state.gameSpecific.markers, state.board, board, moved)
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
        aiTimeMs:    state.gameSpecific.aiTimeMs, // carry the per-move time limit forward
        markers,
      },
    };
  },

  // Record or clear a player's fog-square marker. This is UI metadata, not a game action:
  // it doesn't touch the board, consume a turn, or require it to be that player's turn —
  // the engine applies it via `patchState`, bypassing normal action validation.
  setManualMarker(state, playerId, square, type) {
    if (!state.gameSpecific.fogOfWar) return state;
    const prevForPlayer = state.gameSpecific.markers?.[playerId] ?? {};
    const updatedForPlayer = { ...prevForPlayer };
    if (type) updatedForPlayer[square] = type;
    else delete updatedForPlayer[square];
    return {
      ...state,
      gameSpecific: {
        ...state.gameSpecific,
        markers: { ...state.gameSpecific.markers, [playerId]: updatedForPlayer },
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
    // This player's fog markers: one per currently-hidden square, seeded from the last
    // real sighting the instant it went out of view and freely re-cyclable from there
    // (see `updateMarkers`/`setManualMarker`) — there's no separate "confirmed" vs
    // "guessed" state. Persisted in gameSpecific so it survives a page reload, unlike a
    // client-only cache.
    const squareMarkers = state.gameSpecific.markers?.[playerId] ?? {};
    const fogMarkers = Object.entries(squareMarkers)
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
      fogMarkers,
      viewerId: playerId, // so toGrid can tell which colour's sprites a marker should use
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

  // Belief sampler. Preferred source is the EXACT position set P (the paper's
  // belief: every position consistent with the full observation history,
  // exactBelief.js), sampled uniformly — while it holds, the belief is perfect,
  // and |P| = 1 means we literally know the board. If exact tracking has given
  // up (attached mid-game, or P outgrew its cap), we fall back to the heuristic
  // particle tracker (belief.js), which is kept in lockstep every turn so the
  // handover is seamless. With fog off there is nothing hidden, so we return []
  // and the agent treats the position as the single known world.
  sampleWorlds(observation, playerId, n, rng = Math.random) {
    if (!observation.gameSpecific.fogOfWar) return [];
    // turnNumber keys the updates so re-sampling within one decision (e.g. the
    // king-safety guard) can't advance either belief an extra phantom ply.
    const turnKey = observation.turnNumber ?? null;
    const exact = getExactBelief(observation, playerId);
    exact.beginTurn(observation, turnKey);
    const belief = getBelief(observation, playerId);
    belief.beginTurn(observation.board, turnKey);
    // If exact tracking was lost, information may since have collapsed enough
    // (few hidden pieces, small possible-sets) to re-enumerate P from the
    // heuristic belief — a tight superset, still far better than particles.
    if (!exact.exact) exact.tryReacquire(observation, belief, turnKey);
    if (exact.exact) {
      const picks = exact.samplePositions(n, rng);
      if (picks && picks.length) {
        return picks.map(pos => ({
          ...observation,
          board: pos.board,
          units: boardToUnits(pos.board),
          // Position-specific rights/en-passant so in-tree move generation for
          // BOTH sides is exact per world (the heuristic path can't know these).
          gameSpecific: {
            ...observation.gameSpecific,
            castlingRights: pos.cr,
            enPassantTarget: pos.ep,
          },
        }));
      }
    }
    const boards = belief.sample(observation.board, n, rng);
    return boards.map(board => ({
      ...observation,
      board,
      units: boardToUnits(board),
    }));
  },

  // Let both belief trackers record the move we just chose, so next turn they
  // can advance P / detect our own captured pieces.
  onActionCommitted(observation, playerId, action) {
    if (!observation.gameSpecific.fogOfWar) return;
    getExactBelief(observation, playerId).commitOurMove(action);
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
    // Fog markers: server-persisted per-square guess for each hidden square (seeded from
    // the last real sighting, freely re-cyclable — see `updateMarkers`), converted from
    // algebraic squares to the same [x,y] grid coords as `visible`. Always about the
    // opponent, so use the enemy colour's sprites.
    const enemyPrefix = state.viewerId === 'white' ? 'b' : 'w';
    const markers = (state.fogMarkers ?? []).map(m => {
      const fi = FILES.indexOf(m.position[0]);
      const rank = parseInt(m.position.slice(1), 10);
      return { x: fi, y: 8 - rank, type: m.type, imagePath: `/images/chess/${enemyPrefix}${m.type.toUpperCase()}` };
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
    return { width: 8, height: 8, cells, xLabels: FILES.split(''), yLabels: '87654321'.split(''), visible, markers };
  },

  // Convert a grid [col,row] click into the algebraic square setManualMarker expects.
  gridToSquare(col, row) {
    const FILES = 'abcdefgh';
    return `${FILES[col]}${8 - row}`;
  },
};
