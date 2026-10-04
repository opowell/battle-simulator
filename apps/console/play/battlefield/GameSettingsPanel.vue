<script setup>
// Every setting of the game being played, changeable while it is played: the
// game's own options and the engine's, who plays each seat, and the units on the
// board. The same form the setup page uses (GameSetupFields), opened on the
// session's settings as they are now; only what was changed is sent, and the
// server works out how each change lands (POST /sessions/:id/reconfigure).
// A panel (see PanelDesk): `close` asks the host to close it once applied.
import { ref, computed } from 'vue';
import GameSetupFields from '../GameSetupFields.vue';

const props = defineProps({
  liveState: { type: Object, default: null },
  // The game's definition as GET /games serves it: options, agents, seat limits.
  gameDef:   { type: Object, default: null },
});
const emit = defineEmits(['close']);

// Taken when the panel opens and held while it is open: the game moves on
// underneath, and a form re-seeding itself mid-edit would lose the edit.
const initial = ref(null);
const liveSession = ref(null);
const form = ref(null);
const busy = ref(false);
const error = ref('');

if (props.liveState) {
  const { startingUnits, ...config } = props.liveState.params?.config ?? {};
  initial.value = {
    gameOpts: config,
    players: (props.liveState.params?.players ?? []).map(p => ({ id: p.id, name: p.name ?? p.id, agent: p.agent ?? 'human' })),
    maxTurns: config.maxTurns ?? null,
  };
  liveSession.value = { id: props.liveState.id, by: props.liveState.viewerId ?? null };
}

const body = computed(() => {
  const f = form.value;
  if (!f || !initial.value) return null;
  const config = { ...f.changed };
  if ((f.maxTurns ?? null) !== (initial.value.maxTurns ?? null)) config.maxTurns = f.maxTurns ?? null;
  const players = (f.seats ?? []).flatMap((s) => {
    const was = initial.value.players.find(p => p.id === s.id);
    if (!was) return [];
    const patch = {};
    if (s.name !== was.name) patch.name = s.name;
    if (s.agent !== was.agent) patch.agent = s.agent;
    return Object.keys(patch).length ? [{ id: s.id, ...patch }] : [];
  });
  return {
    ...(Object.keys(config).length ? { config } : {}),
    ...(players.length ? { players } : {}),
    ...(f.units ? { units: f.units } : {}),
    by: liveSession.value?.by ?? null,
  };
});

const changeCount = computed(() => {
  const b = body.value;
  if (!b) return 0;
  return Object.keys(b.config ?? {}).length + (b.players ?? []).length + (b.units ? 1 : 0);
});

async function apply() {
  if (!changeCount.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    await window.api.reconfigure(props.liveState.id, body.value);
    emit('close');
  } catch (e) {
    error.value = e.message;
  } finally { busy.value = false; }
}
</script>

<template>
  <div v-if="gameDef && initial" class="gso">
    <div class="gso-sub">Changes apply to the game in progress, and everyone in it is told what changed.</div>
    <div class="gso-body">
      <GameSetupFields :game="gameDef" :initial="initial" :live-session="liveSession"
                       @update:config="form = $event"/>
    </div>
    <div class="gso-foot">
      <span v-if="error" class="gso-err">{{ error }}</span>
      <span v-else class="gso-count">{{ changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Nothing changed yet' }}</span>
      <button class="btn btn-ghost btn-sm" @click="emit('close')">Cancel</button>
      <button class="btn btn-primary btn-sm" :disabled="!changeCount || busy" @click="apply">
        {{ busy ? 'Applying…' : 'Apply to this game' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.gso{height:100%;display:flex;flex-direction:column;min-height:0}
.gso-sub{font-size:11px;color:var(--dim);padding:10px 16px;border-bottom:1px solid var(--line)}
.gso-body{padding:14px 16px;overflow:auto;min-height:0;flex:1}
.gso-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--line)}
.gso-count{flex:1;font-size:11px;color:var(--dim)}
.gso-err{flex:1;font-size:11px;color:var(--danger)}
</style>
