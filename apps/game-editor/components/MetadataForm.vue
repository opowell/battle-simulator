<script setup>
// Metadata tab: player counts, default players, save/revert.
// Binds directly to the parent's reactive `form` object.
import PlayersEditor from './PlayersEditor.vue';
defineProps({ form: Object, dirty: Boolean, saving: Boolean });
defineEmits(['save', 'revert']);
</script>

<template>
  <div class="panel-b meta-tab">
    <div class="row2">
      <div class="field">
        <label>Min players</label>
        <input type="number" min="2" v-model.number="form.minPlayers"/>
      </div>
      <div class="field">
        <label>Max players</label>
        <input type="number" :min="form.minPlayers" v-model.number="form.maxPlayers"/>
      </div>
    </div>

    <div class="field mt16">
      <label>Default players ({{ form.defaultPlayers.length }})</label>
      <PlayersEditor :players="form.defaultPlayers"/>
    </div>

    <div class="form-actions">
      <button class="btn btn-primary" :disabled="!dirty || saving" @click="$emit('save')">
        <BsIcon name="check" :size="14"/> Save metadata
      </button>
      <button class="btn btn-ghost" :disabled="!dirty" @click="$emit('revert')">Revert</button>
    </div>
  </div>
</template>
