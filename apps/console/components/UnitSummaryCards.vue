<script setup>
// What a query naming a unit adds to the card-per-type screen, as
// GameSummaryCards does for a game: a card for the unit itself — its picture,
// what it is and who starts with it — ahead of the cards of its game and those
// sides. Pressing a unit anywhere in the console narrows to it, so this card is
// where its definition is opened from.
//
// Rendered in DataShell's #cards-before slot, so it reads the query off the
// shell rather than being handed it.
import { computed } from 'vue'
import { ShellCard, useShellContext } from 'header-content-layout'
import { namedIn } from '../source.js'
import Art from './Art.vue'

// The unit rows (rows.js).
const props = defineProps({ units: { type: Array, default: () => [] } })
// open: (row) — a record to open beside the browser.
const emit = defineEmits(['open'])

const shell = useShellContext()

const named = computed(() => {
  const wanted = namedIn(shell.query.value.expr, 'unit')
  return props.units.filter((u) => wanted.has(u.id.toLowerCase()))
})

const facts = (u) => [
  u.fields.gameTitle,
  u.record.starting ? `${u.record.starting} at start` : 'nobody starts with it',
  u.fields.sides || null,
].filter(Boolean)
</script>

<template>
  <ShellCard v-for="u in named" :key="u.id" span="all">
    <template #head>
      <div class="us-head">
        <Art :value="u.fields.art" :size="96" />
        <div class="us-names">
          <h2 class="us-title">{{ u.fields.name }}</h2>
          <div class="us-facts"><span class="cx-mono">{{ u.record.type }}</span> · {{ facts(u).join(' · ') }}</div>
        </div>
      </div>
    </template>
    <template #aside>
      <button type="button" class="cx-btn cx-btn--quiet" title="Every field the catalog has for it" @click="emit('open', u)">Definition</button>
    </template>
  </ShellCard>
</template>

<style scoped>
.us-head { display: flex; gap: 14px; align-items: center; min-width: 0; }
.us-names { min-width: 0; }
.us-title { margin: 0; font-size: 18px; font-weight: var(--dc-weight-semibold, 600); color: var(--dc-fg-0); }
.us-facts { margin-top: 2px; font-size: 12px; color: var(--dc-fg-2); }
</style>
