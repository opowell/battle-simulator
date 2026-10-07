// Shape-based (non-grid terrain) scenarios for Combat Mission. Each scenario authors
// terrain as an array of rectangles and ovals (see games/terrainShapes.js) and a
// `deploy` table of [unitType, x, y] placements. players[0] fields `allied`, players[1]
// fields `axis`. All maps are 22×16 with a wall border; deployments keep the Allies
// north (low y) and the Axis south (high y). See CombatMissionGame.js.

// All three shape maps are authored at high density (110+ terrain objects each) from a
// shared field grid: a patchwork of small fields, each walled by earthen hedgerow banks.
// Hedges are passable-but-slow cover that does NOT block LOS; woods block LOS; buildings
// and water are impassable. Because hedges are passable the grid stays connected even where
// a field is fully enclosed. Theme features (lanes, river, hamlet, orchards, ponds) are laid
// on top — later shapes win the tile rasterization (see createMapFromShapes).
const FIELD_XS = [[1, 2], [4, 5], [7, 8], [10, 11], [13, 14], [16, 17], [19, 20]]; // 7 field columns
const FIELD_YS = [[1, 2], [4, 5], [7, 8], [10, 11], [13, 14]];                     // 5 field rows
const HEDGE_X  = [3, 6, 9, 12, 15, 18];  // vertical hedgerow banks between the columns
const HEDGE_Y  = [3, 6, 9, 12];          // horizontal hedgerow banks between the rows

// Base terrain: an open tint per field + a hedgerow segment on every field edge (so each
// field reads as a walled enclosure). 35 fields + 30 + 28 hedges = 93 objects before theme.
function fieldGrid() {
  const t = [];
  for (const [x0, x1] of FIELD_XS) for (const [y0, y1] of FIELD_YS)
    t.push({ shape: 'rect', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, kind: 'field' });
  for (const hx of HEDGE_X) for (const [y0, y1] of FIELD_YS)
    t.push({ shape: 'rect', x: hx, y: y0, w: 1, h: y1 - y0 + 1, kind: 'hedge' });
  for (const hy of HEDGE_Y) for (const [x0, x1] of FIELD_XS)
    t.push({ shape: 'rect', x: x0, y: hy, w: x1 - x0 + 1, h: 1, kind: 'hedge' });
  return t;
}

// Rebuild some hedgerow banks as dry-stone walls: the same rule (cover, passable, see-
// through - map.js gives 'stonewall' the hedge tile), drawn as stone. Each [x,y,w,h]
// must be an existing hedge segment, so the field grid's layout is untouched.
function stoneWalls(t, segs) {
  for (const [x, y, w, h] of segs) {
    const hedge = t.find(s => s.kind === 'hedge' && s.x === x && s.y === y && s.w === w && s.h === h);
    if (!hedge) throw new Error(`stoneWalls: no hedge segment at ${x},${y} ${w}x${h}`);
    hedge.kind = 'stonewall';
  }
}

// Standard deploy zones on this grid: Allies on the north fields, Axis on the south.
const GRID_DEPLOY = {
  allied: [
    ['rifle-squad', 1, 1], ['rifle-squad', 7, 1], ['mg-team', 4, 1],
    ['sniper', 10, 1], ['bazooka-team', 13, 1], ['mortar-team', 1, 4],
    ['sherman', 4, 4], ['stuart', 19, 4],
  ],
  axis: [
    ['volks-squad', 1, 14], ['volks-squad', 13, 14], ['mg42-team', 19, 11],
    ['german-sniper', 7, 14], ['panzerschreck', 16, 13], ['mortar-ger', 19, 14],
    ['panzer-iv', 4, 11], ['tiger', 10, 13],
  ],
};

// bocage (DEFAULT) — a sunken-lane crossroads, a stone farm hamlet to fight over, orchards
// and farm ponds over the full hedgerow patchwork.
function buildBocage() {
  const t = fieldGrid();
  const rect = (x, y, w, h, kind) => t.push({ shape: 'rect', x, y, w, h, kind });
  // Sunken lanes, each one unbroken strip (the squares where they cross a hedge line are
  // the open gaps between hedges, so road and open ground rule the same there).
  rect(1, 9, 20, 1, 'road');                                            // E-W lane
  rect(9, 1, 1, 14, 'road');                                            // N-S lane
  rect(9, 9, 1, 1, 'road');                                             // crossroads
  // Copses and ponds fill whole fields: square footprints, so the drawn wood is exactly
  // the squares that block sight (LOS is cast over the tile grid - see los.js).
  rect(1, 4, 2, 2, 'woods'); rect(19, 1, 2, 2, 'woods'); rect(4, 7, 2, 2, 'woods');
  rect(1, 10, 2, 2, 'woods'); rect(19, 13, 2, 2, 'woods'); rect(13, 10, 2, 2, 'woods');
  rect(16, 7, 2, 2, 'woods'); rect(6, 13, 2, 2, 'woods');
  // The farm hamlet: houses and barns, its yards walled in stone rather than hedged.
  stoneWalls(t, [[15, 4, 1, 2], [15, 7, 1, 2], [13, 6, 2, 1], [16, 6, 2, 1], [13, 3, 2, 1], [16, 3, 2, 1]]);
  rect(13, 4, 2, 1, 'building'); rect(16, 4, 2, 1, 'building'); rect(13, 5, 1, 1, 'building');
  rect(16, 5, 2, 1, 'building'); rect(14, 7, 1, 2, 'building'); rect(17, 7, 1, 1, 'building');
  rect(10, 4, 2, 2, 'pond'); rect(7, 10, 2, 2, 'pond');
  return { width: 22, height: 16, terrain: t, deploy: GRID_DEPLOY };
}

// river_line — an impassable river cuts the patchwork in two; a single bridged lane is the
// only crossing. Water does not block LOS, so long guns rule the banks.
function buildRiverLine() {
  const t = fieldGrid();
  const rect = (x, y, w, h, kind, dir) => t.push({ shape: 'rect', x, y, w, h, kind, ...(dir ? { dir } : {}) });
  rect(1, 8, 20, 2, 'water');                                           // the river, bank to bank
  rect(10, 7, 2, 1, 'road'); rect(10, 10, 2, 1, 'road');                // bridge approaches
  rect(10, 8, 2, 2, 'bridge', 'ns');                                    // the one crossing
  rect(2, 4, 2, 2, 'woods'); rect(19, 4, 2, 2, 'woods'); rect(5, 1, 2, 2, 'woods');
  rect(16, 1, 2, 2, 'woods'); rect(2, 12, 2, 2, 'woods'); rect(19, 12, 2, 2, 'woods');
  rect(6, 13, 2, 2, 'woods'); rect(13, 1, 2, 2, 'woods');
  rect(16, 11, 2, 1, 'building'); rect(16, 12, 3, 1, 'building'); rect(4, 5, 2, 1, 'building');
  return { width: 22, height: 16, terrain: t, deploy: GRID_DEPLOY };
}

// hill_woods — the patchwork thickens into wood lots and copses over rolling ground, with a
// lateral track and two farmsteads; woods block LOS, rewarding manoeuvre over static fire.
function buildHillWoods() {
  const t = fieldGrid();
  const rect = (x, y, w, h, kind) => t.push({ shape: 'rect', x, y, w, h, kind });
  rect(1, 9, 20, 1, 'road');                                            // lateral track on y=9
  // Dense wood lots scattered across the fields (block LOS).
  for (const [x, y] of [[1, 1], [7, 1], [13, 1], [19, 1], [4, 4], [16, 4], [10, 4], [1, 7], [19, 7],
                        [4, 10], [16, 10], [10, 10], [1, 13], [13, 13]])
    rect(x, y, 2, 2, 'woods');
  // Two farmsteads, their yards walled in stone.
  stoneWalls(t, [[7, 3, 2, 1], [13, 12, 2, 1]]);
  rect(7, 4, 2, 1, 'building'); rect(7, 5, 1, 1, 'building'); rect(13, 10, 2, 1, 'building'); rect(14, 11, 1, 1, 'building');
  return { width: 22, height: 16, terrain: t, deploy: GRID_DEPLOY };
}

const bocage     = buildBocage();
const river_line = buildRiverLine();
const hill_woods = buildHillWoods();

export const SHAPE_SCENARIOS = { bocage, river_line, hill_woods };
