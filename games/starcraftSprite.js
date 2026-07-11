// Shared map-unit sprite for SC1/SC2: an all-primitive body (no sourced art — see
// games/cs/CsGame.js's spriteLayers() for the pattern this follows) built from generic
// unit-definition tags (domain, special, hp) rather than a per-type shape table, so a
// new unit in either roster gets a sane sprite for free. `fill: 'team'` defers to the
// owner's palette color (apps/design/SchematicLayer.vue's layerColor), since sc1/sc2
// player order — and therefore which race sits on which side — isn't fixed the way
// CS's CT/T always are.
const BODY_STROKE = '#20242c';

export function scSpriteLayers(type, def) {
  const { domain, special = [], hp = 0 } = def;
  const isWorker  = special.includes('worker');
  const isMassive = special.includes('massive') || special.includes('siege') || hp >= 300;
  const isCaster  = def.attack === 0 && !isWorker;
  const bodyR = isWorker ? 0.72 : 1.0;
  const layers = [];

  // Heavy/massive units get an outer ring halo.
  if (isMassive) {
    layers.push({ shape: 'circle', rFrac: 1.28, fill: 'none', stroke: 'team', strokeWidth: 1.5, dx: 0, dy: 0, rot: 0 });
  }
  // Body.
  layers.push({ shape: 'circle', rFrac: bodyR, fill: 'team', stroke: BODY_STROKE, strokeWidth: 2, dx: 0, dy: 0, rot: 0 });
  // Air units get a pair of wing fins, hinged exactly on the body's edge and extending
  // radially outward from there (anchorX: 0 → the rect grows away from its hinge, not
  // around it), which guarantees they clear the opaque body circle instead of being
  // hidden under it.
  if (domain === 'air') {
    for (const side of [-1, 1]) {
      const angleDeg = 90 + side * 55;
      const rad = angleDeg * Math.PI / 180;
      layers.push({
        shape: 'rect', wFrac: 0.6, hFrac: 0.22, anchorX: 0, anchorY: 0.5, rxFrac: 0.3,
        fill: 'team', stroke: BODY_STROKE, strokeWidth: 1,
        dx: bodyR * Math.cos(rad), dy: bodyR * Math.sin(rad), rot: angleDeg,
      });
    }
  }
  // Workers get a small tool accent; casters get a diamond core.
  if (isWorker) {
    layers.push({
      shape: 'rect', wFrac: 0.5, hFrac: 0.16, anchorX: 0.5, anchorY: 0.5, rxFrac: 0.5,
      fill: '#d8dee6', stroke: BODY_STROKE, strokeWidth: 1, dx: 0.28, dy: 0.28, rot: 45,
    });
  } else if (isCaster) {
    layers.push({
      shape: 'rect', wFrac: 0.55, hFrac: 0.55, anchorX: 0.5, anchorY: 0.5, rxFrac: 0.12,
      fill: '#c9a6ff', stroke: '#3a2a55', strokeWidth: 1, dx: 0, dy: 0, rot: 45,
    });
  }
  // Type-letter glyph on top, dark-on-light-team-color legible via a thin white outline.
  layers.push({
    shape: 'text', text: type[0].toUpperCase(), rFrac: bodyR * 0.95,
    fill: '#12141a', stroke: '#ffffffb0', strokeWidth: 2, dx: 0, dy: 0, rot: 0,
  });
  return layers;
}
