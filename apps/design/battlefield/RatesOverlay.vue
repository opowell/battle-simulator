<script setup>
import { computed } from 'vue';
// Collapses civ1's set-tax/set-luxury actions (one legal action per 10%-step target
// rate — see Civ1Game.js's getLegalActions) into two sliders instead of a wall of
// buttons. `civ` is the current player's economy snapshot (Civ1Game.toGrid's `civ`
// field); taxActions/luxActions are the raw legal actions, used only to find the
// exact action object to submit for a given target rate.
const props = defineProps({
  show:        Boolean,
  civ:         { type: Object, default: null },
  taxActions:  { type: Array, default: () => [] },
  luxActions:  { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'submit']);

const taxRate = computed(() => props.civ?.taxRate ?? 0);
const luxRate = computed(() => props.civ?.luxRate ?? 0);
const sciRate = computed(() => Math.max(0, 100 - taxRate.value - luxRate.value));
const taxMax  = computed(() => props.civ?.taxMax ?? 100);
// The engine allows one tax change and one luxury change per turn (see
// Civ1Game.js's taxSetTurn/luxSetTurn) — once used, no set-tax/set-luxury actions
// are legal until next turn, so the matching slider goes inert. Surface that
// instead of leaving the drag silently do nothing.
const taxLocked = computed(() => !props.taxActions.length);
const luxLocked = computed(() => !props.luxActions.length);

function setTax(rate) {
  const action = props.taxActions.find(a => a.taxRate === Number(rate));
  if (action) emit('submit', action);
}
function setLux(rate) {
  const action = props.luxActions.find(a => a.luxRate === Number(rate));
  if (action) emit('submit', action);
}
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="rt-scrim" @click.self="$emit('close')">
      <div class="rt-panel">
        <div class="rt-head">
          <span class="rt-title">Tax · Luxury · Science</span>
          <button class="rt-close" @click="$emit('close')">×</button>
        </div>
        <div class="rt-row">
          <div class="rt-label">
            <span>Tax{{taxLocked ? ' (set this turn)' : ''}}</span>
            <span class="mono rt-val">{{taxRate}}%</span>
          </div>
          <input class="rt-slider" type="range" min="0" :max="taxMax" step="10" :disabled="taxLocked"
                 :value="taxRate" @input="setTax($event.target.value)"/>
        </div>
        <div class="rt-row">
          <div class="rt-label">
            <span>Luxury{{luxLocked ? ' (set this turn)' : ''}}</span>
            <span class="mono rt-val">{{luxRate}}%</span>
          </div>
          <input class="rt-slider" type="range" min="0" :max="taxMax" step="10" :disabled="luxLocked"
                 :value="luxRate" @input="setLux($event.target.value)"/>
        </div>
        <div class="rt-row rt-row--readonly">
          <div class="rt-label">
            <span>Science</span>
            <span class="mono rt-val">{{sciRate}}%</span>
          </div>
          <div class="rt-track"><div class="rt-fill" :style="{ width: sciRate + '%' }"/></div>
        </div>
        <div class="mono rt-hint">Tax + Luxury ≤ {{taxMax}}% under {{civ?.government ?? 'this government'}} · Science takes the rest</div>
        <button class="btn btn-ghost rt-done" @click="$emit('close')">Done</button>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.rt-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.rt-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 300px; max-width: 92vw; padding: 16px 18px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.rt-head { display: flex; align-items: center; margin-bottom: 14px; }
.rt-title { font-weight: 700; font-size: 13px; flex: 1; }
.rt-close { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 15px; cursor: pointer; line-height: 1; }
.rt-row { margin-bottom: 14px; }
.rt-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--dim); margin-bottom: 5px; }
.rt-val { color: var(--txt); }
.rt-slider { width: 100%; accent-color: var(--accent); }
.rt-slider:disabled { opacity: .4; cursor: not-allowed; }
.rt-row--readonly .rt-label { color: var(--faint); }
.rt-track { height: 5px; border-radius: 3px; background: var(--bg3); overflow: hidden; }
.rt-fill { height: 100%; background: var(--accent); opacity: .6; }
.rt-hint { font-size: 10px; color: var(--faint); margin-bottom: 12px; }
.rt-done { width: 100%; justify-content: center; }
</style>
