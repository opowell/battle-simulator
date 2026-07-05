// Recolor SC1 unit sprites to a player's team color — no build step, browser canvas only.
//
// The sprites in images/units/*.png store their team-color region as a magenta ramp
// (bright magenta -> dark), exactly like StarCraft's player-color remap. To color a
// unit we find those magenta pixels and swap their hue+saturation to the target color
// while preserving the ramp's brightness (so shading/highlights are kept).
//
//   import { recolorToCanvas, loadRecolored, TEAM_COLORS } from './teamColor.js';
//   const canvas = await loadRecolored('/images/sc1/units/marine.png', TEAM_COLORS.blue);
//   ctx.drawImage(canvas, x, y);

// Target team colors as { h: hue 0-360, s: saturation 0-1 }. s:0 gives a grey ramp (white player).
export const TEAM_COLORS = {
  red:    { h:   0, s: 1.00 },
  blue:   { h: 222, s: 1.00 },
  teal:   { h: 174, s: 0.90 },
  purple: { h: 280, s: 0.85 },
  orange: { h:  28, s: 1.00 },
  brown:  { h:  22, s: 0.70 },
  white:  { h:   0, s: 0.00 },
  yellow: { h:  52, s: 1.00 },
  green:  { h: 110, s: 0.85 },
  pink:   { h: 320, s: 0.65 },
};

// A pixel belongs to the team-color ramp when red and blue both clearly exceed green
// (the magenta family). Matches the extraction mask used to rip the sprites.
function isTeamPixel(r, g, b) {
  return (r - g) > 25 && (b - g) > 25;
}

function rgbToV(r, g, b) { return Math.max(r, g, b) / 255; }

// HSV -> RGB with the given hue (deg), saturation (0-1), value (0-1). Returns [r,g,b] 0-255.
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 1)      [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else            [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Recolor an ImageData in place. `color` is a { h, s } from TEAM_COLORS (or your own).
export function recolorImageData(data, color) {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;                 // transparent
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (!isTeamPixel(r, g, b)) continue;          // keep the unit's own colors
    const [nr, ng, nb] = hsvToRgb(color.h, color.s, rgbToV(r, g, b));
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  return data;
}

// Draw an already-loaded HTMLImageElement recolored, returning a fresh <canvas>.
export function recolorToCanvas(image, color) {
  const cv = document.createElement('canvas');
  cv.width = image.naturalWidth || image.width;
  cv.height = image.naturalHeight || image.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  const id = ctx.getImageData(0, 0, cv.width, cv.height);
  recolorImageData(id, color);
  ctx.putImageData(id, 0, 0);
  return cv;
}

// Convenience: fetch a sprite URL and resolve to a recolored <canvas>.
export function loadRecolored(url, color) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(recolorToCanvas(img, color));
    img.onerror = reject;
    img.src = url;
  });
}
