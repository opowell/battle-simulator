<script setup>
import { computed } from 'vue';
// Individual units are ambiguous client-side (see Civ1Game.toGrid's `glyph` comment —
// militia/musketeers/mech-inf/marines all render as 'm'), so an empire-wide roster
// can't be built from the rendered units array. Civ1Game.toGrid's `military` field
// does the counting/summing server-side instead, where UNITS stats are available —
// including `units`, the unit-by-unit list the roster below is built from.
const props = defineProps({
  show:     Boolean,
  military: { type: Object, default: null },
  playerId: { type: String, default: null },
});
const emit = defineEmits(['close', 'select-unit']);

const mine = computed(() => props.military?.[props.playerId]
  ?? { total: 0, totalAttack: 0, totalDefense: 0, byType: {}, units: [] });
const byType = computed(() => Object.entries(mine.value.byType).sort((a, b) => b[1] - a[1]));
// Server-sorted (units still owing this turn an order first — see toGrid), so the list
// doubles as "who have I not moved yet?" and keeps a stable order as moves are spent.
const units = computed(() => mine.value.units ?? []);
const waiting = computed(() => units.value.filter(u => u.needsOrders).length);

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// Where it stands, in the words the player thinks in (see toGrid's `city`/`terrain`).
// The square itself goes on the row's second line: on an empire of twenty militia the
// terrain alone doesn't tell two rows apart, and the map is where the answer is.
function place(u) { return u.city ?? u.terrain ?? `${u.x},${u.y}`; }

// The advisor is how you FIND a unit in an empire of dozens — a stacked or garrisoned
// one especially, since the board only ever draws the top of a stack. So a row hands
// the unit over to the map and gets out of the way.
function pick(u) {
  emit('select-unit', u.id);
  emit('close');
}
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

        <div v-if="units.length" class="mo-sub">
          <span class="mo-sub-k">All units</span>
          <span v-if="waiting" class="mono mo-sub-v">{{waiting}} awaiting orders</span>
        </div>
        <div v-if="units.length" class="mo-units">
          <button v-for="u in units" :key="u.id" class="mo-unit"
                  :class="{ 'mo-unit--wants': u.needsOrders }" @click="pick(u)">
            <span class="mo-u-name">{{cap(u.type)}}</span>
            <span class="mo-u-where">{{place(u)}}</span>
            <span class="mono mo-u-stats" title="Attack / defense">{{u.attack}}/{{u.defense}}</span>
            <span class="mono mo-u-mp" title="Moves left this turn">{{u.mp}}/{{u.maxMp}} mp</span>
            <span class="mo-u-tags">{{[`${u.x},${u.y}`, ...u.status].join(' · ')}}</span>
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mo-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.mo-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 340px; max-width: 92vw; max-height: 88vh; overflow-y: auto; padding: 16px 18px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
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

.mo-sub { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 6px; }
.mo-sub-k { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; }
.mo-sub-v { font-size: 9px; color: var(--dim); margin-left: auto; }
.mo-units { display: flex; flex-direction: column; gap: 3px; max-height: 300px; overflow-y: auto; }
/* One row per unit: name, where it stands, its a/d, its moves left, its standing orders. */
.mo-unit { display: grid; grid-template-columns: 1fr auto auto auto; grid-auto-rows: auto; gap: 1px 8px;
  text-align: left; font: inherit; font-size: 11px; padding: 5px 8px; cursor: pointer;
  background: var(--bg2); border: 1px solid transparent; border-radius: 4px; color: var(--dim); }
.mo-unit:hover { border-color: var(--line2); background: var(--bg3); }
/* A unit that still owes this turn an order — the reason to open the list mid-turn. */
.mo-unit--wants { border-left: 2px solid var(--acc, #d8c038); }
.mo-u-name  { color: var(--txt); font-weight: 600; }
.mo-u-where { color: var(--dim); }
.mo-u-stats { color: var(--faint); }
.mo-u-mp    { color: var(--faint); }
.mo-u-tags  { grid-column: 1 / -1; color: var(--faint); font-size: 10px; }
</style>
