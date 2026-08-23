<script setup>
import { computed } from 'vue';
// Collapses civ1's set-research actions (one button per researchable tech — see
// Civ1Game.js's getLegalActions) into one overlay, alongside what's already
// researched and progress on the current target (civ.bulbs/researchCost — see
// Civ1Game.toGrid's `civ` field, which pre-resolves tech ids to names since the
// client has no access to tech.js).
const props = defineProps({
  show:             Boolean,
  // civ carries researchName/researchedNames/bulbs/researchCost, plus futureTechs —
  // the count of Future Tech completions, which never joins researchedNames because
  // it is the one advance a civ researches more than once (see economy.js).
  civ:              { type: Object, default: null },
  researchActions:  { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'submit']);

const progressPct = computed(() => {
  const c = props.civ;
  if (!c?.research || !c.researchCost) return 0;
  return Math.min(100, (c.bulbs / c.researchCost) * 100);
});

function pick(tech) {
  const action = props.researchActions.find(a => a.tech === tech);
  if (action) emit('submit', action);
}
</script>

<template>
  <teleport to="body">
    <div v-if="show" class="sc-scrim" @click.self="$emit('close')">
      <div class="sc-panel">
        <div class="sc-head">
          <span class="sc-title">Science</span>
          <button class="sc-close" @click="$emit('close')">×</button>
        </div>
        <div v-if="civ?.researchName" class="sc-section">
          <div class="sc-label">
            <span>Researching {{civ.researchName}}</span>
            <span class="mono sc-val">{{civ.bulbs}}/{{civ.researchCost}}</span>
          </div>
          <div class="sc-track"><div class="sc-fill" :style="{ width: progressPct + '%' }"/></div>
        </div>
        <div v-if="civ?.futureTechs" class="sc-section">
          <div class="sc-label">
            <span>Future Tech</span>
            <span class="mono sc-val">&times;{{civ.futureTechs}}</span>
          </div>
        </div>
        <div v-if="civ?.researchedNames?.length" class="sc-section">
          <div class="sc-section-title">Researched ({{civ.researchedNames.length}})</div>
          <div class="sc-chips">
            <span v-for="t in civ.researchedNames" :key="t" class="sc-chip">{{t}}</span>
          </div>
        </div>
        <div class="sc-section">
          <div class="sc-section-title">Available</div>
          <div class="sc-list">
            <button v-for="a in researchActions" :key="a.tech" class="action-btn sc-btn" @click="pick(a.tech)">
              Research {{a.tech}}
            </button>
            <div v-if="!researchActions.length" class="sc-empty">Nothing left to pick this turn.</div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.sc-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.sc-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 320px; max-width: 92vw; max-height: 80vh; overflow-y: auto; padding: 16px 18px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.sc-head { display: flex; align-items: center; margin-bottom: 14px; }
.sc-title { font-weight: 700; font-size: 13px; flex: 1; }
.sc-close { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 15px; cursor: pointer; line-height: 1; }
.sc-section { margin-bottom: 14px; }
.sc-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--dim); margin-bottom: 5px; }
.sc-val { color: var(--txt); }
.sc-track { height: 5px; border-radius: 3px; background: var(--bg3); overflow: hidden; }
.sc-fill { height: 100%; background: var(--accent); }
.sc-section-title { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
.sc-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.sc-chip { font-size: 9px; padding: 2px 6px; border-radius: 3px; background: var(--bg3); color: var(--dim); }
.sc-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.sc-btn { font-size: 11px; font-family: var(--mono); }
.sc-empty { font-size: 11px; color: var(--faint); }
</style>
