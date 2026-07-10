<script setup>
defineProps({ toasts: { type: Array, default: () => [] } });
</script>

<template>
  <div class="toast">
    <div v-for="t in toasts" :key="t.id" class="toastmsg" :class="t.kind">{{ t.msg }}</div>
  </div>
</template>
