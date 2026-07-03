<script setup>
defineProps({
  terrain: Object, // { x, y, name, description }
});
</script>

<template>
  <div style="padding:12px 14px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-weight:700;font-size:13px">{{terrain.name}}</span>
    </div>
    <div class="mono" style="font-size:10px;color:var(--faint);margin-bottom:8px">
      ({{terrain.x}}, {{terrain.y}})
    </div>
    <div v-if="terrain.description" style="font-size:11px;color:var(--dim);line-height:1.4">
      {{terrain.description}}
    </div>
  </div>
</template>
