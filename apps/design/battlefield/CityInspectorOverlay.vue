<script setup>
import { computed, ref } from 'vue';
// The civ1 "city screen" — like the original game, clicking a city pops this instead
// of the thin generic unit sidebar (see Battlefield.vue's selectedCity). `city` is one
// entry from Civ1Game.toGrid's `cities` field, already carrying the full per-turn
// breakdown (computeCity(), called read-only there — see the comment by cityDetail).
// `productionActions` is this city's set-production options for the current turn,
// filtered from displayedActions the same way Rates/Science filter their own actions.
const props = defineProps({
  show:             Boolean,
  city:             { type: Object, default: null },
  productionActions: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'submit']);
const imgSrc = window.api.imgSrc;
const ICON = '/images/civ1/city';

const showProdPicker = ref(false);
function pick(item) {
  const action = props.productionActions.find(a => a.item === item);
  if (action) emit('submit', action);
  showProdPicker.value = false;
}
const prodLocked = computed(() => !props.productionActions.length);

// The 21-square "fat cross" (see Civ1Game.toGrid's `radius` field, itself mirroring
// city.js's FAT_CROSS) minus the 4 excluded corners — a plain 5x5 CSS grid with those
// corner cells simply never populated reproduces the cross shape without needing a
// non-rectangular layout.
const radiusTiles = computed(() =>
  (props.city?.radius ?? []).filter(t => !(Math.abs(t.dx) === 2 && Math.abs(t.dy) === 2)));

function tileTitle(t) {
  if (t.offBoard) return '';
  if (t.center) return `${props.city.name} (city centre)`;
  if (t.claimedByOther) return `${t.terrain} — worked by another city`;
  return `${t.terrain} — food ${t.yield.food} · shields ${t.yield.shields} · trade ${t.yield.trade}`;
}

// The original city screen marks a worked tile with the resource icons it's
// actually yielding (food/shields/trade), not a citizen — citizens are their own
// row (the Citizens section above, by mood). One icon per point, same as the
// original — a food-2/shield-1 tile shows two food icons and one shield icon.
const RES_ICON = { food: 'food', shields: 'production', trade: 'trade' };
function tileResources(t) {
  if (!t.yield) return [];
  const out = [];
  for (const [k, icon] of Object.entries(RES_ICON)) {
    for (let i = 0; i < t.yield[k]; i++) out.push(icon);
  }
  return out;
}

// Capacity bars (food box, production box) as a strip of the resource's own icon —
// one lit per point filled, one dim per point still empty — the same convention the
// original city screen uses instead of a plain progress bar.
function capacityIcons(filled, total) {
  const f = Math.max(0, Math.min(filled, total));
  return [
    ...Array(f).fill(true),
    ...Array(Math.max(0, total - f)).fill(false),
  ];
}
</script>

<template>
  <teleport to="body">
    <div v-if="show && city" class="ci-scrim" @click.self="$emit('close')">
      <div class="ci-panel">
        <div class="ci-head">
          <span class="ci-title">{{city.name}}</span>
          <span class="mono ci-size">size {{city.size}}</span>
          <button class="ci-close" @click="$emit('close')">×</button>
        </div>

        <div v-if="city.disorder" class="ci-disorder">⚠ Civil disorder — no output this turn</div>

        <div v-if="radiusTiles.length" class="ci-section">
          <div class="ci-section-title">City Radius</div>
          <div class="ci-radius">
            <div v-for="t in radiusTiles" :key="t.dx + ',' + t.dy"
                 class="ci-rtile"
                 :class="{ 'ci-rtile--worked': t.worked, 'ci-rtile--claimed': t.claimedByOther, 'ci-rtile--off': t.offBoard, 'ci-rtile--center': t.center }"
                 :style="{ gridColumn: String(t.dx + 3), gridRow: String(t.dy + 3),
                           background: t.terrain === 'ocean' ? '#5046a0' : undefined }"
                 :title="tileTitle(t)">
              <img v-if="t.sprite" :src="imgSrc(t.sprite)" class="ci-rtile-img" draggable="false"/>
              <span v-if="t.center" class="ci-rtile-mark">★</span>
              <div v-else-if="t.worked" class="ci-rtile-res">
                <img v-for="(icon, ri) in tileResources(t)" :key="ri"
                     :src="imgSrc(`${ICON}/${icon}`)" class="ci-rtile-res-icon" draggable="false"/>
              </div>
            </div>
          </div>
          <div class="mono ci-radius-legend">★ city · icons = resources worked · dim = claimed by another city</div>
        </div>

        <div class="ci-section">
          <div class="ci-section-title">Citizens</div>
          <div class="ci-citizens">
            <span v-if="city.happy" class="ci-cit ci-cit--happy">
              <img :src="imgSrc(`${ICON}/people_happy_m`)" class="ci-cit-icon"/>×{{city.happy}}
            </span>
            <span v-if="city.content" class="ci-cit">
              <img :src="imgSrc(`${ICON}/people_content_m`)" class="ci-cit-icon"/>×{{city.content}}
            </span>
            <span v-if="city.unhappy" class="ci-cit ci-cit--unhappy">
              <img :src="imgSrc(`${ICON}/people_unhappy_m`)" class="ci-cit-icon"/>×{{city.unhappy}}
            </span>
          </div>
        </div>

        <div class="ci-section">
          <div class="ci-label">
            <span class="ci-label-k">Food</span>
            <span class="mono ci-val">
              {{city.food}}/{{city.foodBox}}
              <template v-if="city.foodSurplus > 0"> · grows in {{city.growthTurns}}</template>
              <template v-else-if="city.foodSurplus < 0"> · starving</template>
            </span>
          </div>
          <div class="ci-capacity">
            <img v-for="(lit, fi) in capacityIcons(city.food, city.foodBox)" :key="fi"
                 :src="imgSrc(`${ICON}/food`)" class="ci-icon" :class="{ 'ci-icon--dim': !lit }"/>
          </div>
        </div>

        <div class="ci-section">
          <div class="ci-label">
            <span class="ci-label-k">Building {{city.productionName}}</span>
            <span class="mono ci-val">
              {{city.shields}}/{{city.buildCost}}▪
              <template v-if="city.buildTurnsLeft != null"> · {{city.buildTurnsLeft}}t</template>
            </span>
          </div>
          <div class="ci-capacity">
            <img v-for="(lit, si) in capacityIcons(city.shields, city.buildCost)" :key="si"
                 :src="imgSrc(`${ICON}/production`)" class="ci-icon" :class="{ 'ci-icon--dim': !lit }"/>
          </div>
          <button class="btn btn-ghost ci-change" :disabled="prodLocked" @click="showProdPicker = !showProdPicker">
            {{prodLocked ? 'Production set this turn' : 'Change production…'}}
          </button>
          <div v-if="showProdPicker && !prodLocked" class="ci-picker">
            <button v-for="a in productionActions" :key="a.item" class="action-btn ci-picker-btn" @click="pick(a.item)">
              {{a.item}}
            </button>
          </div>
        </div>

        <div class="ci-section">
          <div class="ci-section-title">Trade ({{city.trade}})</div>
          <div class="ci-trade">
            <div class="ci-trade-row">
              <img v-for="i in city.gold" :key="'g'+i" :src="imgSrc(`${ICON}/gold`)" class="ci-icon"/>
            </div>
            <div class="ci-trade-row">
              <img v-for="i in city.luxury" :key="'l'+i" :src="imgSrc(`${ICON}/luxury`)" class="ci-icon"/>
            </div>
            <div class="ci-trade-row">
              <img v-for="i in city.science" :key="'s'+i" :src="imgSrc(`${ICON}/bulb`)" class="ci-icon"/>
            </div>
          </div>
        </div>

        <div v-if="city.buildings.length" class="ci-section">
          <div class="ci-section-title">Buildings</div>
          <div class="ci-chips">
            <span v-for="b in city.buildings" :key="b" class="ci-chip">{{b}}</span>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ci-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.ci-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 340px; max-width: 92vw; max-height: 85vh; overflow-y: auto; padding: 16px 18px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.ci-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.ci-title { font-weight: 700; font-size: 14px; }
.ci-size { font-size: 10px; color: var(--faint); flex: 1; }
.ci-close { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 15px; cursor: pointer; line-height: 1; }
.ci-disorder { font-size: 11px; color: #ff5f56; background: rgba(255,95,86,.1); border: 1px solid rgba(255,95,86,.25); border-radius: var(--r); padding: 6px 9px; margin-bottom: 12px; }
.ci-section { margin-bottom: 14px; }
.ci-section-title { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
.ci-radius { display: grid; grid-template-columns: repeat(5, 28px); grid-template-rows: repeat(5, 28px); gap: 1px; justify-content: center; background: var(--bg3); padding: 1px; border-radius: 4px; }
.ci-rtile { position: relative; background: var(--bg2); display: grid; place-items: center; overflow: hidden; }
.ci-rtile--off { visibility: hidden; }
.ci-rtile-img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
.ci-rtile--claimed .ci-rtile-img { opacity: .35; }
.ci-rtile-mark { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.9); pointer-events: none; }
.ci-rtile-res { position: absolute; inset: 0; display: flex; flex-wrap: wrap; align-content: center; align-items: center; justify-content: center; gap: 1px; background: rgba(0,0,0,.4); pointer-events: none; }
.ci-rtile-res-icon { width: 8px; height: 8px; object-fit: contain; image-rendering: pixelated; flex: none; }
.ci-radius-legend { font-size: 9px; color: var(--faint); margin-top: 5px; }
.ci-citizens { display: flex; flex-wrap: wrap; gap: 8px; }
.ci-cit { display: flex; align-items: center; gap: 3px; font-size: 11px; font-family: var(--mono); color: var(--dim); }
.ci-cit--happy { color: var(--ok); }
.ci-cit--unhappy { color: #ff5f56; }
.ci-cit-icon { width: 16px; height: 16px; object-fit: contain; image-rendering: pixelated; }
.ci-label { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--dim); margin-bottom: 5px; }
.ci-label-k { display: flex; align-items: center; gap: 5px; color: var(--txt); }
.ci-icon { width: 14px; height: 14px; object-fit: contain; image-rendering: pixelated; }
.ci-icon--dim { opacity: .2; }
.ci-val { color: var(--dim); }
.ci-capacity { display: flex; flex-wrap: wrap; gap: 2px; background: var(--bg3); border-radius: 3px; padding: 3px; }
.ci-change { width: 100%; justify-content: center; margin-top: 6px; font-size: 10px; }
.ci-picker { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; max-height: 160px; overflow-y: auto; }
.ci-picker-btn { font-size: 10px; font-family: var(--mono); }
.ci-trade { display: flex; flex-direction: column; gap: 3px; }
.ci-trade-row { display: flex; flex-wrap: wrap; gap: 2px; min-height: 12px; background: var(--bg3); border-radius: 3px; padding: 2px 3px; }
.ci-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ci-chip { font-size: 9px; padding: 2px 6px; border-radius: 3px; background: var(--bg3); color: var(--dim); }
</style>
