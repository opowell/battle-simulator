<script setup>
// Grid of selectable icons. v-model holds the chosen icon name.
defineProps({ modelValue: String, names: { type: Array, default: () => [] } });
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="iconpick">
    <div v-for="ic in names" :key="ic" class="iconopt" :class="{ on: modelValue === ic }" :title="ic"
         @click="$emit('update:modelValue', ic)">
      <BsIcon :name="ic" :size="18"/>
    </div>
  </div>
</template>
