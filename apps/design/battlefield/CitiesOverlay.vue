<script setup>
import { computed } from 'vue';
// Civ1's cities have no map-level status readout beyond the sprite/size badge —
// checking on a multi-city empire otherwise means hunting each one down on the map
// and clicking it. Lists every owned city with its production/food progress; clicking
// a row centres the map on it and selects it (see Civ1Game.toGrid's `cities` field).
const props = defineProps({
  show:     Boolean,
  cities:   { type: Array, default: () => [] },
  playerId: { type: String, default: null },
});
const emit = defineEmits(['close', 'goto']);

const myCities = computed(() => props.cities.filter(c => c.owner === props.playerId));

function goto(c) {
  // Cities render as pseudo-units with no real unitId (see App.vue's buildField) —
  // their synthetic id is derived from position the same way there.
  emit('goto', { x: c.x, y: c.y, unitId: `u_${c.x}_${c.y}` });
  emit('close');
}
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="co-scrim" @click.self="$emit('close')">
      <div class="co-panel">
        <div class="co-head">
          <span class="co-title">Cities ({{myCities.length}})</span>
          <button class="co-close" @click="$emit('close')">×</button>
        </div>
        <div class="co-list">
          <button v-for="c in myCities" :key="c.id" class="co-row" @click="goto(c)">
            <div class="co-row-top">
              <span class="co-name">{{c.name}}</span>
              <span class="mono co-size">size {{c.size}}</span>
            </div>
            <div class="mono co-sub">
              Building {{c.productionName}} ({{c.shields}}/{{c.buildCost}}▪) · food {{c.food}}/{{c.foodBox}}
            </div>
            <div class="co-bar">
              <div class="co-bar-fill" :style="{ width: Math.min(100, c.buildCost ? c.shields / c.buildCost * 100 : 0) + '%' }"/>
            </div>
            <div v-if="c.buildings.length" class="mono co-buildings">{{c.buildings.join(', ')}}</div>
          </button>
          <div v-if="!myCities.length" class="co-empty">No cities yet.</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.co-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.co-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 340px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.co-head { padding: 16px 18px; display: flex; align-items: center; border-bottom: 1px solid var(--line); flex: none; }
.co-title { font-weight: 700; font-size: 13px; flex: 1; }
.co-close { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 15px; cursor: pointer; line-height: 1; }
.co-list { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.co-row { text-align: left; background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r); padding: 8px 10px; cursor: pointer; }
.co-row:hover { border-color: var(--accent); }
.co-row-top { display: flex; justify-content: space-between; margin-bottom: 3px; }
.co-name { font-weight: 700; font-size: 12px; }
.co-size { font-size: 10px; color: var(--faint); }
.co-sub { font-size: 10px; color: var(--dim); margin-bottom: 5px; }
.co-bar { height: 4px; border-radius: 2px; background: var(--bg3); overflow: hidden; }
.co-bar-fill { height: 100%; background: var(--accent); }
.co-buildings { font-size: 9px; color: var(--faint); margin-top: 5px; }
.co-empty { font-size: 11px; color: var(--faint); padding: 8px; }
</style>
