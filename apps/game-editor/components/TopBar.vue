<script setup>
defineProps({ count: { type: Number, default: 0 } });
</script>

<template>
  <div class="topbar">
    <div class="brand"><span class="mark"><BsIcon name="sliders" :size="15"/></span> GAME EDITOR</div>
    <div class="statuschip"><BsIcon name="grid" :size="12"/> {{ count }} games</div>
    <div class="spacer"></div>
    <a class="btn btn-sm btn-ghost" href="/ui/design/">← Back to app</a>
  </div>
</template>
