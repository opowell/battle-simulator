<script setup>
import { computed } from 'vue';

// One transient combat flash, drawn centred on (0,0) — the parent <g> is already
// translated to the unit's board square. Mirrors the original's hit feedback:
//   • damage — the struck sprite blinks and a numeral floats up
//   • heal   — a soft green glow and a green "+N"
//   • action — a quick white flash on the acting unit (a schematic stand-in for
//              the original's attack/cast animation)
const props = defineProps({
  fx: Object,   // { type:'action'|'damage'|'heal', amount?, died?, key }
  r:  Number,   // flash radius in screen px
});

const COLOR = { action: '#ffffff', damage: '#ff5a52', heal: '#46d39a' };

const fill      = computed(() => COLOR[props.fx.type] ?? '#ffffff');
const flashClass = computed(() => props.fx.type === 'damage' ? 'fx-blink' : 'fx-pulse');
const numFill   = computed(() => props.fx.type === 'heal' ? COLOR.heal : '#ffffff');
const numText   = computed(() => props.fx.type === 'heal' ? `+${props.fx.amount}` : `-${props.fx.amount}`);
const fontSize  = computed(() => Math.max(11, props.r * (props.fx.died ? 1.15 : 0.95)));
</script>

<template>
  <g class="fx-layer">
    <circle cx="0" cy="0" :r="r" :fill="fill" :class="flashClass"/>
    <text v-if="fx.amount != null"
          x="0" :y="-r - 2" text-anchor="middle"
          :font-size="fontSize" font-weight="800"
          :fill="numFill" stroke="rgba(0,0,0,0.65)" stroke-width="0.7"
          class="fx-num">
      {{ numText }}
    </text>
  </g>
</template>

<style scoped>
.fx-layer { pointer-events: none; }
.fx-num { paint-order: stroke; font-family: ui-monospace, monospace; }

/* Action / heal: a single soft flash that fades out. */
@keyframes fx-pulse { 0% { opacity: 0.7; } 100% { opacity: 0; } }
.fx-pulse { animation: fx-pulse 0.38s ease-out forwards; }

/* Damage: a quick double blink echoing the original's white hit-flash. */
@keyframes fx-blink {
  0%, 100% { opacity: 0; }
  12%      { opacity: 0.8; }
  38%      { opacity: 0; }
  55%      { opacity: 0.7; }
  82%      { opacity: 0; }
}
.fx-blink { animation: fx-blink 0.5s ease-out forwards; }

/* Floating numeral rises and fades, like the original's damage/heal numbers. */
@keyframes fx-rise {
  0%   { opacity: 0; transform: translateY(3px); }
  20%  { opacity: 1; }
  100% { opacity: 0; transform: translateY(-16px); }
}
.fx-num { animation: fx-rise 0.75s ease-out forwards; }
</style>
