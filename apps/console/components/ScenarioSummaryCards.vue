<script setup>
// What a query naming a scenario adds to the card-per-type screen, as
// GameSummaryCards does for a game: a card for the scenario itself — what it
// is, and the three things to do with it — ahead of the cards of its sessions
// and recordings. Pressing a scenario anywhere in the console narrows to it,
// so this card is where a scenario is started from or edited.
//
// Rendered in DataShell's #cards-before slot, so it reads the query off the
// shell rather than being handed it.
import { computed, ref } from 'vue'
import { ShellCard, useShellContext } from 'header-content-layout'
import { api } from '../api.js'
import { namedIn } from '../source.js'
import { defaultSeats, sessionRequest } from '../sessions.js'
import { useSessionOpener, useSetupOpener } from '../opener.js'
import Art from './Art.vue'

// The scenario rows and the file rows (rows.js): a scenario is edited in the
// game source that defines it.
const props = defineProps({
  scenarios: { type: Array, default: () => [] },
  files: { type: Array, default: () => [] },
})
// open: (row, { line }) — a record to open beside the browser, at a line of it.
const emit = defineEmits(['open', 'changed'])

const shell = useShellContext()
const opener = useSessionOpener()
const openSetup = useSetupOpener()

const named = computed(() => {
  const wanted = namedIn(shell.query.value.expr, 'scenario')
  return props.scenarios.filter((s) => wanted.has(s.id.toLowerCase()))
})

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const facts = (s) => [
  s.fields.gameTitle,
  `${s.fields.players} players`,
  s.record.fog ? 'fog of war' : null,
  plural(s.fields.sessions, 'session'),
].filter(Boolean)

// GET /games has what starting one takes (seats, agents, scenarios); asked once.
let gamesList = null
const gameEntry = async (name) => (await (gamesList ??= api.games())).find((g) => g.name === name)

const busy = ref('')
const error = ref('')

async function start(s) {
  const pending = opener.begin()
  busy.value = `start:${s.id}`; error.value = ''
  try {
    const entry = await gameEntry(s.record.game)
    if (!entry) throw new Error(`${s.fields.gameTitle} is not loaded — restart the server to play it.`)
    const { scenario } = s.record
    const created = await api.createSession(sessionRequest(entry, scenario, defaultSeats(entry, scenario)))
    pending.go(created.id)
    emit('changed')
  } catch (e) {
    pending.cancel()
    gamesList = null
    error.value = e.message
  }
  busy.value = ''
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where the game's source defines the scenario: the first `id: '<its id>'` in a
 * file of the game's, taken after that file has said `scenarios` where one
 * has — an option or a unit can have the same id. A file named for scenarios
 * is read first, then the game's class, then the rest.
 */
async function findDefinition(s) {
  const pattern = new RegExp(`\\bid\\s*:\\s*['"\`]${escape(s.record.scenario)}['"\`]`)
  const rank = (path) => (/scenario/i.test(path) ? 0 : /Game\.[cm]?js$/.test(path) ? 1 : 2)
  const candidates = props.files
    .filter((f) => f.record.game === s.record.game && /\.[cm]?js$/.test(f.record.path) && !/\.test\.[cm]?js$/.test(f.record.path))
    .sort((a, b) => rank(a.record.path) - rank(b.record.path))
  let fallback = null
  for (const file of candidates) {
    const { content } = await api.readFile(file.record.game, file.record.path)
    let listed = false
    for (const [i, line] of content.split('\n').entries()) {
      if (/scenarios/.test(line)) listed = true
      if (!pattern.test(line)) continue
      if (listed) return { file, line: i + 1 }
      fallback ??= { file, line: i + 1 }
    }
  }
  return fallback
}

async function edit(s) {
  busy.value = `edit:${s.id}`; error.value = ''
  try {
    const found = await findDefinition(s)
    // Nowhere to be found (a scenario built in code): its record, which shows
    // what it configures.
    if (found) emit('open', found.file, { line: found.line })
    else emit('open', s)
  } catch (e) {
    error.value = e.message
  }
  busy.value = ''
}
</script>

<template>
  <ShellCard v-for="s in named" :key="s.id" span="all">
    <template #head>
      <div class="ss-head">
        <Art :value="s.fields.art" :size="44" />
        <div class="ss-names">
          <h2 class="ss-title">{{ s.fields.name }}</h2>
          <div class="ss-facts">{{ facts(s).join(' · ') }}</div>
        </div>
      </div>
    </template>
    <template #aside>
      <button type="button" class="cx-btn cx-btn--quiet" :disabled="busy === `edit:${s.id}`" title="Open the game source that defines this scenario" @click="edit(s)">
        {{ busy === `edit:${s.id}` ? 'Finding…' : 'Edit' }}
      </button>
    </template>
    <p v-if="s.record.description" class="ss-summary">{{ s.record.description }}</p>
    <div class="cx-row">
      <button type="button" class="cx-btn cx-btn--primary" :disabled="busy === `start:${s.id}`" title="Start it with the default seats and options" @click="start(s)">
        {{ busy === `start:${s.id}` ? 'Starting…' : 'Quick start' }}{{ opener.inNewTab() ? ' ↗' : '' }}
      </button>
      <button type="button" class="cx-btn" @click="openSetup(s.record.game, s.record.scenario)">Choose seats and options</button>
    </div>
    <p v-if="error && busy === ''" class="cx-error">{{ error }}</p>
  </ShellCard>
</template>

<style scoped>
.ss-head { display: flex; gap: 12px; align-items: center; min-width: 0; }
.ss-names { min-width: 0; }
.ss-title { margin: 0; font-size: 16px; font-weight: var(--dc-weight-semibold, 600); color: var(--dc-fg-0); }
.ss-facts { margin-top: 2px; font-size: 12px; color: var(--dc-fg-2); }
.ss-summary { margin: 0 0 12px; font-size: 13px; color: var(--dc-fg-1); }
</style>
