<script setup>
// One opened record: its picture and name, then whatever its kind can show or
// edit. The row is looked up afresh on every catalog refresh, so a record that
// has since gone (a deleted game, an ended session) says so instead of
// showing stale data.
import Art from './Art.vue'
import GameDetail from './GameDetail.vue'
import FileEditor from './FileEditor.vue'
import SessionDetail from './SessionDetail.vue'
import RecordingDetail from './RecordingDetail.vue'
import ScenarioDetail from './ScenarioDetail.vue'
import FieldList from './FieldList.vue'

// `rows` is every row by entity, for a detail that lists related records.
defineProps({ row: Object, rows: Object })
const emit = defineEmits(['changed', 'created', 'open', 'close'])

const detailFor = {
  games: GameDetail,
  files: FileEditor,
  sessions: SessionDetail,
  recordings: RecordingDetail,
  scenarios: ScenarioDetail,
}
</script>

<template>
  <div class="cx-panel">
    <p v-if="!row" class="cx-muted">This record no longer exists.</p>
    <template v-else>
      <header class="cx-head">
        <Art v-if="row.fields.art" :value="row.fields.art" :size="44" />
        <div>
          <h2>{{ row.fields.name }}</h2>
          <div class="cx-kicker">{{ row.entityLabel }} · {{ row.fields.gameTitle }}</div>
        </div>
      </header>
      <component
        :is="detailFor[row.entityKey]"
        v-if="detailFor[row.entityKey]"
        :key="row.id"
        :record="row.record"
        :fields="row.fields"
        :rows="rows"
        @open="(r) => emit('open', r)"
        @changed="emit('changed')"
        @created="(id) => emit('created', id)"
        @close="emit('close')"
      />
      <FieldList v-else :record="row.record" />
    </template>
  </div>
</template>
