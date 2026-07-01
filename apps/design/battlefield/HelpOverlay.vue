<script setup>
defineProps({
  show: Boolean,
  ui:   Object,
  game: String,
});
defineEmits(['close']);
</script>

<template>
  <teleport to="body">
    <div v-if="show && ui.help"
         style="position:fixed;inset:0;z-index:1003;background:rgba(4,7,10,.82);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)"
         @click.self="$emit('close')">
      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:480px;max-width:92vw;max-height:86vh;overflow-y:auto;box-shadow:0 24px 64px -12px rgba(0,0,0,.85)">
        <div style="padding:16px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg1);z-index:1">
          <BsIcon name="crosshair" :size="15" color="var(--accent)"/>
          <span style="font-weight:700;font-size:15px;letter-spacing:.01em;flex:1">{{ui.help.title ?? game}}</span>
          <span class="mono up" style="font-size:9px;padding:2px 7px;border-radius:3px;background:rgba(66,198,230,.1);color:var(--accent)">How to Play</span>
          <button @click="$emit('close')"
                  style="flex:none;width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:16px">
          <div v-for="(section, i) in ui.help.sections" :key="i">
            <div style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:6px">
              {{section.heading}}
            </div>
            <div style="font-size:13px;color:var(--txt);line-height:1.65">{{section.text}}</div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>
