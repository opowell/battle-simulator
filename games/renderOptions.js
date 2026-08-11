// Shared game options related to how a board is rendered (client display concerns, not
// game rules — the engine ignores them). Spread into a game's `gameOptions` so they show
// up in the configure modal like any other option.
//
// There is no HTML-vs-SVG renderer option: Battlefield.vue picks HtmlLayer/HtmlIsoLayer
// wherever HTML can fully draw the board and SchematicLayer/IsoLayer where it can't (see
// its useHtmlRenderer). Nothing to configure, so nothing is offered.

// Show zoom in/out buttons on the bottom bar and let a click on the map recentre the view
// (see Battlefield.vue's zoom state). Worth adding for games whose map is bigger than the
// stage can usefully show at once; small fixed boards (chess) should leave it out entirely.
// A game whose map is ALWAYS too big to show at once shouldn't offer the choice at all:
// set `ui.mapZoom: true` and skip this option (civ1).
// The starting zoom comes from the game's `ui.defaultTileSize` (px per tile); without one
// the view starts fitted to the stage as before.
//
// Only for the SVG (SchematicLayer) and HTML (HtmlLayer) renderers, which both take their
// geometry from Battlefield's fitter. ISOMETRIC games (civ2's `ui.isometric`) must NOT add
// this: IsoLayer and HtmlIsoLayer solve their own scale/origin from their own box and ignore the fitter, so
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
