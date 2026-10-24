<script setup>
// A battle's dice, thrown on screen before the board shows what they did (SessionView's
// roll beat): each side's dice in its own colour, tumbling while `phase` is 'rolling',
// then the faces that were actually thrown and their totals, the winner's bright and
// the loser's dimmed. Generic — any attack whose result carries attackerRolls /
// defenderRolls / attackerSum / defenderSum / won gets one.
import { ref, computed, watch, onUnmounted } from 'vue';

const props = defineProps({
  // { key, phase: 'rolling'|'settled', attacker: { rolls, sum, color, name },
  //   defender: { rolls, sum, color, name }, won }
  roll: { type: Object, required: true },
});

// While tumbling, every die shows a fresh random face a few times a second.
const tumble = ref(0);
let timer = null;
function spin(on) {
  clearInterval(timer);
  timer = on ? setInterval(() => { tumble.value++; }, 70) : null;
}
watch(() => props.roll.phase, (p) => spin(p === 'rolling'), { immediate: true });
onUnmounted(() => spin(false));

const rolling = computed(() => props.roll.phase === 'rolling');
const faces = (side) => {
  void tumble.value;
  return rolling.value ? side.rolls.map(() => 1 + Math.floor(Math.random() * 6)) : side.rolls;
};

// Pip positions on a 3x3 grid, per face.
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
const sides = computed(() => [
  { key: 'a', ...props.roll.attacker, wins: props.roll.won },
  { key: 'd', ...props.roll.defender, wins: !props.roll.won },
]);
</script>

<template>
  <div class="dr" :class="{ 'dr--settled': !rolling }">
    <template v-for="(s, si) in sides" :key="s.key">
      <div v-if="si === 1" class="dr-vs">vs</div>
      <div class="dr-side" :class="{ 'dr-side--win': !rolling && s.wins, 'dr-side--lose': !rolling && !s.wins }">
        <div class="dr-dice">
          <span v-for="(f, i) in faces(s)" :key="i" class="dr-die" :style="{ background: s.color }">
            <span v-for="c in 9" :key="c" class="dr-cell"><span v-if="PIPS[f]?.includes(c - 1)" class="dr-pip"/></span>
          </span>
        </div>
        <div class="dr-sum mono">{{ rolling ? '…' : s.sum }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dr {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: rgba(8, 11, 14, 0.88); border: 1px solid var(--line, #26313b); border-radius: 8px;
  pointer-events: none; z-index: 5; max-width: calc(100% - 32px);
}
.dr-side { display: flex; align-items: center; gap: 8px; transition: opacity .15s; }
.dr-side--lose { opacity: 0.45; }
.dr-dice { display: flex; flex-wrap: wrap; gap: 4px; max-width: 176px; }
.dr-die {
  width: 18px; height: 18px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.45);
  display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); padding: 2px; box-sizing: border-box;
}
.dr-cell { display: flex; align-items: center; justify-content: center; }
.dr-pip { width: 3.5px; height: 3.5px; border-radius: 50%; background: #0b1117; }
.dr-sum { font-size: 18px; font-weight: 700; min-width: 26px; text-align: center; color: #e6edf3; }
.dr-side--win .dr-sum { color: #ffffff; text-shadow: 0 0 6px rgba(255,255,255,.5); }
.dr-vs { font-size: 10px; color: #8a96a1; text-transform: uppercase; letter-spacing: .08em; }
</style>
