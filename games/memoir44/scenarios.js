// Scenarios: starting armies, terrain, objectives, and victory conditions.
//
// A scenario is:
//   { id, name, description,
//     medals,                      // victory: first side to this many medals
//     hands: [n0, n1],             // command-card hand size per player
//     firstPlayer: 0|1,            // player index that moves first
//     baselines: [row0, row1],     // each player's home edge (retreat toward)
//     terrain: { 'col,row': type },
//     objectives: [{ col, row, medalFor: 'either'|0|1 }],  // hex holds worth a medal
//     units: [{ player, type, col, row }] }
//
// Positions use offset coords: col 0-12, row 0-8 (row 0 = player-0 edge).

import { BOARD_COLS, BOARD_ROWS } from './hex.js';

const rot = (col, row) => ({ col: BOARD_COLS - 1 - col, row: BOARD_ROWS - 1 - row });

// --- Encounter: an open, symmetric field (the default) ---------------------

function encounter() {
  const terrain = {};
  const units = [];
  const mirror = (col, row, type) => {
    const r = rot(col, row);
    terrain[`${col},${row}`] = type;
    terrain[`${r.col},${r.row}`] = type;
  };
  // A rotationally-symmetric spread of cover.
  mirror(3, 3, 'forest'); mirror(4, 3, 'forest');
  mirror(2, 2, 'hill');   mirror(10, 3, 'hill');
  mirror(6, 4, 'town');   mirror(5, 4, 'town');

  const deploy = (col, row, type) => {
    units.push({ player: 0, type, col, row });
    const r = rot(col, row);
    units.push({ player: 1, type, col: r.col, row: r.row });
  };
  deploy(2, 0, 'infantry'); deploy(6, 0, 'infantry'); deploy(10, 0, 'infantry');
  deploy(4, 1, 'armor');    deploy(8, 1, 'armor');
  deploy(6, 1, 'artillery');

  return {
    id: 'encounter',
    name: 'Encounter',
    description: 'Open symmetric field — 3 infantry, 2 armor, 1 artillery a side. First to 5 medals.',
    medals: 5,
    hands: [5, 5],
    firstPlayer: 0,
    baselines: [0, BOARD_ROWS - 1],
    terrain,
    objectives: [],
    units,
  };
}

// --- Pegasus Bridge: British airborne seize the bridges --------------------

function pegasusBridge() {
  const terrain = {};
  // A river across the middle (row 4) with two bridges; forest and a town
  // give the defenders cover.
  for (let c = 0; c < BOARD_COLS; c++) terrain[`${c},4`] = 'river';
  terrain['3,4'] = 'bridge';
  terrain['9,4'] = 'bridge';
  for (const k of ['5,2', '6,2', '7,2', '6,3']) terrain[k] = 'town';   // Bénouville
  for (const k of ['1,3', '11,3', '2,5', '10,5']) terrain[k] = 'forest';
  terrain['4,6'] = 'hill'; terrain['8,6'] = 'hill';
  // German defenders are dug in behind sandbags covering the bridge approaches.
  for (const k of ['3,2', '9,2']) terrain[k] = 'sandbags';

  const units = [
    // British (player 0) — landed south of the canal, storming the bridges.
    { player: 0, type: 'infantry', col: 3, row: 6 },
    { player: 0, type: 'infantry', col: 4, row: 7 },
    { player: 0, type: 'infantry', col: 8, row: 6 },
    { player: 0, type: 'infantry', col: 9, row: 7 },
    { player: 0, type: 'infantry', col: 6, row: 7 },
    // German (player 1) — dug in around Bénouville to the north.
    { player: 1, type: 'infantry', col: 3, row: 2 },
    { player: 1, type: 'infantry', col: 6, row: 2 },
    { player: 1, type: 'infantry', col: 9, row: 2 },
    { player: 1, type: 'armor',    col: 6, row: 1 },
    { player: 1, type: 'artillery', col: 10, row: 1 },
  ];

  return {
    id: 'pegasus-bridge',
    name: 'Pegasus Bridge',
    description: 'British airborne rush the two bridges vs dug-in Germans. Holding a bridge scores a medal. First to 5.',
    medals: 5,
    hands: [5, 4],
    firstPlayer: 0,
    baselines: [BOARD_ROWS - 1, 0], // British hold the south edge, Germans the north
    terrain,
    objectives: [
      { col: 3, row: 4, medalFor: 'either' },
      { col: 9, row: 4, medalFor: 'either' },
    ],
    units,
  };
}

export const SCENARIOS = [encounter(), pegasusBridge()];

export function getScenario(id) {
  return SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0];
}
