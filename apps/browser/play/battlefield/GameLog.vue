<script setup>
import { gameActionLabel } from '../actionLabels.js';

const props = defineProps({
  log:           { type: Array, default: () => [] },
  historyLength: { type: Number, default: 0 },
  histPos:       { type: Number, default: 0 },
  units:         { type: Array, default: () => [] },
  // Moves played before the game was rebuilt under new settings mid-play: history
  // to read, below the moves since, but not a position the scrub bar can reach.
  earlierLog:    { type: Array, default: () => [] },
  // The game's ui flags, for its own words for its own action types (ui.actionLabels).
  ui:            { type: Object, default: null },
  // The board's names for its columns and rows (a–h, 8–1), when it has them: a move
  // between cells is then written square to square.
  xLabels:       { type: Array, default: null },
  yLabels:       { type: Array, default: null },
});

// A cell by the board's own names for it, or null where it has none.
function squareName(p) {
  if (!props.xLabels || !props.yLabels || !p || typeof p !== 'object') return null;
  const x = props.xLabels[p.x], y = props.yLabels[p.y];
  return Number.isInteger(p.x) && Number.isInteger(p.y) && x != null && y != null ? `${x}${y}` : null;
}
defineEmits(['seek']);

function fmtAction(action) {
  const t = action.type ?? '';
  // A game that knows how to say what one of its actions does says it, the same
  // way it does for the buttons in ActionsPanel — nothing generic here can name a
  // knight's chosen route or a piece being called off mid-journey.
  if (action.label) return action.label;
  const own = gameActionLabel(action, props.ui);
  if (own) return own;
  if (t === 'move') {
    if (typeof action.from === 'string' && typeof action.to === 'string')
      return action.from + ' → ' + action.to;
    const from = squareName(action.from), to = squareName(action.to);
    if (from && to) return `${from} ${action.capture ? '×' : '→'} ${to}`;
    if (action.to && typeof action.to === 'object')
      return `Move → (${Number(action.to.x).toFixed(2)},${Number(action.to.y).toFixed(2)})`;
    if (action.unitId) return `Move ${action.unitId}`;
  }
  if (t === 'attack') {
    // Territory-vs-territory attacks (kdice) carry from/to ids plus, once
    // resolved, a dice-roll `result` stamped onto the action (see
    // KDiceGame.applyActions) — show the rolls and outcome, not just the label.
    if (typeof action.from === 'string' && typeof action.to === 'string') {
      let s = `${action.from} → ${action.to}`;
      if (action.result) {
        const r = action.result;
        s += `  [${r.attackerRolls.join(',')}]=${r.attackerSum} vs [${r.defenderRolls.join(',')}]=${r.defenderSum} · ${r.won ? 'WON' : 'LOST'}`;
      }
      return s;
    }
    return `Attack ${action.targetId ?? ''}`;
  }
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
        {{ earlierLog.length ? 'No moves since the settings changed.' : 'No moves yet.' }}
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
      <template v-if="earlierLog.length">
        <div class="log-divider">Before the settings changed</div>
        <div v-for="(entry, ei) in [...earlierLog].reverse()" :key="'earlier' + ei" class="log-row log-row--earlier">
          <span class="mono log-turn">T{{entry.turnNumber}}</span>
          <span v-for="(pa, i) in entry.playerActions" :key="i" class="log-pa">
            <b class="log-player">{{pa.playerId}}</b>
            {{ fmtAction(pa.action) }}
          </span>
        </div>
      </template>
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
.log-divider { padding: 6px 14px 4px; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); border-bottom: 1px solid var(--line); }
.log-row--earlier { cursor: default; opacity: .6; }
</style>
