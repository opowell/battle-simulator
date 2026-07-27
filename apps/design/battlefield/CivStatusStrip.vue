<script setup>
// Per-player economy status strip (civ1 only — see Civ1Game.toGrid's `civ` field).
// Split out of GameHeader.vue so the generic header stays free of civ-specific
// formatting; the host only needs to pass the resolved per-player civ object.
defineProps({
  civ: { type: Object, default: null },
});
</script>

<template>
  <div v-if="civ" class="mono cst">
    <span class="cst-item" title="Treasury">
      <BsIcon name="zap" :size="10" color="var(--faint)"/>{{civ.gold}}
    </span>
    <span class="cst-item" title="Government">{{civ.government}}</span>
    <span class="cst-item" title="Tax / Luxury / Science">
      {{civ.taxRate}}/{{civ.luxRate}}/{{100 - civ.taxRate - civ.luxRate}}
    </span>
    <span v-if="civ.research" class="cst-item" title="Researching">{{civ.research}}</span>
    <span v-if="civ.anarchyTurns" class="cst-item cst-item--warn">Anarchy</span>
  </div>
</template>

<style scoped>
.cst { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--dim); }
.cst-item { display: flex; align-items: center; gap: 3px; }
.cst-item--warn { color: var(--warn); }
</style>
