<script setup>
// Who sits in each seat of a new session: a name, and a human or one of the
// agents the game offers.
const seats = defineModel({ type: Array, required: true })
defineProps({ agents: { type: Array, default: () => [] } })
</script>

<template>
  <div class="se">
    <div v-for="(seat, i) in seats" :key="i" class="se__row">
      <input v-model="seat.name" class="cx-input" :aria-label="`Seat ${i + 1} name`">
      <select v-model="seat.agent" class="cx-input" :aria-label="`Seat ${i + 1} player`">
        <option value="human">Human</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.se { display: flex; flex-direction: column; gap: 6px; }
.se__row { display: grid; grid-template-columns: 1fr 1.2fr; gap: 6px; }
</style>
