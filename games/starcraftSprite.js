// Shared map-unit sprite for SC1/SC2: an all-primitive body (no sourced art — see
// games/cs/CsGame.js's spriteLayers() for the pattern this follows) built from generic
// unit-definition tags (domain, special, hp) rather than a per-type shape table, so a
// new unit in either roster gets a sane sprite for free. `fill: 'team'` defers to the
// owner's palette color (apps/console/play/SchematicLayer.vue's layerColor), since sc1/sc2
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

// Map sprite for a unit that has real art (SC1's games/sc1/images/map-original/ and
// map-remastered/, the in-game sprites from the StarCraft fandom wiki — see
// games/sc1/images/SPRITES.md): the picture
// standing on a team-coloured base ring. The art is not recoloured: each sprite was
// captured in whatever player colour its screenshot happened to use (purple, red,
// none at all on Protoss gold), so tinting would mark some units and not others. The
// ring is what says whose unit it is, the same way for every one.
//
// How big the picture draws: given `px`, the unit's size in the original game (the
// larger side of its units.dat box, in game pixels), it is that against a 32 px
// dragoon/goliath/siege tank — so a marine (20 px) stands at under two thirds of a
// goliath and an overlord over it, as they do in the game. The art files can't say
// this themselves: each was blown up by its own whole factor to a similar file size
// (games/sc1/images/SPRITES.md), which is how a marine came to draw as big as a
// dragoon. Clamped so a zergling stays clickable and a battlecruiser doesn't swallow
// its escort. Without `px`, a rougher rule from the definition's tags: workers a size
// down, the massive units (battlecruiser, carrier, ultralisk) a size up.
const REFERENCE_PX = 32, MIN_SCALE = 0.6, MAX_SCALE = 1.5;
function imageScale(def, px) {
  if (px > 0) return Math.min(MAX_SCALE, Math.max(MIN_SCALE, px / REFERENCE_PX));
  const { special = [], hp = 0 } = def;
  if (special.includes('worker')) return 0.85;
  return (special.includes('massive') || hp >= 300) ? 1.35 : 1;
}

// `pixelated`: the 1998 originals are low-resolution pictures blown up by a whole
// factor, so the renderer keeps their hard pixel edges rather than smearing them when
// it scales them again (the Remastered art is drawn smooth).
export function scImageSpriteLayers(src, def, { px, pixelated = false } = {}) {
  const k = imageScale(def, px);
  return [
    { shape: 'circle', rFrac: k * 0.95, fill: '#0000002e', stroke: 'team', strokeWidth: 2, dx: 0, dy: 0, rot: 0 },
    { src, wFrac: k * 2.5, hFrac: k * 2.5, anchorX: 0.5, anchorY: 0.5, dx: 0, dy: 0, rot: 0,
      ...(pixelated ? { pixelated: true } : {}) },
  ];
}

// The clickable radius that picture needs, as a multiple of the token radius (the
// renderers' `hitRFrac`): the art overhangs the ring, and a click on a marine's rifle
// should still pick the marine.
export function scImageHitRFrac(def, px) {
  return imageScale(def, px) * 1.2;
}

// Building counterpart to scImageSpriteLayers: the structure's art on a team-outlined
// footprint plate (a building's token is square, so its owner mark is too). The art
// overhangs the plate a little, as a building's sprite overhangs its footprint in the
// game. Sized by the token itself (scBuildingSize → the renderers' sizeFrac).
export function scBuildingImageSpriteLayers(src, { pixelated = false } = {}) {
  return [
    { shape: 'rect', wFrac: 2, hFrac: 2, anchorX: 0.5, anchorY: 0.5, rxFrac: 0.18,
      fill: '#0000002e', stroke: 'team', strokeWidth: 2, dx: 0, dy: 0, rot: 0 },
    { src, wFrac: 2.3, hFrac: 2.3, anchorX: 0.5, anchorY: 0.5, dx: 0, dy: 0, rot: 0,
      ...(pixelated ? { pixelated: true } : {}) },
  ];
}

// How big a structure's token draws, as a multiple of the standard unit token (the
// renderers' `sizeFrac`, see apps/console/play/SchematicLayer.vue's unitR). A base is the
// landmark you navigate by and reads at a glance; a bunker or a turret is barely more
// than a unit. Derived from the same generic definition tags scSpriteLayers uses, so a
// new structure gets a sane size for free: the buildTime-0 town hall and the things it
// upgrades into are the biggest, then anything that trains units, then the rest.
export function scBuildingSize(def) {
  // No defaulting of buildTime: an unrecognised structure is a plain one, not a base.
  const { buildTime, produces = [], special = [] } = def;
  if (buildTime === 0 || special.some(s => s.startsWith('upgrade-from'))) return 2.4;
  if (produces.length) return 1.9;
  return 1.5;
}

// ── How much of the map a token covers, in squares ───────────────────────────
// What the layers above draw, measured in board squares rather than token radii, so a
// game can keep its units off the ground its structures stand on (games/sc1/placement.js).
//
// TOKEN_R is the renderers' standard token radius on a square board wider than ten
// squares — the only kind SC1/SC2 maps are (unitR in apps/console/play/SchematicLayer.vue
// and HtmlLayer.vue: 0.42 of a square). Every size here is a multiple of it.
export const TOKEN_R = 0.42;

// Half the side of a structure's plate (the wFrac-2 rect above): the square, centred on
// the structure, that it covers on the map.
export function scBuildingHalfSide(def) {
  return TOKEN_R * scBuildingSize(def);
}

// Radius of the team ring a unit with map art stands on (scImageSpriteLayers' circle):
// the patch of ground the unit itself covers.
export function scUnitRingR(def, px) {
  return TOKEN_R * imageScale(def, px) * 0.95;
}

// Structure counterpart to scSpriteLayers: a squared-off plated body, so a big token
// reads as a building rather than as an oversized unit. Same idiom otherwise — all
// primitives, team-colored, type letter on top.
export function scBuildingSpriteLayers(type, def) {
  const isDefensive = (def.attack ?? 0) > 0;
  return [
    // Body: fills the token box, corners knocked off.
    { shape: 'rect', wFrac: 2, hFrac: 2, anchorX: 0.5, anchorY: 0.5, rxFrac: 0.18,
      fill: 'team', stroke: BODY_STROKE, strokeWidth: 2, dx: 0, dy: 0, rot: 0 },
    // Inset plate: a darker roof panel, which is what separates a structure from a
    // unit's flat disc at a glance.
    { shape: 'rect', wFrac: 1.34, hFrac: 1.34, anchorX: 0.5, anchorY: 0.5, rxFrac: 0.08,
      fill: '#00000030', stroke: BODY_STROKE, strokeWidth: 1, dx: 0, dy: 0, rot: 0 },
    // Armed structures (bunker, sunken/spore colony, turret, photon cannon) wear a
    // muzzle stub, the one thing worth knowing about a building from across the map.
    ...(isDefensive
      // anchorY: 1 hinges the stub on its bottom edge so it grows away from the body
      // (the same trick scSpriteLayers uses for an air unit's wings) instead of sinking
      // into it.
      ? [{ shape: 'rect', wFrac: 0.34, hFrac: 0.5, anchorX: 0.5, anchorY: 1,
           rxFrac: 0.4, fill: '#d8dee6', stroke: BODY_STROKE, strokeWidth: 1,
           dx: 0, dy: -1, rot: 0 }]
      : []),
    { shape: 'text', text: type[0].toUpperCase(), rFrac: 1.1,
      fill: '#12141a', stroke: '#ffffffb0', strokeWidth: 2, dx: 0, dy: 0, rot: 0 },
  ];
}
