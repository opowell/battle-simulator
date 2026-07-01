<script setup>
defineProps({
  isLive:          Boolean,
  field:           Object,
  tFloat:          { type: Number, default: 0 },
  playing:         Boolean,
  histPos:         { type: Number, default: 0 },
  histLength:      { type: Number, default: 0 },
  atLatest:        Boolean,
  liveState:       Object,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  canReveal:       Boolean,
  revealAll:       Boolean,
});
defineEmits(['step-back', 'step-fwd', 'toggle-play', 'scrub', 'go-back', 'go-forward', 'toggle-reveal']);
</script>

<template>
  <div style="border-top:1px solid var(--line);padding:8px 14px;display:flex;align-items:center;gap:10px;background:var(--bg1)">
    <template v-if="!isLive && field.turns > 1">
      <button class="iconbtn" style="width:30px;height:30px" @click="$emit('step-back')">
        <BsIcon name="stepb" :size="15" color="var(--dim)"/>
      </button>
      <button class="btn btn-sm" style="min-width:62px;justify-content:center;gap:5px" @click="$emit('toggle-play')">
        <BsIcon :name="playing ? 'pause' : 'play'" :size="13" :color="playing ? 'var(--dim)' : 'var(--accent)'"/>
        {{playing ? 'Pause' : 'Play'}}
      </button>
      <button class="iconbtn" style="width:30px;height:30px" @click="$emit('step-fwd')">
        <BsIcon name="step" :size="15" color="var(--dim)"/>
      </button>
      <input type="range" style="flex:1;min-width:0"
             :min="0" :max="field.turns - 1" step="0.05"
             :value="tFloat" @input="$emit('scrub', $event)"/>
      <span class="mono" style="font-size:11px;color:var(--dim);white-space:nowrap;min-width:72px;text-align:right">
        T {{Math.floor(tFloat)}} / {{field.turns - 1}}
      </span>
    </template>
    <template v-else-if="isLive">
      <button class="iconbtn" style="width:30px;height:30px" :disabled="histPos <= 0" @click="$emit('go-back')" title="Previous action">
        <BsIcon name="back" :size="15" color="var(--dim)"/>
      </button>
      <span class="mono" style="font-size:11px;min-width:36px;text-align:center"
            :style="{color: atLatest ? 'var(--faint)' : 'var(--accent)'}">
        {{histPos + 1}}/{{histLength}}
      </span>
      <button class="iconbtn" style="width:30px;height:30px" :disabled="atLatest" @click="$emit('go-forward')" title="Next action">
        <BsIcon name="back" :size="15" color="var(--dim)" style="transform:scaleX(-1)"/>
      </button>
      <span class="mono" style="font-size:11px;color:var(--faint)">·</span>
      <span class="mono" style="font-size:11px;color:var(--dim)">
        <b style="color:var(--txt)">{{liveState.id.slice(0, 8)}}</b>
      </span>
      <span class="mono" style="font-size:11px;color:var(--faint)">·</span>
      <span class="mono" style="font-size:11px;color:var(--dim)">
        Turn <b style="color:var(--txt)">{{liveState.turn ?? 0}}</b>
      </span>
      <span class="mono" style="font-size:11px;color:var(--faint)">·</span>
      <span class="mono" style="font-size:11px"
            :style="{color: isDone ? 'var(--faint)' : isPending ? 'var(--ok)' : 'var(--warn)'}">
        {{isDone ? 'game over' : isPending ? ('your turn · ' + pendingPlayerId) : 'ai thinking…'}}
      </span>
      <button v-if="canReveal" class="btn btn-sm" style="gap:5px"
              :style="revealAll ? {borderColor:'var(--accent)',color:'var(--accent)'} : {}"
              @click="$emit('toggle-reveal')"
              :title="revealAll ? 'Hide hidden pieces' : 'Show true positions of all pieces'">
        <BsIcon name="eye" :size="13" :color="revealAll ? 'var(--accent)' : 'var(--dim)'"/>
        {{revealAll ? 'Revealed' : 'Reveal all'}}
      </button>
      <div style="flex:1"/>
    </template>
    <template v-else>
      <span class="mono" style="font-size:11px;color:var(--faint)">{{field.label}}</span>
      <div style="flex:1"/>
    </template>
    <BsIcon name="clock" :size="14" color="var(--faint)"/>
  </div>
</template>
