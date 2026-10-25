import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattleGame } from './BattleGame.js';
import { checkSpec, resolveSpec } from './spec.js';

// Pieces that move by patterns and take by moving (patterns.js), under the check
// rule: the standard board game of kings, written as a spec.
const G = makeBattleGame({ name: 'PatternTest' });
const P = [{ id: 'w', name: 'White' }, { id: 'b', name: 'Black' }];

const PIECE = { hp: 1, attack: 1, defense: 1, range: 1, speed: 1, rate: 1, vision: 8 };
const KINGS = {
  unitTypes: {
    king:   { ...PIECE, name: 'King', glyph: 'K', tags: ['royal'], moves: [{ steps: [[0, 1], [1, 1]] }], castle: { with: 'rook', steps: 2 } },
    queen:  { ...PIECE, name: 'Queen', glyph: 'Q', attack: 9, defense: 9, moves: [{ steps: [[0, 1], [1, 1]], slides: true }] },
    rook:   { ...PIECE, name: 'Rook', glyph: 'R', attack: 5, defense: 5, moves: [{ steps: [[0, 1]], slides: true }] },
    bishop: { ...PIECE, name: 'Bishop', glyph: 'B', attack: 3, defense: 3, moves: [{ steps: [[1, 1]], slides: true }] },
    knight: { ...PIECE, name: 'Knight', glyph: 'N', attack: 3, defense: 3, moves: [{ steps: [[1, 2]] }] },
    pawn: {
      ...PIECE, name: 'Pawn', glyph: 'P',
      moves: [
        { steps: [[0, 1]], symmetric: false, capture: false },
        { steps: [[0, 1]], symmetric: false, capture: false, slides: true, range: 2, unmoved: true },
        { steps: [[1, 1]], symmetric: 'mirror', capture: 'only', enPassant: true },
      ],
      promote: { to: ['queen', 'rook', 'bishop', 'knight'] },
    },
  },
  forward: ['up', 'down'],
  turn: { units: 1 },
  victory: [{ type: 'royal', tag: 'royal', check: true }],
};
const BACK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
const OPENING = [
  ...BACK.map((type, x) => ({ type, seat: 0, at: [x, 7] })), ...BACK.map((_, x) => ({ type: 'pawn', seat: 0, at: [x, 6] })),
  ...BACK.map((type, x) => ({ type, seat: 1, at: [x, 0] })), ...BACK.map((_, x) => ({ type: 'pawn', seat: 1, at: [x, 1] })),
];
const spec = (units = OPENING, extra = {}) => ({ ...KINGS, board: { topology: 'square', width: 8, height: 8, generator: 'open' }, units, ...extra });

const sq = (s) => ({ x: 'abcdefgh'.indexOf(s[0]), y: 8 - Number(s[1]) });
const start = (units, config = {}) => G.createInitialState(P, { spec: spec(units), ...config });
const at = (s, square) => { const c = sq(square); return s.units.find(u => u.alive && u.position.x === c.x && u.position.y === c.y); };
const moves = (s, pid, square) => G.getLegalActions(s, pid).filter(a => a.type === 'move' && a.unitId === at(s, square)?.id);
const targets = (s, pid, square) => moves(s, pid, square).map(a => 'abcdefgh'[a.to.x] + (8 - a.to.y)).sort();
// Plays "e2e4"-style moves in turn, white first; `=q` promotes.
function play(s, ...list) {
  for (const m of list) {
    const pid = s.activePlayers[0];
    const from = m.slice(0, 2), to = sq(m.slice(2, 4)), promote = m.split('=')[1];
    const a = moves(s, pid, from).find(x => x.to.x === to.x && x.to.y === to.y && (!promote || x.promote === { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[promote]));
    assert.ok(a, `${m} is legal for ${pid}`);
    s = G.applyActions(s, [{ playerId: pid, action: a }]);
  }
  return s;
}
const place = (list) => list.map(([type, seat, square]) => ({ type, seat, at: (({ x, y }) => [x, y])(sq(square)) }));

test('the spec checks: patterns, promotion, castling, forward and a turn of one unit', () => {
  assert.deepEqual(checkSpec(resolveSpec(spec())), []);
  const errs = checkSpec(resolveSpec({ ...spec(), forward: ['north'], turn: { units: 0 },
    unitTypes: { ...KINGS.unitTypes, odd: { ...PIECE, moves: [{ steps: [[0, 0]], capture: 'maybe' }], promote: { to: ['dragon'] }, castle: { with: 'tower' } } } }));
  for (const want of [/forward\[0\]/, /turn.units/, /moves\[0\].steps/, /moves\[0\].capture/, /promote.to: no unit type "dragon"/, /castle.with: no unit type "tower"/]) {
    assert.ok(errs.some(e => want.test(e)), `${want} in ${errs.join(' | ')}`);
  }
});

test('pieces move by their patterns from the opening: a pawn one or two ahead, a knight jumps, the rest are boxed in', () => {
  const s = start();
  assert.deepEqual(targets(s, 'w', 'e2'), ['e3', 'e4']);
  assert.deepEqual(targets(s, 'w', 'g1'), ['f3', 'h3']);
  assert.deepEqual(targets(s, 'w', 'a1'), []);
  assert.deepEqual(targets(s, 'w', 'd1'), []);
  assert.equal(G.getLegalActions(s, 'w').filter(a => a.type === 'move').length, 20);
  assert.ok(!G.getLegalActions(s, 'w').some(a => a.type === 'attack'), 'a piece takes by moving, never by striking');
  assert.ok(!G.getLegalActions(s, 'w').some(a => a.type === 'end-turn'), 'a side that can move may not pass');
  assert.deepEqual(targets(s, 'b', 'e7'), ['e5', 'e6'], 'the other side advances the other way');
});

test('one unit a turn: a move hands the turn over by itself', () => {
  let s = start();
  s = play(s, 'e2e4');
  assert.deepEqual(s.activePlayers, ['b']);
  s = play(s, 'e7e6');
  assert.deepEqual(targets(s, 'w', 'e4'), ['e5'], 'once a pawn has moved it steps one');
  s = play(s, 'g1f3');
  assert.deepEqual(s.activePlayers, ['b']);
  assert.equal(s.turnNumber, 2);
});

test('a session may lift the limit: every unit moves, and the side ends its own turn', () => {
  let s = start(undefined, { unitsPerTurn: '0' });
  s = play(s, 'e2e4');
  assert.deepEqual(s.activePlayers, ['w'], 'still white: no limit');
  s = play(s, 'd2d4');
  assert.ok(G.getLegalActions(s, 'w').some(a => a.type === 'end-turn'), 'having played, it may pass');
});

test('taking by moving removes the piece; a pawn takes only on its diagonals', () => {
  let s = start();
  s = play(s, 'e2e4', 'd7d5');
  assert.deepEqual(targets(s, 'w', 'e4'), ['d5', 'e5']);
  const take = moves(s, 'w', 'e4').find(a => a.to.x === 3);
  assert.equal(take.capture, true);
  assert.ok(take.targetId, 'a capture names its target, as a strike does');
  s = play(s, 'e4d5');
  assert.equal(at(s, 'd5').ownerId, 'w');
  assert.equal(s.units.filter(u => !u.alive).length, 1);
  assert.equal(s.gameSpecific.alive.b, 15);
});

test('check: a move may not leave the king threatened, and a side in check must answer it', () => {
  let s = start(place([['king', 0, 'e1'], ['rook', 0, 'a2'], ['king', 1, 'e8'], ['rook', 1, 'e5'], ['bishop', 0, 'c3']]));
  // White is in check from the rook on e5: only answers are legal.
  const all = G.getLegalActions(s, 'w').map(a => `${at(s, 'abcdefgh'[a.from.x] + (8 - a.from.y)).type}-${'abcdefgh'[a.to.x]}${8 - a.to.y}`).sort();
  assert.deepEqual(all, ['bishop-e5', 'king-d1', 'king-d2', 'king-f1', 'king-f2', 'rook-e2']);
});

test('checkmate and stalemate end the game', () => {
  // Fool's mate.
  let s = start();
  s = play(s, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepEqual(G.getResult(s), { outcome: 'win', winnerId: 'b', reason: 'checkmate' });
  assert.deepEqual(G.getLegalActions(s, 'w'), []);
  // Black king in the corner, boxed in by a queen that gives no check.
  s = start(place([['king', 0, 'f7'], ['queen', 0, 'g5'], ['king', 1, 'h8'], ['pawn', 0, 'a2']]));
  s = play(s, 'g5g6');
  assert.deepEqual(G.getResult(s), { outcome: 'draw', winnerId: null, reason: 'stalemate' });
});

test('castling: over empty squares, never through a threatened one; the rook lands on the square crossed', () => {
  let s = start(place([['king', 0, 'e1'], ['rook', 0, 'h1'], ['rook', 0, 'a1'], ['king', 1, 'e8'], ['rook', 1, 'd8']]));
  const castles = G.getLegalActions(s, 'w').filter(a => a.castle);
  assert.equal(castles.length, 1, 'not queenside: d1 is threatened');
  s = G.applyActions(s, [{ playerId: 'w', action: castles[0] }]);
  assert.equal(at(s, 'g1').type, 'king');
  assert.equal(at(s, 'f1').type, 'rook');
  // A king that has moved may not castle.
  s = start(place([['king', 0, 'e1'], ['rook', 0, 'h1'], ['king', 1, 'e8'], ['pawn', 1, 'a7']]));
  s = play(s, 'e1e2', 'a7a6', 'e2e1', 'a6a5');
  assert.ok(!G.getLegalActions(s, 'w').some(a => a.castle));
});

test('en passant: a pawn that slid past may be taken on the square it crossed, the next turn only', () => {
  const board = place([['king', 0, 'e1'], ['pawn', 0, 'e2'], ['king', 1, 'e8'], ['pawn', 1, 'd7'], ['pawn', 1, 'h7']]);
  let s = play(start(board), 'e2e4', 'h7h6', 'e4e5', 'd7d5');
  assert.deepEqual(targets(s, 'w', 'e5'), ['d6', 'e6']);
  s = play(s, 'e5d6');
  assert.equal(s.units.find(u => u.type === 'pawn' && u.ownerId === 'b' && u.position.x === 3)?.alive ?? false, false, 'the pawn on d5 is taken');
  s = play(start(board), 'e2e4', 'h7h6', 'e4e5', 'd7d5', 'e1f1', 'h6h5');
  assert.deepEqual(targets(s, 'w', 'e5'), ['e6'], 'a turn later the chance is gone');
});

test('promotion: one move a piece it may become, the first listed first', () => {
  let s = start(place([['king', 0, 'e1'], ['pawn', 0, 'a7'], ['king', 1, 'e8']]));
  const ms = moves(s, 'w', 'a7');
  assert.deepEqual(ms.map(a => a.promote), ['queen', 'rook', 'bishop', 'knight']);
  s = play(s, 'a7a8=n');
  assert.equal(at(s, 'a8').type, 'knight');
  assert.equal(at(s, 'a8').id, ms[0].unitId, 'the same unit, become another');
});

test('off the board of cells or the turns, pieces move by speed and strike like any unit', () => {
  const s = start(place([['king', 0, 'e1'], ['knight', 0, 'b1'], ['king', 1, 'e8']]), { space: 'continuous' });
  const knight = s.units.find(u => u.type === 'knight');
  const ms = G.getLegalActions(s, 'w').filter(a => a.type === 'move' && a.unitId === knight.id);
  assert.ok(ms.length > 2, 'a lattice of points, not a knight\'s two squares');
});

test('the scenario\'s display and board labels reach the board', () => {
  const s = G.createInitialState(P, { spec: { ...spec(), display: { preset: 'board' }, board: { topology: 'square', width: 8, height: 8, generator: 'open', labels: { x: [...'abcdefgh'], y: ['8', '7', '6', '5', '4', '3', '2', '1'] } } } });
  const g = G.toGrid(s);
  assert.deepEqual(g.display, { preset: 'board' });
  assert.equal(g.xLabels[4], 'e');
  assert.equal(g.yLabels[0], '8');
});

test('perft: 20, 400 and 8902 positions one, two and three moves from the opening', () => {
  const perft = (s, d) => {
    const pid = s.activePlayers[0];
    const acts = G.getLegalActions(s, pid).filter(a => a.type !== 'end-turn');
    if (d === 1) return acts.length;
    return acts.reduce((n, a) => n + perft(G.applyActions(s, [{ playerId: pid, action: a }]), d - 1), 0);
  };
  assert.deepEqual([1, 2, 3].map(d => perft(start(), d)), [20, 400, 8902]);
});
