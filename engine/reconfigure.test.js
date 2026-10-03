// reconfigure.test.js — changing settings under a game in progress: how a change
// is classified, how units cross between board models, and the engine's guard
// against a move chosen before the change landing after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, EngineReconfigured } from './GameEngine.js';
import { planReconfigure, carriedRoster, rebuiltState, editedState } from './reconfigure.js';
import { ChessGame } from '../games/chess/index.js';

const seats = () => [{ id: 'white', name: 'W' }, { id: 'black', name: 'B' }];

function afterE4() {
  const s = ChessGame.createInitialState(seats(), {});
  const e4 = ChessGame.getLegalActions(s, 'white').find(a => a.from === 'e2' && a.to === 'e4');
  return ChessGame.applyActions(s, [{ playerId: 'white', action: e4 }]);
}

test('a change is classified by what it does to the opening, without asking the game', () => {
  assert.equal(planReconfigure(ChessGame, seats(), {}, {}).kind, 'none');
  const fog = planReconfigure(ChessGame, seats(), {}, { fogOfWar: true });
  assert.equal(fog.kind, 'patch');
  assert.equal(fog.gameSpecific.fogOfWar, true);
  assert.deepEqual(Object.keys(planReconfigure(ChessGame, seats(), { difficulty: 25 }, { difficulty: 80 }).gameSpecific), ['difficulty']);
  assert.equal(planReconfigure(ChessGame, seats(), {}, { space: 'continuous' }).kind, 'rebuild');
  assert.equal(planReconfigure(ChessGame, seats(), {}, { time: 'continuous' }).kind, 'rebuild');
  assert.equal(planReconfigure(ChessGame, seats(), {}, { simultaneousTurns: true }).kind, 'engine');
});

test('a rebuild carries every piece to the same square of the new board, and the turn with it', () => {
  const s = afterE4();
  const cont = rebuiltState(ChessGame, s, seats(), { space: 'continuous' }, carriedRoster(ChessGame, s, seats(), { space: 'continuous' }));
  assert.deepEqual(cont.activePlayers, ['black']);
  assert.equal(cont.units.length, 32);
  const pawn = cont.units.find(u => u.type === 'pawn' && u.cell.x === 4 && u.cell.y === 4);
  assert.deepEqual(pawn.position, { x: 4.5, y: 4.5 });
  assert.ok(ChessGame.getLegalActions(cont, 'black').length > 0);
  // …and back: the pawn is on e4 of a board of squares again.
  const back = rebuiltState(ChessGame, cont, seats(), {}, carriedRoster(ChessGame, cont, seats(), {}));
  assert.equal(back.board.e4?.type, 'pawn');
  assert.deepEqual(back.activePlayers, ['black']);
});

test('units edited in place keep what the game has accumulated', () => {
  // White's king walks out and back: castling is gone for good, home squares or not.
  let s = ChessGame.createInitialState(seats(), {});
  const play = (from, to) => {
    const side = s.activePlayers[0];
    s = ChessGame.applyActions(s, [{ playerId: side, action: ChessGame.getLegalActions(s, side).find(a => a.from === from && a.to === to) }]);
  };
  play('e2', 'e4'); play('e7', 'e5'); play('e1', 'e2'); play('a7', 'a6'); play('e2', 'e1'); play('a6', 'a5');
  assert.equal(s.gameSpecific.castlingRights.white.kingSide, false);
  const roster = s.units.filter(u => u.alive !== false).map(({ id, ownerId, type, position }) => ({ id, ownerId, type, position }))
    .filter(u => !(u.ownerId === 'black' && u.type === 'knight' && u.position === 'b8'));
  const edited = editedState(ChessGame, s, seats(), {}, roster);
  assert.equal(edited.units.length, 31);
  assert.equal(edited.gameSpecific.castlingRights.white.kingSide, false, 'a lost right stays lost');
  assert.deepEqual(edited.activePlayers, s.activePlayers);
  assert.equal(edited.board.b8, undefined);
});

test('a move chosen before a reconfigure is dropped, not played on the new position', async () => {
  let release;
  const slow = { chooseAction: (_s, legal) => new Promise(r => { release = () => r(legal[0]); }) };
  const engine = new GameEngine(ChessGame, [{ id: 'white', name: 'W', agent: slow }, { id: 'black', name: 'B', agent: slow }], {});
  engine._init();
  const step = engine.step();
  await new Promise(r => setImmediate(r));
  const fogged = { fogOfWar: true };
  engine.reconfigure({ config: fogged, gameSpecific: { fogOfWar: true } });
  release();
  await assert.rejects(step, EngineReconfigured);
  assert.equal(engine.log.length, 0, 'nothing was played');
  assert.equal(engine.state.gameSpecific.fogOfWar, true, 'and the patch stands');
});

test('history replays a settings patch at the ply it landed', async () => {
  const first = (_s, legal) => legal[0];
  const engine = new GameEngine(ChessGame, [{ id: 'white', name: 'W', agent: { chooseAction: first } }, { id: 'black', name: 'B', agent: { chooseAction: first } }], {});
  engine._init();
  await engine.step();
  engine.reconfigure({ config: { difficulty: 90 }, gameSpecific: { difficulty: 90 } });
  await engine.step();
  const states = engine.replayStates();
  assert.equal(states.length, 3);
  assert.equal(states[0].gameSpecific.difficulty, 25, 'before the patch, as it was played');
  assert.equal(states[1].gameSpecific.difficulty, 90, 'from the ply it landed at');
  assert.equal(states[2].gameSpecific.difficulty, 90);
  // A take-back to before it drops it, along with the moves after it.
  engine.rewindTo(0);
  assert.equal(engine.state.gameSpecific.difficulty, 25);
  assert.equal(engine.patches.length, 0);
});
