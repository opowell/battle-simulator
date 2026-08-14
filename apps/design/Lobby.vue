<script setup>
import { ref } from 'vue';
import GameCard from './GameCard.vue';
import GameThumb from './GameThumb.vue';
import GameStartModal from './GameStartModal.vue';

const props = defineProps({
  sessions:  { type: Array,  default: () => [] },
  apiGames:  { type: Array,  default: () => [] },
  serverErr: { type: String, default: '' },
});

const emit = defineEmits(['open-session', 'create', 'delete-session', 'refresh']);

// Clicking a card opens one modal: what the game is, and how to set the session
// up. Its buttons both start a session from the form as it stands — untouched,
// that form is the game's own defaults, which is the old one-click quick start.
const startGame = ref(null);

function openStart(g)  { startGame.value = g; }
function closeStart()  { startGame.value = null; }

function handleCreate(payload) {
  emit('create', payload);
  startGame.value = null;
}

// An ANALYSIS BOARD: a study session with no opponent. Every seat is human (the
// one person at the keyboard moves both sides), which is the condition the
// server puts on the flag, and which is what lets the whole board be revealed
// and the game database stay open while the session is still being played.
//
// Fog goes ON for a game that has one to offer: an analysis board with the fog
// lifted is just a board, and the database's whole question — what did players
// who could see what you can see go on to play — needs the fog to mean anything.
// Everything else — scenario, options, turn limit — is taken from the form.
function analysisBoard(payload) {
  if (!payload) return;
  const g = startGame.value;
  const fogged = (g.gameOptions ?? []).some(o => o.id === 'fogOfWar');
  emit('create', {
    ...payload,
    // …including the session name, if one was typed (the form leaves it as the
    // bare game name when it wasn't).
    name:     payload.name === g.name ? `${g.name} — analysis` : payload.name,
    gameOpts: { ...payload.gameOpts, analysisBoard: true, ...(fogged ? { fogOfWar: true } : {}) },
    players:  payload.players.map(p => ({ ...p, agent: 'human' })),
  });
  startGame.value = null;
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
    <div class="panel lobby-panel">
      <div class="panel-h">
        <span class="panel-t">New Session</span>
      </div>
      <div class="panel-b">
        <div v-if="serverErr" class="lobby-err">
          ⚠ {{serverErr}}
        </div>
        <div class="gamegrid">
          <GameCard v-for="g in apiGames" :key="g.name"
                    :game="g"
                    @click="openStart(g)"/>
        </div>
      </div>
    </div>

    <!-- ── Right: Active Sessions ── -->
    <div class="panel lobby-panel">
      <div class="panel-h">
        <span class="panel-t">Active Sessions</span>
        <div class="lobby-live">
          <span class="mono lobby-live-count">{{sessions.length}} live</span>
          <button class="btn btn-sm btn-ghost lobby-refresh" @click="$emit('refresh')" title="Refresh">
            <BsIcon name="clock" :size="12" color="var(--dim)"/>
          </button>
        </div>
      </div>
      <div class="panel-b">

        <!-- Server error -->
        <div v-if="serverErr" class="lobby-err">
          ⚠ {{serverErr}}
        </div>

        <!-- Empty state -->
        <div v-if="!sessions.length && !serverErr" class="lobby-empty">
          No active sessions — create one →
        </div>

        <!-- Session rows -->
        <div v-for="s in sessions" :key="s.id" class="sessionrow">
          <div class="gicon">
            <GameThumb :name="s.game" :size="26"/>
          </div>
          <div class="lobby-row-main">
            <div class="lobby-row-top">
              <b class="lobby-game">
                {{s.game}}
              </b>
              <span class="mono lobby-id">
                #{{s.id.slice(0, 8)}}
              </span>
              <span class="lobby-status" :style="{color: sessionStatusColor(s)}">
                <BsDot :color="sessionStatusColor(s)" :size="7"/>
                {{sessionStatusLabel(s)}}
              </span>
            </div>
            <div class="lobby-row-sub">
              <span class="mono lobby-turn">turn {{s.turn ?? 0}}</span>
              <span v-if="s.pendingPlayer" class="mono lobby-waiting">
                · waiting: {{s.pendingPlayer}}
              </span>
            </div>
          </div>
          <div class="lobby-row-actions">
            <button class="btn btn-sm btn-ghost lobby-del"
                    title="Delete session"
                    @click.stop="$emit('delete-session', s.id)">✕</button>
            <button class="btn btn-sm lobby-resume" @click="$emit('open-session', s)"
                    :class="{ 'lobby-resume--pending': s.pendingPlayer }">
              {{s.status === 'done' ? 'Review' : 'Resume'}}
            </button>
          </div>
        </div>
      </div>
    </div>

    <GameStartModal :game="startGame" :disabled="!!serverErr"
                    @close="closeStart"
                    @create="handleCreate"
                    @analysis-board="analysisBoard"/>
  </div>
</template>

<style scoped>
.lobby-panel { min-height: 0; }
.lobby-err { padding: 10px 12px; border: 1px solid var(--danger); border-radius: var(--r); background: rgba(255,95,86,.07); font-size: 12px; color: var(--danger); margin-bottom: 12px; }
.lobby-live { display: flex; align-items: center; gap: 8px; }
.lobby-live-count { font-size: 11px; color: var(--dim); }
.lobby-refresh { padding: 3px 8px; }
.lobby-empty { padding: 20px 0; color: var(--faint); font-size: 12px; text-align: center; }
.lobby-row-main { min-width: 0; }
.lobby-row-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
.lobby-game { font-weight: 600; white-space: nowrap; flex: none; }
.lobby-id { font-size: 10px; color: var(--faint); flex: none; }
.lobby-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; flex: none; }
.lobby-row-sub { margin-top: 5px; display: flex; gap: 10px; }
.lobby-turn { font-size: 10px; color: var(--faint); }
.lobby-waiting { font-size: 10px; color: var(--dim); }
.lobby-row-actions { display: flex; gap: 6px; align-items: center; }
.lobby-del { padding: 4px 7px; opacity: .5; }
.lobby-resume--pending { border-color: var(--accent); color: var(--accent); }
</style>
