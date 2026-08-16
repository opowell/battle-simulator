// Visual layout of the classic Risk world map on a hex grid: each of the 42
// territories is a small blob of hexes, laid out in roughly world-map shape, so
// the board can be drawn (and clicked) like KDice's territory map — see
// games/mapTypes/hexagon.js for the axial math and RiskGame.toGrid for the render.
//
// The rules never consult this file: RiskMap.ADJACENCY stays the single authority
// on who can attack whom. The layout only has to AGREE with it, which layout.test.js
// enforces in both directions:
//   - two blobs may only touch if they are really adjacent (no fake borders), and
//   - the pairs that are adjacent but do NOT touch are exactly SEA_ROUTES below.
// That second set is the map's water crossings — the connection lines drawn on the
// real board (Alaska↔Kamchatka and friends) plus the Mediterranean. toGrid emits
// them as dashed links so a legal attack is never invisible.

import { hexId, hexNeighbors, territoryCapital } from '../mapTypes/hexagon.js';

export const HEX_SIZE = 1;

const CODE_TO_ID = {
  ALA: 'alaska',        NWT: 'northwest_territory', GRN: 'greenland',
  ABT: 'alberta',       ONT: 'ontario',             QUE: 'quebec',
  WUS: 'western_us',    EUS: 'eastern_us',          CAM: 'central_america',
  VEN: 'venezuela',     PER: 'peru',                BRA: 'brazil',
  ARG: 'argentina',
  ICE: 'iceland',       GBR: 'great_britain',       WEU: 'western_europe',
  NEU: 'northern_europe', SCA: 'scandinavia',       UKR: 'ukraine',
  SEU: 'southern_europe',
  NAF: 'north_africa',  EGY: 'egypt',               EAF: 'east_africa',
  CON: 'congo',         SAF: 'south_africa',        MAD: 'madagascar',
  MDE: 'middle_east',   AFG: 'afghanistan',         URA: 'ural',
  SIB: 'siberia',       YAK: 'yakutsk',             KAM: 'kamchatka',
  IRK: 'irkutsk',       MON: 'mongolia',            CHI: 'china',
  IND: 'india',         SEA: 'southeast_asia',      JAP: 'japan',
  INO: 'indonesia',     NGU: 'new_guinea',          WAU: 'western_australia',
  EAU: 'eastern_australia',
};

// The map itself. One 3-letter code (or `~~~` for open sea) per hex, four columns
// of text per hex column; odd rows are indented two spaces because a pointy-top
// hex row sits half a cell to the right of the row above it. Editing rule: keep
// every line the same width and never let two territories that RiskMap says are
// NOT adjacent end up sharing an edge — the test will tell you if you did.
const MAP = `
~~~ ~~~ ~~~ ~~~ ~~~ ~~~ GRN GRN ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~
  ALA ALA NWT NWT NWT NWT GRN GRN ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ YAK YAK ~~~ ~~~ ~~~
ALA ~~~ NWT NWT NWT GRN GRN ~~~ ~~~ ~~~ ~~~ ICE SCA SCA ~~~ ~~~ ~~~ ~~~ ~~~ SIB SIB YAK YAK KAM KAM ~~~
  ABT ABT ABT ONT ONT QUE QUE ~~~ ~~~ ~~~ ~~~ GBR ~~~ SCA SCA UKR UKR URA URA SIB SIB IRK IRK KAM KAM ~~~
~~~ WUS WUS WUS EUS EUS ~~~ ~~~ ~~~ ~~~ ~~~ GBR NEU NEU NEU UKR UKR URA URA URA SIB MON MON MON ~~~ ~~~
  ~~~ WUS WUS EUS EUS ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ WEU WEU SEU SEU MDE AFG AFG AFG CHI CHI CHI ~~~ ~~~ JAP ~~~
~~~ ~~~ ~~~ CAM ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ MDE MDE AFG AFG CHI CHI CHI ~~~ ~~~ JAP ~~~
  ~~~ ~~~ ~~~ CAM ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ MDE MDE MDE IND IND IND SEA SEA ~~~ ~~~ ~~~ ~~~
~~~ ~~~ ~~~ VEN VEN ~~~ ~~~ ~~~ ~~~ ~~~ NAF NAF NAF EGY EGY ~~~ ~~~ IND IND ~~~ ~~~ SEA ~~~ ~~~ ~~~ ~~~
  ~~~ ~~~ PER BRA BRA BRA ~~~ ~~~ ~~~ ~~~ ~~~ NAF NAF EGY ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~
~~~ ~~~ PER PER BRA BRA ~~~ ~~~ ~~~ ~~~ ~~~ CON CON EAF EAF ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ INO INO NGU NGU
  ~~~ ~~~ ~~~ ARG ARG ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ CON CON EAF ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ INO NGU NGU ~~~
~~~ ~~~ ~~~ ARG ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ SAF SAF SAF MAD ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ WAU WAU EAU EAU
  ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ MAD ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ ~~~ EAU ~~~
`;

// Adjacent on the board, separated by water on the map. Drawn as dashed sea
// routes instead of a shared border (see RiskGame.toGrid); the test asserts this
// list is exactly the set of adjacent-but-not-touching pairs, so a layout edit
// that accidentally opens or closes a crossing fails rather than silently
// dropping a connection line.
export const SEA_ROUTES = [
  ['alaska', 'kamchatka'],
  ['greenland', 'iceland'],
  ['brazil', 'north_africa'],
  ['north_africa', 'western_europe'],
  ['north_africa', 'southern_europe'],
  ['egypt', 'southern_europe'],
  ['east_africa', 'middle_east'],
  ['japan', 'kamchatka'],
  ['japan', 'mongolia'],
  ['indonesia', 'southeast_asia'],
];

// Parse MAP once at module load into axial hex cells. Offset→axial is the same
// even-row convention generateHexRect uses: q = col - floor(row/2), r = row.
function parseMap() {
  const hexIdsByTerritory = {};
  const hexCells = {};
  const territoryOfHex = {};

  const rows = MAP.split('\n').filter(l => l.trim().length);
  rows.forEach((line, row) => {
    const body = row % 2 ? line.slice(2) : line;
    for (let col = 0; col * 4 < body.length; col++) {
      const code = body.slice(col * 4, col * 4 + 3);
      if (code === '~~~' || !code.trim()) continue;
      const id = CODE_TO_ID[code];
      if (!id) throw new Error(`RiskLayout: unknown territory code "${code}" at row ${row}, col ${col}`);
      const q = col - Math.floor(row / 2);
      const hex = hexId(q, row);
      hexCells[hex] = { q, r: row };
      territoryOfHex[hex] = id;
      (hexIdsByTerritory[id] ??= []).push(hex);
    }
  });

  const hexAdjacency = {};
  const seaAdjacency = {};  // as above, but open sea still counts as a neighbour
  for (const hex of Object.keys(hexCells)) {
    const { q, r } = hexCells[hex];
    const all = hexNeighbors(q, r).map(([nq, nr]) => hexId(nq, nr));
    seaAdjacency[hex] = all;
    hexAdjacency[hex] = all.filter(n => hexCells[n]);
  }

  // The army count is drawn on one hex per territory — the deepest-interior one,
  // so the number sits inside the blob rather than on a coastal spur. Coast counts
  // as boundary here (hence seaAdjacency), which is why a shoreline hex loses to an
  // inland one even when all of a blob's land neighbours are its own.
  const capitalHexByTerritory = {};
  for (const [id, hexes] of Object.entries(hexIdsByTerritory)) {
    capitalHexByTerritory[id] = territoryCapital(hexes, hexCells, HEX_SIZE, seaAdjacency);
  }

  return { hexIdsByTerritory, capitalHexByTerritory, hexCells, territoryOfHex, hexAdjacency };
}

export const LAYOUT = parseMap();

// Which territories share a hex edge on the map. Used by the test to keep the
// drawing honest about RiskMap.ADJACENCY.
export function touchingPairs() {
  const { hexCells, territoryOfHex, hexAdjacency } = LAYOUT;
  const pairs = new Set();
  for (const hex of Object.keys(hexCells)) {
    for (const n of hexAdjacency[hex]) {
      const a = territoryOfHex[hex], b = territoryOfHex[n];
      if (a !== b) pairs.add([a, b].sort().join('|'));
    }
  }
  return pairs;
}
