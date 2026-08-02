// Which SIDE the analysis API answers for — the rule lives in api-server.js's
// resolveAnalysisContext, but it is only observable through a real game, so it
// is exercised here against chess (the only fog game with an analysis panel).
//
// The bug this pins down: while reviewing a historical ply under fog, the panel
// used to answer for the VIEWER's seat regardless of the position, so scrubbing
// back to a black-to-move ply returned white's moves — suggestions that cannot
// be played from the board on screen, drawn on it as arrows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame } from './index.js';
import { resolveAnalysisContext } from '../../api-server.js';

// A stand-in for api-server.js's Session, carrying only what the resolver
// touches: the params/log a historical ply is replayed from, plus the live
// state, fog flag and status that pick the seat.
function fakeSession({ fog = true, status = 'active', plies = 2 } = {}) {
  const players = [{ id: 'white', name: 'You' }, { id: 'black', name: 'CPU' }];
  const config = { fog, fogOfWar: fog };
  let state = ChessGame.createInitialState(players, config);
  const log = [];
  for (let i = 0; i < plies; i++) {
    const mover = state.activePlayers[0];
    const action = ChessGame.getLegalActions(state, mover)[0];
    const playerActions = [{ playerId: mover, action }];
    log.push({ turnNumber: state.turnNumber, phase: 'action', playerActions });
    state = ChessGame.applyActions(state, playerActions);
  }
  return { gameName: 'chess', fog, status, params: { players, config }, engine: { state, log } };
}

const args = (over) => ({ playerId: 'white', agentId: 'chess-ai', ...over });
const ownerOf = (ctx, action) => ctx.viewState.units.find(u => u.id === action.unitId)?.ownerId;

test('historical ply: analysis follows the side to move, not the viewer', () => {
  const session = fakeSession({ fog: true, status: 'done' });
  // ply 1 = the position after white's first move, so BLACK is to move there.
  const ctx = resolveAnalysisContext(session, args({ ply: 1 }));
  assert.equal(ctx.color, 'black');
  assert.ok(ctx.legalActions.length > 0);
  assert.ok(ctx.legalActions.every(a => ownerOf(ctx, a) === 'black'),
    'every suggested move must be playable from the position on screen');
});

test('historical ply: the viewer\'s own turn is analyzed for the viewer', () => {
  const session = fakeSession({ fog: true, status: 'active' });
  const ctx = resolveAnalysisContext(session, args({ ply: 0 }));
  assert.equal(ctx.color, 'white');
});

test('historical ply under LIVE fog: the opponent\'s turn is refused, not mis-answered', () => {
  const session = fakeSession({ fog: true, status: 'active' });
  // Analyzing black here would mean reading black's own view of a game still in
  // progress — real hidden information, not a mere labelling problem.
  assert.throws(() => resolveAnalysisContext(session, args({ ply: 1 })), /black to move/);
});

test('historical ply, no fog: the side to move is analyzed whoever asks', () => {
  const session = fakeSession({ fog: false, status: 'active' });
  assert.equal(resolveAnalysisContext(session, args({ ply: 1 })).color, 'black');
});

test('live position under fog: still analyzed for the viewer mid-opponent-turn', () => {
  // 1 ply played, so the true state says black is to move; the viewer asking
  // "what should I play?" must still get their own side (see the resolver's
  // comment) rather than an error.
  const session = fakeSession({ fog: true, status: 'active', plies: 1 });
  assert.equal(session.engine.state.activePlayers[0], 'black');
  const ctx = resolveAnalysisContext(session, args({ ply: null }));
  assert.equal(ctx.color, 'white');
  assert.ok(ctx.legalActions.every(a => ownerOf(ctx, a) === 'white'));
});

test('fog view is filtered for the side being analyzed', () => {
  const session = fakeSession({ fog: true, status: 'done' });
  const ctx = resolveAnalysisContext(session, args({ ply: 1 }));
  const white = ctx.viewState.units.filter(u => u.ownerId === 'white');
  const black = ctx.viewState.units.filter(u => u.ownerId === 'black');
  assert.equal(black.length, 16, 'black sees all of its own pieces');
  assert.ok(white.length < 16, 'and only the white pieces black can actually see');
});
