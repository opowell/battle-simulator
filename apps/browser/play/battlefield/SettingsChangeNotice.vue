<script setup>
// Tells everyone in a game when its settings change mid-play — "Black changed
// Fog of War: off → on" — so nobody's game moves under them unannounced. Read off
// the session's `changes` (Session.reconfigure records one per change), named
// from the game's own option labels, so it is the same for every game.
import { ref, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  liveState: { type: Object, default: null },
  gameDef:   { type: Object, default: null },
});

const shown = ref([]);   // [{ key, lines }]
let seenFor = null;      // session id the count below belongs to
let seen = 0;            // changes already on screen or already there when we arrived
const timers = new Set();

const optionOf = (key) => (props.gameDef?.gameOptions ?? []).find(o => o.id === key);
const seatName = (id) => (props.liveState?.params?.players ?? []).find(p => p.id === id)?.name ?? id;
const agentName = (id) => (id === 'human' ? 'a human'
  : (props.gameDef?.agents ?? []).find(a => a.id === id)?.name ?? id);

function valueText(key, v) {
  const opt = optionOf(key);
  if (v === null || v === undefined || v === '') return key === 'maxTurns' ? 'no limit' : 'default';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  const choice = opt?.options?.find(o => o.value === v);
  return choice?.label ?? String(v);
}

function describe(change) {
  const who = change.by ? seatName(change.by) : 'Someone';
  const lines = [];
  for (const o of change.options ?? []) {
    if (o.key === 'seed') continue;   // pinned along with a new map, not chosen
    const label = optionOf(o.key)?.label ?? (o.key === 'maxTurns' ? 'Turn limit' : o.key);
    lines.push(`${label}: ${valueText(o.key, o.from)} → ${valueText(o.key, o.to)}`);
  }
  for (const s of change.seats ?? []) {
    lines.push(s.field === 'player'
      ? `${seatName(s.seat)} is now played by ${agentName(s.to)}`
      : `${s.from} is now called ${s.to}`);
  }
  if (change.unitsEdited) lines.push('Units on the board were changed');
  if (change.rebuilt && !change.unitsEdited) lines.push('The board was rebuilt under the new settings');
  return { title: `${who} changed the game's settings`, lines };
}

watch(() => [props.liveState?.id, props.liveState?.changes?.length ?? 0], ([id, count]) => {
  // Arriving at a game counts what it already had as seen: a notice is news.
  if (id !== seenFor) { seenFor = id; seen = count; shown.value = []; return; }
  if (count <= seen) { seen = count; return; }
  for (const change of props.liveState.changes.slice(seen)) {
    const key = change.at + ':' + Math.random();
    shown.value = [...shown.value, { key, ...describe(change) }];
    const t = setTimeout(() => { shown.value = shown.value.filter(n => n.key !== key); timers.delete(t); }, 8000);
    timers.add(t);
  }
  seen = count;
}, { immediate: true });

onBeforeUnmount(() => { for (const t of timers) clearTimeout(t); });
const dismiss = (key) => { shown.value = shown.value.filter(n => n.key !== key); };
</script>

<template>
  <PlayOverlay>
    <div v-if="shown.length" class="scn" aria-live="polite">
      <div v-for="n in shown" :key="n.key" class="scn-item" @click="dismiss(n.key)">
        <div class="scn-title"><BsIcon name="sliders" :size="13" color="var(--accent)"/> {{ n.title }}</div>
        <div v-for="(line, i) in n.lines" :key="i" class="scn-line">{{ line }}</div>
      </div>
    </div>
  </PlayOverlay>
</template>

<style scoped>
.scn{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:1300;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.scn-item{pointer-events:auto;cursor:pointer;min-width:280px;max-width:440px;padding:10px 14px;border:1px solid var(--accent-d);border-radius:var(--r);background:var(--bg2);box-shadow:0 10px 30px -10px rgba(0,0,0,.7)}
.scn-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600}
.scn-line{font-size:12px;color:var(--dim);margin-top:4px;font-family:var(--mono)}
</style>
