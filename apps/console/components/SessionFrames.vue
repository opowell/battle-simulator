<script setup>
// The play UI of every session open inside the console, one iframe each, kept
// alive for as long as its tab is open. The window renders a tab's content only
// while it is in front, and an iframe that leaves the page — or is merely moved
// to another place in it — loads its page again: a game booted from nothing
// every time the console's own tab is looked at. So the frames live here, over
// the window, each laid over the box its tab shows (SessionPlay) and hidden,
// still running, while that tab is behind another.
import { onBeforeUnmount, reactive, ref, watchEffect } from 'vue'
import { playUrl } from '../api.js'

const props = defineProps({
  /** The ids of the sessions open in the console. */
  sessionIds: Array,
  /** SESSION_SLOTS: the box each session is showing in, while it is. */
  slots: Map,
})

const layer = ref(null)
/** Where each frame sits in the layer, as last measured. */
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
// browser resized — so while a frame is showing it follows its box each frame.
let raf = 0
const follow = () => { measure(); raf = requestAnimationFrame(follow) }
watchEffect(() => {
  const showing = props.slots.size > 0
  if (showing && !raf) follow()
  if (!showing && raf) { cancelAnimationFrame(raf); raf = 0 }
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

function styleOf(id) {
  const place = places[id]
  // Hidden rather than taken away: it keeps its size, so the game inside does
  // not lay itself out for nothing while it waits.
  const shown = props.slots.has(id) && place
  return {
    ...(place ? { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px`, height: `${place.height}px` } : {}),
    visibility: shown ? 'visible' : 'hidden',
  }
}
</script>

<template>
  <div ref="layer" class="sf">
    <iframe
      v-for="id in sessionIds"
      :key="id"
      class="sf__frame"
      :style="styleOf(id)"
      :src="playUrl.session(id)"
      title="Session"
      allow="autoplay; fullscreen"
    />
  </div>
</template>

<style scoped>
/* The layer covers the window and lets every press through but a frame's. */
.sf { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.sf__frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; pointer-events: auto; }
</style>
