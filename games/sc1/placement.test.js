// Units are put down beside a structure, never on the plate it draws (placement.js):
// at the opening, when a building finishes a unit, and in a customised starting roster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sc1Game, UNITS } from './index.js';
import { footprint, footprintUnder, onFootprint, ringR } from './placement.js';
import { buildInitialState } from '../../engine/startingSetup.js';
import { rosterFromState } from '../../engine/startingSetup.js';
import { num } from '../coord.js';

const players = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const opening = (config) => Sc1Game.createInitialState(players, config);

// Every unit clear of every structure: not its centre, its whole ring.
function assertClear(state, label) {
  for (const u of state.units.filter(x => x.alive)) {
    const b = footprintUnder(u, state.buildings);
    assert.equal(b, null,
      `${label}: ${u.type} ${u.id} at (${u.position.x}, ${u.position.y}) stands on ${b?.type} ${b?.id}`);
  }
}

for (const sc of Sc1Game.scenarios) {
  test(`sc1 ${sc.id}: no starting unit stands on a building's footprint`, () => {
    assertClear(opening(sc.config), sc.id);
  });

  test(`sc1 ${sc.id}: the starting workers stand between their base and its minerals, and can mine at once`, () => {
    const s = opening(sc.config);
    const mineralCentres = Object.entries(s.board.tiles)
      .filter(([, t]) => t.terrain === 'minerals')
      .map(([k]) => k.split(',').map(Number).map(v => v + 0.5));
    const nearestMineral = (x, y) => Math.min(...mineralCentres.map(([mx, my]) => Math.hypot(mx - x, my - y)));
    for (const p of players) {
      const base = s.buildings.find(b => b.ownerId === p.id);
      const f = footprint(base);
      const workers = s.units.filter(u => u.ownerId === p.id && UNITS[u.type].special.includes('worker'));
      assert.equal(workers.length, 4);
      const gatherers = new Set(Sc1Game.getLegalActions(s, p.id)
        .filter(a => a.type === 'gather-minerals').map(a => a.unitId));
      for (const w of workers) {
        const x = num(w.position.x), y = num(w.position.y);
        assert.ok(nearestMineral(x, y) < nearestMineral(f.cx, f.cy), `${w.id} is not on the mineral side of its base`);
        assert.ok(gatherers.has(w.id), `${w.id} cannot gather minerals from where it starts`);
      }
    }
  });
}

test('sc1: starting units do not stand on each other', () => {
  const s = opening({});
  const live = s.units.filter(u => u.alive);
  for (const a of live) for (const b of live) {
    if (a.id >= b.id) continue;
    const d = Math.hypot(num(a.position.x) - num(b.position.x), num(a.position.y) - num(b.position.y));
    assert.ok(d >= ringR(a) + ringR(b), `${a.id} and ${b.id} overlap (${d.toFixed(3)} apart)`);
  }
});

test('sc1: starting positions are exact decimals', () => {
  for (const u of opening({}).units) {
    assert.match(String(u.position.x), /^\d+(\.\d+)?$/);
    assert.ok(String(u.position.x).length <= 6, `${u.id}: ${u.position.x} carries float dust`);
  }
});

test('sc1: a customised roster that puts a unit on the command center gets it put down beside it', () => {
  const base = opening({});
  const cc = base.buildings.find(b => b.ownerId === 'p1');
  const roster = rosterFromState(base);
  // The setup board names a square by its centre — the command center's own square.
  const onIt = { x: String(cc.position.x + 0.5), y: String(cc.position.y + 0.5) };
  const edited = [...roster.map(e => (e.id === 'u2' ? { ...e, position: onIt } : e)),
    { ownerId: 'p1', type: 'marine', position: { x: String(cc.position.x + 1.5), y: String(cc.position.y + 0.5) } }];
  const state = buildInitialState(Sc1Game, players, { startingUnits: edited });
  assert.equal(state.units.length, base.units.length + 1);
  assertClear(state, 'customised');
  // ...and the fog tracker's common knowledge is where they really start.
  const start = new Map(state.gameSpecific.startRoster.units.map(u => [u.id, String(u.position.x) + ',' + String(u.position.y)]));
  for (const u of state.units) assert.equal(start.get(u.id), String(u.position.x) + ',' + String(u.position.y));
});

test('sc1: a unit a building finishes is put down beside it', () => {
  let s = opening({});
  for (let i = 0; i < 6; i++) {
    // Train an SCV (and for p2 a drone) every turn, with money to spare, and keep the
    // base pocket filling up until it has to put them further out.
    s = {
      ...s,
      buildings: s.buildings.map(b => ({ ...b, queue: { unitType: b.ownerId === 'p1' ? 'scv' : 'drone', turnsLeft: 1 } })),
    };
    for (const p of players) s = Sc1Game.applyActions(s, [{ playerId: p.id, action: { type: 'end-turn', unitId: '__player__' } }]);
  }
  assert.equal(s.units.length, opening({}).units.length + 12);
  assertClear(s, 'after training');
});

test('sc1: the footprint is the plate the map draws', () => {
  const s = opening({});
  const cc = s.buildings[0];
  const f = footprint(cc);
  // The command center's own square and the squares round it are under the plate...
  assert.ok(onFootprint(cc.position.x + 0.5, cc.position.y + 0.5, 0, cc));
  assert.ok(onFootprint(cc.position.x + 1.5, cc.position.y + 1.5, 0, cc));
  assert.ok(onFootprint(cc.position.x, cc.position.y + 1, 0, cc));
  // ...two squares out is not.
  assert.ok(!onFootprint(cc.position.x + 2.5, cc.position.y + 0.5, 0, cc));
  assert.ok(f.half > 1 && f.half < 1.1);
});
