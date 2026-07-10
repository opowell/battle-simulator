<script setup>
defineProps({
  terrain: Object, // { x, y, name, description }
});
</script>

<template>
  <div class="sqd">
    <div class="sqd-head">
      <span class="sqd-name">{{terrain.name}}</span>
    </div>
    <div class="mono sqd-coord">
      ({{terrain.x}}, {{terrain.y}})
    </div>
    <div v-if="terrain.description" class="sqd-desc">
      {{terrain.description}}
    </div>
  </div>
</template>

<style scoped>
.sqd { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.sqd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sqd-name { font-weight: 700; font-size: 13px; }
.sqd-coord { font-size: 10px; color: var(--faint); margin-bottom: 8px; }
.sqd-desc { font-size: 11px; color: var(--dim); line-height: 1.4; }
</style>
