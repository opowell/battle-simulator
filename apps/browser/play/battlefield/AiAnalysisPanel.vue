<script setup>
import { computed } from 'vue';
import AnalysisCandidateList from './AnalysisCandidateList.vue';

// Latest AI decision record per player, as broadcast by the server (see
// api-server.js Session.aiAnalysis / agents/ObscuroAgent.js _buildAnalysis).
const props = defineProps({
  analysis: { type: Object, default: () => ({}) },
});

// Newest decision first, so the side that just moved is on top.
const entries = computed(() =>
  Object.values(props.analysis || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
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

        <AnalysisCandidateList :candidates="a.candidates"/>
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
.ai-more { font-size: 10px; color: var(--faint); padding-top: 4px; }
</style>
