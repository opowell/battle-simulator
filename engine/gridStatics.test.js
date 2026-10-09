import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripStatics, stripBodyStatics, haveFromHeader, staticKey, socketHolder } from './gridStatics.js';

const shapes = [{ shape: 'rect', x: 1, y: 1, w: 2, h: 2, fill: '#000' }];

// A socket: what it named on connecting, plus whatever it has been sent since.
const send = (grid, sock) => stripStatics(grid, sock.has, sock.sent);

test('a connection is sent the shapes once, then their key only', () => {
  const sock = socketHolder(null);
  const grid = { width: 4, shapes, cells: [{ x: 0 }] };
  const first = send(grid, sock);
  assert.deepEqual(first.shapes, shapes, 'the first board carries them');
  assert.equal(first.statics.shapes, staticKey(shapes));
  const second = send({ ...grid, cells: [{ x: 1 }] }, sock);
  assert.equal(second.shapes, undefined, 'a later board leaves them out');
  assert.equal(second.statics.shapes, first.statics.shapes, 'but still names them');
  assert.deepEqual(grid.shapes, shapes, 'the game\'s own grid is never edited');
  sock.forget();
  assert.deepEqual(send(grid, sock).shapes, shapes, 'a resync sends them again');
});

test('a socket that names what it holds on connecting is never sent it', () => {
  const sock = socketHolder(`zzz,${staticKey(shapes)}`);
  assert.equal(send({ shapes }, sock).shapes, undefined);
  assert.deepEqual(send({ shapes }, socketHolder('')).shapes, shapes, 'an empty name holds nothing');
});

test('the key follows the content, so a changed field is sent again', () => {
  const sock = socketHolder(null);
  send({ shapes }, sock);
  const moved = [{ ...shapes[0], x: 2 }];
  const out = send({ shapes: moved }, sock);
  assert.deepEqual(out.shapes, moved);
  assert.notEqual(out.statics.shapes, staticKey(shapes));
  // An equal copy is the same content: the key matches and it is left out.
  assert.equal(send({ shapes: moved.map(s => ({ ...s })) }, sock).shapes, undefined);
});

test('any other field is static once a game hands back the same object again', () => {
  const cells = [{ x: 0, terrain: 'open' }];
  const sock = socketHolder(null);
  const a = send({ cells, units: [{ id: 'a' }] }, sock);
  assert.equal(a.statics, undefined, 'seen once: nothing is known about it yet');
  const b = send({ cells, units: [{ id: 'a' }] }, sock);
  assert.deepEqual(b.cells, cells, 'seen twice: keyed, and sent with its key');
  assert.equal(b.statics.cells, staticKey(cells));
  assert.equal(b.statics.units, undefined, 'a field rebuilt every time is never keyed');
  const c = send({ cells, units: [{ id: 'a' }] }, sock);
  assert.equal(c.cells, undefined, 'then left out');
  assert.deepEqual(c.units, [{ id: 'a' }]);
});

test('a REST caller gets left out only what its X-Grid-Have header names', () => {
  const body = { id: 's', grid: { shapes, los: { blockShapes: [] } }, session: { grid: { shapes } } };
  const plain = stripBodyStatics(body, haveFromHeader(undefined));
  assert.deepEqual(plain.grid.shapes, shapes, 'no header: whole boards');
  assert.ok(plain.grid.statics.shapes && plain.grid.statics.los, 'named by key all the same');
  const have = stripBodyStatics(body, haveFromHeader(` ${staticKey(shapes)} ,nonsense`));
  assert.equal(have.grid.shapes, undefined);
  assert.deepEqual(have.grid.los, { blockShapes: [] }, 'what it does not hold still comes');
  assert.equal(have.session.grid.shapes, undefined, 'a reconfigure\'s board too');
  assert.deepEqual(body.grid.shapes, shapes, 'the body handed in is untouched');
  assert.equal(stripBodyStatics([1, 2], haveFromHeader('')).length, 2, 'non-board bodies pass through');
  // A history page's whole boards; its diffs are left alone.
  const page = { frames: [{ full: { shapes, cells: [] } }, { patch: [[0, {}]] }] };
  const lean = stripBodyStatics(page, haveFromHeader(staticKey(shapes)));
  assert.equal(lean.frames[0].full.shapes, undefined);
  assert.equal(lean.frames[0].full.statics.shapes, staticKey(shapes));
  assert.equal(lean.frames[1], page.frames[1]);
});
