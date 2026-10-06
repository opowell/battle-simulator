<script setup>
// A game's setup page as a console tab: its pictures and scenarios beside every
// seat and option the game offers (play/GamePage.vue), started as a session — or
// as an analysis board — the same way every other start here builds one
// (sessions.js). The form is a step on the way into a game, so a session started
// here takes its tab's place (the console opens its record there, behind the game);
// one that opens in a browser tab of its own leaves the form be.
import { onMounted, ref } from 'vue'
import { api } from '../api.js'
import { analysisBoardRequest, formRequest } from '../sessions.js'
import { useSessionOpener } from '../opener.js'
import GamePage from '../play/GamePage.vue'

// scenario: the one the page opens on ('' for the game's first).
const props = defineProps({ gameName: String, scenario: { type: String, default: '' } })
// created: (row id, { replace }) — the new session's catalog row, as the other forms here report it.
const emit = defineEmits(['close', 'created'])

const game = ref(null)
const error = ref('')
onMounted(async () => {
  try {
    game.value = (await api.games()).find((g) => g.name === props.gameName) ?? null
    if (!game.value) error.value = `No game called ${props.gameName}`
  } catch (e) { error.value = e.message }
})

const opener = useSessionOpener()
const busy = ref(false)

async function start(body) {
  busy.value = true; error.value = ''
  // Begun now, while the click still counts as one: a browser tab opened once
  // the session exists would be stopped by a popup blocker.
  const pending = opener.begin()
  const here = !opener.inNewTab()
  try {
    const created = await api.createSession(body)
    pending.go(created.id)
    emit('created', `sessions:${created.id}`, { replace: here })
  } catch (e) {
    pending.cancel()
    error.value = e.message
  }
  busy.value = false
}
</script>

<template>
  <div class="play sp-setup">
    <GamePage
      :game="game"
      :scenario="scenario"
      :disabled="busy || !game"
      @back="emit('close')"
      @create="(form) => start(formRequest(game, form))"
      @analysis-board="(form) => start(analysisBoardRequest(game, form))"
    />
    <p v-if="error" class="sp-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.sp-setup { position: relative; }
.sp-error { position: absolute; left: 24px; bottom: 8px; margin: 0; color: var(--danger); font-size: 12px; }
</style>
