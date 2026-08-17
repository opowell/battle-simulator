<script setup>
// The perspective switcher lives here as well as in the right sidebar, so that a
// game which hides that sidebar entirely (ui.showRightSidebar) still leaves an
// observer a way to watch through one player's fog. Both copies are never usable
// at once — this menu is modal over the sidebar.
import ObserverPerspective from './ObserverPerspective.vue';

defineProps({
  show:       Boolean,
  serverErr:  { type: String, default: '' },
  gamesCount: { type: Number, default: 0 },
  showRuler:  Boolean,
  showHpBars: { type: Boolean, default: true },
  showSidebar: { type: Boolean, default: true },
  showAiAnalysis: { type: Boolean, default: true },
  canSurrender: Boolean,
  // Observer-only; omitted (empty) for a seated player, which hides the section.
  observerPlayers: { type: Array, default: () => [] },
  teams:           { type: Array, default: () => [] },
  observerView:    { type: String, default: null },
});
defineEmits(['close', 'exit', 'open-settings', 'toggle-ruler', 'toggle-hp-bars',
             'toggle-sidebar', 'toggle-ai-analysis', 'surrender', 'set-observer-view']);
const apiLabel = 'api · ' + window.location.host + window.api.basePath;
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="menu-scrim" @click.self="$emit('close')">
      <div class="menu-panel">
        <div class="menu-head">
          <span class="menu-mark">
            <BsIcon name="crosshair" :size="14"/>
          </span>
          <span class="menu-brand">BATTLE&nbsp;SIMULATOR</span>
          <button class="menu-close" @click="$emit('close')">
            ×
          </button>
        </div>
        <div class="menu-status">
          <div class="statuschip" :class="{ 'menu-chip--err': serverErr }">
            <span class="pulse" :class="{ 'menu-pulse--err': serverErr }"/>
            {{ serverErr ? 'offline' : apiLabel }}
          </div>
          <span class="mono menu-games">{{gamesCount}} games</span>
        </div>
        <ObserverPerspective v-if="observerPlayers.length"
          :players="observerPlayers" :teams="teams" :value="observerView"
          @change="$emit('set-observer-view', $event)"/>
        <div class="menu-actions">
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('close'); $emit('exit')">
            <BsIcon name="back" :size="14" color="var(--dim)"/> Back to Lobby
          </button>
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('toggle-ruler')">
            <BsIcon name="move" :size="14" :color="showRuler ? 'var(--accent)' : 'var(--dim)'"/>
            {{showRuler ? 'Hide ruler' : 'Show ruler'}}
          </button>
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('toggle-hp-bars')">
            <BsIcon name="shield" :size="14" :color="showHpBars ? 'var(--accent)' : 'var(--dim)'"/>
            {{showHpBars ? 'Hide health bars' : 'Show health bars'}}
          </button>
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('toggle-sidebar')">
            <BsIcon name="grid" :size="14" :color="showSidebar ? 'var(--accent)' : 'var(--dim)'"/>
            {{showSidebar ? 'Hide side panel' : 'Show side panel'}}
          </button>
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('toggle-ai-analysis')">
            <BsIcon name="eye" :size="14" :color="showAiAnalysis ? 'var(--accent)' : 'var(--dim)'"/>
            {{showAiAnalysis ? 'Hide AI analysis' : 'Show AI analysis'}}
          </button>
          <button class="btn btn-ghost menu-btn"
                  @click="$emit('close'); $emit('open-settings')">
            <BsIcon name="sliders" :size="14" color="var(--dim)"/> Settings
          </button>
          <button v-if="canSurrender" class="btn btn-ghost menu-btn menu-btn--danger"
                  @click="$emit('surrender')">
            <BsIcon name="flag" :size="14" color="var(--danger)"/> Surrender
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.menu-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.menu-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 340px; max-width: 92vw; overflow: hidden; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.menu-head { padding: 16px 18px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
.menu-mark { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--accent); color: var(--accent); border-radius: 5px; flex: none; }
.menu-brand { font-weight: 700; letter-spacing: .12em; font-size: 13px; flex: 1; }
.menu-close { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 16px; cursor: pointer; line-height: 1; }
.menu-status { padding: 16px 18px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 9px; }
.menu-chip--err { border-color: var(--danger); color: var(--danger); }
.menu-pulse--err { background: var(--danger); animation-play-state: paused; }
.menu-games { font-size: 11px; color: var(--faint); }
.menu-actions { padding: 10px; display: flex; flex-direction: column; gap: 4px; }
.menu-btn { justify-content: flex-start; gap: 8px; }
.menu-btn--danger { color: var(--danger); }
</style>
