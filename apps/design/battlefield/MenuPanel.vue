<script setup>
// The game screen's menu, as a panel (see PanelDesk): what the server is, the
// view toggles, the way into the other panels, and how panels are shown.
//
// The perspective switcher lives here as well as in the right sidebar, so that a
// game which hides that sidebar entirely (ui.showRightSidebar) still leaves an
// observer a way to watch through one player's fog.
import ObserverPerspective from './ObserverPerspective.vue';

defineProps({
  serverErr:  { type: String, default: '' },
  gamesCount: { type: Number, default: 0 },
  showRuler:  Boolean,
  showHpBars: { type: Boolean, default: true },
  showSidebar: { type: Boolean, default: true },
  showAiAnalysis: { type: Boolean, default: true },
  canSurrender: Boolean,
  // A game still being played, whose settings (and units) can be changed from here.
  canChangeSettings: Boolean,
  canShowHelp: Boolean,
  // How panels are shown: 'float' over the board, or 'dock'ed in a column beside it.
  panelMode: { type: String, default: 'float' },
  // Observer-only; omitted (empty) for a seated player, which hides the section.
  observerPlayers: { type: Array, default: () => [] },
  teams:           { type: Array, default: () => [] },
  observerView:    { type: String, default: null },
});
defineEmits(['exit', 'open-panel', 'set-panel-mode', 'toggle-ruler', 'toggle-hp-bars',
             'toggle-sidebar', 'toggle-ai-analysis', 'surrender', 'set-observer-view']);
const apiLabel = 'api · ' + window.location.host + window.api.basePath;
</script>

<template>
  <div class="mp">
    <div class="mp-status">
      <div class="statuschip" :class="{ 'mp-chip--err': serverErr }">
        <span class="pulse" :class="{ 'mp-pulse--err': serverErr }"/>
        {{ serverErr ? 'offline' : apiLabel }}
      </div>
      <span class="mono mp-games">{{gamesCount}} games</span>
    </div>
    <ObserverPerspective v-if="observerPlayers.length"
      :players="observerPlayers" :teams="teams" :value="observerView"
      @change="$emit('set-observer-view', $event)"/>
    <div class="mp-actions">
      <button class="btn btn-ghost mp-btn" @click="$emit('exit')">
        <BsIcon name="back" :size="14" color="var(--dim)"/> Back to Lobby
      </button>
      <button class="btn btn-ghost mp-btn" @click="$emit('toggle-ruler')">
        <BsIcon name="move" :size="14" :color="showRuler ? 'var(--accent)' : 'var(--dim)'"/>
        {{showRuler ? 'Hide ruler' : 'Show ruler'}}
      </button>
      <button class="btn btn-ghost mp-btn" @click="$emit('toggle-hp-bars')">
        <BsIcon name="shield" :size="14" :color="showHpBars ? 'var(--accent)' : 'var(--dim)'"/>
        {{showHpBars ? 'Hide health bars' : 'Show health bars'}}
      </button>
      <button class="btn btn-ghost mp-btn" @click="$emit('toggle-sidebar')">
        <BsIcon name="grid" :size="14" :color="showSidebar ? 'var(--accent)' : 'var(--dim)'"/>
        {{showSidebar ? 'Hide side panel' : 'Show side panel'}}
      </button>
      <button class="btn btn-ghost mp-btn" @click="$emit('toggle-ai-analysis')">
        <BsIcon name="eye" :size="14" :color="showAiAnalysis ? 'var(--accent)' : 'var(--dim)'"/>
        {{showAiAnalysis ? 'Hide AI analysis' : 'Show AI analysis'}}
      </button>
      <button v-if="canChangeSettings" class="btn btn-ghost mp-btn" @click="$emit('open-panel', 'game-settings')">
        <BsIcon name="sliders" :size="14" color="var(--accent)"/> Game settings
      </button>
      <button v-if="canChangeSettings" class="btn btn-ghost mp-btn" @click="$emit('open-panel', 'add-units')">
        <BsIcon name="plus" :size="14" color="var(--accent)"/> Add units
      </button>
      <button v-if="canShowHelp" class="btn btn-ghost mp-btn" @click="$emit('open-panel', 'help')">
        <BsIcon name="search" :size="14" color="var(--dim)"/> How to play
      </button>
      <button v-if="canSurrender" class="btn btn-ghost mp-btn mp-btn--danger" @click="$emit('surrender')">
        <BsIcon name="flag" :size="14" color="var(--danger)"/> Surrender
      </button>
    </div>
    <div class="mp-mode">
      <span class="mp-mode-label">Panels</span>
      <div class="seg">
        <button :class="{ on: panelMode === 'float' }" @click="$emit('set-panel-mode', 'float')">Floating</button>
        <button :class="{ on: panelMode === 'dock' }" @click="$emit('set-panel-mode', 'dock')">Docked</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-status { padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 9px; }
.mp-chip--err { border-color: var(--danger); color: var(--danger); }
.mp-pulse--err { background: var(--danger); animation-play-state: paused; }
.mp-games { font-size: 11px; color: var(--faint); }
.mp-actions { padding: 8px; display: flex; flex-direction: column; gap: 2px; }
.mp-btn { justify-content: flex-start; gap: 8px; }
.mp-btn--danger { color: var(--danger); }
.mp-mode { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--line); }
.mp-mode-label { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
</style>
