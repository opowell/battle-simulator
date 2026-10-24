// dragPan.js — grab the map and drag it, on any board that zooms (the `mapZoom` option).
//
// The gesture is a held Cmd (Ctrl off a Mac) with the left button, or the middle button
// on its own: a plain left drag is already taken — box-select on an RTS map, drag-to-move
// on others — and the right button draws annotation arrows (HtmlLayer). It is caught in
// the CAPTURE phase on the stage, ahead of every board layer, so the same gesture pans
// whichever renderer is mounted and none of them has to know about it.
//
// A press that never travels is not swallowed: Cmd+click still reaches the board as a
// click (a territory game reads Ctrl/Cmd as a modifier). Only once the pointer has moved
// a few pixels does it become a pan, and then the click the release would fire is eaten,
// so letting go of the map never also deselects, recentres or gives an order.
import { ref, onUnmounted } from 'vue';

const MIN_DRAG_PX = 4;

/** Whether a mousedown is the start of a pan gesture (not of a click, box or arrow). */
export function isPanPress(e) {
  return e.button === 1 || (e.button === 0 && (e.metaKey || e.ctrlKey));
}

/**
 * The world point the map moves to when the pointer has travelled (dx, dy) screen px
 * from where the drag began: the point under the pointer stays under it, so the centre
 * moves the opposite way, scaled from screen px to world units by the tile size.
 */
export function pannedCenter(startCenter, dx, dy, tilePx) {
  return { x: startCenter.x - dx / tilePx, y: startCenter.y - dy / tilePx };
}

/**
 * @param {object} o
 * @param {() => boolean} o.enabled     whether this board pans at all (zoom on)
 * @param {() => number}  o.tilePx      current tile size in screen px
 * @param {() => {x,y}}   o.center      the centre as currently DRAWN (after clamping)
 * @param {({x,y}) => void} o.setCenter
 * @returns {{ panning: import('vue').Ref<boolean>, onMousedown: (e: MouseEvent) => void }}
 */
export function useDragPan({ enabled, tilePx, center, setCenter }) {
  const panning = ref(false);
  let start = null;

  function onMove(e) {
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!panning.value && Math.hypot(dx, dy) < MIN_DRAG_PX) return;
    panning.value = true;
    setCenter(pannedCenter(start.center, dx, dy, start.tilePx));
  }

  function eatClick(e) { e.stopPropagation(); e.preventDefault(); }

  function stop() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }

  function onUp() {
    stop();
    if (panning.value) {
      // The browser fires the release's click (auxclick for the middle button) right
      // after this mouseup; catch it once, then stop listening in case none comes.
      window.addEventListener('click', eatClick, { capture: true, once: true });
      window.addEventListener('auxclick', eatClick, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener('click', eatClick, { capture: true });
        window.removeEventListener('auxclick', eatClick, { capture: true });
      }, 50);
    }
    panning.value = false;
    start = null;
  }

  function onMousedown(e) {
    if (!enabled() || !isPanPress(e)) return;
    e.preventDefault();      // no middle-button autoscroll, no text selection
    e.stopPropagation();     // the board layers never see the press: no box, no drag
    start = { x: e.clientX, y: e.clientY, center: center(), tilePx: tilePx() };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onUnmounted(stop);
  return { panning, onMousedown };
}
