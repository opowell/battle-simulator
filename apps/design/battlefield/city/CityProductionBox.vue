<script setup>
// The production half of the city screen: what this city is building — as a picture,
// the way the original shows the item between its CHANGE and BUY buttons — how far
// along it is, and the menu of everything else it could build instead.
//
// The pictures and names come from the game, not from here: `city.buildOptions` is a
// map item -> { name, image, cost, turns, stats, kind } built server-side in
// Civ1Game.js, because apps/design has no access to civ1's UNITS/IMPROVEMENTS tables.
import { computed } from 'vue';
import CityIconStrip from './CityIconStrip.vue';

const props = defineProps({
  city:              { type: Object, required: true },
  productionActions: { type: Array, default: () => [] },
  team:              { type: Object, default: null },  // owner's team, for unit art colour
  recolor:           Boolean,                          // field.ui.recolorTeamSprites
  open:              Boolean,
});
const emit = defineEmits(['pick', 'update:open']);

const imgSrc = window.api.imgSrc;
// Unit art is repainted in the owner's colour, the way it is everywhere else on screen
// (apps/design/teamSprite.js). Improvements fall back to the shield icon, which is a
// resource icon and must stay its own colour.
function art(info) {
  return info.kind === 'unit'
    ? window.teamSpriteHref(info.image, props.team?.raw, props.recolor)
    : imgSrc(info.image);
}

const locked = computed(() => !props.productionActions.length);
const opts = computed(() => props.city.buildOptions ?? {});
const current = computed(() => opts.value[props.city.production] ?? {
  name: props.city.productionName, image: props.city.icons?.shields, cost: props.city.buildCost,
});
// The picker's rows are the legal actions (that is what may be submitted); each one is
// dressed with the display info the game sent for that item.
const choices = computed(() => props.productionActions.map(a => ({
  action: a,
  info: opts.value[a.item] ?? { name: a.item, image: props.city.icons?.shields, cost: null },
})));
</script>

<template>
  <div class="cp">
    <div class="cp-now">
      <img :src="art(current)" class="cp-art" draggable="false"/>
      <div class="cp-now-txt">
        <div class="cp-name">{{current.name}}</div>
        <div class="mono cp-sub">
          {{city.shields}}/{{city.buildCost}} shields
          <template v-if="city.shields >= city.buildCost"> · ready</template>
          <template v-else-if="city.buildTurnsLeft != null"> · {{city.buildTurnsLeft}} turns left</template>
        </div>
      </div>
    </div>

    <CityIconStrip :icon="city.icons?.shields" :filled="city.shields" :total="city.buildCost" :size="16"/>

    <button class="btn btn-ghost cp-change" :disabled="locked" @click="emit('update:open', !open)">
      {{locked ? 'Production set this turn' : (open ? 'Close menu' : 'Change… [C]')}}
    </button>

    <!-- Numbered because the number keys pick straight off this list (see the city
         screen's onKeyDown) — the original's own change-production menu did the same. -->
    <div v-if="open && !locked" class="cp-menu">
      <button v-for="(c, i) in choices" :key="c.action.item" class="cp-opt" @click="emit('pick', c.action)">
        <span class="mono cp-key">{{i > 8 ? '' : i + 1}}</span>
        <img :src="art(c.info)" class="cp-opt-art" draggable="false"/>
        <span class="cp-opt-txt">
          <span class="cp-opt-name">{{c.info.name}}</span>
          <span class="mono cp-opt-sub">{{c.info.stats}}</span>
        </span>
        <span class="mono cp-opt-cost">
          {{c.info.cost}}▪<template v-if="c.info.turns"> · {{c.info.turns}}t</template>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cp { display: flex; flex-direction: column; gap: 8px; }
.cp-now { display: flex; align-items: center; gap: 10px; }
.cp-art { width: 52px; height: 52px; object-fit: contain; image-rendering: pixelated; flex: none;
          background: var(--bg3); border: 1px solid var(--line2); padding: 3px; }
.cp-now-txt { min-width: 0; }
.cp-name { font-size: 15px; font-weight: 700; text-transform: capitalize; }
.cp-sub { font-size: 11px; color: var(--dim); margin-top: 2px; }
.cp-change { width: 100%; justify-content: center; font-size: 12px; padding: 7px 10px; }
.cp-menu { display: flex; flex-direction: column; gap: 3px; max-height: 320px; overflow-y: auto;
           background: var(--bg0); border: 1px solid var(--line2); padding: 4px; }
.cp-opt { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer;
          background: var(--bg2); border: 1px solid transparent; color: var(--txt); padding: 4px 6px; }
.cp-opt:hover { background: var(--bg3); border-color: var(--line3); }
.cp-key { flex: none; width: 12px; color: var(--accent); font-size: 12px; }
.cp-opt-art { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; flex: none; }
.cp-opt-txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.cp-opt-name { font-size: 13px; text-transform: capitalize; }
.cp-opt-sub { font-size: 10px; color: var(--faint); }
.cp-opt-cost { flex: none; font-size: 11px; color: var(--dim); }
</style>
