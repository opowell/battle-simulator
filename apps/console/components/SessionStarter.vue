<script setup>
// Starts a session of `game` (a GET /games entry), optionally from one of its
// scenarios, with the seats the play UI's form would open with — editable here.
// Every other option stays at the game's (or the scenario's) default; the play
// UI's setup page is linked for anything more. The new session opens where the
// settings say sessions open.
import { ref, watch } from 'vue'
import { api, playUrl } from '../api.js'
import { defaultSeats, sessionRequest } from '../sessions.js'
import { useSessionOpener } from '../opener.js'
import SeatsEditor from './SeatsEditor.vue'

const props = defineProps({ game: Object, scenario: { type: String, default: '' } })
const emit = defineEmits(['created'])

const seats = ref([])
watch(() => [props.game, props.scenario], () => {
  seats.value = props.game ? defaultSeats(props.game, props.scenario) : []
}, { immediate: true })

const opener = useSessionOpener()
const busy = ref(false)
const error = ref('')

async function start() {
  const pending = opener.begin()
  busy.value = true; error.value = ''
  try {
    const created = await api.createSession(sessionRequest(props.game, props.scenario, seats.value))
    pending.go(created.id)
    emit('created', `sessions:${created.id}`)
  } catch (e) { pending.cancel(); error.value = e.message }
  busy.value = false
}
</script>

<template>
  <div class="cx-stack">
    <SeatsEditor v-model="seats" :agents="game?.agents ?? []" />
    <div class="cx-row">
      <button type="button" class="cx-btn cx-btn--primary" :disabled="busy || !game" @click="start">Start session{{ opener.inNewTab() ? ' ↗' : '' }}</button>
      <a v-if="game" class="cx-btn" :href="playUrl.game(game.name)" target="_blank" rel="noopener">Every option, in the play UI ↗</a>
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
  </div>
</template>
