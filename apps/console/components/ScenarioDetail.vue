<script setup>
// A scenario: what it sets up, and a session started from it.
import { onMounted, ref } from 'vue'
import { api } from '../api.js'
import SessionStarter from './SessionStarter.vue'

const props = defineProps({ record: Object })
const emit = defineEmits(['created'])

const game = ref(null)
const error = ref('')
onMounted(async () => {
  try { game.value = (await api.games()).find((g) => g.name === props.record.game) ?? null }
  catch (e) { error.value = e.message }
})
</script>

<template>
  <div class="cx-stack">
    <p v-if="record.description">{{ record.description }}</p>
    <h3>Start it</h3>
    <p v-if="error" class="cx-error">{{ error }}</p>
    <SessionStarter v-else-if="game" :game="game" :scenario="record.scenario" @created="(id) => emit('created', id)" />
    <p v-else class="cx-muted">Loading…</p>
    <h3>What it configures</h3>
    <pre class="cx-code">{{ JSON.stringify(record.config, null, 2) }}</pre>
  </div>
</template>
