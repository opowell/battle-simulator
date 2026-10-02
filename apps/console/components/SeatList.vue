<script setup>
// The seats of a session or recording: name, id, and who plays it.
defineProps({ players: Array, pending: { type: String, default: null } })
</script>

<template>
  <table class="sl">
    <tbody>
      <tr v-for="p in players" :key="p.id">
        <td>{{ p.name }}<span v-if="p.id === pending" class="sl__turn">to move</span></td>
        <td class="cx-mono cx-muted">{{ p.id }}</td>
        <td>{{ p.agent === 'human' ? 'Human' : `AI · ${p.agent}` }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.sl { width: 100%; border-collapse: collapse; font-size: 13px; }
.sl td { padding: 5px 8px; border-bottom: 1px solid var(--dc-line); }
.sl__turn { margin-left: 8px; padding: 1px 6px; border-radius: 999px; font-size: 11px; background: var(--dc-accent-bg); color: var(--dc-accent); }
</style>
