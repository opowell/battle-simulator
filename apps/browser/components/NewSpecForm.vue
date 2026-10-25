<script setup>
// A new battle spec: a copy of one there is, or a starter of two small armies on
// open ground. It is a scenario at once — no server restart.
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'

const props = defineProps({ rows: Object })
const emit = defineEmits(['created'])

// The games whose specs can be edited are the ones that have some.
const specRows = computed(() => props.rows?.specs ?? [])
const games = computed(() => [...new Set(specRows.value.map((r) => r.record.game))])

const form = ref({ game: games.value[0] ?? '', id: '', name: '', from: '' })
watch(games, (list) => { if (!list.includes(form.value.game)) form.value.game = list[0] ?? '' })
const sources = computed(() => specRows.value.filter((r) => r.record.game === form.value.game))

const busy = ref(false)
const error = ref('')

async function create() {
  busy.value = true; error.value = ''
  try {
    const { game, id, name, from } = form.value
    const made = await api.createSpec(game, { id, name, from: from || undefined })
    emit('created', `specs:${made.id}`)
  } catch (e) { error.value = e.message }
  busy.value = false
}
</script>

<template>
  <form class="cx-stack" @submit.prevent="create">
    <header>
      <h2>New spec</h2>
      <p class="cx-note">A battle as data: unit types, terrain, board, abilities, objectives. It is a scenario as soon as it is made.</p>
    </header>
    <p v-if="!games.length" class="cx-muted">No game here keeps its specs as files.</p>
    <template v-else>
      <label v-if="games.length > 1" class="cx-field"><span>Game</span>
        <select v-model="form.game" class="cx-input">
          <option v-for="g in games" :key="g" :value="g">{{ g }}</option>
        </select>
      </label>
      <label class="cx-field"><span>Id</span>
        <input v-model.trim="form.id" class="cx-input cx-mono" placeholder="e.g. river-crossing" required pattern="[a-z][a-z0-9\-]*" title="Lower-case letters, digits and dashes, starting with a letter">
      </label>
      <label class="cx-field"><span>Name</span>
        <input v-model.trim="form.name" class="cx-input" placeholder="e.g. River crossing">
      </label>
      <label class="cx-field"><span>Start from</span>
        <select v-model="form.from" class="cx-input">
          <option value="">Two small armies on open ground</option>
          <option v-for="r in sources" :key="r.id" :value="r.record.spec">A copy of {{ r.fields.name }}</option>
        </select>
      </label>
      <div class="cx-row">
        <button type="submit" class="cx-btn cx-btn--primary" :disabled="busy || !form.id">Create spec</button>
      </div>
    </template>
    <p v-if="error" class="cx-error">{{ error }}</p>
  </form>
</template>
