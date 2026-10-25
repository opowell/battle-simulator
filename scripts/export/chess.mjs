// Chess's boards in the core's format (scripts/export-pack.mjs). Chess has no
// terrain: every scenario plays on the same eight by eight squares, and the only
// difference between its light and dark squares is their colour. What the
// scenarios change is the quadrant of (space × time) the pieces move in, which a
// library map carries as its `modes`; the opening position is the one the game
// deals itself for that scenario, white (seat 0) at the bottom as the game draws it.
// Fog of War is the standard board with fog on, and fog is the core's own setup
// switch rather than a map's, so it adds no map of its own.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FILES = 'abcdefgh';

/** The cell a piece stands on: its `cell` off the board of squares, else its algebraic square. */
function cellOf(u) {
  if (u.cell) return [u.cell.x, u.cell.y];
  return [FILES.indexOf(u.position[0]), 8 - Number(u.position.slice(1))];
}

export default async function exportBoards(dir) {
  const { ChessGame } = await import(pathToFileURL(path.join(dir, 'ChessGame.js')).href);
  const colour = ChessGame.colors;
  const players = [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }];
  // a8 (the top-left cell) is a light square.
  const rows = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => ((x + y) % 2 ? 'd' : 'l')).join(''));
  const maps = {};
  for (const sc of ChessGame.scenarios) {
    if (sc.config.fogOfWar) continue;
    const { units } = ChessGame.createInitialState(players, sc.config);
    maps[sc.id] = {
      name: sc.name,
      description: sc.description,
      board: { topology: 'square', width: 8, height: 8, rows, legend: { l: 'light', d: 'dark' }, stacking: 'one' },
      units: units.map(u => ({ type: u.type, seat: players.findIndex(p => p.id === u.ownerId), at: cellOf(u) })),
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
      'how each piece moves (the knight\'s jump, the bishop\'s diagonals, the pawn\'s single step forward and diagonal capture): a library piece moves and strikes by its move and range like any other unit',
      'capture by moving onto a piece: the core strikes from a distance and the struck piece loses hit points',
      'check, checkmate, stalemate and the king as the piece that decides the game: the core plays a chess map to elimination (a placement cannot carry the royal tag)',
      'castling, en passant, promotion and the double first pawn step',
      'draws by repetition, the fifty-move rule and insufficient material',
      'Fog of War\'s per-square sight and its piece markers: the fog scenario is the standard board, and the core\'s own fog is a setup switch',
      'the hit points, grinding contact and hop cooldowns of the clockwork, melee and sliding scenarios: their maps keep only their space and time',
    ],
  };
}
