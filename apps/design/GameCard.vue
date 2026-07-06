<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  game: { type: Object, required: true },
});
defineEmits(['click']);

const broken = ref(false);
watch(() => props.game.name, () => { broken.value = false; });

const src = computed(() => `/images/${props.game.name}/preview_box`);
const playersLabel = computed(() => {
  const g = props.game;
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers}P` : `${g.minPlayers}–${g.maxPlayers}P`;
});
</script>

<template>
  <div class="gamecard" @click="$emit('click')">
    <img v-if="!broken" class="gamecard-bg" :src="src" :alt="game.name" loading="lazy" @error="broken = true"/>
    <div class="gamecard-scrim"/>
    <div class="gamecard-info">
      <div class="gamecard-name">{{game.name}}</div>
      <span class="gamecard-tag">{{playersLabel}}</span>
    </div>
  </div>
</template>
