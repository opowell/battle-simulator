// sessionScope.js — what a session's board needs to know about the page it shares.
//
// The console keeps every open session's board alive at once, side by side in one
// document, where each used to have a page of its own. Two things follow, each
// provided by SessionView to everything under it:
//
// KEYS_LIVE — a function of a keydown: is this key mine to answer? Every board
//   listens on window for its keys, so a board must not act on a key just because
//   it heard it — only while its session is on screen and holds the keyboard.
//
// OVERLAY_TARGET — where the board's overlays (the city screen, the advisors, the
//   game-over dialog) are drawn: inside the session, not on the document's body,
//   so they stay within its box, wear its look (play.css is scoped to .play), and
//   count as the session's own when a key is pressed on one. See PlayOverlay.
//
// Outside a session (no provider) both fall back to what a page of its own had.
import { Teleport, h, inject, unref } from 'vue'

// Strings, not Symbols: this module is loaded twice — natively by install.js (which
// registers PlayOverlay) and by the SFC loader for the components — and each copy
// would mint its own Symbol, so a provide from one would never reach an inject
// from the other.
export const KEYS_LIVE = 'play:keys-live'
export const OVERLAY_TARGET = 'play:overlay-target'

export const useKeysLive = () => inject(KEYS_LIVE, () => true)

/** <PlayOverlay> — a teleport to the session's overlay layer (registered by install.js). */
export const PlayOverlay = {
  name: 'PlayOverlay',
  setup(_, { slots }) {
    const target = inject(OVERLAY_TARGET, 'body')
    // Deferred, so a target that is a ref of the session's own root is in place by
    // the time an overlay mounted in the same pass looks for it.
    return () => h(Teleport, { to: unref(target) ?? 'body', defer: true }, slots.default?.())
  },
}
