<script setup>
// Everyone standing on the selected unit's square. A board that stacks units draws
// only the top of the stack, so this is where the rest can be read off — and picked
// up: a row selects its unit, the same as clicking it on the board would if it were
// on top.
defineProps({
  // The square's units, top of the stack first.
  units:      { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  field:      Object,
});
defineEmits(['select']);
// A standing order's name: its title up to the dash ("Fortified — +50% defence").
const markName = m => String(m.title).split(' — ')[0];
</script>

<template>
  <div class="squ">
    <div class="squ-t">On this square · {{ units.length }}</div>
    <button v-for="u in units" :key="u.id" class="squ-row"
            :class="{ 'squ-row--on': u.id === selectedId, 'squ-row--orders': u.needsOrders }"
            :title="u.needsOrders ? 'Still wants orders this turn' : ''"
            @click="$emit('select', u)">
      <img v-if="u.imagePath" class="squ-img" draggable="false" alt=""
           :src="teamSpriteHref(u.imagePath, u.teamObj?.raw, field?.ui?.recolorTeamSprites)"/>
      <BsDot v-else :color="u.teamObj?.raw" :size="9"/>
      <span class="squ-name">{{ u.name }}</span>
      <span v-if="u.statusMark?.title" class="mono squ-mark" :title="u.statusMark.title">{{ markName(u.statusMark) }}</span>
      <span v-if="u.maxMp != null" class="mono squ-mp">{{ EXACT.fmt(u.mp ?? 0) }} / {{ EXACT.fmt(u.maxMp) }}</span>
    </button>
  </div>
</template>

<style scoped>
.squ { padding: 10px 14px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; }
.squ-t { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
.squ-row { display: flex; align-items: center; gap: 7px; width: 100%; padding: 3px 5px; border: 1px solid transparent;
  border-radius: 4px; background: transparent; color: var(--txt); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.squ-row:hover { border-color: var(--line2); }
.squ-row--on { border-color: var(--accent); background: rgba(66,198,230,.08); }
.squ-img { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; flex-shrink: 0; }
.squ-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.squ-row--orders .squ-name { color: var(--ok); }
.squ-mark { font-size: 9px; color: #f2b441; }
.squ-mp { font-size: 9px; color: var(--faint); }
</style>
