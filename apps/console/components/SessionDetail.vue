<script setup>
// A live session: who is seated and how, where it has got to, and the way into
// it in the play UI. Ending one here deletes it from the server; its recording
// stays on disk.
import { computed, ref } from 'vue'
import { api, playUrl } from '../api.js'
import ConfirmButton from './ConfirmButton.vue'
import SeatList from './SeatList.vue'

const props = defineProps({ record: Object, fields: Object, rows: Object })
const emit = defineEmits(['changed', 'close', 'open'])

const recording = computed(() => (props.rows?.recordings ?? []).find((r) => r.record.id === props.record.id))
const busy = ref(false)
const error = ref('')

async function remove() {
  busy.value = true; error.value = ''
  try {
    await api.deleteSession(props.record.id)
    emit('changed')
    emit('close')
  } catch (e) { error.value = e.message; busy.value = false }
}
</script>

<template>
  <div class="cx-stack">
    <div class="cx-row">
      <a class="cx-btn cx-btn--primary" :href="playUrl.session(record.id)" target="_blank" rel="noopener">Open in the play UI ↗</a>
      <button v-if="recording" type="button" class="cx-btn" @click="emit('open', recording)">Recording</button>
    </div>

    <dl class="sd">
      <dt>State</dt><dd>{{ record.status }}<template v-if="fields.outcome"> · {{ fields.outcome }}</template><template v-if="record.result?.reason"> ({{ record.result.reason }})</template></dd>
      <dt>Turn</dt><dd>{{ record.turn ?? '—' }}</dd>
      <dt>Scenario</dt><dd>{{ record.scenario ?? '—' }}</dd>
      <dt>Fog of war</dt><dd>{{ record.fog ? 'on' : 'off' }}</dd>
      <dt>Started</dt><dd>{{ new Date(record.createdAt).toLocaleString() }}</dd>
      <dt>Id</dt><dd class="cx-mono">{{ record.id }}</dd>
    </dl>

    <h3>Seats</h3>
    <SeatList :players="record.players" :pending="record.status === 'active' ? record.pendingPlayer : null" />

    <h3>End</h3>
    <div class="cx-row">
      <ConfirmButton label="Delete session" confirm="Delete it? The recording is kept." :busy="busy" @confirm="remove" />
    </div>
    <p v-if="error" class="cx-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.sd { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 13px; }
.sd dt { color: var(--dc-fg-2); }
.sd dd { margin: 0; overflow-wrap: anywhere; }
</style>
