<script setup>
defineProps({
  field:           Object,
  liveState:       Object,
  isLive:          Boolean,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  showMenu:        Boolean,
  ui:              Object,
});
defineEmits(['toggle-menu', 'show-help']);
</script>

<template>
  <div style="padding:12px 14px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <BsIcon name="crosshair" :size="14" color="var(--accent)"/>
      <span v-if="ui.help"
            style="font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:5px"
            :title="'How to play ' + field.game"
            @click="$emit('show-help')">
        {{field.game}}
        <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(66,198,230,.12);color:var(--accent);font-weight:500;letter-spacing:.04em">?</span>
      </span>
      <span v-else style="font-weight:700;font-size:14px">{{field.game}}</span>
      <button class="iconbtn" title="Menu" style="width:22px;height:22px"
              :style="{borderColor: showMenu ? 'var(--accent)' : 'var(--line2)'}"
              @click="$emit('toggle-menu')">
        <BsIcon name="grid" :size="12" :color="showMenu ? 'var(--accent)' : 'var(--dim)'"/>
      </button>
      <span class="mono" style="font-size:11px;color:var(--faint);margin-left:auto">Turn {{liveState?.turn ?? 0}}</span>
    </div>
    <div v-if="isLive" style="display:flex">
      <span v-if="isDone"
            style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(70,211,154,.1);color:var(--ok)">
        ✓ {{liveState.result?.winner ? 'Winner: ' + liveState.result.winner : 'Game over'}}
      </span>
      <span v-else-if="isPending"
            class="mono" style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(70,211,154,.1);color:var(--ok)">
        ● Your turn · {{pendingPlayerId}}
      </span>
      <span v-else
            class="mono" style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(242,180,65,.1);color:var(--warn)">
        ○ AI thinking…
      </span>
    </div>
  </div>
</template>
