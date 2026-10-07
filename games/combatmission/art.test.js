import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatMissionGame } from './index.js';
import { TERRAIN, getTileContinuous } from './map.js';
import { UNIT_DEFS } from './units.js';

// The drawn map is art.js's; the rules' map is map.js's rasterized tiles (LOS, cover,
// the AI's moves) plus its continuous shape lookup (a human's free moves). These pin
// the three together, so a feature can never look like one thing and rule as another.

const players = () => [{ id: 'allied', name: 'Allies' }, { id: 'axis', name: 'Axis' }];
const SCENARIOS = ['bocage', 'river_line', 'hill_woods', 'ambush'];

const TILE_OF_NAME = {
  Building: TERRAIN.WALL, Woods: TERRAIN.TREE, Hedgerow: TERRAIN.HEDGE, 'Stone wall': TERRAIN.HEDGE,
  Road: TERRAIN.ROAD, Bridge: TERRAIN.ROAD, Water: TERRAIN.WATER, Pond: TERRAIN.WATER, Field: TERRAIN.FLOOR,
};

function inside(s, x, y) {
  if (s.shape === 'oval') {
    const nx = (x - s.x - s.w / 2) / (s.w / 2), ny = (y - s.y - s.h / 2) / (s.h / 2);
    return nx * nx + ny * ny <= 1;
  }
  if (s.shape === 'poly') throw new Error('terrain base shapes are rects/ovals');
  return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
}

for (const scenario of SCENARIOS) {
  test(`combatmission art (${scenario}): the terrain drawn on every square is the terrain its rules use`, () => {
    const state = CombatMissionGame.createInitialState(players(), { scenario });
    const { board } = state;
    const named = CombatMissionGame.toGrid(state).shapes.filter(s => s.name);
    for (const s of named) assert.ok(s.name in TILE_OF_NAME, `unknown terrain name ${s.name}`);
    for (let y = 1; y < board.height - 1; y++) {
      for (let x = 1; x < board.width - 1; x++) {
        const top = [...named].reverse().find(s => inside(s, x + 0.5, y + 0.5));
        const drawn = top ? TILE_OF_NAME[top.name] : TERRAIN.FLOOR;
        const rule = board.tiles[y][x];
        // Open ground and road rule the same (no cover, cost 1), so a lane drawn across
        // a hedge-line gap is still exact.
        const same = drawn === rule || (drawn === TERRAIN.ROAD && rule === TERRAIN.FLOOR) ||
                     (drawn === TERRAIN.FLOOR && rule === TERRAIN.ROAD);
        assert.ok(same, `(${x},${y}) drawn ${top?.name ?? 'open ground'} but rules say '${rule}'`);
      }
    }
  });

  test(`combatmission art (${scenario}): free movement sees the same terrain as the tile grid`, () => {
    const { board } = CombatMissionGame.createInitialState(players(), { scenario });
    if (!board.terrainShapes) return; // the hand-laid map's tiles are its only geometry
    for (let y = 1.05; y < board.height - 1; y += 0.1) {
      for (let x = 1.05; x < board.width - 1; x += 0.1) {
        const a = getTileContinuous(board, x, y), b = board.tiles[Math.floor(y)][Math.floor(x)];
        const same = a === b || [a, b].every(t => t === TERRAIN.FLOOR || t === TERRAIN.ROAD);
        assert.ok(same, `(${x.toFixed(2)},${y.toFixed(2)}) continuous '${a}' vs tile '${b}'`);
      }
    }
  });
}

test('combatmission art: decoration is click-transparent and every poly is convex', () => {
  const shapes = CombatMissionGame.toGrid(CombatMissionGame.createInitialState(players())).shapes;
  assert.ok(shapes.filter(s => !s.name).length > shapes.filter(s => s.name).length, 'the map is dressed');
  for (const s of shapes.filter(s => s.shape === 'poly')) {
    const p = s.points; let sign = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
      const cr = Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
      if (cr) { assert.ok(!sign || cr === sign, 'convex poly'); sign = cr; }
    }
  }
});

test('combatmission art: every unit type has a silhouette and a footprint; tanks turn with their heading', () => {
  const state = CombatMissionGame.createInitialState(players());
  const units = CombatMissionGame.toGrid(state).units;
  assert.equal(units.length, state.units.length);
  for (const u of units) {
    assert.ok(u.spriteLayers?.length, `${u.unitName} has a sprite`);
    assert.ok(['circle', 'rect'].includes(u.footprint?.shape), `${u.unitName} has a footprint`);
  }
  for (const type of Object.keys(UNIT_DEFS)) {
    const art = CombatMissionGame.toGrid({ ...state, units: [{ ...state.units[0], type }] }).units[0];
    assert.ok(art.spriteLayers?.length && art.footprint, `${type} has art`);
  }

  // An undeployed tank faces the enemy's side; one driven east faces east.
  const tank = state.units.find(u => u.type === 'sherman');
  const before = units.find(u => u.id === tank.id).footprint.ang;
  assert.ok(Math.abs(before - Math.PI / 2) < 0.01, 'allied armour faces south at deployment');
  const moved = CombatMissionGame.applyActions(state, [{ playerId: 'allied',
    action: { type: 'move', unitId: tank.id, to: { x: Number(tank.position.x) + 2, y: Number(tank.position.y) } } }]);
  const after = CombatMissionGame.toGrid(moved).units.find(u => u.id === tank.id).footprint.ang;
  assert.ok(Math.abs(after) < 0.01, 'faces the way it drove');
});
