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
// Likewise an optional `tileImprovements` layer for the settlers' work already done
// on the land (TILE_IMPROVEMENT_LEGEND below; a space or anything else is untouched
// ground). Only what the terrain takes is applied — a mine on grassland or irrigation
// on a mountain is dropped, as a settler could not have built it.
//
// Starting units are `{ side: 1|2, type, x, y }`; side 1 → players[0],
// side 2 → players[1]. Coordinates are 0-indexed from the top-left. A unit may
// also start `veteran` and/or `fortified` (dug in, with the bonus already earned).
//
// A battle rather than a world needs a few more pieces, all optional:
//   cities     `{ side, x, y, name?, size?, buildings? }` standing from turn 1
//   fortresses `[x, y]` squares with a fortress already built on them (see combat.js:
//              land defenders x2 instead of fortifying, and no stack death)
//   objective  `{ type: 'take-city', attacker: 1|2, defender: 1|2, turns }` — the
//              attacker wins by capturing the defender's city (and so destroying
//              them); the defender wins by still holding it once `turns` rounds
//              are over, or by wiping out the attacking army first
//   revealed   true: both sides know the whole battlefield's terrain, and where
//              its cities stand, from the start (units are still fogged)
//   openingSpan  how many tiles across the board opens on, at least (the client's
//              default frames the viewer's units in about 10)
//   wrap       false: the map's east and west edges are edges, not one seam — a
//              battlefield is a place, not a world
//   config     the scenario menu entry's config (seats, fog, …), as on any scenario

import { IRRIGABLE, MINEABLE } from './city.js';

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

// Character → what settlers have built on a square (the `tileImprovements` layer).
export const TILE_IMPROVEMENT_LEGEND = {
  '=': { hasRoad: true },
  'i': { irrigated: true },
  'm': { mined: true },
  '+': { hasRoad: true, irrigated: true },
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
  // ── Five battles before the Siege, easiest first ───────────────────────────────
  // Each is smaller than the one after it, and each brings in one thing more: walking
  // up and striking (Outpost), a garrison dug in (Border Town), a fort and the catapults
  // to crack it (River Fort), riders sallying from the walls (Twin Forts), and all of it
  // on a field the size of a real campaign (Highland Pass). Rates are the heuristic
  // attacker's against the heuristic defender (demo/civ1-siege-bench.mjs --map ID), the
  // same measure as the Siege's ~22%; a human general should do better.
  {
    id: 'outpost',
    name: 'Outpost',
    description: 'Very easy: three legions have 10 turns to take a frontier village held by one militia',
    rows: [
      '..........',
      '..GGPGGG..',
      '.PGGGGGGG.',
      '.PPGGGGGG.',
      '..PGGPGG..',
      '..........',
    ],
    revealed: true,
    wrap: false,
    cities: [
      { side: 2, x: 7, y: 3, size: 2, buildings: ['palace'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 10 },
    units: [
      { side: 1, type: 'legion',  x: 2, y: 2 },
      { side: 1, type: 'legion',  x: 2, y: 3 },
      { side: 1, type: 'legion',  x: 3, y: 3 },
      { side: 2, type: 'militia', x: 7, y: 3 },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
  {
    id: 'border-town',
    name: 'Border Town',
    description: 'Easy: four legions and two horsemen have 12 turns to take a town held by a phalanx and a militia, dug in',
    rows: [
      '.............',
      '..GGPGGFFGG..',
      '.PPGGGGGFGGG.',
      '.PPPGGGGGGGG.',
      '.PPGGGGGGFGG.',
      '.PPGGGPGGGGG.',
      '..PGGPGGGGG..',
      '.............',
    ],
    revealed: true,
    wrap: false,
    cities: [
      { side: 2, x: 10, y: 4, size: 2, buildings: ['palace', 'granary'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 12 },
    units: [
      { side: 1, type: 'legion',   x: 3, y: 2 },
      { side: 1, type: 'legion',   x: 3, y: 3 },
      { side: 1, type: 'legion',   x: 3, y: 4 },
      { side: 1, type: 'legion',   x: 3, y: 5 },
      { side: 1, type: 'cavalry',  x: 2, y: 3 },
      { side: 1, type: 'cavalry',  x: 2, y: 4 },
      { side: 2, type: 'phalanx',  x: 10, y: 4, fortified: true },
      { side: 2, type: 'militia',  x: 10, y: 4, fortified: true },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
  {
    id: 'river-fort',
    name: 'River Fort',
    description: 'Moderate: eleven units with two catapults have 12 turns to take a river town, past a fort on the hill that guards the crossing',
    // The fort's hill sits on the straight road to the town: go through it (x2 for the
    // fort, x2 for the hill) or round it under its zone of control.
    rows: [
      '...............',
      '..GGPGGGFFGGG..',
      '.PPGGGGGFFGGGG.',
      '.PPPGGGHGGGGGG.',
      '.PPGGGGGGGGGGG.',
      '.PPPGGGGGGGGGG.',
      '.PPGGGGPGFGGGG.',
      '..PGGGGGGGGGG..',
      '...............',
    ],
    rivers: [
      '               ',
      '               ',
      '               ',
      '               ',
      '    ~~~~~~~~   ',
      '               ',
      '               ',
      '               ',
      '               ',
    ],
    revealed: true,
    wrap: false,
    openingSpan: 14,
    fortresses: [[7, 3]],
    cities: [
      { side: 2, x: 12, y: 4, size: 3, buildings: ['palace', 'granary', 'temple'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 12 },
    units: [
      { side: 1, type: 'catapult', x: 3, y: 3 },
      { side: 1, type: 'catapult', x: 3, y: 5 },
      { side: 1, type: 'legion',   x: 4, y: 2 },
      { side: 1, type: 'legion',   x: 4, y: 3 },
      { side: 1, type: 'legion',   x: 4, y: 4 },
      { side: 1, type: 'legion',   x: 4, y: 5 },
      { side: 1, type: 'legion',   x: 4, y: 6 },
      { side: 1, type: 'legion',   x: 5, y: 4 },
      { side: 1, type: 'phalanx',  x: 3, y: 4 },
      { side: 1, type: 'cavalry',  x: 5, y: 2 },
      { side: 1, type: 'cavalry',  x: 5, y: 6 },
      { side: 2, type: 'phalanx',  x: 12, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 12, y: 4, fortified: true },
      { side: 2, type: 'legion',   x: 12, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 7, y: 3, fortified: true },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
  {
    id: 'twin-forts',
    name: 'Twin Forts',
    description: 'Hard: fourteen units have 15 turns to take a harbour town behind two hill forts, whose chariot rides out at anything left in the open',
    // Two hill forts either side of the one way in, two squares apart: the road between
    // them is under both their zones of control. Behind the walls, a chariot waits for
    // a catapult caught without its guard.
    rows: [
      '.................',
      '...GGPGG....HMM..',
      '..GGGGPGGFFPHGG..',
      '.PPGGGGGFFGGGGGG.',
      '.PPPPGGGGGHGGGGG.',
      '.PPPPPGGGGGGGGG..',
      '.PPPPGGGGGHGGGGG.',
      '.PPGGGGGFFGGGGGG.',
      '..GGGGPGGFFPHGG..',
      '...GGPGG....HMM..',
      '.................',
    ],
    revealed: true,
    wrap: false,
    openingSpan: 16,
    fortresses: [[10, 4], [10, 6]],
    cities: [
      { side: 2, x: 14, y: 5, size: 3, buildings: ['palace', 'granary', 'temple'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 15 },
    units: [
      { side: 1, type: 'catapult', x: 5, y: 4, veteran: true },
      { side: 1, type: 'catapult', x: 5, y: 5 },
      { side: 1, type: 'catapult', x: 5, y: 6 },
      { side: 1, type: 'legion',   x: 6, y: 3 },
      { side: 1, type: 'legion',   x: 6, y: 4 },
      { side: 1, type: 'legion',   x: 6, y: 5 },
      { side: 1, type: 'legion',   x: 6, y: 6 },
      { side: 1, type: 'legion',   x: 6, y: 7 },
      { side: 1, type: 'legion',   x: 7, y: 5 },
      { side: 1, type: 'phalanx',  x: 4, y: 4 },
      { side: 1, type: 'phalanx',  x: 4, y: 6 },
      { side: 1, type: 'chariot',  x: 7, y: 3 },
      { side: 1, type: 'chariot',  x: 7, y: 7 },
      { side: 1, type: 'knights',  x: 4, y: 5 },
      // The garrison: phalanxes dug in and a legion to strike from the walls.
      { side: 2, type: 'phalanx',  x: 14, y: 5, fortified: true, veteran: true },
      { side: 2, type: 'phalanx',  x: 14, y: 5, fortified: true },
      { side: 2, type: 'phalanx',  x: 14, y: 5, fortified: true },
      { side: 2, type: 'legion',   x: 14, y: 5, fortified: true },
      { side: 2, type: 'militia',  x: 14, y: 5, fortified: true },
      { side: 2, type: 'phalanx',  x: 10, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 10, y: 6, fortified: true },
      { side: 2, type: 'chariot',  x: 15, y: 4 },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
  {
    id: 'highland-pass',
    name: 'Highland Pass',
    description: 'Very hard: twenty units have 16 turns to take a city at the head of a pass, held by three forts and eleven defenders with knights to sally',
    // The Siege in small: a fort on the river crossing, a hill outwork either side of the
    // approach, a garrison dug in, and riders behind the walls.
    rows: [
      '....................',
      '....GGPG.....HMM....',
      '..GGGGGPGFF.PHGGG...',
      '.GPGGGGPFFFGGGGPGG..',
      '.PPPGGGGGFGGGHGGGGG.',
      '.PPPPPGGGGGGPGGGGG..',
      '.PPPPPPGGGHGGGGGGGG.',
      '.PPPPPGGGGGGPGGGGG..',
      '.PPPGGGGGFGGGHGGGGG.',
      '.GPGGGGPFFFGGGGPGG..',
      '..GGGGGPGFF.PHGGG...',
      '....GGPG.....HMM....',
      '....................',
    ],
    rivers: [
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '   ~~~~~~~~         ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
      '                    ',
    ],
    revealed: true,
    wrap: false,
    openingSpan: 18,
    fortresses: [[10, 6], [13, 4], [13, 8]],
    cities: [
      { side: 2, x: 17, y: 6, size: 3, buildings: ['palace', 'granary', 'temple', 'marketplace'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 16 },
    units: [
      { side: 1, type: 'catapult', x: 6, y: 5, veteran: true },
      { side: 1, type: 'catapult', x: 6, y: 7, veteran: true },
      { side: 1, type: 'catapult', x: 5, y: 5 },
      { side: 1, type: 'catapult', x: 5, y: 7 },
      { side: 1, type: 'legion',   x: 7, y: 3 },
      { side: 1, type: 'legion',   x: 7, y: 4 },
      { side: 1, type: 'legion',   x: 7, y: 5 },
      { side: 1, type: 'legion',   x: 7, y: 6 },
      { side: 1, type: 'legion',   x: 7, y: 7 },
      { side: 1, type: 'legion',   x: 7, y: 8 },
      { side: 1, type: 'legion',   x: 7, y: 9 },
      { side: 1, type: 'legion',   x: 6, y: 4 },
      { side: 1, type: 'legion',   x: 6, y: 8 },
      { side: 1, type: 'phalanx',  x: 5, y: 6 },
      { side: 1, type: 'phalanx',  x: 4, y: 6 },
      { side: 1, type: 'knights',  x: 8, y: 4 },
      { side: 1, type: 'knights',  x: 8, y: 6 },
      { side: 1, type: 'knights',  x: 8, y: 8 },
      { side: 1, type: 'chariot',  x: 6, y: 3 },
      { side: 1, type: 'chariot',  x: 6, y: 9 },
      // The garrison.
      { side: 2, type: 'phalanx',  x: 17, y: 6, fortified: true, veteran: true },
      { side: 2, type: 'phalanx',  x: 17, y: 6, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 6, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 6, fortified: true },
      { side: 2, type: 'legion',   x: 17, y: 6, fortified: true },
      // The crossing fort, and the two outworks.
      { side: 2, type: 'phalanx',  x: 10, y: 6, fortified: true },
      { side: 2, type: 'legion',   x: 10, y: 6, fortified: true },
      { side: 2, type: 'phalanx',  x: 13, y: 4, fortified: true },
      { side: 2, type: 'phalanx',  x: 13, y: 8, fortified: true },
      // Riders behind the walls.
      { side: 2, type: 'knights',  x: 18, y: 6 },
      { side: 2, type: 'chariot',  x: 18, y: 4 },
    ],
    config: {
      players: [{ name: 'You' }, { name: 'Defender', agent: 'civ1-heuristic' }],
      fogOfWar: true,
    },
  },
  {
    id: 'siege',
    name: 'Siege',
    description: 'A fixed battle: your army of 28 — catapults, legions, knights — has 20 turns to take a coastal city held by 20 defenders, with forts on the hills before it and horsemen to sally',
    // An island, west to east: the attackers' open staging plains under a knoll, a
    // wooded ridge north and south with a pair of hills on the river crossing between
    // them, the city's two hill outworks over the north bay and the southern inlet, and
    // the city itself at the head of the estuary, between two headlands, with the sea
    // at its back — so it can only be approached from the west. The map does not wrap.
    // Every hill before the city carries a fortress (combat.js: x2 for whoever holds it,
    // and a beaten defender dies alone), so the outworks have to be taken a man at a
    // time or walked past under their zone of control — and a fort the attacker takes
    // is a fort it can hold.
    rows: [
      '..........................',
      '.....GPHG.........HMM.....',
      '...GGGGPGGFFP....PHMMG....',
      '..GPGGGGPGFFFPG.GGPMMGGG..',
      '..GGPGGGGFFFGGPGGGGPGFFGH.',
      '.GGGGPGGGGFFGGGPHHGGPGGG..',
      '.PPPPPPPGGGPGGGGPGGGGPG...',
      '..PPPPPPGGGGPHGGGPGGGG....',
      '.PPPPPPPPGGGGPGGGGP.......',
      '..PPPPPPGPGGGHPGGGGGGG....',
      '.PPPPPPPGGPGGGGPGGGGPGG...',
      '..GGGGPGGGFFGGGGHHGGGPGGG.',
      '...GGGGPGFFFPGGGGPGGGFFG..',
      '.....GGGPG..FPGGGGPMMG....',
      '......GG.....GPGGGHMM.....',
      '...............GGHM.......',
      '..........................',
    ],
    rivers: [
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '        ~~~~~~~~~~        ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
    ],
    // Settlers' work, all of it known to both sides from the start (Civ1Game's remembered
    // ground): the bottom land on both banks is under irrigation, and a road runs from the
    // crossing forts along the north bank and out to both outworks. Every road reaches the
    // city from BEHIND it, through its two eastern neighbours. A road on a square beside
    // the walls on the attackers' side lets a horseman step out for a third of a move,
    // strike at full strength and step back in the same turn; with one on each side of
    // the city the heuristic attacker took it 16% of the time (200 games), against 22%
    // (600) with the roads round the back (demo/civ1-siege-bench.mjs, AI-DESIGN.md).
    tileImprovements: [
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                 =        ',
      '                 =+i      ',
      '            ==+++ii=      ',
      '                ii=       ',
      '              iiiii=      ',
      '                  +i      ',
      '                 =        ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
      '                          ',
    ],
    revealed: true,
    wrap: false,
    // Twice the default framing: the army fills ten tiles, and the battle is the
    // whole field between it and the walls.
    openingSpan: 20,
    fortresses: [
      [13, 7], [13, 9],             // the river crossing
      [16, 5], [17, 5],             // the northern outwork
      [16, 11], [17, 11],           // the southern outwork
    ],
    cities: [
      // A city with a life before the war: granary, temple, market and library. No City
      // Walls — they stop a beaten garrison costing citizens and treble its defence, and
      // with them the attacker never took the city, even from a garrison of two (0 of 120
      // games each, measured before the forts, against 20 attackers). No Barracks either:
      // the defenders it trains come out veterans, which took the attacker from 21% to
      // 15% (400 games each). The rest change nothing in a twenty-turn battle.
      { side: 2, x: 18, y: 8, size: 3, buildings: ['palace', 'granary', 'temple', 'marketplace', 'library'] },
    ],
    objective: { type: 'take-city', attacker: 1, defender: 2, turns: 20 },
    units: [
      // ── The attackers (side 1): 28 — a siege train with its escort, on the plains ──
      { side: 1, type: 'catapult', x: 8, y: 7, veteran: true },
      { side: 1, type: 'catapult', x: 8, y: 8, veteran: true },
      { side: 1, type: 'catapult', x: 8, y: 9, veteran: true },
      { side: 1, type: 'catapult', x: 7, y: 7 },
      { side: 1, type: 'catapult', x: 7, y: 8 },
      { side: 1, type: 'catapult', x: 7, y: 9 },
      { side: 1, type: 'legion',   x: 9, y: 5 },
      { side: 1, type: 'legion',   x: 9, y: 6 },
      { side: 1, type: 'legion',   x: 9, y: 7 },
      { side: 1, type: 'legion',   x: 9, y: 8 },
      { side: 1, type: 'legion',   x: 9, y: 9 },
      { side: 1, type: 'legion',   x: 9, y: 10 },
      { side: 1, type: 'legion',   x: 9, y: 11 },
      { side: 1, type: 'legion',   x: 8, y: 6 },
      { side: 1, type: 'legion',   x: 8, y: 10 },
      { side: 1, type: 'legion',   x: 6, y: 7 },
      { side: 1, type: 'legion',   x: 6, y: 8 },
      { side: 1, type: 'legion',   x: 6, y: 9 },
      // The siege train's guard: the catapults defend at 1, and the defenders ride out.
      { side: 1, type: 'phalanx',  x: 6, y: 6 },
      { side: 1, type: 'phalanx',  x: 6, y: 10 },
      { side: 1, type: 'phalanx',  x: 5, y: 8 },
      { side: 1, type: 'knights',  x: 10, y: 5 },
      { side: 1, type: 'knights',  x: 10, y: 7 },
      { side: 1, type: 'knights',  x: 10, y: 8 },
      { side: 1, type: 'knights',  x: 10, y: 9 },
      { side: 1, type: 'knights',  x: 10, y: 11 },
      { side: 1, type: 'chariot',  x: 7, y: 5 },
      { side: 1, type: 'chariot',  x: 7, y: 11 },
      // ── The defenders (side 2): 20 ──────────────────────────────────────────────
      // The garrison: phalanxes dug in, and a legion to strike at whatever comes up to
      // the walls. (No catapults: anything that steps up beside a city strikes from on
      // open ground, and a garrison catapult kills it, stack and all, nineteen times in
      // twenty — three of them made the walls unapproachable. See demo/civ1-siege-bench.)
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true, veteran: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'phalanx',  x: 18, y: 8, fortified: true },
      { side: 2, type: 'legion',   x: 18, y: 8, fortified: true },
      // The forts at the river crossing: a phalanx to hold each and a legion to strike
      // at whatever tries to slip past.
      { side: 2, type: 'phalanx',  x: 13, y: 7, fortified: true },
      { side: 2, type: 'legion',   x: 13, y: 7, fortified: true },
      { side: 2, type: 'phalanx',  x: 13, y: 9, fortified: true },
      { side: 2, type: 'legion',   x: 13, y: 9, fortified: true },
      // The hill outworks north and south of the approach, one fort apiece.
      { side: 2, type: 'phalanx',  x: 16, y: 5, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 5, fortified: true },
      { side: 2, type: 'phalanx',  x: 16, y: 11, fortified: true },
      { side: 2, type: 'phalanx',  x: 17, y: 11, fortified: true },
      // A mounted reserve behind the walls, to ride out at the siege train.
      { side: 2, type: 'knights',  x: 19, y: 7 },
      { side: 2, type: 'chariot',  x: 19, y: 9 },
      { side: 2, type: 'chariot',  x: 20, y: 7 },
      { side: 2, type: 'knights',  x: 20, y: 9 },
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
      const work = TILE_IMPROVEMENT_LEGEND[map.tileImprovements?.[y]?.[x]] ?? {};
      tiles[`${x},${y}`] = {
        terrain, hasRoad: !!work.hasRoad && terrain !== 'ocean', hasRiver, fortress: false,
        ...(work.irrigated && IRRIGABLE.has(terrain) ? { irrigated: true } : {}),
        ...(work.mined && MINEABLE[terrain] ? { mined: true } : {}),
      };
    }
  }
  for (const [x, y] of map.fortresses ?? []) tiles[`${x},${y}`].fortress = true;
  return { width, height, tiles, ...(map.wrap === false ? { wrap: false } : {}) };
}

export function getFixedMap(id) {
  return FIXED_MAPS.find(m => m.id === id) ?? null;
}
