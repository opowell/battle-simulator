<script setup>
import { computed } from 'vue';

// Latest AI decision record per player, as broadcast by the server (see
// api-server.js Session.aiAnalysis / agents/ObscuroAgent.js _buildAnalysis).
const props = defineProps({
  analysis: { type: Object, default: () => ({}) },
});

// Newest decision first, so the side that just moved is on top.
const entries = computed(() =>
  Object.values(props.analysis || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0)));

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
function pct(p) { return Math.round((p || 0) * 100); }
</script>

<template>
  <div class="ai" v-if="entries.length">
    <div class="panel-t ai-title">AI Analysis</div>
    <div class="ai-scroll">
      <div v-for="a in entries" :key="a.player" class="ai-block">
        <div class="ai-head">
          <b class="ai-player">{{ a.player }}</b>
          <span class="ai-mode">{{ a.mode }}</span>
        </div>
        <div class="ai-meta mono">
          <span v-if="a.difficulty != null">power {{ a.difficulty }}</span>
          <span v-if="a.worlds">· {{ a.worlds }} worlds</span>
          <span v-if="a.value != null">· v {{ a.value }}</span>
          <span v-if="a.chosenRank != null">· picked #{{ a.chosenRank }}</span>
        </div>

        <div class="ai-rows">
          <div v-for="(c, i) in a.candidates" :key="c.key"
               class="ai-row" :class="{ 'ai-row--chosen': c.chosen }">
            <span class="mono ai-rank">{{ i + 1 }}</span>
            <span class="ai-move">{{ fmtMove(c.move) }}</span>
            <!-- Stockfish centipawn eval, when scored. -->
            <span class="mono ai-cp" :class="c.cp > 20 ? 'ai-pos' : c.cp < -20 ? 'ai-neg' : ''">
              {{ c.cp != null ? fmtCp(c.cp) : '' }}</span>
            <!-- Selection / equilibrium probability bar, when this is a distribution. -->
            <span class="ai-bar"><span v-if="c.prob != null" class="ai-bar-fill"
              :style="{ width: pct(c.prob) + '%' }"></span></span>
            <span class="mono ai-metric">{{ c.prob != null ? pct(c.prob) + '%' : '' }}</span>
          </div>
        </div>
        <div v-if="a.totalCandidates > a.candidates.length" class="ai-more">
          +{{ a.totalCandidates - a.candidates.length }} more
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai { border-top: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; max-height: 40%; }
.ai-title { padding: 7px 14px; flex-shrink: 0; }
.ai-scroll { overflow-y: auto; flex: 1; }
.ai-block { padding: 4px 14px 8px; border-bottom: 1px solid var(--line); }
.ai-head { display: flex; align-items: baseline; gap: 8px; }
.ai-player { color: var(--accent); font-size: 12px; }
.ai-mode { font-size: 10px; color: var(--dim); }
.ai-meta { font-size: 10px; color: var(--faint); margin: 2px 0 5px; display: flex; gap: 5px; flex-wrap: wrap; }
.ai-rows { display: flex; flex-direction: column; gap: 1px; }
.ai-row { display: grid; grid-template-columns: 16px 62px 46px 1fr 38px; align-items: center; gap: 6px; font-size: 11px; padding: 1px 4px; border-radius: 3px; }
/* The move actually played: bold text and a stronger background highlight. */
.ai-row--chosen { background: rgba(66,198,230,.18); }
.ai-row--chosen .ai-move { font-weight: 700; color: var(--fg, #fff); }
.ai-rank { font-size: 9px; color: var(--faint); text-align: right; }
.ai-move { color: var(--fg, #ddd); }
.ai-cp { font-size: 10px; color: var(--dim); text-align: right; }
.ai-cp.ai-pos { color: var(--ok); }
.ai-cp.ai-neg { color: var(--danger); }
.ai-bar { height: 5px; background: rgba(255,255,255,.06); border-radius: 3px; overflow: hidden; }
.ai-bar-fill { display: block; height: 100%; background: var(--accent); }
.ai-metric { font-size: 10px; color: var(--dim); min-width: 34px; text-align: right; }
.ai-more { font-size: 10px; color: var(--faint); padding-top: 4px; }
</style>
