<script setup>
import { computed } from 'vue';
import CivStatusStrip from './CivStatusStrip.vue';
const props = defineProps({
  field:           Object,
  liveState:       Object,
  isLive:          Boolean,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  // Whose per-player status to resolve from field.civ below — the human's own
  // side, not necessarily whoever's turn it currently is (see Battlefield's
  // analysisPlayerId). Optional, data-shape-driven: renders nothing for games
  // that don't populate field.civ.
  statusPlayerId:  { type: String, default: null },
  showMenu:        Boolean,
  ui:              Object,
});
defineEmits(['toggle-menu', 'show-help']);
const myCiv = computed(() => props.field?.civ?.[props.statusPlayerId] ?? null);
</script>

<template>
  <div class="gh">
    <div class="gh-top">
      <BsIcon name="crosshair" :size="14" color="var(--accent)"/>
      <span v-if="ui.help" class="gh-game gh-game--link"
            :title="'How to play ' + field.game"
            @click="$emit('show-help')">
        {{field.game}}
        <span class="gh-help">?</span>
      </span>
      <span v-else class="gh-game">{{field.game}}</span>
      <button class="iconbtn gh-menu-btn" title="Menu"
              :class="{ 'gh-menu-btn--on': showMenu }"
              @click="$emit('toggle-menu')">
        <BsIcon name="grid" :size="12" :color="showMenu ? 'var(--accent)' : 'var(--dim)'"/>
      </button>
      <span class="mono gh-turn">Turn {{liveState?.turn ?? 0}}</span>
    </div>
    <div v-if="isLive" class="gh-status">
      <span v-if="isDone" class="gh-chip gh-chip--ok">
        ✓ {{liveState.result?.winner ? 'Winner: ' + liveState.result.winner : 'Game over'}}
      </span>
      <span v-else-if="isPending" class="mono gh-chip gh-chip--ok">
        ● Your turn · {{pendingPlayerId}}
      </span>
      <span v-else class="mono gh-chip gh-chip--warn">
        ○ AI thinking…
      </span>
    </div>
    <div v-if="isLive && liveState?.id" class="mono gh-session" :title="liveState.id">
      {{liveState.id.slice(0, 8)}}
    </div>
    <CivStatusStrip :civ="myCiv"/>
  </div>
</template>

<style scoped>
.gh { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.gh-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.gh-game { font-weight: 700; font-size: 14px; }
.gh-game--link { cursor: pointer; display: flex; align-items: center; gap: 5px; }
.gh-help { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(66,198,230,.12); color: var(--accent); font-weight: 500; letter-spacing: .04em; }
.gh-menu-btn { width: 22px; height: 22px; }
.gh-menu-btn--on { border-color: var(--accent); }
.gh-turn { font-size: 11px; color: var(--faint); margin-left: auto; }
.gh-status { display: flex; }
.gh-session { font-size: 10px; color: var(--faint); margin-top: 6px; }
.gh-chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.gh-chip--ok { background: rgba(70,211,154,.1); color: var(--ok); }
.gh-chip--warn { background: rgba(242,180,65,.1); color: var(--warn); }
</style>
