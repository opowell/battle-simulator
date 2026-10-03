<script setup>
// A session opened inside the console: the play UI's own page for it, in a tab
// beside the browser rather than a browser tab of its own.
import { playUrl } from '../api.js'

defineProps({ sessionId: String })
</script>

<template>
  <iframe class="sp" :src="playUrl.session(sessionId)" title="Session" allow="autoplay; fullscreen" />
</template>

<style scoped>
.sp { display: block; width: 100%; height: 100%; border: 0; background: var(--dc-bg-0); }
</style>
