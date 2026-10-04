<script setup>
// Every session open inside the console, one SessionView each, kept alive for as
// long as its tab is open. The window renders a tab's content only while it is in
// front, and a board unmounted with it would be a game loaded again from nothing
// (history, subscription, animation queue) every time the console's own tab is
// looked at. So the boards live here, over the window, each laid over the box its
// tab shows (SessionPlay) and hidden, still running, while that tab is behind
// another.
import { computed, onBeforeUnmount, reactive, ref, watch, watchEffect } from 'vue'
import SessionView from '../play/SessionView.vue'

const props = defineProps({
  /** The ids of the sessions open in the console. */
  sessionIds: Array,
  /** SESSION_SLOTS: the box each session is showing in, while it is. */
  slots: Map,
})
// Passed on from a SessionView: open-session (id, { replace }), close.
const emit = defineEmits(['open-session', 'close'])

const layer = ref(null)
/** Where each board sits in the layer, as last measured. */
const places = reactive({})

function measure() {
  const origin = layer.value?.getBoundingClientRect()
  if (!origin) return
  for (const [id, box] of props.slots) {
    const r = box.getBoundingClientRect()
    const place = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }
    const was = places[id]
    if (!was || Object.keys(place).some((k) => was[k] !== place[k])) places[id] = place
  }
}

// A box moves without being told to — a splitter dragged, a tab carried, the
// browser resized — so while a board is showing it follows its box each frame.
let raf = 0
const follow = () => { measure(); raf = requestAnimationFrame(follow) }
watchEffect(() => {
  const showing = props.slots.size > 0
  if (showing && !raf) follow()
  if (!showing && raf) { cancelAnimationFrame(raf); raf = 0 }
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const isShown = (id) => props.slots.has(id) && !!places[id]

// A game is played from the keyboard (civ1's arrows move the unit in hand), so a
// board coming into view takes the keyboard — a session just opened, or a tab just
// brought to the front, answers its first key without a click on it first. Of the
// boards on screen (two sessions split side by side), the one that has the keyboard
// is the one last arrived or last pressed on, and it alone answers keys.
const hosts = {}
const keyed = ref(null)
const shownIds = computed(() => props.sessionIds.filter(isShown))
watch(shownIds, (now, was = []) => {
  const arrived = now.filter((id) => !was.includes(id)).at(-1)
  if (arrived) {
    keyed.value = arrived
    // SessionView's root is focusable (tabindex -1), and there from the start —
    // while the board is still loading too. Not now but once this task is over,
    // for two reasons: a tab brought back to the front lands here mid-flush, before
    // this layer has drawn the board visible again (a hidden element refuses the
    // focus); and the window switches tabs on pointerdown, after which the browser's
    // own mousedown still focuses the tab that was pressed.
    setTimeout(() => hosts[arrived]?.querySelector('[tabindex]')?.focus({ preventScroll: true }))
  } else if (!now.includes(keyed.value)) {
    keyed.value = now.at(-1) ?? null
  }
}, { flush: 'post' })

function styleOf(id) {
  const place = places[id]
  // Hidden rather than taken away: it keeps its size, so the game inside does
  // not lay itself out for nothing while it waits.
  return {
    ...(place ? { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px`, height: `${place.height}px` } : {}),
    visibility: isShown(id) ? 'visible' : 'hidden',
  }
}
</script>

<template>
  <div ref="layer" class="sf">
    <div
      v-for="id in sessionIds"
      :key="id"
      :ref="(el) => { if (el) hosts[id] = el; else delete hosts[id] }"
      class="sf__frame"
      :style="styleOf(id)"
      @pointerdown.capture="keyed = id"
    >
      <SessionView
        :session-id="id"
        :active="isShown(id) && keyed === id"
        @open-session="(next, options) => emit('open-session', next, { ...options, from: id })"
        @close="emit('close', id)"
      />
    </div>
  </div>
</template>

<style scoped>
/* The layer covers the window and lets every press through but a board's. */
.sf { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
/* Each board's box is what a page of its own would have been to it: its
   full-screen scrims (position: fixed; inset: 0) cover the board, not the
   console — layout containment makes the box their containing block. */
.sf__frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: auto; contain: layout paint; }
</style>
