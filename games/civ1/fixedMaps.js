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
// side 2 → players[1]. Coordinates are 0-indexed from the top-left.

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
    description: 'The real Civ1 world map (80x49), transcribed tile-for-tile from the original game earth map (see images/samples/Civ1_earthmap.webp)',
    // Transcribed by matching every 16px tile of the original map image against the
    // game's own terrain art (all 10 terrains x 16 blend variants, plus the 16 ocean
    // tiles) and taking the nearest — so the Sahara/Australia come out desert, the
    // Amazon jungle, Siberia forest and the poles arctic, as in the original.
    rows: [
      'AAAATAAAATTAAAAAAAATATATATAATTAATAATTATAAAATAAAAAAAGGGHGGGGGGGGGGGGGGGGGGGGGGGAA',
      'TT....T......T...TTT....T......T...TT.........T..T..GG..G.....G........G........',
      '................................................................................',
      '.........................AAAAAAA................................................',
      '...............AA.A.AAA.AAAAAAAA......P.....GG.....GGH..........................',
      '....TTTTA....AAAAAAAA....AAAAAAT.....AA...............GG.....G..................',
      '...TTTTTTTTTAA.A.AAAAA...AAAAAT...............A.....FFGGFFFFF..FFF....FFF.......',
      '.THTGPPPPTTTTT.TAAA..A...AAAAT...............A..AA.FFHGFFFFFFFGFFFFFFFFFF.G.....',
      '.....PGTPT..TTAAAAAAAA..AAGG..........GAP......G.GFFFHFFFFFFFFGFFGFFFFFHFHH.....',
      '.....GGFGPPTTAA...A.T...AG....A......AFGFPGF.AAFGTGFFFFFFFFFFFFFFFHFFH.HFF......',
      '....PMGFPPPPTT...ATAA...............GFPGGF.FFFFFFGFFFFFFFFFFFFFFHFFFFH..F.......',
      '....PMGFGPP.TTTAATTTT..........H...PFG.GGGFFFGFGGGFFFFFFFFFFFFFFFFFF....FH......',
      '....PHFFGPG.PPH.PTTTT.........HH.....P.GFGFFGFFFGFGFHHFHHFFFHFFFFFFFG....P......',
      '....GGHFGPPPPPPPPHTPP..........F...F...FFFGFFFFGGFPFFGFHGFHFFHFFFFFGPPG.........',
      '...GGGMGGGPPP.PPPPP.P.........GG...GPPFFFGGGFHHGGGJHHHHHHHHFFFFHGGPPPP..........',
      '...GGFMGGGGPG.HGG.P..............GHGGGHFFGFHFHPGPGGGGGPPPPPPPPPPPPPPGPG.........',
      '..GGGMMGHGHGGGG.................GGGMMGGGGPGHPGGPPPPPPPPPPPPPPPPPPPPPGPG.PG......',
      '..GGPPHGGGGGGG..................PGGGGFGGGGPHPD..PP.PPPDPDDDPPPPPPDPPPG..G.......',
      '..GFPPFGGHGGGP................PPPP.GH..GHF...HP.GPPDPDPDGPGPPPPDDPP.PG..MG......',
      '..GPPDDGGHGG..................PPP...GH...GHPPPP.PPPPDPPHPDDDDDDPPPG......P......',
      '..P.GGDG...P.........................G.....PPPPGPPPPPPHHMHHHHHHHHMHPG..G........',
      '..P.GDD....P..................GPPDD........PPGGHPPPDPPHPGHMMMMMHHHPPPG..........',
      '....GDG.......................DPHHPPPG.DP.PPPGGGPPPPPHHGDPGMHHMHHPPGGH..........',
      '....GGP.P...GP...............PPHDGDPPPPDDHGDPPD.PPPPHPGGDGGGHHHHHPGPPP..........',
      '.....GGPG....GP.............PPDDDDDPDDDDDHD.PDD....HHGGDGGGGGGGHGPGGP...........',
      '........GG..................PGDDDDDDDDDDSHS.DDDDDD....PPGGGHGHPGFGGG...G........',
      '.........G.................PDDDDDDHPPDDDDHD..GDDDDP....GGGGG..GGGGG....PG.......',
      '.........PP.GPPG...........DDDDDDDPDDDDDDHDD..DDDD......GGG...PPGG.....GG.......',
      '..........PGFPPPG..........DDDDDDDDPDPDPPDHHD..PD.......GG.....GGGG.....FG......',
      '...........GHGGGGGH........PPDPPPHDDDPPPPPPMDP..G.......PG.......HG......G......',
      '...........HJJJGGGGG........PPDPPPPPPPPPPPPHMDP..........G...........P..........',
      '..........GHJGGJJGGGG........PPPG.PPGPGGGGGGMDDP...................GPP..GP......',
      '..........PGJJGGGGJGFGG............GGGGJJJGG.DPP...............GFG..PGFGGG.G....',
      '...........FGGJJGJJFGGGP...........GGJJGHGGGHPP.................GF..G.PG...PGG..',
      '...........GHGGGGGGGGGG............GHHHGJJH.GG...................G...........GG.',
      '............GMFGGGGGGP..............GHJJJGHMG....................PP.....G.......',
      '............GFMGGFGPPP..............GGGGGGGMP.....................G.......PG....',
      '..............HMGGGPGG...............GGHGGGHG..........................GGPGPGG..',
      '..............GHGGHGG................DPPGGGGGG.........................GGPPPPG..',
      '..............GMGPGG................PPPPPPPGGG.P....................GGPPPDDDPPP.',
      '..............GMGGGP................HPDDPPGG...P...................GGGPDDDDDDPF.',
      '..............PMGGG..................PPDPPGG...G...................GPDDDDDDDDPP.',
      '...............MGP...................HPPPGGG..GP...................GDDDDDPDDGPG.',
      '...............GG....................HPPGHG...P....................DDDDDDDPDDHF.',
      '...............PG.....................DPGHG........................DDD..GDDDHG..',
      '................G.....................PGGG..............................GHHHG...',
      '................F.....................G...................................PG....',
      '................................................................................',
      'T.T.........T...........TT..T.......TTTT..TT........TT..............T...T...T...',
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
      '                                          ~    ~             ~                  ',
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
      '                                        ~~~                ~~                   ',
      '                                         ~                                      ',
      '                                         ~                                      ',
      '                                                                                ',
      '                                                                                ',
      '                   ~                                                            ',
      '              ~  ~~~                                                            ',
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
    ],
    // Opposite hemispheres: North America vs. eastern Asia.
    units: [
      { side: 1, type: 'settlers', x: 8,  y: 16 },
      { side: 1, type: 'militia',  x: 9,  y: 16 },
      { side: 2, type: 'settlers', x: 60, y: 16 },
      { side: 2, type: 'militia',  x: 61, y: 16 },
    ],
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
  return { width, height, tiles };
}

export function getFixedMap(id) {
  return FIXED_MAPS.find(m => m.id === id) ?? null;
}
