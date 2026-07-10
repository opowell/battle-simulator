<script setup>
// Left panel: header + New button + scrollable list of games.
import GameRow from './GameRow.vue';
defineProps({ games: Array, selected: String, loading: Boolean });
defineEmits(['select', 'create']);
</script>

<template>
  <div class="panel">
    <div class="panel-h">
      <span class="panel-t">Games</span>
      <button class="btn btn-sm btn-primary" @click="$emit('create')"><BsIcon name="plus" :size="14"/> New</button>
    </div>
    <div class="panel-b">
      <div v-if="loading" class="muted mono txt-sm">Loading…</div>
      <div v-else class="glist">
        <GameRow v-for="g in games" :key="g.name" :game="g" :selected="selected === g.name"
                 @select="$emit('select', g.name)"/>
      </div>
    </div>
  </div>
</template>
