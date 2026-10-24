<script setup>
// One row per move recorded from this position: how often it was played, how
// those games ended for the player who played it, and (expandable) a few of the
// actual games. Rows arrive pre-sorted by frequency from the server.
//
// The win/draw/loss bar is from the MOVER's point of view, not white's — under
// fog the database groups games by one seat's own view, so "how did it go" can
// only mean "for that seat".
import { ref, computed, watch } from 'vue';

const props = defineProps({
  moves:        { type: Array,  default: () => [] },
  total:        { type: Number, default: 0 },
  hoveredIndex: { type: Number, default: -1 },
  // How many rows to show before the "…more" fold. From the opening position a
  // few thousand games spread over twenty-odd first moves, and an unfolded list
  // that long pushes every panel below it off the screen.
  max:          { type: Number, default: 12 },
});
const emit = defineEmits(['hover', 'select']);

const expanded = ref(-1);
function toggle(i) { expanded.value = expanded.value === i ? -1 : i; }

const showAll = ref(false);
const shown = computed(() => showAll.value ? props.moves : props.moves.slice(0, props.max));
const hiddenCount = computed(() => props.moves.length - shown.value.length);
// A new position (or a different grouping of it) starts folded again, and with
// nothing expanded: row 3 of the old list is not row 3 of the new one.
watch(() => props.moves, () => { showAll.value = false; expanded.value = -1; });

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);
const share = computed(() => (r) => pct(r.games, props.total));

function outcomeFor(ex, r) {
  // `r.examples[].seat` is the side that played this move in that game; the
  // stored result is the game's, in white's terms.
  if (!ex.result) return '';
  if (ex.result.startsWith('1/2')) return '½';
  const won = (ex.result === '1-0') === (ex.seat === 'white');
  return won ? 'W' : 'L';
}
</script>

<template>
  <div class="db-rows">
    <template v-for="(r, i) in shown" :key="r.san">
      <div class="db-row" :class="{ 'db-row--hovered': i === hoveredIndex, 'db-row--unavailable': !r.move }"
           :title="r.move ? 'Click to play this move' : 'Not available in your position — this move comes from games whose hidden half differed'"
           @mouseenter="emit('hover', i)" @mouseleave="emit('hover', -1)"
           @click="r.move && emit('select', i)">
        <span class="db-san mono">{{ r.san }}</span>
        <span class="db-n mono">{{ r.games.toLocaleString() }}</span>
        <span class="db-share mono">{{ share(r) }}%</span>
        <span class="db-bar" :title="`${r.win} won · ${r.draw} drawn · ${r.loss} lost`">
          <span class="db-bar-w" :style="{ width: pct(r.win, r.games) + '%' }"/>
          <span class="db-bar-d" :style="{ width: pct(r.draw, r.games) + '%' }"/>
          <span class="db-bar-l" :style="{ width: pct(r.loss, r.games) + '%' }"/>
        </span>
        <button class="db-more" :class="{ on: expanded === i }" title="Show example games"
                @click.stop="toggle(i)">{{ expanded === i ? '▾' : '▸' }}</button>
      </div>
      <div v-if="expanded === i" class="db-games">
        <div v-for="ex in r.examples" :key="ex.id + ':' + ex.ply" class="db-game">
          <span class="db-g-players"
                :title="`${ex.white} (${ex.whiteRating ?? '?'}) — ${ex.black} (${ex.blackRating ?? '?'})${ex.playedAt ? ' · ' + ex.playedAt : ''}${ex.timeControl ? ' · ' + ex.timeControl : ''}`">
            {{ ex.white }} ({{ ex.whiteRating ?? '?' }}) — {{ ex.black }} ({{ ex.blackRating ?? '?' }})</span>
          <span class="db-g-res mono" :class="'db-g-' + outcomeFor(ex, r).toLowerCase()">{{ outcomeFor(ex, r) }}</span>
          <span class="db-g-meta mono">move {{ Math.floor(ex.ply / 2) + 1 }}</span>
        </div>
        <div v-if="r.games > r.examples.length" class="db-game db-game--more">
          + {{ (r.games - r.examples.length).toLocaleString() }} more
        </div>
      </div>
    </template>
    <button v-if="hiddenCount > 0" class="db-fold" @click="showAll = true">
      + {{ hiddenCount }} more {{ hiddenCount === 1 ? 'move' : 'moves' }}
    </button>
    <button v-else-if="showAll && moves.length > max" class="db-fold" @click="showAll = false">
      Show fewer
    </button>
  </div>
</template>

<style scoped>
.db-rows { display: flex; flex-direction: column; gap: 1px; }
.db-row {
  display: grid; grid-template-columns: 42px 34px 30px 1fr 14px;
  align-items: center; gap: 6px; font-size: 11px; padding: 2px 4px;
  border-radius: 3px; cursor: pointer;
}
.db-row:hover, .db-row--hovered { background: rgba(255,255,255,.06); }
.db-row--unavailable { cursor: default; opacity: .45; }
.db-san { color: var(--fg, #ddd); }
.db-n { font-size: 10px; color: var(--dim); text-align: right; }
.db-share { font-size: 10px; color: var(--faint); text-align: right; }
.db-bar { display: flex; height: 9px; border-radius: 2px; overflow: hidden; background: var(--bg0); }
.db-bar-w { background: #6ea86e; }
.db-bar-d { background: #7a7a7a; }
.db-bar-l { background: #a85a5a; }
.db-more { background: none; border: 0; padding: 0; font-size: 9px; color: var(--faint); cursor: pointer; }
.db-more.on { color: var(--accent); }
.db-games { padding: 2px 4px 4px 8px; display: flex; flex-direction: column; gap: 2px; }
.db-game { display: grid; grid-template-columns: 1fr 14px 46px; gap: 5px; align-items: center; font-size: 10px; color: var(--faint); }
.db-g-players { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-g-w { color: var(--ok); }
.db-g-l { color: var(--danger); }
.db-g-meta { text-align: right; }
.db-game--more { color: var(--faint); font-style: italic; }
.db-fold {
  align-self: flex-start; margin-top: 3px; padding: 1px 4px;
  background: none; border: 0; font-size: 10px; color: var(--dim); cursor: pointer;
}
.db-fold:hover { color: var(--accent); }
</style>
