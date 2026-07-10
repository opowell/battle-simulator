<script setup>
// Right-panel header: game icon + name, Metadata/Files tabs, Delete button.
defineProps({ name: String, icon: String, tab: String, filesCount: { type: Number, default: 0 } });
defineEmits(['update:tab', 'delete']);
</script>

<template>
  <div class="panel-h">
    <div class="detail-head-l">
      <span class="gicon gicon-sm"><BsIcon :name="icon" :size="17"/></span>
      <span class="panel-t detail-title">{{ name }}</span>
      <div class="tabs">
        <button :class="{ on: tab === 'meta' }" @click="$emit('update:tab', 'meta')">Metadata</button>
        <button :class="{ on: tab === 'files' }" @click="$emit('update:tab', 'files')">Files <span class="muted">({{ filesCount }})</span></button>
      </div>
    </div>
    <button class="btn btn-sm btn-danger" @click="$emit('delete')"><BsIcon name="trash" :size="13"/> Delete</button>
  </div>
</template>
