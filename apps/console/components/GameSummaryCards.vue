<script setup>
// What a query naming a game adds to the card-per-type screen: a card for the
// game itself, ahead of the cards of what it holds. appfr drops the Games card
// once the query has named the one game (it would only repeat the header), so
// this is where the game's own summary and the way into a new session go.
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

// The game rows (rows.js), one per game.
const props = defineProps({ games: { type: Array, default: () => [] } })
const emit = defineEmits(['open', 'changed'])

const shell = useShellContext()
const opener = useSessionOpener()
const openSetup = useSetupOpener()

/**
 * The games the query narrows to: `game:x` terms, in any alternative, not left
 * out. A game one of whose scenarios the query names gives way to that
 * scenario's card (ScenarioSummaryCards), which starts it the same ways.
 */
const named = computed(() => {
  const expr = shell.query.value.expr
  const wanted = namedIn(expr, 'game')
  const scenarios = namedIn(expr, 'scenario')
  return props.games.filter((g) => wanted.has(g.record.name.toLowerCase()) && !g.fields.scenario.some((id) => scenarios.has(id.toLowerCase())))
})

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const facts = (game) => [
  `${game.fields.players} players`,
  game.record.fog ? 'fog of war' : null,
  plural(game.record.agents ?? 0, 'agent'),
  plural(game.record.options ?? 0, 'option'),
].filter(Boolean)

// GET /games has what starting one takes (seats, agents, scenarios); asked once.
let gamesList = null
const gameEntry = async (name) => (await (gamesList ??= api.games())).find((g) => g.name === name)

const busy = ref('')
const error = ref('')

async function start(game) {
  const pending = opener.begin()
  busy.value = game.id; error.value = ''
  try {
    const entry = await gameEntry(game.record.name)
    if (!entry) throw new Error(`${game.fields.name} is not loaded — restart the server to play it.`)
    const created = await api.createSession(sessionRequest(entry, '', defaultSeats(entry, '')))
    pending.go(created.id)
    emit('changed')
  } catch (e) {
    pending.cancel()
    gamesList = null
    error.value = e.message
  }
  busy.value = ''
}
</script>

<template>
  <ShellCard v-for="game in named" :key="game.id" span="all">
    <template #head>
      <div class="gs-head">
        <Art :value="game.fields.art" :size="56" />
        <div class="gs-names">
          <h2 class="gs-title">{{ game.fields.name }}</h2>
          <div class="gs-facts"><span class="cx-mono">{{ game.record.name }}</span> · {{ facts(game).join(' · ') }}</div>
        </div>
      </div>
    </template>
    <template #aside>
      <button type="button" class="cx-btn cx-btn--quiet" title="Player counts, sides and source files" @click="emit('open', game)">Definition</button>
    </template>
    <div class="cx-row">
      <template v-if="game.record.live">
        <button type="button" class="cx-btn cx-btn--primary" :disabled="busy === game.id" @click="start(game)">
          {{ busy === game.id ? 'Starting…' : 'Start a new session' }}{{ opener.inNewTab() ? ' ↗' : '' }}
        </button>
        <button type="button" class="cx-btn" @click="openSetup(game.record.name)">Choose seats and options</button>
      </template>
      <p v-else class="cx-note">Registered but not loaded: restart the server to play it.</p>
    </div>
    <p v-if="error && busy === ''" class="cx-error">{{ error }}</p>
  </ShellCard>
</template>

<style scoped>
.gs-head { display: flex; gap: 14px; align-items: center; min-width: 0; }
.gs-names { min-width: 0; }
.gs-title { margin: 0; font-size: 18px; font-weight: var(--dc-weight-semibold, 600); color: var(--dc-fg-0); }
.gs-facts { margin-top: 2px; font-size: 12px; color: var(--dc-fg-2); }
</style>
