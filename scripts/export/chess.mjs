// Chess's boards in the core's format (scripts/export-pack.mjs). Chess has no
// terrain: every scenario plays on the same eight by eight squares, and the only
// difference between its light and dark squares is their colour. What the
// scenarios change is the quadrant of (space × time) the pieces move in, which a
// library map carries as its `modes`; the opening position is the one the game
// deals itself for that scenario, white (seat 0) at the bottom as the game draws it.
// Fog of War is the standard board with fog on, and fog is the core's own setup
// switch rather than a map's, so it adds no map of its own.
//
// Every map brings chess's own pieces (src/battle/patterns.js): each moves by its
// pattern and takes by moving onto a piece, the pawn steps one ahead (two on its
// first move), takes on its diagonals, en passant, and promotes on the far rank;
// the king castles, and may never be left in check: checkmate wins, stalemate
// draws. A side moves one piece a turn, and the board is shown as a board game:
// no hit points, no plates under the pieces, no roster or actions panel, files
// and ranks along the edges. Off the board of squares and turns (the clockwork,
// melee and sliding maps) the same pieces move by their speed and strike by
// their material value, as any unit does there.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameImageFiles } from '../../src/server/gameImages.js';

const FILES = 'abcdefgh';

/** The cell a piece stands on: its `cell` off the board of squares, else its algebraic square. */
function cellOf(u) {
  if (u.cell) return [u.cell.x, u.cell.y];
  return [FILES.indexOf(u.position[0]), 8 - Number(u.position.slice(1))];
}

// Material value (pawns), how far a piece moves off the board of squares, and
// how far it sees under fog (a radius: the squares it could reach next).
const PIECES = {
  king:   { value: 4, speed: 1, vision: 2, moves: [{ steps: [[0, 1], [1, 1]] }], castle: { with: 'rook', steps: 2 }, tags: ['royal'] },
  queen:  { value: 9, speed: 3, vision: 8, moves: [{ steps: [[0, 1], [1, 1]], slides: true }] },
  rook:   { value: 5, speed: 3, vision: 8, moves: [{ steps: [[0, 1]], slides: true }] },
  bishop: { value: 3, speed: 3, vision: 8, moves: [{ steps: [[1, 1]], slides: true }] },
  knight: { value: 3, speed: 2, vision: 3, moves: [{ steps: [[1, 2]] }] },
  pawn: {
    value: 1, speed: 1, vision: 2,
    moves: [
      { steps: [[0, 1]], symmetric: false, capture: false },
      { steps: [[0, 1]], symmetric: false, capture: false, slides: true, range: 2, unmoved: true },
      { steps: [[1, 1]], symmetric: 'mirror', capture: 'only', enPassant: true },
    ],
    promote: { to: ['queen', 'rook', 'bishop', 'knight'] },
  },
};

// A piece's picture for a seat, where export-pack.mjs copies it into the pack.
async function artOf(dir, pack, type, seat) {
  const a = pack.art(type, seat);
  const m = a.imagePath.match(/^\/images\/([^/]+)\/([^/]+)$/);
  const [file] = m ? await gameImageFiles(dir, m[2]) : [];
  return { imagePath: file ? `/library/${m[1]}/art/${m[2]}${path.extname(file)}` : null, glyph: seat ? a.glyph.toLowerCase() : a.glyph };
}

export default async function exportBoards(dir) {
  const { ChessGame } = await import(pathToFileURL(path.join(dir, 'ChessGame.js')).href);
  const { pack } = await import(pathToFileURL(path.join(dir, 'pack.js')).href);
  const colour = ChessGame.colors;
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  const unitTypes = {};
  for (const [type, p] of Object.entries(PIECES)) {
    const { value, speed, vision, ...rules } = p;
    unitTypes[type] = {
      name: type[0].toUpperCase() + type.slice(1), glyph: pack.art(type, 0).glyph,
      hp: 1, attack: value, defense: value, range: 1, speed, rate: 1, vision,
      ...rules,
      art: [await artOf(dir, pack, type, 0), await artOf(dir, pack, type, 1)],
    };
  }
  // a8 (the top-left cell) is a light square.
  const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => ((x + y) % 2 ? 'd' : 'l')).join(''));
  const maps = {};
  for (const sc of ChessGame.scenarios) {
    if (sc.config.fogOfWar) continue;
    const { units } = ChessGame.createInitialState(players, sc.config);
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: {
        topology: 'square', width: 8, height: 8, rows, legend: { l: 'light', d: 'dark' }, stacking: 'one',
        labels: { x: [...FILES], y: ['8', '7', '6', '5', '4', '3', '2', '1'] },
      },
      unitTypes,
      units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: cellOf(u) })),
      forward: ['up', 'down'],
      turn: { units: 1 },
      victory: [{ type: 'royal', tag: 'royal', check: true }],
      display: { preset: 'board' },
      modes: { space: sc.config.space, time: sc.config.time, play: 'sequential' },
    };
  }
  return {
    terrain: {
      light: { name: 'Light square', color: colour.light, description: 'A square of the board. No effect.', cost: 1, passable: true, cover: 0, blocksSight: false },
      dark: { name: 'Dark square', color: colour.dark, description: 'A square of the board. No effect.', cost: 1, passable: true, cover: 0, blocksSight: false },
    },
    maps,
    omitted: [
      'draws by repetition, the fifty-move rule and insufficient material',
      'choosing what a pawn promotes to from the board: a click promotes to a queen, and the actions panel lists the rest',
      'Fog of War\'s per-square sight and its piece markers: the fog scenario is the standard board, and the core\'s own fog is a setup switch',
      'the hit points, grinding contact and hop cooldowns of the clockwork, melee and sliding scenarios: there the pieces move by speed and strike, one blow taking a piece',
      'the game\'s own AIs (Stockfish, Obscuro): the core plays a chess map with its generic AI',
    ],
  };
}
