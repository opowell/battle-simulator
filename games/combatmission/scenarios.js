// Shape-based (non-grid terrain) scenarios for Combat Mission. Each scenario authors
// terrain as an array of rectangles and ovals (see games/terrainShapes.js) and a
// `deploy` table of [unitType, x, y] placements. players[0] fields `allied`, players[1]
// fields `axis`. All maps are 22×16 with a wall border; deployments keep the Allies
// north (low y) and the Axis south (high y). See CombatMissionGame.js.

// bocage — Normandy hedgerow country: hedgerow field walls, woods, farmhouses and a
// central road. Hedges give cover without blocking LOS; woods block LOS.
const bocage = {
  width: 22, height: 16,
  terrain: [
    { shape: 'rect', x:  1, y:  7, w: 20, h: 2, kind: 'road'   },
    { shape: 'rect', x:  3, y:  3, w:  8, h: 1, kind: 'hedge'  },
    { shape: 'rect', x: 10, y:  3, w:  1, h: 4, kind: 'hedge'  },
    { shape: 'rect', x: 11, y: 12, w:  8, h: 1, kind: 'hedge'  },
    { shape: 'rect', x: 11, y:  9, w:  1, h: 4, kind: 'hedge'  },
    { shape: 'oval', x: 13, y:  2, w:  5, h: 3, kind: 'woods'  },
    { shape: 'oval', x:  3, y: 11, w:  5, h: 3, kind: 'woods'  },
    { shape: 'rect', x: 16, y: 11, w:  3, h: 3, kind: 'building' },
    { shape: 'rect', x:  3, y:  4, w:  3, h: 2, kind: 'building' },
  ],
  deploy: {
    allied: [
      ['rifle-squad',  1,  2], ['rifle-squad',  8,  1], ['mg-team', 1, 5],
      ['sniper',       6,  1], ['bazooka-team', 2,  2], ['mortar-team', 2, 6],
      ['sherman',     13,  5], ['stuart',      19,  4],
    ],
    axis: [
      ['volks-squad',  2, 14], ['volks-squad', 14, 14], ['mg42-team', 20, 10],
      ['german-sniper', 8, 14], ['panzerschreck', 20, 13], ['mortar-ger', 19, 14],
      ['panzer-iv',    6, 11], ['tiger', 10, 10],
    ],
  },
};

// river_line — an impassable river splits the field; a single bridge (road carved over
// the water) is the only crossing. Water does not block LOS, so long-range guns dominate.
const river_line = {
  width: 22, height: 16,
  terrain: [
    { shape: 'rect', x:  1, y:  7, w: 20, h: 2, kind: 'water'    },
    { shape: 'rect', x: 10, y:  7, w:  2, h: 2, kind: 'road'     },
    { shape: 'oval', x:  3, y: 11, w:  4, h: 3, kind: 'pond'     },
    { shape: 'oval', x: 15, y:  2, w:  5, h: 3, kind: 'woods'    },
    { shape: 'oval', x:  4, y:  2, w:  4, h: 3, kind: 'woods'    },
    { shape: 'rect', x: 16, y: 11, w:  3, h: 3, kind: 'building' },
    { shape: 'rect', x:  9, y: 12, w:  3, h: 2, kind: 'building' },
  ],
  deploy: {
    allied: [
      ['rifle-squad',  2,  3], ['rifle-squad', 10,  2], ['mg-team', 1, 5],
      ['sniper',      12,  1], ['bazooka-team', 9,  5], ['mortar-team', 2, 1],
      ['sherman',     11,  5], ['stuart',      18,  5],
    ],
    axis: [
      ['volks-squad',  2, 14], ['volks-squad', 13, 10], ['mg42-team', 20, 11],
      ['german-sniper', 6, 13], ['panzerschreck', 12, 11], ['mortar-ger', 20, 14],
      ['panzer-iv',    7, 10], ['tiger', 14, 13],
    ],
  },
};

// hill_woods — open rolling ground broken by oval wood clumps and two farmhouses, with a
// lateral track. Woods are passable but block LOS, rewarding manoeuvre over static fire.
const hill_woods = {
  width: 22, height: 16,
  terrain: [
    { shape: 'oval', x:  4, y:  2, w:  4, h: 3, kind: 'woods'    },
    { shape: 'oval', x: 14, y:  3, w:  5, h: 3, kind: 'woods'    },
    { shape: 'oval', x:  8, y:  7, w:  5, h: 3, kind: 'woods'    },
    { shape: 'oval', x:  3, y: 11, w:  4, h: 3, kind: 'woods'    },
    { shape: 'oval', x: 15, y: 11, w:  4, h: 3, kind: 'woods'    },
    { shape: 'rect', x:  9, y:  2, w:  3, h: 2, kind: 'building' },
    { shape: 'rect', x: 10, y: 12, w:  3, h: 2, kind: 'building' },
    { shape: 'rect', x:  1, y:  8, w: 20, h: 1, kind: 'road'     },
  ],
  deploy: {
    allied: [
      ['rifle-squad',  2,  2], ['rifle-squad', 13,  2], ['mg-team', 1, 5],
      ['sniper',       6,  3], ['bazooka-team', 4,  6], ['mortar-team', 1, 1],
      ['sherman',     16,  5], ['stuart',      19,  3],
    ],
    axis: [
      ['volks-squad',  2, 14], ['volks-squad', 14, 12], ['mg42-team', 20, 11],
      ['german-sniper', 5, 12], ['panzerschreck', 8, 13], ['mortar-ger', 20, 14],
      ['panzer-iv',    7, 11], ['tiger', 17, 13],
    ],
  },
};

export const SHAPE_SCENARIOS = { bocage, river_line, hill_woods };
