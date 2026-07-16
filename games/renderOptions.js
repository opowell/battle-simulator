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
  description: 'Render the board with the experimental HTML renderer instead of SVG.',
  type: 'boolean',
  default: false,
};
