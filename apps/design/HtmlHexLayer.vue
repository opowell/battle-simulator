<script setup>
import { computed, ref } from 'vue';
import HtmlUnit from './battlefield/HtmlUnit.vue';
// HTML/CSS renderer for hex TERRITORY maps (kdice, risk) — the HTML counterpart of the
// SVG hex board SchematicLayer used to draw, picked automatically in Battlefield.vue.
// Nothing here is an <svg>: a hex is a plain <div> cut to shape with clip-path, and a
// border or sea route is a <div> of the segment's length rotated onto its bearing. The
// board is made of the same elements as the rest of the app, so a hex answers a click
// the way any element does — the element under the pointer is the one that was clicked,
// with no coordinate conversion in between.
//
// Territory maps only (a hex board whose cells carry `territoryId`). A hex board of
// per-hex terrain and pieces (memoir44) still goes to SchematicLayer — its cell glyphs,
// terrain inspection and sprite tokens have no equivalent here yet.
//
// Positions come from the shared `fit` (Battlefield's world→screen transform), so this
// board lands exactly where the SVG one did.

const props = defineProps({
  field:        Object,
  fit:          Object,
  units:        Array,
  selectedId:   { type: String, default: null },
  activeUnitId: { type: String, default: null },
  hoveredId:    { type: String, default: null },
  rdr:          Object,
  // Territory-wide flash keyed by territoryId (see App.vue's territoryFx): { key,
  // blinks, holdOwner } — `key` restarts the animation, `blinks` is how many hard
  // on/off cycles to run, and `holdOwner` keeps the pre-attack colour until it ends.
  territoryFx:  { type: Object, default: () => ({}) },
});
// Only 'sq-click': a hex, a token and the background all report WHERE the click landed
// and Battlefield decides what that means (select, attack, tap) — a territory map has no
// "select this unit" click of its own.
const emit = defineEmits(['sq-click']);

const layerEl = ref(null);

// ── colours ───────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt]);
}
function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * (1 - amt), g * (1 - amt), b * (1 - amt)]);
}

// While a territory is flashing after a conquest its hexes keep showing the
// pre-attack owner (App.vue's territoryFx.holdOwner) — the new owner's colour
// only appears once the flash finishes and the entry is removed.
function heldOwner(territoryId) {
  if (territoryId == null) return null;
  const fx = props.territoryFx?.[territoryId];
  return fx && fx.holdOwner != null ? fx.holdOwner : null;
}
function teamRaw(owner) {
  return props.field.teams[owner - 1]?.raw ?? '#8a96a1';
}
// 'team' is a sentinel (see kdice's toGrid): the server can't know the client's team
// palette, so it defers to whichever colour the client gave this tile's owner.
// Lightened for the fill (the original K.Dice board's pastel look) — the borders carry
// the darker, saturated shade instead, so a blob still reads as clearly bounded.
function tileColor(tile) {
  if (tile.color !== 'team') return tile.color;
  return lighten(teamRaw(heldOwner(tile.territoryId) ?? tile.owner), 0.35);
}
// A border sits between exactly two territories (or a territory and the map's edge —
// see games/mapTypes/hexagon.js's territoryBorders, which emits each shared edge once,
// tagged with both sides). It reads as "selected" if either side is the selection, so a
// shared edge recolours the same regardless of which side asks.
function isSegSelected(seg) {
  const sel = props.selectedId ?? props.activeUnitId;
  return sel != null && (seg.aId === sel || seg.bId === sel);
}
function segBorderColor(seg) {
  if (isSegSelected(seg)) return '#ffffff';
  const useA = !!seg.aOwner;
  return darken(teamRaw(heldOwner(useA ? seg.aId : seg.bId) ?? (useA ? seg.aOwner : seg.bOwner)), 0.55);
}

// ── geometry ──────────────────────────────────────────────────────────────────
// Pointy-top hexes, matching games/mapTypes/hexagon.js's hexCorners: a box of
// √3·r by 2·r cut by HEX_CLIP below. The hair over the true radius makes adjacent
// same-territory fills overdraw their shared edge — without it, anti-aliasing
// leaves a faint background-coloured seam that reads as a spurious grid line.
const hexR = computed(() => props.fit.len(props.field.hexSize ?? 1) + 0.75);
const hexW = computed(() => Math.sqrt(3) * hexR.value);

function hexBox(tile) {
  return {
    left:   `${props.fit.x(tile.x) - hexW.value / 2}px`,
    top:    `${props.fit.y(tile.y) - hexR.value}px`,
    width:  `${hexW.value}px`,
    height: `${hexR.value * 2}px`,
  };
}
function tileStyle(tile) {
  return { ...hexBox(tile), background: tileColor(tile) };
}

const boundStyle = computed(() => ({
  left:   `${props.fit.x(0)}px`,
  top:    `${props.fit.y(0)}px`,
  width:  `${props.fit.len(props.field.world.w)}px`,
  height: `${props.fit.len(props.field.world.h)}px`,
  border: `1.5px solid ${props.rdr.bound}`,
}));

// A segment as a rotated box: a div as long as the segment, as thick as its stroke,
// pivoted about its left-hand end — the HTML equivalent of a line with round caps.
function edgeStyle(p1, p2, color, thickness, dashed = false) {
  const x1 = props.fit.x(p1[0]), y1 = props.fit.y(p1[1]);
  const x2 = props.fit.x(p2[0]), y2 = props.fit.y(p2[1]);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return {
    left: `${x1}px`, top: `${y1 - thickness / 2}px`,
    width: `${len}px`, height: `${thickness}px`,
    transform: `rotate(${ang}deg)`, transformOrigin: `0 ${thickness / 2}px`,
    borderRadius: `${thickness / 2}px`,
    // Dashed sea routes: a repeating gradient rather than a border, so the dashes keep
    // their size and rhythm whatever the segment's length and angle (5 on, 5 off —
    // the same dash pattern the SVG board used).
    background: dashed
      ? `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 10px)`
      : color,
  };
}
function borderStyle(seg) {
  return edgeStyle(seg.p1, seg.p2, segBorderColor(seg), isSegSelected(seg) ? 4 : 2.25);
}
// Two territories connected without sharing a border (a game's toGrid may emit these as
// `links` — Risk's sea routes). Dashed, so a crossing over open water never looks like a
// land border, and brightened while either end is selected — the same rule as an edge.
function linkStyle(lk) {
  const seg = { aId: lk.a, bId: lk.b, aOwner: lk.aOwner, bOwner: lk.bOwner };
  return edgeStyle(lk.p1, lk.p2, segBorderColor(seg), isSegSelected(seg) ? 3 : 1.5, true);
}

// Every hex of a currently-flashing territory, keyed so a re-flash (a second attack
// before the first finishes) restarts from a fresh element. blinks: 0 entries (a colour
// hold with no attack playing yet — App.vue's bundleHold) draw no overlay: they keep the
// old colour via heldOwner, but nothing is actually flashing.
const flashingHexes = computed(() => {
  const fx = props.territoryFx;
  if (!fx || !Object.keys(fx).length) return [];
  return (props.field.tiles ?? [])
    .filter(t => t.territoryId != null && fx[t.territoryId]?.blinks > 0)
    .map(t => ({ tile: t, fxKey: fx[t.territoryId].key, blinks: fx[t.territoryId].blinks }));
});

// Token size: the same fraction of a hex the SVG board used, so the army/dice count
// badge sits in its hex exactly as before.
// Token size: the same fraction of a hex the board has always used, times whatever the
// game asked for on this token (u.sizeFrac) — a bigger stack can simply be a bigger
// token, which reads across the whole map at a glance where a two-digit number doesn't.
const tokenBaseR = computed(() => Math.max(5, props.fit.len((props.field.hexSize ?? 1) * 0.55)));
function tokenR(u) {
  return Math.max(5, tokenBaseR.value * (u?.sizeFrac ?? 1));
}
// Dot per unit of a small count (u.pips — kdice's dice), under the token. Sized off the
// token so they stay legible at any board scale, and wrapped at four per row so a full
// stack is two short rows rather than a line wider than its own hex.
function pipList(u) {
  const n = Math.min(u?.pips ?? 0, 12);
  return n > 0 ? Array.from({ length: n }, (_, i) => i) : [];
}
function pipStyle(u) {
  const d = Math.max(3, Math.round(tokenR(u) * 0.34));
  return { width: `${d}px`, height: `${d}px` };
}
function pipRowStyle(u) {
  const d = Math.max(3, Math.round(tokenR(u) * 0.34));
  return { maxWidth: `${d * 4 + 3 * 3}px`, gap: '3px' };
}
function tokenStyle(u) {
  return { left: `${props.fit.x(u.x)}px`, top: `${props.fit.y(u.y)}px` };
}

// A token whose territory is holding its pre-attack look (App.vue's territoryFx) shows
// the held count and the held owner's colour, exactly like the hexes under it. Without
// this the board contradicts itself mid-animation: the blob still the old owner's
// colour, the number on it already the result of a battle that hasn't been shown yet —
// and a bundled AI turn spoils its whole outcome the moment it arrives.
const displayUnits = computed(() => (props.units ?? []).map(u => {
  const fx = props.territoryFx?.[u.id];
  if (!fx || (fx.holdOwner == null && fx.holdLabel == null)) return u;
  return {
    ...u,
    label: fx.holdLabel ?? u.label,
    teamObj: fx.holdOwner != null ? (props.field.teams[fx.holdOwner - 1] ?? u.teamObj) : u.teamObj,
  };
}));

// ── clicks ────────────────────────────────────────────────────────────────────
// A hex and a token each report their OWN position: the element that was clicked is the
// answer, and Battlefield resolves it to a territory (nearestTerritoryUnitId). Anything
// else is a click on the board's background — the open sea between blobs — which is
// reported as the point it actually landed on and resolves to no territory at all.
// Modifier keys travel with the click: a game may mean something different by a
// shift-held click (Risk attacks with every die it can) — see Battlefield's
// handleTerritoryClick.
const mods = (e) => ({ shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!(e.ctrlKey || e.metaKey) });
function clickHex(e, tile) {
  emit('sq-click', null, null, tile.x, tile.y, mods(e));
}
function clickToken(e, u) {
  emit('sq-click', null, null, u.x, u.y, mods(e));
}
function clickBackground(e) {
  const rect = layerEl.value.getBoundingClientRect();
  emit('sq-click', null, null,
    (e.clientX - rect.left - props.fit.x(0)) / props.fit.s,
    (e.clientY - rect.top - props.fit.y(0)) / props.fit.s, mods(e));
}
</script>

<template>
  <div ref="layerEl" class="bf-layer hx-layer" :style="{ background: rdr.stage }" @click="clickBackground">
    <!-- The board's boundary, same as every other renderer draws. -->
    <div class="hx-bound" :style="boundStyle"/>

    <!-- Fill only, no per-hex outline — hexes of one territory read as a single blob;
         the borders below trace just the blob's outer edge, not a honeycomb lattice. -->
    <div v-for="(tile, i) in (field.tiles ?? [])" :key="'hx' + i"
         class="hx-hex" :style="tileStyle(tile)"
         @click.stop="clickHex($event, tile)"/>

    <!-- Territory flash: an all-white hex over each of the territory's tiles, hard
         blinking on/off (blink count/timing must match App.vue's TERRITORY_BLINK_MS). -->
    <div v-for="fh in flashingHexes" :key="'hxfx' + fh.tile.territoryId + '-' + fh.fxKey"
         class="hx-hex hx-flash" :style="{ ...hexBox(fh.tile), animationIterationCount: fh.blinks }"/>

    <div v-for="(seg, si) in (field.hexBorders ?? [])" :key="'hb' + si"
         class="hx-edge" :style="borderStyle(seg)"/>
    <div v-for="(lk, li) in (field.hexLinks ?? [])" :key="'hl' + li"
         class="hx-edge" :style="linkStyle(lk)"/>

    <!-- One token per territory (its army/dice count), centred on the territory's
         capital hex. No HP bar and no state ring: on a territory map the selection is
         already drawn as a white outline around the whole blob. -->
    <div v-for="u in displayUnits" :key="u.id" class="hx-token" :style="tokenStyle(u)">
      <HtmlUnit :unit="u" :r="tokenR(u)" :rdr="rdr" shape="square" :showHp="false"
                :hovered="u.id === hoveredId"
                @click.stop="clickToken($event, u)"/>
      <!-- The count, seen rather than read (u.pips) — one dot per die/army, so the
           board's big stacks stand out without counting digits. -->
      <div v-if="pipList(u).length" class="hx-pips" :style="pipRowStyle(u)"
           @click.stop="clickToken($event, u)">
        <span v-for="i in pipList(u)" :key="i" class="hx-pip"
              :style="{ ...pipStyle(u), background: u.teamObj.raw }"/>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* .bf-layer (index.html) already fills the stage as a positioned box — everything below
   is absolutely placed against it, in the same screen pixels the shared fit produces. */
.hx-layer { overflow: hidden; }
.hx-hex {
  position: absolute;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  cursor: pointer;
}
/* Same hard on/off blink as the SVG board's territory flash: steps(1) so it reads as a
   flash rather than a fade, and forwards so the last frame is the un-flashed one. */
.hx-flash {
  background: #ffffff;
  pointer-events: none;
  animation-name: hx-territory-flash;
  animation-duration: 0.3s;
  animation-timing-function: steps(1, end);
  animation-fill-mode: forwards;
}
@keyframes hx-territory-flash {
  0%, 49.9%  { opacity: 0.85; }
  50%, 100%  { opacity: 0; }
}
.hx-bound { position: absolute; box-sizing: border-box; pointer-events: none; }
.hx-edge { position: absolute; pointer-events: none; }
.hx-token { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 2px; }
/* Two rows at most, so a full stack stays inside its hex. */
.hx-pips { display: flex; flex-wrap: wrap; justify-content: center; cursor: pointer; }
.hx-pip { border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.6); flex: none; }
</style>
