<script setup>
// Every field of a record, for a kind with nothing more particular to show:
// plain values as text, anything structured as JSON.
import { computed } from 'vue'

const props = defineProps({ record: Object, omit: { type: Array, default: () => [] } })

const entries = computed(() => Object.entries(props.record ?? {})
  .filter(([key]) => !props.omit.includes(key))
  .map(([key, value]) => ({
    key,
    label: key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
    structured: value !== null && typeof value === 'object',
    text: value === null || value === undefined || value === '' ? '—'
      : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
  })))
</script>

<template>
  <dl class="fl">
    <template v-for="e in entries" :key="e.key">
      <dt>{{ e.label }}</dt>
      <dd><pre v-if="e.structured" class="cx-code">{{ e.text }}</pre><template v-else>{{ e.text }}</template></dd>
    </template>
  </dl>
</template>

<style scoped>
.fl { display: grid; grid-template-columns: minmax(90px, max-content) 1fr; gap: 8px 16px; margin: 0; font-size: 13px; }
.fl dt { color: var(--dc-fg-2); }
.fl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
</style>
