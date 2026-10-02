<script setup>
// A destructive action that asks twice, in place: the first press arms it and
// says what will happen, the second does it. Leaving it alone disarms it.
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps({ label: String, confirm: String, busy: Boolean })
const emit = defineEmits(['confirm'])

const armed = ref(false)
let timer = null
function press() {
  if (armed.value) { clearTimeout(timer); armed.value = false; emit('confirm'); return }
  armed.value = true
  timer = setTimeout(() => { armed.value = false }, 4000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="cx-btn cx-btn--danger" :disabled="busy" @click="press">
    {{ armed ? props.confirm : props.label }}
  </button>
</template>
