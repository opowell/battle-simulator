<script setup>
// A game's definition: its registry entry (player counts and the sides it
// seats), its source files, and the way to delete it. Saves go through the same
// admin endpoints /ui/game-editor uses, which rewrite api-server.js — so they
// take effect when the server next starts.
import { computed, ref } from 'vue'
import { api } from '../api.js'
import { useSetupOpener } from '../opener.js'
import PlayersEditor from './PlayersEditor.vue'
import ConfirmButton from './ConfirmButton.vue'

const props = defineProps({ record: Object, fields: Object, rows: Object })
const emit = defineEmits(['changed', 'close', 'open'])
const openSetup = useSetupOpener()

const snapshot = () => ({
  minPlayers: props.record.minPlayers,
  maxPlayers: props.record.maxPlayers,
  defaultPlayers: props.record.defaultPlayers.map((p) => ({ id: p.id, name: p.name })),
})
// Taken once: a catalog refresh must not throw away an edit in progress.
const form = ref(snapshot())
const baseline = ref(JSON.stringify(form.value))
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value)

const busy = ref(false)
const error = ref('')
const saved = ref('')

const files = computed(() => (props.rows?.files ?? []).filter((r) => r.record.game === props.record.name))

async function save() {
  busy.value = true; error.value = ''; saved.value = ''
  try {
    await api.updateGame(props.record.name, form.value)
    baseline.value = JSON.stringify(form.value)
    saved.value = 'Saved to api-server.js — restart the server for it to take effect.'
    emit('changed')
  } catch (e) { error.value = e.message }
  busy.value = false
}

async function remove() {
  busy.value = true; error.value = ''
  try {
    await api.deleteGame(props.record.name)
    // The refresh closes this tab along with every other one of the game's —
    // closing it here first would bring one of its files' tabs to the front,
    // which would try to load a file that has just been deleted.
    emit('changed')
  } catch (e) { error.value = e.message; busy.value = false }
}
</script>

<template>
  <div class="cx-stack">
    <p v-if="!record.live" class="cx-note">Registered but not loaded: restart the server to play it.</p>
    <p v-if="record.unitsError" class="cx-error">Its opening position could not be built: {{ record.unitsError }}</p>

    <div class="cx-row">
      <button v-if="record.live" type="button" class="cx-btn cx-btn--primary" @click="openSetup(record.name)">Set up a session</button>
    </div>

    <h3>Definition</h3>
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
      <button type="button" class="cx-btn cx-btn--primary" :disabled="!dirty || busy" @click="save">Save definition</button>
      <button type="button" class="cx-btn" :disabled="!dirty || busy" @click="form = snapshot()">Revert</button>
    </div>
    <p v-if="saved" class="cx-ok">{{ saved }}</p>
    <p v-if="error" class="cx-error">{{ error }}</p>

    <h3>Source · {{ files.length }} files</h3>
    <ul class="gd-files">
      <li v-for="f in files" :key="f.id">
        <button type="button" class="gd-file" @click="emit('open', f)">
          <span class="cx-mono">{{ f.record.path }}</span>
          <span class="cx-muted">{{ Math.max(1, Math.round(f.record.size / 1024)) }} KB</span>
        </button>
      </li>
    </ul>

    <h3>Delete</h3>
    <p class="cx-note">Removes the game's registry entry and its whole games/{{ record.name }}/ directory.</p>
    <div class="cx-row">
      <ConfirmButton label="Delete game" :confirm="`Delete ${record.name} and its files?`" :busy="busy" @confirm="remove" />
    </div>
  </div>
</template>

<style scoped>
.gd-files { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; border: 1px solid var(--dc-line); border-radius: var(--dc-radius-sm, 4px); }
.gd-file { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 5px 10px; border: 0; background: none; color: inherit; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.gd-file:hover { background: var(--dc-bg-2); }
</style>
