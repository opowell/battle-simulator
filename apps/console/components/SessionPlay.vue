<script setup>
// Where a session opened inside the console shows: the space its tab gives it.
// The board itself is not in here — the window mounts a tab's content only
// while the tab is in front, and a board that is unmounted is a game loaded
// again from nothing on the way back. SessionFrames keeps each one alive over
// the whole window and lays it over this box while there is one.
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { SESSION_SLOTS } from '../opener.js'

const props = defineProps({ sessionId: String })
const slots = inject(SESSION_SLOTS)
const box = ref(null)

onMounted(() => slots.set(props.sessionId, box.value))
onBeforeUnmount(() => { if (slots.get(props.sessionId) === box.value) slots.delete(props.sessionId) })
</script>

<template>
  <div ref="box" class="sp" />
</template>

<style scoped>
.sp { width: 100%; height: 100%; background: var(--dc-bg-0); }
</style>
