<script setup>
// Observer-only control: switch between the full-information view ("Everyone")
// and watching through a single player's own fog-limited perspective. App.vue
// owns the actual re-subscription (see setObserverView); we just bubble the pick.
import { computed } from 'vue';
const props = defineProps({
  // Authoritative player list [{ id, name }] — comes from liveState.params.players
  // so it stays complete even while viewing one player's (fog-trimmed) board.
  players: { type: Array, default: () => [] },
  // field.teams, used only to tint each option with its team colour when available.
  teams:   { type: Array, default: () => [] },
  // Current perspective: null = Everyone, else the selected playerId.
  value:   { type: String, default: null },
});
const emit = defineEmits(['change']);

function colorFor(id) {
  return props.teams.find(t => t.id === id)?.raw ?? 'var(--dim)';
}
const opts = computed(() =>
  props.players.map(p => ({ id: p.id, name: p.name ?? p.id, color: colorFor(p.id) })));
</script>

<template>
  <div class="op">
    <div class="op-label up">Perspective</div>
    <div class="op-row">
      <button class="op-btn" :class="{ 'op-btn--on': value == null }"
              @click="emit('change', null)">
        <BsIcon name="eye" :size="11"/> Everyone
      </button>
      <button v-for="o in opts" :key="o.id"
              class="op-btn" :class="{ 'op-btn--on': value === o.id }"
              @click="emit('change', o.id)">
        <BsDot :color="o.color" :size="7"/> {{ o.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.op { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.op-label { font-size: 10px; color: var(--faint); letter-spacing: .1em; margin-bottom: 7px; }
.op-row { display: flex; flex-wrap: wrap; gap: 5px; }
.op-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px; font-size: 11px; border-radius: 5px;
  border: 1px solid var(--line); background: var(--bg2); color: var(--dim);
  cursor: pointer; transition: border-color .15s, color .15s;
}
.op-btn:hover { color: var(--txt); }
.op-btn--on { border-color: var(--accent); color: var(--accent); background: var(--bg1); }
</style>
