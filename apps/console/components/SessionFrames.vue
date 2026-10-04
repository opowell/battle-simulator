<script setup>
// The play UI of every session open inside the console, one iframe each, kept
// alive for as long as its tab is open. The window renders a tab's content only
// while it is in front, and an iframe that leaves the page — or is merely moved
// to another place in it — loads its page again: a game booted from nothing
// every time the console's own tab is looked at. So the frames live here, over
// the window, each laid over the box its tab shows (SessionPlay) and hidden,
// still running, while that tab is behind another.
import { computed, onBeforeUnmount, reactive, ref, watch, watchEffect } from 'vue'
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

const isShown = (id) => props.slots.has(id) && !!places[id]

// A game is played from the keyboard (civ1's arrows move the unit in hand), and
// its keys listen inside its own frame — which the console's page keeps hold of
// unless told otherwise, so a session just opened, or a tab just brought to the
// front, would answer its first keys with nothing. A frame coming into view takes
// the keyboard; the latest to arrive wins when several do at once.
const frames = {}
const shownIds = computed(() => props.sessionIds.filter(isShown))
watch(shownIds, (now, was = []) => {
  const arrived = now.filter((id) => !was.includes(id)).at(-1)
  if (arrived) focusFrame(arrived)
}, { flush: 'post' })

function focusFrame(id) {
  const frame = frames[id]
  if (!frame) return
  frame.focus()
  frame.contentWindow?.focus()
}

// A frame focused before its page has loaded can lose the keyboard again when the
// page arrives, so it is handed over once more then — unless the keyboard has
// meanwhile gone somewhere else in the console, which is the user's to decide.
function onLoad(id) {
  const frame = frames[id]
  const active = document.activeElement
  if (isShown(id) && (active === frame || active === document.body)) focusFrame(id)
}

function styleOf(id) {
  const place = places[id]
  // Hidden rather than taken away: it keeps its size, so the game inside does
  // not lay itself out for nothing while it waits.
  const shown = isShown(id)
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
      :ref="(el) => { if (el) frames[id] = el; else delete frames[id] }"
      class="sf__frame"
      :style="styleOf(id)"
      :src="playUrl.session(id)"
      title="Session"
      allow="autoplay; fullscreen"
      @load="onLoad(id)"
    />
  </div>
</template>

<style scoped>
/* The layer covers the window and lets every press through but a frame's. */
.sf { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.sf__frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; pointer-events: auto; }
</style>
