<script setup>
import { ref } from 'vue';
import GameCard from './GameCard.vue';
import GameDetailModal from './GameDetailModal.vue';
import GameConfigureModal from './GameConfigureModal.vue';

const props = defineProps({
  sessions:  { type: Array,  default: () => [] },
  apiGames:  { type: Array,  default: () => [] },
  serverErr: { type: String, default: '' },
});

const emit = defineEmits(['open-session', 'create', 'delete-session', 'refresh']);

// Clicking a card opens the gallery/info modal; its "Start…" button hands off
// to the configure modal, its "Quick start" button fires 'create' immediately.
const detailGame    = ref(null);
const configureGame = ref(null);

function openDetail(g)   { detailGame.value = g; }
function closeDetail()    { detailGame.value = null; }
function openConfigure(g) { configureGame.value = g; detailGame.value = null; }
function closeConfigure() { configureGame.value = null; }

function quickStart(g) {
  const sc = g.scenarios?.[0];
  const ov = gameDefaults.scenarioOverrides(sc);
  emit('create', {
    game:     g.name,
    name:     g.name,
    gameOpts: { ...gameDefaults.initGameOpts(g), ...(ov.fogOfWar != null ? { fogOfWar: ov.fogOfWar } : {}) },
    maxTurns: ov.maxTurns ?? 300,
    scenario: sc?.id,
    players:  gameDefaults.makeSlots(g),
  });
  detailGame.value = null;
}

function handleCreate(payload) {
  emit('create', payload);
  configureGame.value = null;
}

function sessionStatusLabel(s) {
  if (s.status === 'done')   return 'Finished';
  if (s.status === 'error')  return 'Error';
  if (s.pendingPlayer)       return 'Your turn';
  return 'Active';
}

function sessionStatusColor(s) {
  if (s.status === 'done' || s.status === 'error') return 'var(--faint)';
  if (s.pendingPlayer) return 'var(--ok)';
  return 'var(--warn)';
}
</script>

<template>
  <div class="lobby">

    <!-- ── Left: New Session ── -->
    <div class="panel" style="min-height:0">
      <div class="panel-h">
        <span class="panel-t">New Session</span>
      </div>
      <div class="panel-b">
        <div v-if="serverErr"
             style="padding:10px 12px;border:1px solid var(--danger);border-radius:var(--r);background:rgba(255,95,86,.07);font-size:12px;color:var(--danger);margin-bottom:12px">
          ⚠ {{serverErr}}
        </div>
        <div class="gamegrid">
          <GameCard v-for="g in apiGames" :key="g.name"
                    :game="g"
                    @click="openDetail(g)"/>
        </div>
      </div>
    </div>

    <!-- ── Right: Active Sessions ── -->
    <div class="panel" style="min-height:0">
      <div class="panel-h">
        <span class="panel-t">Active Sessions</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font-size:11px;color:var(--dim)">{{sessions.length}} live</span>
          <button class="btn btn-sm btn-ghost" style="padding:3px 8px" @click="$emit('refresh')" title="Refresh">
            <BsIcon name="clock" :size="12" color="var(--dim)"/>
          </button>
        </div>
      </div>
      <div class="panel-b">

        <!-- Server error -->
        <div v-if="serverErr"
             style="padding:10px 12px;border:1px solid var(--danger);border-radius:var(--r);background:rgba(255,95,86,.07);font-size:12px;color:var(--danger);margin-bottom:12px">
          ⚠ {{serverErr}}
        </div>

        <!-- Empty state -->
        <div v-if="!sessions.length && !serverErr"
             style="padding:20px 0;color:var(--faint);font-size:12px;text-align:center">
          No active sessions — create one →
        </div>

        <!-- Session rows -->
        <div v-for="s in sessions" :key="s.id" class="sessionrow">
          <div class="gicon">
            <BsIcon :name="(apiGames.find(g => g.name === s.game) || {}).icon || 'grid'" :size="20" color="var(--accent)"/>
          </div>
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:9px;min-width:0">
              <b style="font-weight:600;white-space:nowrap;flex:none">
                {{s.game}}
              </b>
              <span class="mono" style="font-size:10px;color:var(--faint);flex:none">
                #{{s.id.slice(0, 8)}}
              </span>
              <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;flex:none"
                    :style="{color: sessionStatusColor(s)}">
                <BsDot :color="sessionStatusColor(s)" :size="7"/>
                {{sessionStatusLabel(s)}}
              </span>
            </div>
            <div style="margin-top:5px;display:flex;gap:10px">
              <span class="mono" style="font-size:10px;color:var(--faint)">turn {{s.turn ?? 0}}</span>
              <span v-if="s.pendingPlayer"
                    class="mono" style="font-size:10px;color:var(--dim)">
                · waiting: {{s.pendingPlayer}}
              </span>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-sm btn-ghost" style="padding:4px 7px;opacity:.5"
                    title="Delete session"
                    @click.stop="$emit('delete-session', s.id)">✕</button>
            <button class="btn btn-sm" @click="$emit('open-session', s)"
                    :style="s.pendingPlayer ? {borderColor:'var(--accent)',color:'var(--accent)'} : {}">
              {{s.status === 'done' ? 'Review' : 'Resume'}}
            </button>
          </div>
        </div>
      </div>
    </div>

    <GameDetailModal :game="detailGame"
                      @close="closeDetail"
                      @quick-start="quickStart"
                      @configure="openConfigure"/>
    <GameConfigureModal :game="configureGame" :disabled="!!serverErr"
                         @close="closeConfigure"
                         @create="handleCreate"/>
  </div>
</template>
