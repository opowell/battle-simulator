<script setup>
// A new game: the server scaffolds a minimal, runnable definition under
// games/<name>/ and registers it — playable once the server restarts.
import { ref } from 'vue'
import { api } from '../api.js'
import PlayersEditor from './PlayersEditor.vue'

const emit = defineEmits(['created'])

const form = ref({
  name: '',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
})
const busy = ref(false)
const error = ref('')

async function create() {
  busy.value = true; error.value = ''
  try {
    const made = await api.createGame(form.value)
    emit('created', made.name)
  } catch (e) { error.value = e.message }
  busy.value = false
}
</script>

<template>
  <form class="cx-stack" @submit.prevent="create">
    <header>
      <h2>New game</h2>
      <p class="cx-note">Scaffolds a small working two-sided duel in games/&lt;name&gt;/ to build the real rules from. It is playable after a server restart.</p>
    </header>
    <label class="cx-field"><span>Name</span>
      <input v-model.trim="form.name" class="cx-input cx-mono" placeholder="e.g. skirmish" required pattern="[a-z][a-z0-9]*" title="Lower-case letters and digits, starting with a letter">
    </label>
    <div class="cx-grid2">
      <label class="cx-field"><span>Fewest players</span>
        <input v-model.number="form.minPlayers" class="cx-input" type="number" min="2">
      </label>
      <label class="cx-field"><span>Most players</span>
        <input v-model.number="form.maxPlayers" class="cx-input" type="number" :min="form.minPlayers">
      </label>
    </div>
    <div class="cx-field"><span>Sides</span>
      <PlayersEditor v-model="form.defaultPlayers" />
    </div>
    <div class="cx-row">
      <button type="submit" class="cx-btn cx-btn--primary" :disabled="busy || !form.name">Create game</button>
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
  </form>
</template>
