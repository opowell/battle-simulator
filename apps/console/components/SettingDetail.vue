<script setup>
// One of the console's settings (settings.js): what it does, and its choices.
// A change is saved at once; the console rebuilds its rows from it.
import { settings, setSetting } from '../settings.js'

defineProps({ record: Object })
</script>

<template>
  <div class="cx-stack">
    <p class="cx-note">{{ record.description }}</p>
    <div class="cx-row" role="radiogroup" :aria-label="record.label">
      <button
        v-for="choice in record.choices"
        :key="String(choice.value)"
        type="button"
        role="radio"
        :aria-checked="settings[record.key] === choice.value"
        :class="['cx-btn', settings[record.key] === choice.value && 'cx-btn--primary']"
        @click="setSetting(record.key, choice.value)"
      >
        {{ choice.label }}
      </button>
    </div>
    <p class="cx-note">Kept in this browser.</p>
  </div>
</template>
