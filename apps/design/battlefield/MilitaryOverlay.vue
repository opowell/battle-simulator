<script setup>
import { computed } from 'vue';
// Individual units are ambiguous client-side (see Civ1Game.toGrid's `glyph` comment —
// militia/musketeers/mech-inf/marines all render as 'm'), so an empire-wide roster
// can't be built from the rendered units array. Civ1Game.toGrid's `military` field
// does the counting/summing server-side instead, where UNITS stats are available.
const props = defineProps({
  show:     Boolean,
  military: { type: Object, default: null },
  playerId: { type: String, default: null },
});
defineEmits(['close']);

const mine = computed(() => props.military?.[props.playerId] ?? { total: 0, totalAttack: 0, totalDefense: 0, byType: {} });
const byType = computed(() => Object.entries(mine.value.byType).sort((a, b) => b[1] - a[1]));

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="mo-scrim" @click.self="$emit('close')">
      <div class="mo-panel">
        <div class="mo-head">
          <span class="mo-title">Military</span>
          <button class="mo-close" @click="$emit('close')">×</button>
        </div>
        <div class="mo-totals">
          <div class="mo-stat">
            <span class="mono mo-stat-v">{{mine.total}}</span>
            <span class="mo-stat-k">Units</span>
          </div>
          <div class="mo-stat">
            <span class="mono mo-stat-v">{{mine.totalAttack}}</span>
            <span class="mo-stat-k">Attack</span>
          </div>
          <div class="mo-stat">
            <span class="mono mo-stat-v">{{mine.totalDefense}}</span>
            <span class="mo-stat-k">Defense</span>
          </div>
        </div>
        <div class="mo-list">
          <div v-for="[type, count] in byType" :key="type" class="mo-row">
            <span class="mo-type">{{cap(type)}}</span>
            <span class="mono mo-count">×{{count}}</span>
          </div>
          <div v-if="!byType.length" class="mo-empty">No units.</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mo-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.mo-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 300px; max-width: 92vw; padding: 16px 18px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.mo-head { display: flex; align-items: center; margin-bottom: 14px; }
.mo-title { font-weight: 700; font-size: 13px; flex: 1; }
.mo-close { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 15px; cursor: pointer; line-height: 1; }
.mo-totals { display: flex; gap: 8px; margin-bottom: 14px; }
.mo-stat { flex: 1; display: flex; flex-direction: column; align-items: center; background: var(--bg3); border-radius: var(--r); padding: 8px 0; }
.mo-stat-v { font-size: 15px; font-weight: 700; color: var(--txt); }
.mo-stat-k { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
.mo-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.mo-row { display: flex; justify-content: space-between; font-size: 11px; padding: 5px 8px; background: var(--bg2); border-radius: 4px; }
.mo-type { color: var(--txt); }
.mo-count { color: var(--dim); }
.mo-empty { font-size: 11px; color: var(--faint); }
</style>
