<script setup>
// A scenario: what it sets up, and a session started from it in one click —
// with the seats the play UI's form would open with, straight into play. Anyone
// wanting other seats or options goes through the play UI's setup page.
import { onMounted, ref } from 'vue'
import { api, playUrl } from '../api.js'
import { defaultSeats, sessionRequest } from '../sessions.js'
import { useSessionOpener } from '../opener.js'

const props = defineProps({ record: Object })
const emit = defineEmits(['created'])

const game = ref(null)
const error = ref('')
onMounted(async () => {
  try { game.value = (await api.games()).find((g) => g.name === props.record.game) ?? null }
  catch (e) { error.value = e.message }
})

const opener = useSessionOpener()
const busy = ref(false)

async function start() {
  busy.value = true; error.value = ''
  // Begun now, while the click still counts as one: a browser tab opened once
  // the session exists would be stopped by a popup blocker.
  const pending = opener.begin()
  try {
    const { scenario } = props.record
    const created = await api.createSession(sessionRequest(game.value, scenario, defaultSeats(game.value, scenario)))
    pending.go(created.id)
    emit('created', `sessions:${created.id}`)
  } catch (e) {
    pending.cancel()
    error.value = e.message
  }
  busy.value = false
}
</script>

<template>
  <div class="cx-stack">
    <p v-if="record.description">{{ record.description }}</p>
    <div class="cx-row">
      <button type="button" class="cx-btn cx-btn--primary" :disabled="busy || !game" @click="start">
        {{ busy ? 'Starting…' : 'Start session' }}{{ opener.inNewTab() ? ' ↗' : '' }}
      </button>
      <a v-if="game" class="cx-btn" :href="playUrl.game(game.name)" target="_blank" rel="noopener">Other seats or options, in the play UI ↗</a>
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
    <h3>What it configures</h3>
    <pre class="cx-code">{{ JSON.stringify(record.config, null, 2) }}</pre>
  </div>
</template>
