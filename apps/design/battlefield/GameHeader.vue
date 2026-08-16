<script setup>
import { computed } from 'vue';
import StatusChips from './StatusChips.vue';
const props = defineProps({
  field:           Object,
  liveState:       Object,
  isLive:          Boolean,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  // Whose entry to resolve from field.statusChips below — the human's own side,
  // not necessarily whoever's turn it currently is (see Battlefield's
  // analysisPlayerId). Optional, data-shape-driven: renders nothing for games
  // that don't populate field.statusChips.
  statusPlayerId:  { type: String, default: null },
  showMenu:        Boolean,
  ui:              Object,
  // Observer lock-step: the turn on screen has finished playing and the game is
  // parked until Next is clicked. Nothing is computing, so say so rather than
  // leaving the "AI thinking…" chip up — that reads as a hung game.
  awaitingStep:    { type: Boolean, default: false },
});
defineEmits(['toggle-menu', 'show-help']);
const myChips = computed(() => props.field?.statusChips?.[props.statusPlayerId] ?? []);

// A game with more than one phase per turn declares them (ui.phases); everything else
// either has no phase at all or one that never changes, and shows nothing.
const phaseLabel = computed(() => {
  const phase = props.liveState?.phase;
  if (!phase || !(props.ui?.phases?.length > 1)) return null;
  const i = props.ui.phases.indexOf(phase);
  const step = i >= 0 ? `${i + 1}/${props.ui.phases.length} · ` : '';
  return `${step}${phase.replace(/-/g, ' ').toUpperCase()}`;
});
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
    <!-- The phase, for games that have several per turn (risk reinforces, attacks and
         fortifies inside one turn): which one you are in decides what a click does, so
         it belongs next to whose turn it is, not buried as a subtitle over the action
         list. Games with a single phase per turn have nothing to say here. -->
    <div v-if="isLive && !isDone && phaseLabel" class="gh-phase">
      <span class="mono gh-chip gh-chip--phase">{{phaseLabel}}</span>
    </div>
    <div v-if="isLive" class="gh-status">
      <span v-if="isDone" class="gh-chip gh-chip--ok">
        ✓ {{liveState.result?.winner ? 'Winner: ' + liveState.result.winner : 'Game over'}}
      </span>
      <span v-else-if="isPending" class="mono gh-chip gh-chip--ok">
        ● Your turn · {{pendingPlayerId}}
      </span>
      <span v-else-if="awaitingStep" class="mono gh-chip">
        ‖ Paused · Next plays turn {{liveState?.turn ?? 0}}
      </span>
      <span v-else class="mono gh-chip gh-chip--warn">
        ○ AI thinking…
      </span>
    </div>
    <div v-if="isLive && liveState?.id" class="mono gh-session" :title="liveState.id">
      {{liveState.id.slice(0, 8)}}
    </div>
    <StatusChips :chips="myChips"/>
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
.gh-phase { display: flex; margin-bottom: 6px; }
.gh-chip--phase { background: rgba(66,198,230,.12); color: var(--accent); font-weight: 700; letter-spacing: .08em; }
.gh-session { font-size: 10px; color: var(--faint); margin-top: 6px; }
.gh-chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.gh-chip--ok { background: rgba(70,211,154,.1); color: var(--ok); }
.gh-chip--warn { background: rgba(242,180,65,.1); color: var(--warn); }
</style>
