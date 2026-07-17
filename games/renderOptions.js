// Shared game options related to how a board is rendered (client display concerns, not
// game rules — the engine ignores them). Spread into a game's `gameOptions` so they show
// up in the configure modal like any other option.

// Opt into the experimental HTML/CSS board renderer (apps/design/HtmlLayer.vue) instead of
// the default SVG one (SchematicLayer.vue). Only meaningful for square tile-grid boards;
// Battlefield falls back to SVG for anything else. Also live-toggleable from the in-game
// menu (see MenuOverlay's "HTML board renderer" toggle).
export const HTML_RENDERER_OPTION = {
  id: 'htmlRenderer',
  label: 'HTML board renderer',
  description: 'Render the board with the HTML renderer (default). Turn off for the SVG one.',
  type: 'boolean',
  default: true,
};

// Show zoom in/out buttons on the bottom bar and let a click on the map recentre the view
// (see Battlefield.vue's zoom state). Worth adding for games whose map is bigger than the
// stage can usefully show at once; small fixed boards (chess) should leave it out entirely.
// The starting zoom comes from the game's `ui.defaultTileSize` (px per tile); without one
// the view starts fitted to the stage as before.
//
// Only for the SVG (SchematicLayer) and HTML (HtmlLayer) renderers, which both take their
// geometry from Battlefield's fitter. ISOMETRIC games (civ2's `ui.isometric`) must NOT add
// this: IsoLayer solves its own scale/origin from its own box and ignores the fitter, so
// the buttons would render but do nothing. Teaching it to zoom means threading the scale
// and centre through that solver — its diamond half-width isn't a tile size, and the
// world-axis pan clamp doesn't map onto iso screen space.
export const MAP_ZOOM_OPTION = {
  id: 'mapZoom',
  label: 'Zoom & pan controls',
  description: 'Show zoom buttons, and recentre the map on the spot you click.',
  type: 'boolean',
  default: true,
};
