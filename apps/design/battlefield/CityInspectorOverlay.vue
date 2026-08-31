<script setup>
// The civ1 "city screen" — like the original game, clicking a city pops this instead
// of the thin generic unit sidebar (see Battlefield.vue's selectedCity). `city` is one
// entry from Civ1Game.toGrid's `cities` field, already carrying the full per-turn
// breakdown (computeCity(), called read-only there — see the comment by cityDetail),
// the garrison, and the display form of every item this city may build (buildOptions).
// `productionActions` is this city's set-production options for the current turn,
// filtered from displayedActions the same way Rates/Science filter their own actions.
//
// The layout follows the original's: a title bar carrying the name and population and
// the citizens, the resource boxes down the left, the city map as the centrepiece, and
// the buildings and the production box down the right. The pieces are their own small
// components (see ./city/) — this file is only the arrangement.
import { ref, watch, onMounted, onUnmounted } from 'vue';
import CityRadiusMap from './city/CityRadiusMap.vue';
import CityProductionBox from './city/CityProductionBox.vue';
import CityIconStrip from './city/CityIconStrip.vue';

const props = defineProps({
  show:             Boolean,
  city:             { type: Object, default: null },
  productionActions: { type: Array, default: () => [] },
  team:             { type: Object, default: null },   // the city owner's team (colour)
  recolor:          Boolean,                           // field.ui.recolorTeamSprites
});
const emit = defineEmits(['close', 'submit', 'select-unit']);
const imgSrc = window.api.imgSrc;
const teamSpriteHref = window.teamSpriteHref;

const showProdPicker = ref(false);
function pick(action) {
  emit('submit', action);
  showProdPicker.value = false;
}

// ── keyboard ──────────────────────────────────────────────────
// A screen this deep in the game has to be usable without a mouse (the original's own
// city display had its own keys — C to change production, a number to choose). Its keys
// are handled here rather than in Battlefield.vue's binding table because they only
// exist while this screen is up, and they must beat the board's own keys: hence the
// capture-phase listener plus stopPropagation, the same trick image-slot.js uses for
// its modal. Escape is only taken while the picker is open — closing the screen itself
// stays Battlefield's Escape, so one press always steps out of exactly one thing.
function onKeyDown(e) {
  if (!props.show || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const consume = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape' && showProdPicker.value) { showProdPicker.value = false; consume(); return; }
  if (e.key.toLowerCase() === 'c' && props.productionActions.length) {
    showProdPicker.value = !showProdPicker.value;
    consume();
    return;
  }
  // The picker's options are numbered on screen while it is open, so the number keys
  // pick one directly — no highlight to walk through first.
  if (showProdPicker.value && /^[1-9]$/.test(e.key)) {
    const action = props.productionActions[Number(e.key) - 1];
    if (action) pick(action);
    consume();
  }
}

// Never leave the picker open behind a closed screen, or across a switch to another
// city (Battlefield's next-city key steps straight from one to the next).
watch(() => [props.show, props.city?.id], () => { showProdPicker.value = false; });

onMounted(() => window.addEventListener('keydown', onKeyDown, true));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown, true));
</script>

<template>
  <teleport to="body">
    <div v-if="show && city" class="ci-scrim" @click.self="$emit('close')">
      <div class="ci-panel">
        <div class="ci-head">
          <div class="ci-title">
            {{city.name}}
            <span class="mono ci-pop" v-if="city.population">(pop {{city.population.toLocaleString()}})</span>
            <span class="mono ci-pop" v-else>size {{city.size}}</span>
          </div>
          <div class="ci-people">
            <img v-for="(face, i) in (city.citizens ?? [])" :key="i" :src="imgSrc(face)"
                 class="ci-face" draggable="false"/>
          </div>
          <button class="ci-close" @click="$emit('close')">×</button>
        </div>

        <div v-if="city.disorder" class="ci-disorder">⚠ Civil disorder — this city produces nothing</div>

        <div class="ci-body">
          <div class="ci-col">
            <section class="ci-box">
              <h4 class="ci-box-t">City Resources</h4>
              <div class="ci-res">
                <span class="ci-res-k">Food</span>
                <CityIconStrip :icon="city.icons?.food" :filled="Math.abs(city.foodSurplus ?? 0)"/>
                <span class="mono ci-res-v" :class="{ 'ci-res-v--bad': city.foodSurplus < 0 }">
                  {{city.foodSurplus > 0 ? '+' : ''}}{{city.foodSurplus ?? 0}}
                </span>
              </div>
              <div class="ci-res">
                <span class="ci-res-k">Shields</span>
                <CityIconStrip :icon="city.icons?.shields" :filled="city.shieldsPerTurn ?? 0"/>
                <span class="mono ci-res-v">{{city.shieldsPerTurn ?? 0}}</span>
              </div>
              <div class="ci-res">
                <span class="ci-res-k">Trade</span>
                <CityIconStrip :icon="city.icons?.trade" :filled="city.trade ?? 0"/>
                <span class="mono ci-res-v">{{city.trade ?? 0}}</span>
              </div>
              <div class="ci-res">
                <span class="ci-res-k">Taxes</span>
                <CityIconStrip :icon="city.icons?.gold" :filled="city.gold ?? 0"/>
                <span class="mono ci-res-v">{{city.gold ?? 0}}</span>
              </div>
              <div class="ci-res">
                <span class="ci-res-k">Luxuries</span>
                <CityIconStrip :icon="city.icons?.luxury" :filled="city.luxury ?? 0"/>
                <span class="mono ci-res-v">{{city.luxury ?? 0}}</span>
              </div>
              <div class="ci-res">
                <span class="ci-res-k">Science</span>
                <CityIconStrip :icon="city.icons?.science" :filled="city.science ?? 0"/>
                <span class="mono ci-res-v">{{city.science ?? 0}}</span>
              </div>
            </section>

            <section class="ci-box">
              <h4 class="ci-box-t">
                Food Storage
                <span class="mono ci-box-v">
                  {{city.food}}/{{city.foodBox}}
                  <template v-if="city.growthTurns"> · grows in {{city.growthTurns}}</template>
                  <template v-else-if="city.foodSurplus < 0"> · starving</template>
                </span>
              </h4>
              <CityIconStrip :icon="city.icons?.food" :filled="city.food" :total="city.foodBox" :size="16"/>
            </section>

            <section class="ci-box">
              <h4 class="ci-box-t">Units in City</h4>
              <!-- This box is the only place a unit standing on the city's square can be
                   picked up: the city's own token wins that square on the map, so a click
                   there lands on the city and opens this screen. Picking one here selects
                   it and closes the screen — the orders it was picked up for are given on
                   the board (see Battlefield.vue's garrisonPick). -->
              <div v-if="city.garrison?.length" class="ci-garrison">
                <button v-for="u in city.garrison" :key="u.id" class="ci-unit"
                        :class="{ 'ci-unit--orders': u.needsOrders }"
                        :title="`${u.type} — click to select`"
                        @click="emit('select-unit', u.id)">
                  <img :src="teamSpriteHref(u.image, team?.raw, recolor)"
                       class="ci-unit-img" draggable="false"/>
                </button>
              </div>
              <div v-else class="ci-none">undefended</div>
            </section>
          </div>

          <div class="ci-col ci-col--map">
            <CityRadiusMap v-if="city.radius" :city="city" :team="team"/>
          </div>

          <div class="ci-col">
            <section class="ci-box">
              <h4 class="ci-box-t">Buildings</h4>
              <div v-if="city.buildings.length" class="ci-chips">
                <span v-for="b in city.buildings" :key="b" class="ci-chip">{{b}}</span>
              </div>
              <div v-else class="ci-none">none</div>
            </section>

            <section class="ci-box">
              <h4 class="ci-box-t">Producing</h4>
              <CityProductionBox :city="city" :productionActions="productionActions"
                                 :team="team" :recolor="recolor"
                                 :open="showProdPicker" @update:open="showProdPicker = $event"
                                 @pick="pick"/>
            </section>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ci-scrim { position: fixed; inset: 0; z-index: 1002; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.ci-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 1120px; max-width: 96vw; max-height: 92vh; overflow-y: auto; padding: 16px 20px 20px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }

.ci-head { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
.ci-title { font-weight: 700; font-size: 22px; letter-spacing: .5px; flex: none; }
.ci-pop { font-size: 12px; color: var(--faint); font-weight: 400; margin-left: 6px; }
.ci-people { display: flex; flex-wrap: wrap; gap: 1px; flex: 1; }
.ci-face { width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; }
.ci-close { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 20px; cursor: pointer; line-height: 1; }
.ci-disorder { font-size: 13px; color: #ff5f56; background: rgba(255,95,86,.1); border: 1px solid rgba(255,95,86,.25); border-radius: var(--r); padding: 8px 12px; margin-bottom: 14px; }

.ci-body { display: grid; grid-template-columns: 260px 1fr 300px; gap: 16px; align-items: start; }
.ci-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.ci-col--map { align-items: center; }

.ci-box { background: var(--bg2); border: 1px solid var(--line2); border-radius: var(--r); padding: 10px 12px 12px; }
.ci-box-t { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 11px; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: .8px; }
.ci-box-v { font-size: 11px; color: var(--faint); text-transform: none; letter-spacing: 0; margin-left: auto; }
.ci-none { font-size: 12px; color: var(--faint); }

.ci-res { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.ci-res-k { flex: none; width: 62px; font-size: 12px; color: var(--txt); }
.ci-res-v { flex: none; margin-left: auto; font-size: 12px; color: var(--dim); }
.ci-res-v--bad { color: #ff5f56; }

.ci-garrison { display: flex; flex-wrap: wrap; gap: 4px; }
.ci-unit { width: 44px; height: 44px; padding: 0; background: var(--bg3); border: 1px solid var(--line); cursor: pointer; }
.ci-unit:hover { background: var(--bg1); border-color: var(--line2); }
/* Still wants orders this turn — the same units the board's next-unit key chases, so
   the box says at a glance which of them are waiting on you. */
.ci-unit--orders { border-color: #f2b441; }
.ci-unit-img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }

.ci-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ci-chip { font-size: 12px; padding: 3px 8px; border-radius: 3px; background: var(--bg3); color: var(--txt); }
</style>
