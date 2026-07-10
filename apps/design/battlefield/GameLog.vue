<script setup>
const props = defineProps({
  log:           { type: Array, default: () => [] },
  historyLength: { type: Number, default: 0 },
  histPos:       { type: Number, default: 0 },
  units:         { type: Array, default: () => [] },
});
defineEmits(['seek']);

function fmtAction(action) {
  const t = action.type ?? '';
  if (t === 'move') {
    if (typeof action.from === 'string' && typeof action.to === 'string')
      return action.from + ' → ' + action.to;
    if (action.to && typeof action.to === 'object')
      return `Move → (${Number(action.to.x).toFixed(2)},${Number(action.to.y).toFixed(2)})`;
    if (action.unitId) return `Move ${action.unitId}`;
  }
  if (t === 'castle')    return action.side === 'kingside' ? 'O-O' : 'O-O-O';
  if (t === 'attack')    return `Attack ${action.targetId ?? ''}`;
  if (t === 'end-turn')  return 'End Turn';
  if (t === 'end-phase') return 'End Phase';
  if (t === 'pass')      return 'Pass';
  if (t === 'ability') {
    const name = action.abilityName ?? action.ability ?? 'Ability';
    if (action.targetId != null) {
      const target = props.units.find(u => u.id === action.targetId);
      return target ? `${name} → ${target.name} (${action.targetId})` : `${name} → ${action.targetId}`;
    }
    return name;
  }
  return t + (action.unitId ? ' ' + action.unitId : '');
}
</script>

<template>
  <div class="log">
    <div class="panel-t log-title">Log</div>
    <div class="log-scroll">
      <div v-if="!log.length" class="log-empty">
        No moves yet.
      </div>
      <div v-for="(entry, ei) in [...log].reverse()" :key="ei"
           class="log-row"
           :class="{ 'log-row--active': ei === historyLength - 1 - histPos }"
           @click="$emit('seek', Math.max(0, Math.min(historyLength - 1, historyLength - 1 - ei)))">
        <span class="mono log-turn">T{{entry.turnNumber}}</span>
        <span v-for="(pa, i) in entry.playerActions" :key="i" class="log-pa">
          <b class="log-player">{{pa.playerId}}</b>
          {{ fmtAction(pa.action) }}
        </span>
        <span v-for="(ev, evi) in (entry.events ?? [])" :key="'e'+evi"
              class="mono log-ev"
              :class="ev.type === 'damage' ? 'log-ev--damage' : ev.type === 'heal' ? 'log-ev--heal' : 'log-ev--other'">
          {{ ev.type === 'damage' ? (ev.died ? '†' : '') + '−' + ev.amount
           : ev.type === 'heal'   ? '+' + ev.amount
           : '†' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log { border-top: 1px solid var(--line); display: flex; flex-direction: column; flex: 1; min-height: 0; }
.log-title { padding: 7px 14px; flex-shrink: 0; }
.log-scroll { overflow-y: auto; flex: 1; }
.log-empty { padding: 4px 14px 8px; font-size: 11px; color: var(--faint); }
.log-row { padding: 3px 14px; border-bottom: 1px solid var(--line); font-size: 11px; cursor: pointer; transition: background .1s; background: transparent; }
.log-row--active { background: rgba(66,198,230,.08); }
.log-turn { font-size: 9px; color: var(--faint); margin-right: 6px; }
.log-pa { display: inline; margin-right: 8px; }
.log-player { color: var(--accent); }
.log-ev { font-size: 10px; margin-right: 5px; }
.log-ev--damage { color: var(--danger); }
.log-ev--heal { color: var(--ok); }
.log-ev--other { color: var(--dim); }
</style>
