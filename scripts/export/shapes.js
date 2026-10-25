// What the shape-map games' mappings (cs, doom, surviv, combatmission) share: a
// game's authored shape (src/kit/terrainShapes.js: rect, oval or poly) as one of
// the core's board shapes, which are convex only (src/battle/board.js). An oval
// becomes the 16-sided polygon inscribed in it.
export const OVAL_SIDES = 16;

export function boardShape(s) {
  const kind = s.shape ?? 'rect';
  if (kind === 'poly') return { points: s.points.map(p => ({ x: p.x, y: p.y })) };
  if (kind !== 'oval') return { x: s.x, y: s.y, w: s.w, h: s.h };
  const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
  return { points: Array.from({ length: OVAL_SIDES }, (_, i) => ({ x: cx + rx * Math.cos((i * Math.PI) / (OVAL_SIDES / 2)), y: cy + ry * Math.sin((i * Math.PI) / (OVAL_SIDES / 2)) })) };
}

/** Is the polygon convex (every turn the same way)? The core reads no other kind. */
export function isConvex(points) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
