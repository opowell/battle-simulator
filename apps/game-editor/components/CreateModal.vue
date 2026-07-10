<script setup>
// New-game modal. Binds to the parent's reactive `draft` object.
import { computed } from 'vue';
import IconPicker from './IconPicker.vue';
import PlayersEditor from './PlayersEditor.vue';

const props = defineProps({ draft: Object, names: Array, saving: Boolean });
defineEmits(['create', 'cancel']);

const classPreview = computed(() => {
  const n = (props.draft.name || '').split(/[^a-z0-9]+/i).filter(Boolean)
    .map(w => (w[0] ? w[0].toUpperCase() + w.slice(1) : '')).join('');
  return n ? n + 'Game' : '…Game';
});
function onName(e) { props.draft.name = e.target.value.toLowerCase(); }
</script>

<template>
  <div class="modal-scrim" @click.self="$emit('cancel')">
    <div class="modal-panel">
      <div class="panel-h"><span class="panel-t">New game</span></div>
      <div class="panel-b">
        <div class="field">
          <label>Name (lowercase id, e.g. "mygame")</label>
          <input :value="draft.name" @input="onName" placeholder="mygame"/>
          <span class="muted mono hint">Class: {{ classPreview }} · dir: games/{{ draft.name || '…' }}/</span>
        </div>

        <div class="row2 mt14">
          <div class="field"><label>Min players</label><input type="number" min="2" v-model.number="draft.minPlayers"/></div>
          <div class="field"><label>Max players</label><input type="number" :min="draft.minPlayers" v-model.number="draft.maxPlayers"/></div>
        </div>

        <div class="field mt14">
          <label>Icon</label>
          <IconPicker v-model="draft.icon" :names="names"/>
        </div>

        <div class="field mt14">
          <label>Default players</label>
          <PlayersEditor :players="draft.defaultPlayers"/>
        </div>

        <div class="form-actions right">
          <button class="btn btn-ghost" @click="$emit('cancel')">Cancel</button>
          <button class="btn btn-primary" :disabled="saving" @click="$emit('create')">
            <BsIcon name="plus" :size="14"/> Create + scaffold
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
