<script setup>
// A battle spec (src/battle/spec.js), edited as JSON and checked as it is typed
// against the game that plays it (its hooks, the library's maps). A save is
// played by the next session started — the running server needs no restart —
// and is refused while the spec can't be played. ⌘S / Ctrl+S saves; Play saves
// first, then starts the spec's scenario with the default seats.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../api.js'
import { defaultSeats, sessionRequest } from '../sessions.js'
import { useSessionOpener, useSetupOpener } from '../opener.js'
import ConfirmButton from './ConfirmButton.vue'

const props = defineProps({ record: Object })
const emit = defineEmits(['changed', 'created', 'close'])
const opener = useSessionOpener()
const openSetup = useSetupOpener()

const text = ref('')
const original = ref(null)
const errors = ref(props.record.errors ?? [])
const busy = ref(false)
const error = ref('')
const saved = ref('')
const dirty = computed(() => original.value !== null && text.value !== original.value)

onMounted(async () => {
  try {
    const got = await api.readSpec(props.record.game, props.record.spec)
    text.value = got.text
    original.value = got.text
    errors.value = got.errors
  } catch (e) { error.value = e.message }
})

// Checked by the server a moment after typing stops: the game's own check is
// what decides, and it knows the hooks and maps a spec may name.
let timer = null
let asked = 0
watch(text, () => {
  clearTimeout(timer)
  if (original.value === null) return
  timer = setTimeout(async () => {
    const mine = ++asked
    try {
      const { errors: found } = await api.checkSpec(props.record.game, props.record.spec, text.value)
      if (mine === asked) errors.value = found
    } catch (e) { if (mine === asked) errors.value = [e.message] }
  }, 350)
})
onBeforeUnmount(() => clearTimeout(timer))

// What the text says now, for the summary; null while it is not JSON.
const parsed = computed(() => {
  try { const v = JSON.parse(text.value); return v && typeof v === 'object' ? v : null } catch { return null }
})
const unitTypes = computed(() => Object.entries(parsed.value?.unitTypes ?? {}).map(([id, t]) => ({
  id,
  name: t.name ?? id,
  stats: ['hp', 'attack', 'defense', 'range', 'speed', 'rate', 'vision'].map((k) => t[k] ?? '—'),
  abilities: (t.abilities ?? []).join(', '),
})))
const boardText = computed(() => {
  const s = parsed.value
  if (!s) return ''
  if (s.map) return `the library map ${s.map}`
  const b = s.board ?? {}
  const topology = b.topology ?? 'square'
  return topology === 'regions' ? `${Object.keys(b.regions ?? {}).length} regions` : `${topology}, ${b.width ?? '?'}×${b.height ?? '?'}`
})

async function save() {
  if (!dirty.value || busy.value) return true
  busy.value = true; error.value = ''; saved.value = ''
  try {
    await api.writeSpec(props.record.game, props.record.spec, text.value)
    original.value = text.value
    saved.value = 'Saved. The next session started plays it.'
    emit('changed')
    return true
  } catch (e) { error.value = e.message; return false } finally { busy.value = false }
}

async function play() {
  const pending = opener.begin()
  if (!(await save())) { pending.cancel(); return }
  busy.value = true
  try {
    const game = (await api.games()).find((g) => g.name === props.record.game)
    if (!game) throw new Error(`${props.record.game} is not loaded`)
    const created = await api.createSession(sessionRequest(game, props.record.spec, defaultSeats(game, props.record.spec)))
    pending.go(created.id)
    emit('changed')
  } catch (e) {
    pending.cancel()
    error.value = e.message
  }
  busy.value = false
}

const copyId = ref(`${props.record.spec}-copy`)
async function duplicate() {
  busy.value = true; error.value = ''
  try {
    const made = await api.createSpec(props.record.game, { id: copyId.value, from: props.record.spec })
    emit('created', `specs:${made.id}`)
  } catch (e) { error.value = e.message }
  busy.value = false
}

async function remove() {
  busy.value = true; error.value = ''
  try {
    await api.deleteSpec(props.record.game, props.record.spec)
    emit('changed')
    emit('close')
  } catch (e) { error.value = e.message; busy.value = false }
}

function onKey(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); save() }
}
</script>

<template>
  <div class="se cx-stack">
    <p v-if="record.description" class="se__desc">{{ record.description }}</p>
    <div class="cx-row">
      <button type="button" class="cx-btn cx-btn--primary" :disabled="busy || errors.length > 0" :title="dirty ? 'Save, then start it with the default seats' : 'Start it with the default seats'" @click="play">
        {{ dirty ? 'Save and play' : 'Play' }}{{ opener.inNewTab() ? ' ↗' : '' }}
      </button>
      <button type="button" class="cx-btn" :disabled="dirty" title="The game's setup page, on this spec" @click="openSetup(record.game, record.spec)">Choose seats and options</button>
      <span class="se__spacer" />
      <button type="button" class="cx-btn" :disabled="!dirty || busy" @click="text = original">Revert</button>
      <button type="button" class="cx-btn" :disabled="!dirty || busy || errors.length > 0" @click="save">Save</button>
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
    <p v-if="saved && !dirty" class="cx-ok">{{ saved }}</p>

    <div class="se__check" :class="errors.length ? 'se__check--bad' : 'se__check--ok'" role="status">
      <template v-if="!errors.length">Plays as it stands.</template>
      <template v-else>
        Can't be played yet:
        <ul><li v-for="(e, i) in errors" :key="i" class="cx-mono">{{ e }}</li></ul>
      </template>
    </div>

    <div class="cx-row cx-muted se__path">
      <span class="cx-mono">{{ record.game }} · specs/{{ record.file }}</span>
      <span v-if="dirty">· edited</span>
    </div>
    <p v-if="original === null && !error" class="cx-muted">Loading…</p>
    <textarea
      v-else-if="original !== null"
      v-model="text"
      class="se__text"
      spellcheck="false"
      :aria-label="record.file"
      @keydown="onKey"
    />

    <template v-if="parsed">
      <h3>Board</h3>
      <p class="se__line">{{ boardText }}<template v-if="parsed.victory"> · wins by {{ parsed.victory.map((v) => v.type ?? v.fn).join(', ') }}</template></p>
      <h3>Unit types · {{ unitTypes.length }}</h3>
      <table v-if="unitTypes.length" class="se__units">
        <thead><tr><th>Type</th><th>HP</th><th>Atk</th><th>Def</th><th>Rng</th><th>Spd</th><th>Rate</th><th>Vis</th><th>Abilities</th></tr></thead>
        <tbody>
          <tr v-for="u in unitTypes" :key="u.id">
            <td>{{ u.name }} <span class="cx-mono cx-muted">{{ u.id }}</span></td>
            <td v-for="(v, i) in u.stats" :key="i" class="se__num">{{ v }}</td>
            <td class="cx-mono">{{ u.abilities }}</td>
          </tr>
        </tbody>
      </table>
      <p class="cx-note">The format is src/battle/README.md's: every key is optional, and what a spec leaves out is the base ruleset's.</p>
    </template>

    <h3>Copy</h3>
    <div class="cx-row">
      <input v-model.trim="copyId" class="cx-input cx-mono" aria-label="The copy's id" pattern="[a-z][a-z0-9\-]*">
      <button type="button" class="cx-btn" :disabled="busy || !copyId" @click="duplicate">Copy to a new spec</button>
    </div>

    <h3>Delete</h3>
    <p class="cx-note">Removes specs/{{ record.file }}, and its scenario with it.</p>
    <div class="cx-row">
      <ConfirmButton label="Delete spec" :confirm="`Delete ${record.spec}?`" :busy="busy" @confirm="remove" />
    </div>
  </div>
</template>

<style scoped>
.se__desc { margin: 0; font-size: 13px; color: var(--dc-fg-1); }
.se__spacer { flex: 1; }
.se__path { font-size: 12px; }
.se__check { font-size: 12.5px; padding: 8px 10px; border-radius: var(--dc-radius-sm, 4px); border: 1px solid var(--dc-line); }
.se__check ul { margin: 6px 0 0; padding-left: 18px; }
.se__check--ok { color: var(--dc-ok); background: var(--dc-ok-bg); border-color: transparent; }
.se__check--bad { color: var(--dc-danger); background: var(--dc-danger-bg); border-color: transparent; }
.se__text {
  min-height: 360px; height: 52vh; resize: vertical; padding: 10px 12px; tab-size: 2; white-space: pre;
  font: 12.5px/1.55 var(--dc-mono); color: var(--dc-fg-0); background: var(--dc-bg-0);
  border: 1px solid var(--dc-line-2); border-radius: var(--dc-radius-sm, 4px);
}
.se__text:focus { outline: 2px solid var(--dc-accent-dim); outline-offset: -1px; }
.se__line { margin: 0; font-size: 13px; }
.se__units { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.se__units th { text-align: left; font-weight: var(--dc-weight-semibold, 600); color: var(--dc-fg-2); font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--dc-line); }
.se__units td { padding: 4px 6px; border-bottom: 1px solid var(--dc-line); }
.se__num { font-family: var(--dc-mono); text-align: right; }
</style>
