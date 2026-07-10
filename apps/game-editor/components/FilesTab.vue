<script setup>
// Files tab: file list on the left, a plain code editor on the right.
import { nextTick } from 'vue';

const props = defineProps({
  files: { type: Array, default: () => [] },
  filePath: String,
  content: { type: String, default: '' },
  dirty: Boolean,
  saving: Boolean,
});
const emit = defineEmits(['open', 'save', 'update:content']);

// Insert two spaces on Tab instead of moving focus, keeping the caret in place.
function insertTab(e) {
  const el = e.target, s = el.selectionStart, en = el.selectionEnd;
  emit('update:content', props.content.slice(0, s) + '  ' + props.content.slice(en));
  nextTick(() => { el.selectionStart = el.selectionEnd = s + 2; });
}
</script>

<template>
  <div class="panel-b files-tab">
    <div class="files-side">
      <div class="filelist">
        <div v-for="f in files" :key="f.path" class="filerow" :class="{ on: filePath === f.path }" @click="$emit('open', f.path)">
          <span>{{ f.path }}</span><span class="sz">{{ (f.size / 1024).toFixed(1) }}k</span>
        </div>
      </div>
    </div>
    <div class="files-main">
      <template v-if="filePath">
        <div class="files-bar">
          <span class="mono txt-sm">{{ filePath }}</span>
          <span v-if="dirty" class="badge badge-warn">unsaved</span>
          <div class="spacer"></div>
          <button class="btn btn-sm btn-primary" :disabled="!dirty || saving" @click="$emit('save')">
            <BsIcon name="check" :size="13"/> Save file
          </button>
        </div>
        <textarea class="code" :value="content" @input="$emit('update:content', $event.target.value)"
                  spellcheck="false" @keydown.tab.prevent="insertTab"></textarea>
      </template>
      <div v-else class="empty">Select a file to edit.</div>
    </div>
  </div>
</template>
