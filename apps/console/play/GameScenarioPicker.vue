<script setup>
defineProps({
  scenarios: { type: Array,  default: () => [] },
  modelValue: { type: String, default: '' },
});
defineEmits(['update:modelValue']);
</script>

<template>
  <div v-if="scenarios.length" class="gsp">
    <div class="gsp-label">Scenario</div>
    <button v-for="sc in scenarios" :key="sc.id"
            class="scenrow" :class="{sel: sc.id === modelValue}"
            @click="$emit('update:modelValue', sc.id)">
      <div class="scenmark">
        <BsIcon name="flag" :size="14"/>
      </div>
      <div class="gsp-text">
        <div class="gsp-name">{{sc.name}}</div>
        <div class="gsp-desc">{{sc.description}}</div>
      </div>
    </button>
  </div>
</template>

<style scoped>
.gsp{padding:0 18px 18px}
.gsp-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.gsp-text{min-width:0;text-align:left}
.gsp-name{font-weight:600;font-size:13px}
.gsp-desc{font-size:11px;color:var(--dim);margin-top:2px}
</style>
