<script setup>
// One row in the games list.
import GameThumb from './GameThumb.vue';
defineProps({ game: { type: Object, required: true }, selected: Boolean });
defineEmits(['select']);
</script>

<template>
  <button class="grow" :class="{ sel: selected }" @click="$emit('select')">
    <span class="gicon"><GameThumb :name="game.name"/></span>
    <span>
      <div class="gname">{{ game.name }}</div>
      <div class="gmeta">{{ game.minPlayers }}–{{ game.maxPlayers }}p · {{ game.gameClass }}</div>
    </span>
    <span v-if="!game.live" class="badge badge-warn" title="Registered but not loaded; restart to activate">new</span>
  </button>
</template>
