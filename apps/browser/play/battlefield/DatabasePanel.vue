<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import DatabaseMoveList from './DatabaseMoveList.vue';

// "What did recorded human players do from here?" — an opening explorer for the
// position on screen, for games that declare a database (GET /games' `database`
// field; the corpus and the lookup are server-side, see api-server.js's
// handleDatabase).
//
// Generic on purpose: what counts as "from here" is the game's business, not
// this component's. Under fog it is not a position at all — the chess database
// groups games by everything the seat to move had been SHOWN by this point (see
// games/chess/fowDatabase.js) — so the answer arrives describing its own
// grouping in `label`/`hint`, and this file just renders rows and says which
// question they answer.
//
// REPLAY ONLY. The server refuses while a session is live, and Battlefield.vue
// only mounts this once the game is over — an opening book consulted mid-game is
// an outside engine playing for you.
const props = defineProps({
  enabled:   { type: Boolean, default: false },
  sessionId: { type: String, default: null },
  gameName:  { type: String, default: null },
  ply:       { type: Number, default: null },  // null = the position the game is at
  // Moves played from `ply` that never happened — a line being explored off the
  // real game. The answer is for the end of that line, and (under fog) is
  // computed from the line as a HISTORY, so an invented move changes what the
  // player would know, not just where the pieces are.
  line:      { type: Array, default: () => [] },
  // Bumps whenever the live position moves on, so an analysis board that is
  // still being played re-asks after every move. `ply` alone cannot do it: at
  // the live position it stays null from one move to the next, and under fog a
  // hidden reply does not change the log this client can see either.
  revision:  { type: [String, Number], default: 0 },
});
const emit = defineEmits(['hover-move', 'select-move']);

// Whether this game HAS a database, and what it is called — declared by the game
// definition and served on GET /games. No database, no panel.
const meta = ref(null);
onMounted(async () => {
  try {
    const games = await api.games();
    meta.value = games.find(g => g.name === props.gameName)?.database ?? null;
  } catch { meta.value = null; }
});
const available = computed(() => props.enabled && !!meta.value);

const panelOn   = ref(true);
const data      = ref(null);
const loading   = ref(false);
const errorMsg  = ref('');
const hoveredIdx = ref(-1);

const moves = computed(() => data.value?.moves ?? []);

let seq = 0;
let debounceTimer = null;
function schedule() { clearTimeout(debounceTimer); debounceTimer = setTimeout(load, 150); }

async function load() {
  if (!available.value || !panelOn.value || !props.sessionId) { data.value = null; return; }
  const mine = ++seq;
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await api.database(props.sessionId, { ply: props.ply, line: props.line });
    if (mine !== seq) return; // a newer ply is already in flight
    data.value = res;
  } catch (e) {
    if (mine !== seq) return;
    data.value = null;
    errorMsg.value = e?.message || 'Lookup failed';
  } finally {
    if (mine === seq) loading.value = false;
  }
}

watch(() => [available.value, props.sessionId, props.ply, props.line.length, props.revision, panelOn.value], () => {
  // The position changed: drop the old rows immediately rather than leaving
  // another position's statistics on screen under the new board.
  seq++;
  data.value = null;
  hoveredIdx.value = -1;
  emit('hover-move', null);
  if (available.value && panelOn.value) schedule();
}, { immediate: true });

function onHover(i) {
  hoveredIdx.value = i;
  emit('hover-move', i >= 0 ? (moves.value[i]?.move ?? null) : null);
}
function onSelect(i) {
  const move = moves.value[i]?.move;
  if (move) emit('select-move', move);
}

// The row the pointer is on, if any — its numbers take over the meta line.
const hovered = computed(() => (hoveredIdx.value >= 0 ? moves.value[hoveredIdx.value] : null) ?? null);

const fmt = (n) => (n ?? 0).toLocaleString();
</script>

<template>
  <div class="db" v-if="available">
    <div class="db-head">
      <span class="panel-t">{{ meta.label }}</span>
      <div class="seg db-onoff">
        <button :class="{ on: panelOn }" @click="panelOn = true">On</button>
        <button :class="{ on: !panelOn }" @click="panelOn = false">Off</button>
      </div>
    </div>

    <template v-if="panelOn">
      <!-- What question the rows answer, in the answer's own words. -->
      <div v-if="data" class="db-grouping" :title="data.hint">{{ data.label }}</div>

      <!-- Hovering a move swaps this line for that move's own numbers: how strong
           the players who chose it were, and how strong the opposition was. Both,
           separately — a move that scores well for 2100s against 1600s is not the
           same recommendation as one that scores well between equals. -->
      <div v-if="hovered" class="db-meta db-meta--hover">
        <span class="db-hover-san mono">{{ hovered.san }}</span>
        <span>· {{ fmt(hovered.games) }} {{ hovered.games === 1 ? 'game' : 'games' }}</span>
        <span v-if="hovered.avgRating">· played by {{ hovered.avgRating }}</span>
        <span v-if="hovered.avgOppRating">· against {{ hovered.avgOppRating }}</span>
      </div>
      <div v-else-if="data" class="db-meta">
        <span class="db-side">{{ data.color }} to move</span>
        <!-- Down a line that never happened, the answer is about that line — worth
             saying, since the numbers otherwise read as being about the real game. -->
        <span v-if="line.length" class="db-fork"
              :title="`${line.length} invented ${line.length === 1 ? 'move' : 'moves'} from the game`">· in your line</span>
        <span v-if="data.total">· {{ fmt(data.total) }} {{ data.total === 1 ? 'game' : 'games' }}</span>
        <span v-if="data.avgRating">· {{ data.avgRating }} vs {{ data.avgOppRating ?? '?' }}</span>
        <span>· {{ fmt(data.corpusSize) }} indexed</span>
      </div>

      <div v-if="errorMsg" class="db-msg">{{ errorMsg }}</div>
      <div v-else-if="loading && !data" class="db-msg">Searching the database…</div>
      <div v-else-if="!data" class="db-msg">No data.</div>
      <div v-else-if="!moves.length" class="db-msg">
        Nobody in the database was ever in this position — knowing exactly what
        this seat knows, having seen exactly what it saw. That happens within a few
        moves: try an earlier ply.
      </div>
      <DatabaseMoveList v-else :moves="moves" :total="data.total" :hoveredIndex="hoveredIdx"
        @hover="onHover" @select="onSelect"/>

      <div v-if="meta.source && data" class="db-src">{{ meta.source }}</div>
    </template>
  </div>
</template>

<style scoped>
.db { border-bottom: 1px solid var(--line); padding: 10px 14px 12px; }
.db-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.db-onoff button { padding: 2px 8px; font-size: 10px; }
.db-grouping { font-size: 10px; color: var(--dim); margin-bottom: 3px; }
.db-meta { font-size: 10px; color: var(--faint); margin-bottom: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
.db-side { text-transform: capitalize; color: var(--dim); }
.db-fork { color: var(--warn); }
.db-meta--hover { color: var(--dim); }
.db-hover-san { color: var(--fg, #ddd); }
.db-msg { font-size: 11px; color: var(--faint); padding: 6px 2px; line-height: 1.45; }
.db-src { font-size: 9px; color: var(--faint); margin-top: 6px; opacity: .7; }
</style>
