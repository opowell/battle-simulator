<script setup>
// Shared ranked-move row list: rank, move, cp/eval, mix %. Used by both
// AiAnalysisPanel.vue (the AI's own post-hoc decision log) and AnalysisPanel.vue
// (the live/replay "suggest a move" panel) so the two keep one visual language
// instead of duplicating this markup. Rows arrive already ranked (the engine's
// recommendation order); for Obscuro that order is by CFR mixing probability
// first and cp only as a tiebreak, so the probability is shown alongside eval —
// otherwise the displayed order looks unsorted relative to the eval column.
const props = defineProps({
  candidates: { type: Array, default: () => [] },
  // Optional: index of the row to visually mark as "chosen" (AiAnalysisPanel)
  // or "hovered" (AnalysisPanel) — separate from `candidates[i].chosen`.
  hoveredIndex: { type: Number, default: -1 },
});
const emit = defineEmits(['hover', 'select']);

function fmtMove(m) {
  if (!m) return '?';
  if (typeof m.from === 'string' && typeof m.to === 'string')
    return m.from + ' → ' + m.to + (m.isCapture ? ' ×' : '');
  if (m.side) return m.side === 'kingside' ? 'O-O' : 'O-O-O';
  return (m.type || 'move') + (m.unitId ? ' ' + m.unitId : '');
}

// Stockfish centipawns → pawns, from the mover's perspective (e.g. +1.35).
function fmtCp(cp) {
  if (cp == null) return '—';
  if (Math.abs(cp) >= 90000) return cp > 0 ? '#' : '-#'; // mate score
  const p = cp / 100;
  return (p >= 0 ? '+' : '') + p.toFixed(2);
}

function fmtProb(prob) {
  if (prob == null) return '';
  return Math.round(prob * 100) + '%';
}
</script>

<template>
  <div class="ai-rows">
    <div v-for="(c, i) in candidates" :key="c.key ?? i"
         class="ai-row" :class="{ 'ai-row--chosen': c.chosen, 'ai-row--hovered': i === hoveredIndex }"
         @mouseenter="emit('hover', i)" @mouseleave="emit('hover', -1)" @click="emit('select', i)">
      <span class="mono ai-rank">{{ i + 1 }}</span>
      <span class="ai-move">{{ fmtMove(c.move) }}</span>
      <span class="mono ai-cp" :class="c.cp > 20 ? 'ai-pos' : c.cp < -20 ? 'ai-neg' : ''">
        {{ c.cp != null ? fmtCp(c.cp) : '' }}</span>
      <span class="mono ai-prob">{{ fmtProb(c.prob) }}</span>
    </div>
  </div>
</template>

<style scoped>
.ai-rows { display: flex; flex-direction: column; gap: 1px; }
.ai-row { display: grid; grid-template-columns: 16px 1fr 46px 34px; align-items: center; gap: 6px; font-size: 11px; padding: 1px 4px; border-radius: 3px; cursor: pointer; }
.ai-row:hover, .ai-row--hovered { background: rgba(255,255,255,.06); }
/* The move actually played: bold text and a stronger background highlight. */
.ai-row--chosen { background: rgba(66,198,230,.18); }
.ai-row--chosen .ai-move { font-weight: 700; color: var(--fg, #fff); }
.ai-rank { font-size: 9px; color: var(--faint); text-align: right; }
.ai-move { color: var(--fg, #ddd); }
.ai-cp { font-size: 10px; color: var(--dim); text-align: right; }
.ai-cp.ai-pos { color: var(--ok); }
.ai-cp.ai-neg { color: var(--danger); }
.ai-prob { font-size: 10px; color: var(--faint); text-align: right; }
</style>
