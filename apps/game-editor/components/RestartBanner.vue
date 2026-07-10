<script setup>
// Shown after a create/update/delete: those rewrite api-server.js, which only
// takes effect on restart.
defineProps({ message: String });
</script>

<template>
  <div v-if="message" class="banner-wrap">
    <div class="banner">
      <BsIcon name="clock" :size="15"/>
      <span>{{ message }} — restart the API server (<span class="mono">npm start</span>) for changes to take effect.</span>
    </div>
  </div>
</template>
