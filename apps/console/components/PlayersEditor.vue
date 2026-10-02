<script setup>
// The sides a game seats by default: an id the rules refer to, and a name.
const players = defineModel({ type: Array, required: true })

function add() {
  const n = players.value.length + 1
  players.value = [...players.value, { id: `p${n}`, name: `Player ${n}` }]
}
const removeAt = (i) => { players.value = players.value.filter((_, j) => j !== i) }
</script>

<template>
  <div class="pe">
    <div v-for="(p, i) in players" :key="i" class="pe__row">
      <input v-model="p.id" class="cx-input cx-mono" placeholder="id" aria-label="Side id">
      <input v-model="p.name" class="cx-input" placeholder="Name" aria-label="Side name">
      <button type="button" class="cx-btn cx-btn--quiet" :disabled="players.length <= 2" title="Remove this side" @click="removeAt(i)">✕</button>
    </div>
    <button type="button" class="cx-btn pe__add" @click="add">Add a side</button>
  </div>
</template>

<style scoped>
.pe { display: flex; flex-direction: column; gap: 6px; }
.pe__row { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 6px; }
.pe__add { align-self: flex-start; }
</style>
