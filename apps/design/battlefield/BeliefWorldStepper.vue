<script setup>
import { ref, computed, watch } from 'vue';
// ---------------------------------------------------------------------------
// "What does the board probably look like?" — a stepper over the analysis
// engine's belief population (see games/chess/ObscuroAgent.js's
// analyzeObscuroProgressive → beliefWorlds).
//
// Under fog the viewer sees a hole where the opponent's army is. The analysis
// already reasons over the whole set of boards consistent with what they CAN
// see; this exposes that set directly. Two orderings, chosen by the move
// selector:
//
//   • "Most likely" (no move selected) — worlds ranked by marginal
//     plausibility, i.e. how well each agrees with where the population as a
//     whole puts the hidden pieces. #1 is the consensus board.
//   • A specific candidate move — worlds ranked by how good that move looks in
//     them: primarily by the move's RANK among all moves in that world (#1 =
//     a world where it is outright the best move available), cp breaking ties.
//     Only worlds the engine actually priced can be ordered this way.
//
// Emits the selected world's hidden pieces; the board draws them as markers on
// top of the real, unchanged fog (Battlefield.vue → HtmlLayer.vue).
// ---------------------------------------------------------------------------
const props = defineProps({
  // { total, exact, depth, moves: [actionKey], worlds: [{ id, prob, hidden, cp }] }
  belief:     { type: Object, default: null },
  // The panel's ranked candidate rows (each carries the `key` that indexes into
  // `belief.moves`), so the move selector names real moves rather than indices.
  candidates: { type: Array, default: () => [] },
});
const emit = defineEmits(['world']);

// '' = the plausibility ordering; otherwise a candidate move's action key.
const moveKey = ref('');
const n = ref(1);

const worlds = computed(() => props.belief?.worlds ?? []);
const cpColumn = computed(() => {
  if (!moveKey.value) return -1;
  return props.belief?.moves?.indexOf(moveKey.value) ?? -1;
});

// Rank of `col` within one world's cp vector — 1 = the best move on that board.
// Ties share the better rank (standard competition ranking), so "this move is
// one of three equal-best replies" reads as #1 rather than #3.
function rankIn(cp, col) {
  const v = cp[col];
  let better = 0;
  for (let i = 0; i < cp.length; i++) if (cp[i] > v) better++;
  return better + 1;
}

const rows = computed(() => {
  const col = cpColumn.value;
  if (col < 0) {
    // Plausibility order. The engine-priced worlds that fell outside the
    // top-plausibility page have no prob attached (generative belief, or an
    // index past the ranking's cap) — keep them, but after the ranked ones.
    return worlds.value
      .map(w => ({ w, prob: w.prob }))
      .sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1));
  }
  return worlds.value
    .filter(w => Array.isArray(w.cp) && w.cp.length > col)
    .map(w => ({ w, rank: rankIn(w.cp, col), cp: w.cp[col] }))
    .sort((a, b) => (a.rank - b.rank) || (b.cp - a.cp));
});

const current = computed(() => rows.value[n.value - 1] ?? null);

// Clamp whenever the list changes shape (new position, new ordering, more
// worlds priced) so the index never points past the end.
watch(rows, (r) => { if (n.value > r.length) n.value = Math.max(1, r.length); });
watch(moveKey, () => { n.value = 1; });

function step(d) {
  const len = rows.value.length;
  if (!len) return;
  n.value = Math.min(len, Math.max(1, n.value + d));
}
function onInput(e) {
  const v = parseInt(e.target.value, 10);
  n.value = Number.isFinite(v) ? Math.min(rows.value.length || 1, Math.max(1, v)) : 1;
}

function fmtMove(m) {
  if (!m) return '?';
  if (typeof m.from === 'string' && typeof m.to === 'string') return m.from + '→' + m.to;
  return m.type || 'move';
}
function fmtCp(cp) {
  if (cp == null) return '—';
  if (Math.abs(cp) >= 90000) return cp > 0 ? '#' : '-#';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

const label = computed(() => {
  const r = current.value;
  if (!r) return 'No belief worlds yet.';
  if (cpColumn.value < 0) {
    const p = r.prob != null ? `${(r.prob * 100).toFixed(1)}% likely` : 'sampled world';
    return `${p} · ${r.w.hidden?.length ?? 0} hidden`;
  }

  const nMoves = r.w.cp.length;
  return `ranks #${r.rank}/${nMoves} here · ${fmtCp(r.cp)}`;
});

// How much of the population is on offer, and how much of it is only a sample
// of it — the stepper walks a bounded page, not all ~200k worlds.
const scope = computed(() => {
  const b = props.belief;
  if (!b) return '';
  const shown = rows.value.length;
  if (cpColumn.value >= 0) return `${shown} scored${b.depth ? ` @ d${b.depth}` : ''}`;
  if (b.total && b.total > shown) return `top ${shown} of ${b.total.toLocaleString()}`;
  return `${shown} world${shown === 1 ? '' : 's'}`;
});

// A re-acquired population is a SUPERSET of the boards actually possible, so it
// can contain impossible ones — the ranking is still meaningful, but the numbers
// must not be read as certainty. Say so rather than letting "100.0% likely" imply
// the engine knows something it doesn't.
const approx = computed(() => props.belief?.approx === true);

watch(current, (r) => emit('world', r?.w ?? null), { immediate: true });
</script>

<template>
  <div class="bw" v-if="belief && worlds.length">
    <select v-model="moveKey" class="bw-sel" title="Order the belief worlds by how good one move looks in them">
      <option value="">Most likely boards</option>
      <option v-for="c in candidates" :key="c.key" :value="c.key">Best for {{ fmtMove(c.move) }}</option>
    </select>
    <div class="bw-step">
      <button class="bw-btn" :disabled="n <= 1" title="Previous board" @click="step(-1)">◀</button>
      <input class="bw-n mono" type="number" min="1" :max="rows.length || 1" :value="n" @input="onInput"/>
      <span class="bw-of mono">/ {{ rows.length }}</span>
      <button class="bw-btn" :disabled="n >= rows.length" title="Next board" @click="step(1)">▶</button>
      <span class="bw-scope mono">{{ scope }}</span>
    </div>
    <div class="bw-label mono">{{ label }}</div>
    <div v-if="approx" class="bw-warn mono" title="The belief set was re-acquired rather than tracked from the first move, so it is a superset of the truly possible boards — treat these as guesses, not certainties.">
      approximate belief — superset, may include impossible boards
    </div>
  </div>
</template>

<style scoped>
.bw { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 5px; }
.bw-sel { background: var(--bg0); border: 1px solid var(--line); border-radius: var(--r); color: var(--txt); font-size: 11px; padding: 3px 6px; width: 100%; }
.bw-step { display: flex; align-items: center; gap: 4px; }
.bw-btn { font-size: 10px; line-height: 1; padding: 3px 6px; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); }
.bw-btn:disabled { opacity: 0.35; cursor: default; }
.bw-n { width: 46px; background: var(--bg0); border: 1px solid var(--line); border-radius: var(--r); color: var(--txt); font-size: 11px; padding: 2px 4px; text-align: right; }
.bw-of { font-size: 10px; color: var(--faint); }
.bw-scope { font-size: 10px; color: var(--faint); margin-left: auto; white-space: nowrap; }
.bw-label { font-size: 10px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bw-warn { font-size: 9px; color: var(--warn); line-height: 1.3; }
</style>
