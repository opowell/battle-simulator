<script setup>
// The console: appfr's WindowFrame holding a DataShell over every object the
// server knows about (catalog.js), with each record opened beside it as a tab,
// and each session opened inside the console as a tab beside the whole of that.
// What is open, and where, is held in the URL with the query.
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue'
import { DataShell, ROUTE_ADAPTER_KEY, WindowFrame, createHistoryAdapter, group, hasPanel, headless, insertPanel, panelIds, panelNode, removePanel, row, setActivePanel, setSizesAt, useLayoutRoute } from 'header-content-layout'
import { api, playUrl } from './api.js'
import { buildSchema } from './schema.js'
import { buildRows } from './rows.js'
import { createCatalogSource } from './source.js'
import { settings } from './settings.js'
import { OPEN_SESSION, OPEN_SETUP, SESSION_SLOTS } from './opener.js'
import Art from './components/Art.vue'
import RecordPanel from './components/RecordPanel.vue'
import CreatePanel from './components/CreatePanel.vue'
import GameSummaryCards from './components/GameSummaryCards.vue'
import SessionPlay from './components/SessionPlay.vue'
import SessionFrames from './components/SessionFrames.vue'
import SetupPanel from './components/SetupPanel.vue'

const THEME = 'dark'

const schema = shallowRef(null)
const rows = shallowRef(null)
const source = shallowRef(null)
const loadError = ref('')
const loading = ref(false)

const rowsById = computed(() => new Map(Object.values(rows.value ?? {}).flat().map((r) => [r.id, r])))

let catalog = null

function rebuild() {
  rows.value = buildRows(catalog, settings)
  // A new source is what makes the shell ask again — the list and every card.
  source.value = createCatalogSource(rows.value)
}

// A setting is a row too, so changing one is a change to the results.
watch(settings, () => { if (catalog) rebuild() })

async function refresh() {
  loading.value = true
  try {
    catalog = await api.catalog()
    schema.value = buildSchema(catalog, { Art })
    rebuild()
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
// The window itself draws no bar: the browser and the records are what is in it.
// The browser is headless too: it is the page, not a window on it, and a bar
// saying "Browse" over it says nothing.
const home = () => headless(row([headless(panelNode('browse'))]))
const layout = ref(home())

// One route for the page, so the shell's query and the layout each keep the
// other's parameters. The layout is read from it here, before the window renders.
const route = createHistoryAdapter()
provide(ROUTE_ADAPTER_KEY, route)
onBeforeUnmount(() => route.dispose?.())
useLayoutRoute(layout, { adapter: route, home })

/**
 * What is open beside the browser, read off the layout's panel ids: a record
 * (`rec:<row id>`), a form making a new one of something (`new:<entity key>`),
 * a game's setup page (`setup:<game name>`), or a session being played
 * (`play:<session id>`). The id is all there is, so a URL naming the panels — a
 * reload, Back, a link — is enough to open them again.
 */
function itemOf(id) {
  if (id.startsWith('rec:')) return { id, kind: 'record', rowId: id.slice(4) }
  if (id.startsWith('new:')) return { id, kind: 'create', entityKey: id.slice(4) }
  if (id.startsWith('setup:')) return { id, kind: 'setup', game: id.slice(6) }
  if (id.startsWith('play:')) return { id, kind: 'session', sessionId: id.slice(5) }
  return null
}
const opened = computed(() => panelIds(layout.value).map(itemOf).filter(Boolean))

function titleOf(item) {
  if (item.kind === 'session') {
    // Named after the session once the catalog has it.
    return { title: rowsById.value.get(`sessions:${item.sessionId}`)?.fields.name ?? 'Session' }
  }
  if (item.kind === 'setup') return { title: `New ${item.game} session`, subtitle: 'Setup' }
  if (item.kind === 'create') {
    const entity = schema.value?.entities.find((e) => e.key === item.entityKey)
    return { title: entity?.create?.replace('…', '') ?? 'New', subtitle: entity?.label }
  }
  const r = rowsById.value.get(item.rowId)
  return { title: r?.fields.name ?? item.rowId, subtitle: r?.entityLabel }
}

const panels = computed(() => [
  { id: 'browse', title: 'Browse', fixed: true, closable: false },
  ...opened.value.map((item) => ({ id: item.id, ...titleOf(item), closable: true })),
])

/** @param focus  false leaves whichever top-level tab is showing where it is */
function open(id, { focus = true } = {}) {
  if (!hasPanel(layout.value, id)) {
    // Records share one strip of tabs beside the browser rather than each
    // taking a new column of the window.
    const peer = opened.value.find((o) => !topLevel(o))
    if (peer) {
      layout.value = insertPanel(layout.value, id, peer.id, 'center')
    } else {
      // The first record splits off the browser's right, leaving the browser
      // the larger share: its table has more columns to keep on screen.
      const split = insertPanel(layout.value, id, 'browse', 'right')
      layout.value = split.kind === 'split' && split.children.length === 2 ? setSizesAt(split, [], [0.6, 0.4]) : split
    }
  }
  if (focus) layout.value = setActivePanel(layout.value, id)
}

/**
 * A tab of the window's top level, beside the browser and its records as a
 * whole: what a session is, and a game's setup page on the way to one — a game
 * wants the full width, and switching back to the console finds it as it was
 * left. The first one turns the window into tabs: the console (everything there
 * was, named so its tab says so) and this.
 */
const topLevel = (o) => o.kind === 'session' || o.kind === 'setup'
function openTopLevel(id) {
  if (!hasPanel(layout.value, id)) {
    const peer = opened.value.find(topLevel)
    layout.value = peer
      ? insertPanel(layout.value, id, peer.id, 'center')
      : group([{ ...layout.value, title: 'Console' }, id], id)
  }
  layout.value = setActivePanel(layout.value, id)
}

/** A session opened inside the console. */
function openSession(sessionId, { replace } = {}) {
  const id = `play:${sessionId}`
  // A session started from another (a rematch, the next scenario) takes that
  // one's tab: put beside it, and the old one closed.
  const old = replace ? `play:${replace}` : null
  if (old && !hasPanel(layout.value, id) && hasPanel(layout.value, old)) {
    layout.value = setActivePanel(insertPanel(layout.value, id, old, 'center'), id)
    close(old)
    return
  }
  openTopLevel(id)
}
provide(OPEN_SESSION, openSession)

/** A game's setup page — every seat and option. */
const openSetup = (gameName) => openTopLevel(`setup:${gameName}`)
provide(OPEN_SETUP, openSetup)

// A link from before the console was the only UI — the old play UI's
// `#/session/<id>` and `#/game/<name>` — still lands where it pointed (the server
// sends /ui/design here, and a redirect keeps the fragment); so does a session
// opened in a browser tab of its own (playUrl.session).
function openFromHash() {
  const [, kind, name] = window.location.hash.match(/^#\/(session|game)\/([^/?]+)/) ?? []
  if (!kind) return
  history.replaceState(history.state, '', window.location.pathname + window.location.search)
  if (kind === 'session') openSession(decodeURIComponent(name))
  else openSetup(decodeURIComponent(name))
}
onMounted(openFromHash)
window.addEventListener('hashchange', openFromHash)
onBeforeUnmount(() => window.removeEventListener('hashchange', openFromHash))

// The boxes the open sessions show in; SessionFrames lays each one's board over them.
const sessionSlots = reactive(new Map())
provide(SESSION_SLOTS, sessionSlots)
const sessionIds = computed(() => opened.value.filter((o) => o.kind === 'session').map((o) => o.sessionId))

/** A tab that is a strip holding nothing but one space: that space. */
const lone = (tab) => (typeof tab !== 'string' && tab.kind === 'group' && tab.panels.length === 1 && typeof tab.panels[0] !== 'string' ? tab.panels[0] : null)

/**
 * The window once the last session has gone: the console again, not a strip of
 * one tab still holding it — which the next session would wrap in a strip of
 * its own, a console inside a console. A console tab nested like that already
 * (a URL from before this) is lifted out of its extra strip too.
 */
function settle(node) {
  if (node?.kind !== 'group') return node
  let changed = false
  const panels = node.panels.map((tab) => {
    let inner = tab
    while (lone(inner)) inner = { ...lone(inner), title: inner.title ?? lone(inner).title }
    if (inner !== tab) changed = true
    return inner
  })
  if (panels.length === 1 && typeof panels[0] !== 'string') {
    const { title, ...space } = panels[0]
    return space
  }
  return changed ? { ...node, panels } : node
}
// Whatever left it so — a close, a tab carried off, a URL.
watch(layout, (node) => {
  const settled = settle(node)
  if (settled !== node) layout.value = settled
}, { immediate: true })

function close(id) {
  layout.value = removePanel(layout.value, id) ?? home()
}

function openRow(r, options) {
  open(`rec:${r.id}`, options)
}

/**
 * The game each open record belongs to, as last seen: the row of a record
 * whose game has just been deleted is gone with it, and with it the game.
 */
const gameOfRecord = new Map()
watch([opened, rowsById], () => {
  for (const item of opened.value) {
    const game = item.kind === 'record' ? rowsById.value.get(item.rowId)?.record.game : undefined
    if (game !== undefined) gameOfRecord.set(item.rowId, game)
  }
}, { immediate: true })

/** A deleted game takes every tab of its own with it — its files, units, sessions. */
function closeTabsOfGone(catalog) {
  const games = new Set(catalog.games.map((g) => g.name))
  for (const item of opened.value) {
    if (item.kind !== 'record') continue
    const game = rowsById.value.get(item.rowId)?.record.game ?? gameOfRecord.get(item.rowId)
    if (typeof game === 'string' && !games.has(game)) close(item.id)
  }
}

/** Opens a record once a refresh has it — one this console just made. */
async function openCreated(rowId, replacing) {
  await refresh()
  const r = rowsById.value.get(rowId)
  if (replacing) close(replacing)
  // A session that went straight into play here keeps its tab in front.
  if (r) openRow(r, { focus: !(r.entityKey === 'sessions' && hasPanel(layout.value, `play:${r.record.id}`)) })
}

function openCreate(entity) {
  open(`new:${entity.key}`)
}

const itemFor = (id) => opened.value.find((o) => o.id === id)
const gameRows = computed(() => rows.value?.games ?? [])
</script>

<template>
  <p v-if="!schema && loadError" class="cx-boot cx-boot--err">Could not load the catalog: {{ loadError }}</p>
  <p v-else-if="!schema" class="cx-boot">Loading the catalog…</p>
  <div v-else class="cx-root">
    <WindowFrame
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
          <!-- Pressing a game narrows to it (its type declares a scope); every
               other row opens. The game itself then heads the cards. -->
          <template #cards-before>
            <GameSummaryCards :games="gameRows" @open="openRow" @changed="refresh" />
          </template>
          <template #actions>
            <button type="button" class="cx-btn cx-btn--quiet" :disabled="loading" title="Reload everything from the server" @click="refresh">
              {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
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
        <SetupPanel
          v-else-if="itemFor(panel.id)?.kind === 'setup'"
          :game-name="itemFor(panel.id).game"
          @close="close(panel.id)"
          @created="(rowId, { replace }) => openCreated(rowId, replace ? panel.id : undefined)"
        />
        <!-- Keyed: one session replacing another in the same tab (a rematch) must
             register its own box, not inherit the old one's (SessionPlay registers
             on mount). -->
        <SessionPlay v-else-if="itemFor(panel.id)?.kind === 'session'" :key="panel.id" :session-id="itemFor(panel.id).sessionId" />
      </template>
      <template #actions="{ panel }">
        <a
          v-if="itemFor(panel.id)?.kind === 'session'"
          class="cx-btn cx-btn--quiet"
          :href="playUrl.session(itemFor(panel.id).sessionId)"
          target="_blank"
          rel="noopener"
          title="Open this session in a browser tab of its own"
        >↗</a>
      </template>
    </WindowFrame>
    <SessionFrames
      :session-ids="sessionIds"
      :slots="sessionSlots"
      @open-session="(id, { replace, from }) => { openSession(id, { replace: replace ? from : null }); refresh() }"
      @close="(id) => close(`play:${id}`)"
    />
  </div>
</template>

<style>
/* Shared by every panel. Written against appfr's tokens, so the panels wear
   whatever theme the window does. */
.cx-root { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cx-window { flex: 1; min-height: 0; }

/* The window runs edge to edge: no inset round it, no box round each pane — the
   browser is the page, and a record opened beside it is set off by the one
   hairline between them, which is also the handle that resizes them. */
.dc-shell.dc-window.cx-window { padding: 0; }
/* The shell fills its pane to the bottom rather than leaving the pane's own
   background showing under its last row. */
.cx-window .dc-pane__body > .dc-shell { height: 100%; }
.cx-window .dc-space,
.cx-window .dc-pane { border: 0; border-radius: 0; }
.cx-window .dc-window__split { padding: 0; }
.cx-window .dc-window__split[data-dc-direction='row'] > .dc-window__gutter { width: 5px; }
.cx-window .dc-window__split[data-dc-direction='row'] > .dc-window__gutter::after { width: 1px; background: var(--dc-line-2); }
.cx-window .dc-window__gutter:hover::after,
.cx-window .dc-window__gutter:focus-visible::after { background: var(--dc-accent); }
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
/* Doubled, to outrank the shell's own reset of a button's colour: a primary
   button on a card inside the shell is still one. */
.cx-btn.cx-btn--primary { background: var(--dc-accent); border-color: var(--dc-accent); color: var(--dc-accent-contrast); }
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

/* A record's picture on its card: small, beside the name rather than over it,
   and pixel art kept crisp. */
.cx-window .dc-card .dc-card__image { width: 40px; height: 40px; image-rendering: pixelated; }

/* Status words appfr's pill does not colour itself: the domain's own, mapped
   onto the same four tokens its ok / running / review / failed use. */
.dc-pill[data-dc-status='active'] { background: var(--dc-accent-bg); color: var(--dc-accent); }
.dc-pill[data-dc-status='done'], .dc-pill[data-dc-status='loaded'] { background: var(--dc-ok-bg); color: var(--dc-ok); }
.dc-pill[data-dc-status='interrupted'], .dc-pill[data-dc-status='closed'], .dc-pill[data-dc-status='restart'] { background: var(--dc-warn-bg); color: var(--dc-warn); }
.dc-pill[data-dc-status='error'] { background: var(--dc-danger-bg); color: var(--dc-danger); }
</style>
