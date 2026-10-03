// ── Pre-defined ("fixed") Civ1 maps ──────────────────────────────────────────
//
// Unlike the standard scenario (procedurally generated — see generateMap in
// map.js), these are literal hand-built boards for exercising specific
// rendering/gameplay cases in isolation (e.g. coastline sprites around a small
// island) without fighting the random generator for one.
//
// Each map is authored as ASCII art so the shape is readable at a glance. One
// character per tile; `rows` is a list of equal-length strings, top row first.
// The map's width is the row length and its height is the number of rows.
//
// A map may also carry an optional `rivers` layer: same dimensions as `rows`, with
// '~' marking a tile that has a river (anything else means none). It is a separate
// layer because a river sits *on* a terrain rather than replacing it.
//
// Starting units are `{ side: 1|2, type, x, y }`; side 1 → players[0],
// side 2 → players[1]. Coordinates are 0-indexed from the top-left. A unit may
// also start `veteran` and/or `fortified` (dug in, with the bonus already earned).
//
// A battle rather than a world needs a few more pieces, all optional:
//   cities     `{ side, x, y, name?, size?, buildings? }` standing from turn 1
//   objective  `{ type: 'take-city', attacker: 1|2, defender: 1|2, turns }` — the
//              attacker wins by capturing the defender's city (and so destroying
//              them); the defender wins by still holding it once `turns` rounds
//              are over, or by wiping out the attacking army first
//   revealed   true: both sides know the whole battlefield's terrain from the
//              start (units are still fogged)
//   wrap       false: the map's east and west edges are edges, not one seam — a
//              battlefield is a place, not a world
//   config     the scenario menu entry's config (seats, fog, …), as on any scenario

// Character → engine terrain. `.` is water; the engine has no separate "coast"
// or "lake" terrain, so open sea and inland lakes are all 'ocean' (shallow-water
// shading is a pure rendering effect in toGrid, derived from land-adjacency).
export const TERRAIN_LEGEND = {
  '.': 'ocean',
  'G': 'grassland',
  'P': 'plains',
  'F': 'forest',
  'H': 'hills',
  'M': 'mountains',
  'D': 'desert',
  'T': 'tundra',
  'A': 'arctic',
  'J': 'jungle',
  'S': 'swamp',
};

export const FIXED_MAPS = [
  {
    id: 'island-test',
    name: 'Tiny Island',
    description: 'Fixed 5×5 map: a 3×3 grassland island ringed by ocean — for testing coastline rendering',
    rows: [
      '.....',
      '.GGG.',
      '.GGG.',
      '.GGG.',
      '.....',
    ],
    // Opposite corners of the island so all four starting units land on distinct
    // tiles — the default random near-the-settler placement has no room here.
    units: [
      { side: 1, type: 'settlers', x: 1, y: 1 },
      { side: 1, type: 'militia',  x: 1, y: 2 },
      { side: 2, type: 'settlers', x: 3, y: 3 },
      { side: 2, type: 'militia',  x: 3, y: 2 },
    ],
  },
  {
    id: 'octagon-lake',
    name: 'Octagon Lake',
    description: 'Fixed 13×13 map: a grassland octagon island with a 5×5 diamond lake in its centre, ringed by a 2-tile ocean strip',
    rows: [
      '.............',
      '.............',
      '....GGGGG....',
      '...GGGGGGG...',
      '..GGGG.GGGG..',
      '..GGG...GGG..',
      '..GG.....GG..',
      '..GGG...GGG..',
      '..GGGG.GGGG..',
      '...GGGGGGG...',
      '....GGGGG....',
      '.............',
      '.............',
    ],
    // Opposite sides of the ring of land around the lake.
    units: [
      { side: 1, type: 'settlers', x: 4, y: 4 },
      { side: 1, type: 'militia',  x: 5, y: 4 },
      { side: 2, type: 'settlers', x: 8, y: 8 },
      { side: 2, type: 'militia',  x: 7, y: 8 },
    ],
  },
  {
    id: 'earth',
    name: 'Earth',
    description: 'The real Civ1 world map (80x50), transcribed tile-for-tile from the original game earth map (see images/samples/Civ1_earthmap.webp)',
    // Not transcribed from pixels: read straight out of the original game's own save
    // (dosbox CIVIL0.MAP) via JCivED's parser, so every one of the 4000 tiles is exact.
    // Civ1 encodes River as a terrain type of its own; we carry rivers as a flag, so
    // those tiles become grassland + a river in the layer below.
    rows: [
      'AAAATAAAAAAATAAATTAAAAAAAAATAATTAATTAATAATATATAAAAAAAATATAAAAAAAATAATTAATTAAAAAA',
      '..T....T...............T...TTT.T....T...TT....TT......T....TT.......T....T...T.T',
      '................................................................................',
      '.........................AAAAAAA................................................',
      '...............AA.A.AAA.AAAAAAAA......A.....GG.....TAG..........................',
      '....TTTTA....AAAAAAAA....AAAAAAT.....AA...............AA.....T..................',
      '...TTTTTTTTTAA.A.AAAAA...AAAAAT...............A.....FFAAFFFFF..FFF....FFF.......',
      '.TPTGPPPPTTTTT.TAAA..A...AAAAT...............A..AA.FFGAFFFFFFFAFFFFFFFFFF.T.....',
      '.....PGTPT..TTAAAAAAAA..AAGG..........GAA......G.GFFFGFFFFFFFFAFFAFFFFFGFGG.....',
      '.....GGFGPPTTAA...A.T...AG....A......AFGFPGF.AAFGTGFFFFFFFFFFFFFFFGFFG.GFF......',
      '....PMGFPPPPTT...ATAA...............GFPGGF.FFFFFFGFFFFFFFFFFFFFFGFFFFG..F.......',
      '....PMGFGPP.TTTAATTTT..........H...PFG.GGGFFFGFGGGFFFFFFFFFFFFFFFFFF....FG......',
      '....PHFFGPG.PPP.PTTTT.........GG.....P.GFGFFGFFFGFGFGGFGGFFFGFFFFFFFG....P......',
      '....GGHFGPPPPPPPPPTPP..........F...F...FFFGFFFFGGFPFFPFGPFGFF.FFFFFGPPG.........',
      '...GGGMGGGPPP.PPPPP.P.........GG...GPPFFFGGGFGGGGGFGGGGGPGGFFFFDPPPPPP..........',
      '...GGFMGGGGPG.GGG.P..............GGGGGGFFGFGFGPGPGGGGGPPPPPPPPPPPPPPGPG.........',
      '..GGGMMGGGGGGGG.................GGGMMGGGGPGGPGGPPPPPPPPPPPPPPPPPPPPPGPG.PG......',
      '..GGPPHGGGGGGG..................PGGGGFGGGGPGPD..PP.PPPDPDDDPPPPPPDPPPG..G.......',
      '..GFPPFGGGGGGP................PPPP.GH..GGF...HP.GPPDPDPDDPPPPPPDDPP.PG..MG......',
      '..GPPDDGGGGG..................PPP...GH...GPPPPP.PPPPDPPHPDDDDDDPPPG......P......',
      '..P.GDDP...P.........................G.....PPPPGPPPPPPHHMHHHHHHHHMHPG..G........',
      '..P.GDD....P..................GPPDD........PPGGHPPPDPPHPGHMMMMMHHHPPPG..........',
      '....GDG.......................DPHHPPPG.DP.PPPGGGPPPPPHHGDPGMHHMHHPPGGG..........',
      '....GGP.P...GP...............PPHDDDPPPPDDGGDPPD.PPPPHPGGDGGGHHHHHPGPPP..........',
      '.....GGPG....GP.............PPDDDDDPDDDDDGD.PDD....HHGGDPGGGGGGHGPGGP...........',
      '........GG..................PDDDDDDDDDDDSGS.DDDDDD....PPGGGGGPPGFGGG...G........',
      '.........G.................PDDDDDDPPPDDDDGD..PDDDDP....GGGGG..GGGGG....PG.......',
      '.........PP.GPPG...........DDDDDDDPDDDDDDGDD..DDDD......GGG...PPGG.....GG.......',
      '..........PGFPPPG..........DDDDDDDDPDPDPPDHHD..PD.......GG.....GGGG.....FG......',
      '...........GHGGGGGG........PPDPPPPDDDPPPPPPMDP..G.......PG.......GG......G......',
      '...........HJJJGGGGG........PPDPPPPPPPPPPPPHMDP..........G...........P..........',
      '..........GHJGGJJGGGG........PPPG.PPGPGGGGGGMDDP...................GPP..GP......',
      '..........PGJJGGGGJGFGG............GGGGJJJGG.DPP...............GFG..PGFGGG.G....',
      '...........FGGJJGJJFGGGP...........GGJJGGGGGHPP.................GF..G.PG...PGG..',
      '...........GHGGGGGGGGGG............GGGGGJJH.GG...................G...........GG.',
      '............GMFGGGGGGP..............GGJJJGHMG....................PP.....G.......',
      '............GFMGGFGPPP..............GGGGGGGMP.....................G.......PG....',
      '..............HMGGGPGG...............GGGGGGHG..........................GGPGPGG..',
      '..............GHGGGGG................DPPGGGGGG.........................GGPPPPG..',
      '..............GMGPGG................PPPPPPPGGG.P....................GGPPPDDDPPP.',
      '..............GMGGGP................HPDDPPGG...P...................GGGPDDDDDDPF.',
      '..............PMGGG..................PPDPPGG...G...................GPDDDDDDDDPP.',
      '...............MGP...................HPPPGGG..GP...................GDDDDDPDDDPG.',
      '...............GG....................HPPGHG...P....................DDDDDDDPDDHF.',
      '...............PG.....................DPGHG........................DDD..GDDDHG..',
      '................G.....................PGGG..............................GHHHG...',
      '................F.....................G...................................PG....',
      '................................................................................',
      '...........T.....T.TT.T..T......T..........TT....T.T..T......TT.T.....T....TT...',
      'TAATAAAAAAAAAAAAAATAAAAAAAAAATAAAAAAATAATAAAAAAATAAAATAAAAAAATTTAATAAAAAAAATATTA',
    ],
    // Rivers read off the same source image (land tiles carrying a ribbon of
    // water): the Mississippi, Amazon, Nile, Congo, Danube/Volga and the great
    // Asian rivers all land where you'd expect.
    rivers: [
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                               ~                                                ',
      '                                          ~    ~                                ',
      '                                          ~~ ~~~                                ',
      '        ~ ~   ~~                  ~        ~ ~                                  ',
      '        ~ ~                       ~        ~ ~~                                 ',
      '        ~~~                            ~~  ~                                    ',
      '         ~                              ~                                       ',
      '         ~                                                                      ',
      '                                                                                ',
      '                                             ~~                                 ',
      '                                              ~~       ~           ~~~          ',
      '                                         ~            ~~                        ',
      '                                         ~           ~~    ~                    ',
      '                                         ~                 ~~                   ',
      '                                         ~                                      ',
      '                                         ~                                      ',
      '                                                                                ',
      '                                                                                ',
      '                   ~                                                            ',
      '             ~~  ~~~                                                            ',
      '              ~~~~                                                              ',
      '                                       ~~~                                      ',
      '                                     ~~~                                        ',
      '                                     ~                                          ',
      '                                    ~~                                          ',
      '                  ~                                                             ',
      '                  ~                                                             ',
      '                  ~~                                                            ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
      '                                                                                ',
    ],
    // Opposite hemispheres: North America vs. eastern Asia.
    units: [
      { side: 1, type: 'settlers', x: 8,  y: 16 },
      { side: 1, type: 'militia',  x: 9,  y: 16 },
      { side: 2, type: 'settlers', x: 60, y: 16 },
      { side: 2, type: 'militia',  x: 61, y: 16 },
    ],
  },
  {
    id: 'siege',
    name: 'Siege',
    description: 'A fixed battle: your army of 20 — catapults, legions, knights — has 20 turns to take a coastal city held by 20 defenders',
    // West to east: the attackers' open staging plains, a wooded ridge north and
    // south with a pair of hills on the river crossing between them, the city's two
    // hill outworks, and the city itself on the river mouth with the sea at its back
    // — so it can only be approached from the west. The map does not wrap.
    rows: [
      '........................',
      '.PGGGGPGGFFPGGGGPHMM....',
      '.GPGGGGPGFFFPGGGGPMMG...',
      '.GGPGGGGFFFGGPGGGGPGF...',
      '.GGGPGGGGFFGGGPHHGGPG...',
      '.PPPPPPGGGPGGGGPGGGGP...',
      '.PPPPPPGGGGPHGGGPGGGG...',
      '.PPPPPPPGGGGPGGGGPGG....',
      '.PPPPPPGPGGGHPGGGGGGG...',
      '.PPPPPPGGPGGGGPGGGGPG...',
      '.GGGGPGGGFFGGGGHHGGGP...',
      '.PGGGGPGFFFPGGGGPGGGF...',
      '.GPGGGGPGFFFPGGGGPMMG...',
      '.GGPGGGGPFFGGPGGGHMM....',
      '........................',
    ],
    rivers: [
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '       ~~~~~~~~~~       ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
      '                        ',
    ],
    revealed: true,
    wrap: false,
    cities: [
      { side: 2, x: 17, y: 7, size: 3, buildings: ['palace'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 20 },
    units: [
      // ── The attackers (side 1): a siege train with its escort, on the plains ──
      { side: 1, type: 'catapult', x: 7, y: 6, veteran: true },
      { side: 1, type: 'catapult', x: 7, y: 7, veteran: true },
      { side: 1, type: 'catapult', x: 7, y: 8, veteran: true },
      { side: 1, type: 'catapult', x: 6, y: 6 },
      { side: 1, type: 'catapult', x: 6, y: 8 },
      { side: 1, type: 'legion',   x: 8, y: 5 },
      { side: 1, type: 'legion',   x: 8, y: 6 },
      { side: 1, type: 'legion',   x: 8, y: 7 },
      { side: 1, type: 'legion',   x: 8, y: 8 },
      { side: 1, type: 'legion',   x: 8, y: 9 },
      { side: 1, type: 'legion',   x: 7, y: 5 },
      { side: 1, type: 'knights',  x: 9, y: 5 },
      { side: 1, type: 'knights',  x: 9, y: 6 },
      { side: 1, type: 'knights',  x: 9, y: 8 },
      { side: 1, type: 'knights',  x: 9, y: 9 },
      { side: 1, type: 'chariot',  x: 6, y: 5 },
      { side: 1, type: 'chariot',  x: 6, y: 9 },
      { side: 1, type: 'chariot',  x: 7, y: 9 },
      { side: 1, type: 'legion',   x: 6, y: 7 },
      { side: 1, type: 'legion',   x: 5, y: 7 },
      // ── The defenders (side 2) ────────────────────────────────────────────────
      // The garrison, dug in.
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true, veteran: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 7, fortified: true },
      // The two hill outworks north and south of the approach.
      { side: 2, type: 'phalanx',  x: 15, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 16, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 15, y: 10, fortified: true },
      { side: 2, type: 'phalanx',  x: 16, y: 10, fortified: true },
      // Pickets on the hills either side of the river crossing.
      { side: 2, type: 'legion',   x: 12, y: 6, fortified: true },
      { side: 2, type: 'legion',   x: 12, y: 8, fortified: true },
      // A mounted reserve behind the walls, to sally against the siege train.
      { side: 2, type: 'chariot',  x: 18, y: 6 },
      { side: 2, type: 'chariot',  x: 18, y: 8 },
      { side: 2, type: 'knights',  x: 19, y: 6 },
      { side: 2, type: 'knights',  x: 19, y: 8 },
      { side: 2, type: 'legion',   x: 16, y: 6, fortified: true },
      { side: 2, type: 'legion',   x: 16, y: 8, fortified: true },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
];

// Parse a map's `rows` ASCII art into a Civ1 board { width, height, tiles }.
export function parseFixedMap(map) {
  const rows = map.rows;
  const height = rows.length;
  const width = rows[0].length;
  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const terrain = TERRAIN_LEGEND[ch] ?? 'ocean';
      const hasRiver = map.rivers?.[y]?.[x] === '~';
      tiles[`${x},${y}`] = { terrain, hasRoad: false, hasRiver, fortress: false };
    }
  }
  return { width, height, tiles, ...(map.wrap === false ? { wrap: false } : {}) };
}

export function getFixedMap(id) {
  return FIXED_MAPS.find(m => m.id === id) ?? null;
}
