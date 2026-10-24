<script setup>
// One source file of a game's definition, edited as text. ⌘S / Ctrl+S saves.
// The server has already imported the game's modules, so an edit to its rules
// is what the next server start runs — the editor says so rather than implying
// the running games have changed.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '../api.js'

// line: { line, at } — the line to show, selected (a scenario's Edit opens its
// definition); `at` makes the same line asked for again a change.
const props = defineProps({ record: Object, line: { type: Object, default: null } })
const emit = defineEmits(['changed'])

const text = ref('')
const original = ref(null)
const busy = ref(false)
const error = ref('')
const saved = ref('')
const dirty = computed(() => original.value !== null && text.value !== original.value)
const area = ref(null)

onMounted(async () => {
  try {
    const { content } = await api.readFile(props.record.game, props.record.path)
    text.value = content
    original.value = content
    showLine()
  } catch (e) { error.value = e.message }
})

/** Selects the asked-for line and scrolls it a few lines below the top. */
async function showLine() {
  const wanted = props.line?.line
  await nextTick()
  const el = area.value
  if (!wanted || !el) return
  const lines = text.value.split('\n')
  const start = lines.slice(0, wanted - 1).reduce((n, l) => n + l.length + 1, 0)
  el.focus({ preventScroll: true })
  el.setSelectionRange(start, start + (lines[wanted - 1]?.length ?? 0))
  el.scrollTop = Math.max(0, (wanted - 4) * parseFloat(getComputedStyle(el).lineHeight))
}
watch(() => props.line, showLine)

async function save() {
  if (!dirty.value || busy.value) return
  busy.value = true; error.value = ''; saved.value = ''
  try {
    await api.writeFile(props.record.game, props.record.path, text.value)
    original.value = text.value
    saved.value = 'Saved. A change to the rules runs from the next server start.'
    emit('changed')
  } catch (e) { error.value = e.message }
  busy.value = false
}

function onKey(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); save() }
}
</script>

<template>
  <div class="fe">
    <div class="cx-row">
      <span class="cx-mono cx-muted">games/{{ record.game }}/{{ record.path }}</span>
      <span v-if="dirty" class="cx-muted">· edited</span>
      <span class="fe__spacer" />
      <button type="button" class="cx-btn" :disabled="!dirty || busy" @click="text = original">Revert</button>
      <button type="button" class="cx-btn cx-btn--primary" :disabled="!dirty || busy" @click="save">Save</button>
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
    <p v-if="saved" class="cx-ok">{{ saved }}</p>
    <p v-if="original === null && !error" class="cx-muted">Loading…</p>
    <textarea
      v-else-if="original !== null"
      ref="area"
      v-model="text"
      class="fe__text"
      spellcheck="false"
      :aria-label="record.path"
      @keydown="onKey"
    />
  </div>
</template>

<style scoped>
.fe { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 360px; }
.fe__spacer { flex: 1; }
.fe__text {
  flex: 1; min-height: 300px; resize: none; padding: 10px 12px; tab-size: 2; white-space: pre;
  font: 12.5px/1.55 var(--dc-mono); color: var(--dc-fg-0); background: var(--dc-bg-0);
  border: 1px solid var(--dc-line-2); border-radius: var(--dc-radius-sm, 4px);
}
.fe__text:focus { outline: 2px solid var(--dc-accent-dim); outline-offset: -1px; }
</style>
