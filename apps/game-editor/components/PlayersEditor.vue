<script setup>
// Editable list of default players. Mutates the passed array in place (it's the
// parent's reactive form/draft array), so no v-model plumbing is needed.
const props = defineProps({
  players: { type: Array, required: true },
  min: { type: Number, default: 2 },
});

function add() {
  const n = props.players.length + 1;
  props.players.push({ id: 'p' + n, name: 'Player ' + n });
}
function remove(i) { props.players.splice(i, 1); }
</script>

<template>
  <div>
    <div v-for="(p, i) in players" :key="i" class="slot">
      <input v-model="p.id" placeholder="id"/>
      <input v-model="p.name" placeholder="name"/>
      <button class="btn btn-sm btn-ghost" :disabled="players.length <= min" @click="remove(i)">
        <BsIcon name="trash" :size="13"/>
      </button>
    </div>
    <button class="btn btn-sm players-add" @click="add">
      <BsIcon name="plus" :size="13"/> Add player
    </button>
  </div>
</template>
