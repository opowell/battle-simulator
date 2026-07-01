<script setup>
const props = defineProps({
  isDone:           Boolean,
  atLatest:         Boolean,
  isPending:        Boolean,
  selectedId:       { type: String, default: null },
  activeUnitId:     { type: String, default: null },
  ui:               Object,
  unitMoves:        { type: Array, default: () => [] },
  displayedActions: { type: Array, default: () => [] },
  pendingPlayerId:  { type: String, default: null },
  liveState:        Object,
  units:            { type: Array, default: () => [] },
});
defineEmits(['submit']);

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
  <div style="padding:12px 14px;border-top:1px solid var(--line)">
    <div class="panel-t" style="margin-bottom:8px">
      Actions
      <span v-if="liveState.phase" class="mono" style="font-weight:400;color:var(--faint)">
        · {{liveState.phase}}
      </span>
    </div>
    <div v-if="isDone" style="font-size:12px;color:var(--ok)">
      {{liveState.result?.winner
        ? 'Winner: ' + liveState.result.winner
        : liveState.result?.draw ? 'Draw'
        : liveState.status === 'error' ? ('Error: ' + liveState.error)
        : 'Game over'}}
    </div>
    <div v-else-if="!atLatest"
         style="font-size:11px;color:var(--accent);background:rgba(66,198,230,.08);border:1px solid rgba(66,198,230,.2);border-radius:var(--r);padding:7px 10px">
      Viewing past state — advance to latest to issue orders.
    </div>
    <template v-else-if="isPending && selectedId && (ui.freeSelection || selectedId === activeUnitId)">
      <div style="font-size:11px;color:var(--dim);margin-bottom:8px">
        Choose action for <b style="color:var(--accent)">{{pendingPlayerId}}</b>:
      </div>
      <div v-if="unitMoves.length" class="mono"
           style="font-size:10px;color:var(--faint);margin-bottom:8px;padding:5px 8px;border:1px solid var(--line);border-radius:4px">
        Tap a highlighted square to move
      </div>
      <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
        <button v-for="(action, i) in displayedActions" :key="i"
                class="action-btn"
                style="font-size:11px;font-family:var(--mono)"
                @click="$emit('submit', action)">
          {{fmtAction(action)}}
        </button>
        <div v-if="!displayedActions.length" style="font-size:11px;color:var(--faint)">No actions.</div>
      </div>
    </template>
    <template v-else-if="isPending">
      <div style="font-size:11px;color:var(--dim)">
        Click the <b style="color:var(--accent)">{{ui.freeSelection ? 'a piece' : 'active unit'}}</b> on the board to see actions.
      </div>
    </template>
    <div v-else style="font-size:12px;color:var(--warn)">Waiting for AI…</div>
  </div>
</template>
