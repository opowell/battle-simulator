<script setup>
// The game screen's panels — Menu, Game settings, How to play, Add units — and
// the desk they are shown on (PanelDesk: floating over the board by default, or
// docked beside it, as the menu's "Panels" switch says).
//
// Orders and Minimap are panels too, but pinned to the docked column whatever that
// switch says, and their bodies are the host's (slots of the same names): they are
// the board's own controls, wired to its state, and only shown here.
//
// Which are open is the host's (`v-model:open`, ids in the order opened), so the
// board can ask for one from a key or a button; how they are shown is kept here,
// per browser.
import { ref, computed, watch, nextTick } from 'vue';
import PanelDesk from './PanelDesk.vue';
import MenuPanel from './MenuPanel.vue';
import GameSettingsPanel from './GameSettingsPanel.vue';
import HelpPanel from './HelpPanel.vue';
import AddUnitsPanel from './AddUnitsPanel.vue';

const props = defineProps({
  open:      { type: Array, default: () => [] },
  // Everything the menu shows and toggles (see MenuPanel).
  menu:      { type: Object, default: () => ({}) },
  liveState: { type: Object, default: null },
  gameDef:   { type: Object, default: null },
  ui:        { type: Object, default: () => ({}) },
  game:      { type: String, default: '' },
  teams:     { type: Array, default: () => [] },
  // Which of the host's own panels this game has at all ('orders', 'minimap').
  hostPanels: { type: Array, default: () => [] },
  // What the orders panel is called (an observer has none to give: 'Overview').
  ordersTitle: { type: String, default: 'Orders' },
  // ...and the phase of the turn it is giving them in, if the game has phases.
  ordersSubtitle: { type: String, default: '' },
});
const emit = defineEmits(['update:open', 'menu', 'arm']);

const MODE_KEY = 'bs_panel_mode';
const mode = ref((() => { try { return localStorage.getItem(MODE_KEY) ?? 'float'; } catch { return 'float'; } })());
watch(mode, (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } });

const DEFS = computed(() => ({
  'menu':          { title: 'Menu', w: 300, h: 550 },
  'game-settings': { title: 'Game settings', w: 620, h: 640 },
  'help':          { title: props.ui?.help?.title ?? props.game, subtitle: 'How to play', w: 460, h: 520 },
  'add-units':     { title: 'Add units', w: 300, h: 440 },
  ...(props.hostPanels.includes('orders')  ? { 'orders':  { title: props.ordersTitle, subtitle: props.ordersSubtitle || undefined, h: 460, dock: true } } : {}),
  ...(props.hostPanels.includes('minimap') ? { 'minimap': { title: 'Minimap', h: 220, dock: true } } : {}),
}));
const panels = computed(() => props.open.filter(id => DEFS.value[id]).map(id => ({ id, ...DEFS.value[id] })));

const desk = ref(null);
const addUnits = ref(null);

function show(id) {
  if (props.open.includes(id)) desk.value?.focus(id);
  else emit('update:open', [...props.open, id]);
}
function close(id) { emit('update:open', props.open.filter(x => x !== id)); }

// A menu entry that leaves the game takes the menu with it; the rest leave it up.
function onMenu(name, arg) {
  if (name === 'open-panel') return show(arg);
  if (name === 'set-panel-mode') { mode.value = arg; nextTick(() => desk.value?.focus('menu')); return; }
  emit('menu', name, arg);
}

defineExpose({
  show,
  /** A board square clicked; true when the Add units panel took it. */
  place: (col, row) => addUnits.value?.place(col, row) ?? false,
  /** Puts down the unit the Add units panel has in hand. */
  disarm: () => addUnits.value?.disarm(),
});
</script>

<template>
  <PanelDesk ref="desk" :panels="panels" v-model:mode="mode" @close="close">
    <template #menu>
      <MenuPanel v-bind="menu" :panel-mode="mode"
        @exit="onMenu('exit')" @open-panel="onMenu('open-panel', $event)"
        @set-panel-mode="onMenu('set-panel-mode', $event)"
        @toggle-ruler="onMenu('toggle-ruler')" @toggle-hp-bars="onMenu('toggle-hp-bars')"
        @toggle-sidebar="onMenu('toggle-sidebar')" @toggle-ai-analysis="onMenu('toggle-ai-analysis')"
        @surrender="onMenu('surrender')" @set-observer-view="onMenu('set-observer-view', $event)"/>
    </template>
    <template #game-settings>
      <GameSettingsPanel :live-state="liveState" :game-def="gameDef" @close="close('game-settings')"/>
    </template>
    <template #help>
      <HelpPanel :ui="ui"/>
    </template>
    <template #add-units>
      <AddUnitsPanel ref="addUnits" :live-state="liveState" :teams="teams" :recolor="!!ui?.recolorTeamSprites" @arm="emit('arm', $event)"/>
    </template>
    <template #orders><slot name="orders"/></template>
    <template #minimap><slot name="minimap"/></template>
  </PanelDesk>
</template>
