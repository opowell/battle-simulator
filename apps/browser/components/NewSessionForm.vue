<script setup>
// A new session: pick a game and, if it has any, a scenario; then the seats.
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'
import SessionStarter from './SessionStarter.vue'

const emit = defineEmits(['created'])

const games = ref([])
const gameName = ref('')
const scenario = ref('')
const error = ref('')

const game = computed(() => games.value.find((g) => g.name === gameName.value) ?? null)

onMounted(async () => {
  try {
    games.value = await api.games()
    gameName.value = games.value[0]?.name ?? ''
    scenario.value = games.value[0]?.scenarios?.[0]?.id ?? ''
  } catch (e) { error.value = e.message }
})

function pickGame(name) {
  gameName.value = name
  scenario.value = game.value?.scenarios?.[0]?.id ?? ''
}
</script>

<template>
  <div class="cx-stack">
    <h2>New session</h2>
    <p v-if="error" class="cx-error">{{ error }}</p>
    <div class="cx-grid2">
      <label class="cx-field"><span>Game</span>
        <select class="cx-input" :value="gameName" @change="pickGame($event.target.value)">
          <option v-for="g in games" :key="g.name" :value="g.name">{{ g.name }}</option>
        </select>
      </label>
      <label class="cx-field"><span>Scenario</span>
        <select v-model="scenario" class="cx-input" :disabled="!game?.scenarios?.length">
          <option value="">None — the game's defaults</option>
          <option v-for="s in game?.scenarios ?? []" :key="s.id" :value="s.id">{{ s.name ?? s.id }}</option>
        </select>
      </label>
    </div>
    <p v-if="game && scenario" class="cx-note">{{ game.scenarios.find((s) => s.id === scenario)?.description }}</p>
    <div class="cx-field"><span>Seats</span>
      <SessionStarter v-if="game" :game="game" :scenario="scenario" @created="(id) => emit('created', id)" />
    </div>
  </div>
</template>
