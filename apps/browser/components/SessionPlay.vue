<script setup>
// A session opened inside the browser: its board, in the space its tab gives it.
// The tab is kept alive (its panel's keepAlive), so the board stays mounted while
// another tab is in front of it — hidden, still running — rather than being a game
// loaded again from nothing (history, subscription, animation queue) every time
// the browser's own tab is looked at.
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SessionView from '../play/SessionView.vue'
import { SESSION_KEYBOARD } from '../opener.js'

const props = defineProps({ sessionId: String })
// Passed on from the SessionView: open-session (id, { replace }), close.
const emit = defineEmits(['open-session', 'close'])

const keyboard = inject(SESSION_KEYBOARD)
const box = ref(null)

// On screen is having a size: a tab behind another, or a window rolled up, is
// display: none somewhere above this box.
const shown = ref(false)
const observer = new ResizeObserver(([entry]) => {
  shown.value = entry.contentRect.width > 0 && entry.contentRect.height > 0
})
onMounted(() => observer.observe(box.value))
onBeforeUnmount(() => {
  observer.disconnect()
  forget()
})

// A game is played from the keyboard (civ1's arrows move the unit in hand), so a
// board coming into view takes the keyboard — a session just opened, or a tab just
// brought to the front, answers its first key without a click on it first. Of the
// boards on screen (two sessions side by side), the one that has the keyboard is
// the one last arrived or last pressed on, and it alone answers keys.
function forget() {
  keyboard.shown.delete(props.sessionId)
  if (keyboard.keyed.value === props.sessionId) keyboard.keyed.value = [...keyboard.shown].at(-1) ?? null
}
watch(shown, (now) => {
  if (!now) return forget()
  keyboard.shown.add(props.sessionId)
  keyboard.keyed.value = props.sessionId
  // SessionView's root is focusable (tabindex -1), and there from the start —
  // while the board is still loading too. Not now but once this task is over: the
  // window switches tabs on pointerdown, after which the browser's own mousedown
  // still focuses the tab that was pressed.
  setTimeout(() => box.value?.querySelector('[tabindex]')?.focus({ preventScroll: true }))
})
</script>

<template>
  <div ref="box" class="sp" @pointerdown.capture="keyboard.keyed.value = sessionId">
    <SessionView
      :session-id="sessionId"
      :active="shown && keyboard.keyed.value === sessionId"
      @open-session="(next, options) => emit('open-session', next, options)"
      @close="emit('close')"
    />
  </div>
</template>

<style scoped>
/* The box is what a page of its own would have been to the board: its full-screen
   scrims (position: fixed; inset: 0) cover the board, not the Browser — layout
   containment makes the box their containing block. Paint containment keeps the
   board's own stacking (its panel desk sits at z-index 40) inside its window,
   under the window's resize grips and under any window in front of it. */
.sp { width: 100%; height: 100%; background: var(--dc-bg-0); contain: layout paint; }
</style>
