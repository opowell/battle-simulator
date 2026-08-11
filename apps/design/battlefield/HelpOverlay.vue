<script setup>
import { computed } from 'vue';
const props = defineProps({
  show: Boolean,
  ui:   Object,
  game: String,
});
defineEmits(['close']);

// The keyboard reference, built from the very bindings the board executes (ui.keys —
// see keyBindings.js's helpGroups), so a key can't be documented as something other
// than what it does. Games with no bindings just show their prose help as before.
const keyGroups = computed(() => KEYS.helpGroups(props.ui?.keys));
</script>

<template>
  <teleport to="body">
    <div v-if="show && (ui.help || keyGroups.length)" class="help-scrim" @click.self="$emit('close')">
      <div class="help-panel">
        <div class="help-head">
          <BsIcon name="crosshair" :size="15" color="var(--accent)"/>
          <span class="help-title">{{ui.help?.title ?? game}}</span>
          <span class="mono up help-tag">How to Play</span>
          <button class="help-close" @click="$emit('close')">
            ×
          </button>
        </div>
        <div class="help-body">
          <div v-for="(section, i) in ui.help?.sections ?? []" :key="i">
            <div class="help-heading">
              {{section.heading}}
            </div>
            <div class="help-text">{{section.text}}</div>
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
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.help-scrim { position: fixed; inset: 0; z-index: 1003; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.help-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 480px; max-width: 92vw; max-height: 86vh; overflow-y: auto; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.help-head { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg1); z-index: 1; }
.help-title { font-weight: 700; font-size: 15px; letter-spacing: .01em; flex: 1; }
.help-tag { font-size: 9px; padding: 2px 7px; border-radius: 3px; background: rgba(66,198,230,.1); color: var(--accent); }
.help-close { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 16px; cursor: pointer; line-height: 1; }
.help-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
.help-heading { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
.help-text { font-size: 13px; color: var(--txt); line-height: 1.65; }
/* Key column sized to its widest chip ("Shift + ↑ ↓ ← →"), labels in the rest. */
.help-keys { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; align-items: baseline; }
/* justify-self: each chip is only as wide as its own key, not the whole column. */
.help-kbd { justify-self: start; font-size: 11px; color: var(--accent); background: var(--bg2); border: 1px solid var(--line2); border-bottom-width: 2px; border-radius: 4px; padding: 2px 7px; white-space: nowrap; }
.help-key-label { font-size: 12px; color: var(--txt); }
</style>
