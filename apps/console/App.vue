<script setup>
// The console: appfr's WindowFrame holding a DataShell over every object the
// server knows about (catalog.js), with each record opened beside it as a tab.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { DataShell, WindowFrame, hasPanel, headless, insertPanel, panelNode, removePanel, row, setActivePanel, setSizesAt } from 'header-content-layout'
import { api, basePath } from './api.js'
import { buildSchema } from './schema.js'
import { buildRows } from './rows.js'
import { createCatalogSource } from './source.js'
import Art from './components/Art.vue'
import RecordPanel from './components/RecordPanel.vue'
import CreatePanel from './components/CreatePanel.vue'

const THEME = 'dark'

const schema = shallowRef(null)
const rows = shallowRef(null)
const source = shallowRef(null)
const loadError = ref('')
const loading = ref(false)

const rowsById = computed(() => new Map(Object.values(rows.value ?? {}).flat().map((r) => [r.id, r])))

async function refresh() {
  loading.value = true
  try {
    const catalog = await api.catalog()
    rows.value = buildRows(catalog)
    schema.value = buildSchema(catalog, { Art })
    // A new source is what makes the shell ask again — the list and every card.
    source.value = createCatalogSource(rows.value)
    closeTabsOfGone(catalog)
    loadError.value = ''
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}

// Sessions move on while the tab is in the background; catch up on return.
const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
onMounted(() => { refresh(); document.addEventListener('visibilitychange', onVisible) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

// ── panels ───────────────────────────────────────────────────
// `opened` is what is open beside the browser: a record (by row id) or a form
// making a new one of something (by entity key).
const opened = ref([])
// The window itself draws no bar: the browser and the records are what is in it.
const home = () => headless(row([panelNode('browse')]))
const layout = ref(home())

const panels = computed(() => [
  { id: 'browse', title: 'Browse', fixed: true, closable: false },
  ...opened.value.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, closable: true })),
])

function open(item) {
  if (!opened.value.some((o) => o.id === item.id)) {
    // Records share one strip of tabs beside the browser rather than each
    // taking a new column of the window.
    const peer = opened.value.find((o) => hasPanel(layout.value, o.id))
    opened.value = [...opened.value, item]
    if (peer) {
      layout.value = insertPanel(layout.value, item.id, peer.id, 'center')
    } else {
      // The first record splits off the browser's right, leaving the browser
      // the larger share: its table has more columns to keep on screen.
      const split = insertPanel(layout.value, item.id, 'browse', 'right')
      layout.value = split.kind === 'split' && split.children.length === 2 ? setSizesAt(split, [], [0.6, 0.4]) : split
    }
  }
  layout.value = setActivePanel(layout.value, item.id)
}

function close(id) {
  opened.value = opened.value.filter((o) => o.id !== id)
  layout.value = removePanel(layout.value, id) ?? home()
}

function openRow(r) {
  open({ id: `rec:${r.id}`, kind: 'record', rowId: r.id, game: r.record.game, title: r.fields.name, subtitle: r.entityLabel })
}

/** A deleted game takes every tab of its own with it — its files, units, sessions. */
function closeTabsOfGone(catalog) {
  const games = new Set(catalog.games.map((g) => g.name))
  for (const item of opened.value) {
    if (item.kind === 'record' && typeof item.game === 'string' && !games.has(item.game)) close(item.id)
  }
}

/** Opens a record once a refresh has it — one this console just made. */
async function openCreated(rowId, replacing) {
  await refresh()
  const r = rowsById.value.get(rowId)
  if (replacing) close(replacing)
  if (r) openRow(r)
}

function openCreate(entity) {
  open({ id: `new:${entity.key}`, kind: 'create', entityKey: entity.key, title: entity.create.replace('…', ''), subtitle: entity.label })
}

const itemFor = (id) => opened.value.find((o) => o.id === id)
</script>

<template>
  <p v-if="!schema && loadError" class="cx-boot cx-boot--err">Could not load the catalog: {{ loadError }}</p>
  <p v-else-if="!schema" class="cx-boot">Loading the catalog…</p>
  <WindowFrame
    v-else
    v-model:layout="layout"
    class="cx-window"
    :panels="panels"
    :theme="THEME"
    movable
    @panel-close="close"
  >
    <template #panel="{ panel }">
      <DataShell
        v-if="panel.id === 'browse'"
        :schema="schema"
        :source="source"
        :theme="THEME"
        :defaults="{ sort: 'age', dir: 'asc' }"
        @activate="openRow"
        @create="openCreate"
      >
        <template #actions>
          <button type="button" class="cx-btn cx-btn--quiet" :disabled="loading" title="Reload everything from the server" @click="refresh">
            {{ loading ? 'Loading…' : 'Refresh' }}
          </button>
          <a class="cx-btn cx-btn--quiet" :href="`${basePath}/ui/design/`" target="_blank" rel="noopener">Play UI ↗</a>
        </template>
      </DataShell>
      <RecordPanel
        v-else-if="itemFor(panel.id)?.kind === 'record'"
        :row="rowsById.get(itemFor(panel.id).rowId) ?? null"
        :rows="rows"
        @changed="refresh"
        @created="(rowId) => openCreated(rowId)"
        @open="openRow"
        @close="close(panel.id)"
      />
      <CreatePanel
        v-else-if="itemFor(panel.id)?.kind === 'create'"
        :entity-key="itemFor(panel.id).entityKey"
        :rows="rows"
        @created="(rowId) => openCreated(rowId, panel.id)"
      />
    </template>
  </WindowFrame>
</template>

<style>
/* Shared by every panel. Written against appfr's tokens, so the panels wear
   whatever theme the window does. */
.cx-window { flex: 1; min-height: 0; }
.cx-boot { margin: auto; font: 13px/1.5 ui-monospace, Menlo, monospace; color: #8a96a1; }
.cx-boot--err { color: #ff8a80; }

.cx-panel { height: 100%; overflow: auto; padding: 16px 18px 28px; box-sizing: border-box; font-family: var(--dc-sans); color: var(--dc-fg-0); }
.cx-panel h2 { margin: 0 0 2px; font-size: 18px; font-weight: var(--dc-weight-semibold, 600); }
.cx-panel h3 { margin: 22px 0 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dc-fg-2); font-weight: var(--dc-weight-semibold, 600); }
.cx-head { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.cx-kicker { font-size: 12px; color: var(--dc-fg-2); }
.cx-muted { color: var(--dc-fg-2); }
.cx-mono { font-family: var(--dc-mono); }
.cx-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cx-stack { display: flex; flex-direction: column; gap: 12px; }
.cx-note { font-size: 12px; color: var(--dc-fg-2); margin: 6px 0 0; }
.cx-error { font-size: 12px; color: var(--dc-danger); margin: 8px 0 0; white-space: pre-wrap; }
.cx-ok { font-size: 12px; color: var(--dc-ok); margin: 8px 0 0; }

.cx-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  border: 1px solid var(--dc-line-2); border-radius: var(--dc-radius, 6px);
  background: var(--dc-bg-1); color: var(--dc-fg-0); font: inherit; font-size: 13px;
  text-decoration: none; cursor: pointer; white-space: nowrap;
}
.cx-btn:hover { background: var(--dc-bg-2); }
.cx-btn[disabled] { opacity: .45; pointer-events: none; }
.cx-btn--primary { background: var(--dc-accent); border-color: var(--dc-accent); color: var(--dc-accent-contrast); }
.cx-btn--primary:hover { background: var(--dc-accent); filter: brightness(1.08); }
.cx-btn--danger { color: var(--dc-danger); border-color: var(--dc-danger-bg); }
.cx-btn--quiet { border-color: transparent; background: transparent; color: var(--dc-fg-1); }

.cx-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cx-field > span { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--dc-fg-2); }
.cx-input {
  font: inherit; font-size: 13px; padding: 6px 9px; min-width: 0;
  color: var(--dc-fg-0); background: var(--dc-bg-0);
  border: 1px solid var(--dc-line-2); border-radius: var(--dc-radius-sm, 4px);
}
.cx-input:focus { outline: 2px solid var(--dc-accent-dim); outline-offset: -1px; border-color: var(--dc-accent); }
.cx-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.cx-code { margin: 0; padding: 10px 12px; overflow: auto; max-height: 320px; font: 12px/1.5 var(--dc-mono); background: var(--dc-bg-1); border: 1px solid var(--dc-line); border-radius: var(--dc-radius-sm, 4px); white-space: pre; }

/* Status words appfr's pill does not colour itself: the domain's own, mapped
   onto the same four tokens its ok / running / review / failed use. */
.dc-pill[data-dc-status='active'] { background: var(--dc-accent-bg); color: var(--dc-accent); }
.dc-pill[data-dc-status='done'], .dc-pill[data-dc-status='loaded'] { background: var(--dc-ok-bg); color: var(--dc-ok); }
.dc-pill[data-dc-status='interrupted'], .dc-pill[data-dc-status='closed'], .dc-pill[data-dc-status='restart'] { background: var(--dc-warn-bg); color: var(--dc-warn); }
.dc-pill[data-dc-status='error'] { background: var(--dc-danger-bg); color: var(--dc-danger); }
</style>
