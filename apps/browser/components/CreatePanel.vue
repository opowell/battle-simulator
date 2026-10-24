<script setup>
// Making a new one of something — whatever a type's card offers to create.
import NewGameForm from './NewGameForm.vue'
import NewSessionForm from './NewSessionForm.vue'

defineProps({ entityKey: String, rows: Object })
const emit = defineEmits(['created'])

const forms = { games: NewGameForm, sessions: NewSessionForm }
</script>

<template>
  <div class="cx-panel">
    <component :is="forms[entityKey]" v-if="forms[entityKey]" :rows="rows" @created="(id) => emit('created', id)" />
    <p v-else class="cx-muted">Nothing to make here.</p>
  </div>
</template>
