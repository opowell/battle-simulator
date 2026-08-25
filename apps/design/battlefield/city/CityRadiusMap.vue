<script setup>
// The city map of the original's city screen: the 21-square "fat cross" a city may
// work (see city.js's FAT_CROSS), drawn at map scale with the city sprite in the
// middle and, on every square a citizen is working, the resource icons that square is
// actually yielding. A plain 5x5 CSS grid with the four corner cells left unpopulated
// gives the cross shape without a non-rectangular layout.
import { computed } from 'vue';

const props = defineProps({
  city:    { type: Object, required: true },
  team:    { type: Object, default: null },   // the owner's team — the city plaque's colour
  tile:    { type: Number, default: 80 },     // square size in px — the screen's centrepiece
});
const imgSrc = window.api.imgSrc;
// The centre square is drawn exactly as the board draws a city: an owner-coloured
// plaque with the (untinted) `city.sprite` stamped over it and the size on top — see
// HtmlBadgeToken.vue, whose idiom this repeats. That sprite alone is line art meant to
// sit on the plaque; over bare terrain it is an unreadable dark smudge.

const tiles = computed(() =>
  (props.city.radius ?? []).filter(t => !(Math.abs(t.dx) === 2 && Math.abs(t.dy) === 2)));

function tileTitle(t) {
  if (t.offBoard) return '';
  if (t.center) return `${props.city.name} (city centre)`;
  if (t.claimedByOther) return `${t.terrain} — worked by another city`;
  return `${t.terrain} — food ${t.yield.food} · shields ${t.yield.shields} · trade ${t.yield.trade}`;
}
</script>

<template>
  <div class="cr" :style="{ '--t': tile + 'px' }">
    <div v-for="t in tiles" :key="t.dx + ',' + t.dy"
         class="cr-tile"
         :class="{ 'cr-tile--claimed': t.claimedByOther, 'cr-tile--off': t.offBoard, 'cr-tile--worked': t.worked }"
         :style="{ gridColumn: String(t.dx + 3), gridRow: String(t.dy + 3), background: t.color }"
         :title="tileTitle(t)">
      <img v-if="t.sprite" :src="imgSrc(t.sprite)" class="cr-img" draggable="false"/>
      <div v-if="t.center" class="cr-city" :style="{ background: team?.raw ?? 'var(--line3)' }">
        <img v-if="city.sprite" :src="imgSrc(city.sprite)" class="cr-city-img" draggable="false"/>
        <span class="cr-city-n">{{city.size}}</span>
      </div>
      <!-- One icon per point of what this square yields, sent ready-made by the game. -->
      <div v-else-if="t.icons?.length" class="cr-res">
        <img v-for="(icon, ri) in t.icons" :key="ri"
             :src="imgSrc(icon)" class="cr-res-i" draggable="false"/>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cr { display: grid; grid-template-columns: repeat(5, var(--t)); grid-template-rows: repeat(5, var(--t));
      gap: 1px; justify-content: center; background: var(--line); padding: 1px; }
.cr-tile { position: relative; background: var(--bg2); display: grid; place-items: center; overflow: hidden; }
.cr-tile--off { visibility: hidden; }
.cr-tile--worked { outline: 1px solid var(--line3); outline-offset: -1px; }
.cr-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
.cr-city { position: absolute; inset: 10%; display: grid; place-items: center; box-sizing: border-box;
           border: 1px solid rgba(0,0,0,.85);
           box-shadow: inset 1px 1px 0 rgba(255,255,255,.5), inset -1px -1px 0 rgba(0,0,0,.45); }
.cr-city-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.cr-city-n { position: relative; font-size: 26px; font-weight: 700; color: #fff;
             text-shadow: 0 0 3px #000, 0 1px 2px #000; }
.cr-tile--claimed .cr-img { opacity: .3; filter: grayscale(.6); }
.cr-res { position: absolute; inset: 0; display: flex; flex-wrap: wrap; align-content: center;
          align-items: center; justify-content: center; gap: 2px; padding: 3px;
          background: rgba(0,0,0,.35); pointer-events: none; }
.cr-res-i { width: 15px; height: 15px; object-fit: contain; image-rendering: pixelated; flex: none;
            filter: drop-shadow(0 1px 1px rgba(0,0,0,.9)); }
</style>
