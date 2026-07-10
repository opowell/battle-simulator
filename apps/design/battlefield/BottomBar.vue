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
  <div class="bb">
    <template v-if="!isLive && field.turns > 1">
      <button class="iconbtn bb-icon" @click="$emit('step-back')">
        <BsIcon name="stepb" :size="15" color="var(--dim)"/>
      </button>
      <button class="btn btn-sm bb-play" @click="$emit('toggle-play')">
        <BsIcon :name="playing ? 'pause' : 'play'" :size="13" :color="playing ? 'var(--dim)' : 'var(--accent)'"/>
        {{playing ? 'Pause' : 'Play'}}
      </button>
      <button class="iconbtn bb-icon" @click="$emit('step-fwd')">
        <BsIcon name="step" :size="15" color="var(--dim)"/>
      </button>
      <input type="range" class="bb-range"
             :min="0" :max="field.turns - 1" step="0.05"
             :value="tFloat" @input="$emit('scrub', $event)"/>
      <span class="mono bb-tcount">
        T {{Math.floor(tFloat)}} / {{field.turns - 1}}
      </span>
    </template>
    <template v-else-if="isLive">
      <button class="iconbtn bb-icon" :disabled="histPos <= 0" @click="$emit('go-back')" title="Previous action">
        <BsIcon name="back" :size="15" color="var(--dim)"/>
      </button>
      <span class="mono bb-count" :class="{ 'bb-count--latest': atLatest }">
        {{histPos + 1}}/{{histLength}}
      </span>
      <button class="iconbtn bb-icon" :disabled="atLatest" @click="$emit('go-forward')" title="Next action">
        <BsIcon name="back" :size="15" color="var(--dim)" class="bb-flip"/>
      </button>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-meta">
        <b class="bb-meta-b">{{liveState.id.slice(0, 8)}}</b>
      </span>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-meta">
        Turn <b class="bb-meta-b">{{liveState.turn ?? 0}}</b>
      </span>
      <span class="mono bb-sep">·</span>
      <span class="mono bb-state"
            :class="isDone ? 'bb-state--done' : isPending ? 'bb-state--pending' : 'bb-state--ai'">
        {{isDone ? 'game over' : isPending ? ('your turn · ' + pendingPlayerId) : 'ai thinking…'}}
      </span>
      <button v-if="canReveal" class="btn btn-sm bb-reveal"
              :class="{ 'bb-reveal--on': revealAll }"
              @click="$emit('toggle-reveal')"
              :title="revealAll ? 'Hide hidden pieces' : 'Show true positions of all pieces'">
        <BsIcon name="eye" :size="13" :color="revealAll ? 'var(--accent)' : 'var(--dim)'"/>
        {{revealAll ? 'Revealed' : 'Reveal all'}}
      </button>
      <div class="bb-spacer"/>
    </template>
    <template v-else>
      <span class="mono bb-label">{{field.label}}</span>
      <div class="bb-spacer"/>
    </template>
    <BsIcon name="clock" :size="14" color="var(--faint)"/>
  </div>
</template>

<style scoped>
.bb { border-top: 1px solid var(--line); padding: 8px 14px; display: flex; align-items: center; gap: 10px; background: var(--bg1); }
.bb-icon { width: 30px; height: 30px; }
.bb-play { min-width: 62px; justify-content: center; gap: 5px; }
.bb-range { flex: 1; min-width: 0; }
.bb-tcount { font-size: 11px; color: var(--dim); white-space: nowrap; min-width: 72px; text-align: right; }
.bb-count { font-size: 11px; min-width: 36px; text-align: center; color: var(--accent); }
.bb-count--latest { color: var(--faint); }
.bb-flip { transform: scaleX(-1); }
.bb-sep { font-size: 11px; color: var(--faint); }
.bb-meta { font-size: 11px; color: var(--dim); }
.bb-meta-b { color: var(--txt); }
.bb-state { font-size: 11px; }
.bb-state--done { color: var(--faint); }
.bb-state--pending { color: var(--ok); }
.bb-state--ai { color: var(--warn); }
.bb-reveal { gap: 5px; }
.bb-reveal--on { border-color: var(--accent); color: var(--accent); }
.bb-spacer { flex: 1; }
.bb-label { font-size: 11px; color: var(--faint); }
</style>
