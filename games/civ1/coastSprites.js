// Authentic Civ1 coastline.
//
// The original game draws every ocean tile as one of exactly 16 full 16×16 tiles,
// picked by a 4-bit mask of which of its four CARDINAL neighbours are land —
// diagonals are ignored. Mask 0 is open sea. The tiles are the real ones, lifted
// losslessly from the game's own terrain PIC sheet (row 10), so the shore matches
// the original pixel-for-pixel: no upscaling, no mirroring, no approximation.
//
// The bit order was recovered empirically rather than guessed: matching all 2236
// ocean tiles of the game's earth map against the 16 reference tiles and
// correlating the chosen index against each neighbour gave N=bit0 (0.99),
// E=bit1 (1.00), S=bit2 (0.96), W=bit3 (0.99) — see the scrape notes.
//
// Because the mask has only 16 values and the sheet supplies all 16, every
// possible configuration is covered exactly; there is no fallback case.
const N = 1, E = 2, S = 4, W = 8;

// land: { N, S, E, W } booleans — is land present in that direction. (Diagonals may
// be passed but are ignored, matching the original.) Returns { image } naming the
// tile to draw for this ocean tile.
export function pickCoastTile(land) {
  const mask = (land.N ? N : 0) | (land.E ? E : 0) | (land.S ? S : 0) | (land.W ? W : 0);
  return { image: `coast_${mask}` };
}
