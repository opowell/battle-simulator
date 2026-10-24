<script setup>
import { computed } from 'vue';
// A panel (see PanelDesk), titled with the game's name by the host.
const props = defineProps({
  ui:   Object,
  // The board zooms and pans (the `mapZoom` option): list the mouse gestures that move
  // it, which nothing on screen shows (Battlefield's handleWheel, dragPan.js).
  mapZoom: Boolean,
});

// The keyboard reference, built from the very bindings the board executes (ui.keys —
// see keyBindings.js's helpGroups), so a key can't be documented as something other
// than what it does. Games with no bindings just show their prose help as before.
const keyGroups = computed(() => KEYS.helpGroups(props.ui?.keys));

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const mapRows = computed(() => !props.mapZoom ? [] : [
  { keys: 'Wheel', label: 'Zoom in or out about the pointer' },
  { keys: `${MAC ? 'Cmd' : 'Ctrl'} + drag`, label: 'Move the map (or drag with the middle button)' },
  { keys: 'Click', label: 'Centre the map on open ground' },
  ...(props.ui?.boxSelect ? [{ keys: 'Drag', label: 'Select every unit in a box' }] : []),
  { keys: 'Minimap', label: 'Click to jump there, double-click to zoom in' },
]);
</script>

<template>
  <div class="help-body">
    <div v-for="(section, i) in ui.help?.sections ?? []" :key="i">
      <div class="help-heading">
        {{section.heading}}
      </div>
      <div class="help-text">{{section.text}}</div>
    </div>
    <div v-if="mapRows.length">
      <div class="help-heading">Map</div>
      <div class="help-keys">
        <template v-for="(row, j) in mapRows" :key="j">
          <kbd class="mono help-kbd">{{row.keys}}</kbd>
          <span class="help-key-label">{{row.label}}</span>
        </template>
      </div>
    </div>
    <div v-for="(group, i) in keyGroups" :key="'k' + i">
      <div class="help-heading">
        {{group.heading || 'Keyboard'}}
      </div>
      <div class="help-keys">
        <template v-for="(row, j) in group.rows" :key="j">
          <kbd class="mono help-kbd">{{row.keys}}</kbd>
          <span class="help-key-label">{{row.label}}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
.help-heading { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
.help-text { font-size: 13px; color: var(--txt); line-height: 1.65; }
/* Key column sized to its widest chip ("Shift + ↑ ↓ ← →"), labels in the rest. */
.help-keys { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; align-items: baseline; }
/* justify-self: each chip is only as wide as its own key, not the whole column. */
.help-kbd { justify-self: start; font-size: 11px; color: var(--accent); background: var(--bg2); border: 1px solid var(--line2); border-bottom-width: 2px; border-radius: 4px; padding: 2px 7px; white-space: nowrap; }
.help-key-label { font-size: 12px; color: var(--txt); }
</style>
