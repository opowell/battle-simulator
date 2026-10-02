<script setup>
// A recording on disk: the parameters a session was created with and how it
// ended. One whose session is still running leads back to that session.
import { computed } from 'vue'
import SeatList from './SeatList.vue'

const props = defineProps({ record: Object, fields: Object, rows: Object })
const emit = defineEmits(['open'])

const session = computed(() => (props.rows?.sessions ?? []).find((r) => r.record.id === props.record.id))
</script>

<template>
  <div class="cx-stack">
    <div v-if="session" class="cx-row">
      <button type="button" class="cx-btn cx-btn--primary" @click="emit('open', session)">Live session</button>
    </div>
    <dl class="rd">
      <dt>State</dt><dd>{{ record.status }}<template v-if="fields.outcome"> · {{ fields.outcome }}</template><template v-if="record.result?.reason"> ({{ record.result.reason }})</template></dd>
      <dt>Moves</dt><dd>{{ record.moves }}</dd>
      <dt>Scenario</dt><dd>{{ record.scenario ?? '—' }}</dd>
      <dt>Fog of war</dt><dd>{{ record.fog ? 'on' : 'off' }}</dd>
      <dt>Started</dt><dd>{{ record.createdAt ? new Date(record.createdAt).toLocaleString() : '—' }}</dd>
      <dt>File</dt><dd class="cx-mono">sessions/{{ record.file }} · {{ Math.max(1, Math.round(record.size / 1024)) }} KB</dd>
    </dl>
    <p v-if="record.status === 'interrupted'" class="cx-note">The server stopped while this game was still being played, so it never finished.</p>
    <h3>Seats</h3>
    <SeatList :players="record.players" />
  </div>
</template>

<style scoped>
.rd { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 13px; }
.rd dt { color: var(--dc-fg-2); }
.rd dd { margin: 0; overflow-wrap: anywhere; }
</style>
