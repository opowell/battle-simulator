<script setup>
defineProps({
  show:       Boolean,
  serverErr:  { type: String, default: '' },
  gamesCount: { type: Number, default: 0 },
  showRuler:  Boolean,
});
defineEmits(['close', 'exit', 'open-settings', 'toggle-ruler']);
</script>

<template>
  <teleport to="body">
    <div v-if="show"
         style="position:fixed;inset:0;z-index:1002;background:rgba(4,7,10,.82);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)"
         @click.self="$emit('close')">
      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:340px;max-width:92vw;overflow:hidden;box-shadow:0 24px 64px -12px rgba(0,0,0,.85)">
        <div style="padding:16px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
          <span style="width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--accent);color:var(--accent);border-radius:5px;flex:none">
            <BsIcon name="crosshair" :size="14"/>
          </span>
          <span style="font-weight:700;letter-spacing:.12em;font-size:13px;flex:1">BATTLE&nbsp;SIMULATOR</span>
          <button @click="$emit('close')"
                  style="flex:none;width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>
        <div style="padding:16px 18px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:9px">
          <div class="statuschip"
               :style="serverErr ? {borderColor:'var(--danger)',color:'var(--danger)'} : {}">
            <span class="pulse"
                  :style="serverErr ? {background:'var(--danger)',animationPlayState:'paused'} : {}"/>
            {{ serverErr ? 'offline' : 'api · localhost:3000' }}
          </div>
          <span class="mono" style="font-size:11px;color:var(--faint)">{{gamesCount}} games</span>
        </div>
        <div style="padding:10px;display:flex;flex-direction:column;gap:4px">
          <button class="btn btn-ghost" style="justify-content:flex-start;gap:8px"
                  @click="$emit('close'); $emit('exit')">
            <BsIcon name="back" :size="14" color="var(--dim)"/> Back to Lobby
          </button>
          <button class="btn btn-ghost" style="justify-content:flex-start;gap:8px"
                  @click="$emit('toggle-ruler')">
            <BsIcon name="move" :size="14" :color="showRuler ? 'var(--accent)' : 'var(--dim)'"/>
            {{showRuler ? 'Hide ruler' : 'Show ruler'}}
          </button>
          <button class="btn btn-ghost" style="justify-content:flex-start;gap:8px"
                  @click="$emit('close'); $emit('open-settings')">
            <BsIcon name="sliders" :size="14" color="var(--dim)"/> Settings
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
