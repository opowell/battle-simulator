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
      return `Move → (${action.to.x},${action.to.y})`;
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
  <div style="border-top:1px solid var(--line);display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="panel-t" style="padding:7px 14px;flex-shrink:0">Log</div>
    <div style="overflow-y:auto;flex:1">
      <div v-if="!log.length" style="padding:4px 14px 8px;font-size:11px;color:var(--faint)">
        No moves yet.
      </div>
      <div v-for="(entry, ei) in [...log].reverse()" :key="ei"
           style="padding:3px 14px;border-bottom:1px solid var(--line);font-size:11px;cursor:pointer;transition:background .1s"
           :style="{background: ei === historyLength - 1 - histPos ? 'rgba(66,198,230,.08)' : 'transparent'}"
           @click="$emit('seek', Math.max(0, Math.min(historyLength - 1, historyLength - 1 - ei)))">
        <span class="mono" style="font-size:9px;color:var(--faint);margin-right:6px">T{{entry.turnNumber}}</span>
        <span v-for="(pa, i) in entry.playerActions" :key="i" style="display:inline;margin-right:8px">
          <b :style="{color:'var(--accent)'}">{{pa.playerId}}</b>
          {{ fmtAction(pa.action) }}
        </span>
        <span v-for="(ev, evi) in (entry.events ?? [])" :key="'e'+evi"
              class="mono"
              :style="{
                fontSize: '10px',
                marginRight: '5px',
                color: ev.type === 'damage' ? 'var(--danger)' : ev.type === 'heal' ? 'var(--ok)' : 'var(--dim)',
              }">
          {{ ev.type === 'damage' ? (ev.died ? '†' : '') + '−' + ev.amount
           : ev.type === 'heal'   ? '+' + ev.amount
           : '†' }}
        </span>
      </div>
    </div>
  </div>
</template>
