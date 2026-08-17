<script setup>
defineProps({
  isDone:      Boolean,
  dismissed:   Boolean,
  liveState:   Object,
  winnerTeam:  { type: Object, default: null },
  reasonLabel: { type: String, default: '' },
  field:       Object,
});
defineEmits(['dismiss', 'exit', 'new-game']);
</script>

<template>
  <teleport to="body">
    <div v-if="isDone && !dismissed" class="go-scrim" @click.self="$emit('dismiss')">
      <div class="go-panel">
        <div class="go-head">
          <div class="mono up go-kicker">
            <!-- A named winner is a victory whatever word the game's getResult used. -->
            {{ liveState.status === 'error' ? 'Error' : liveState.result?.winnerId != null ? 'Victory' : 'Battle Over' }}
          </div>
          <div v-if="liveState.status === 'error'" class="go-error">
            {{ liveState.error || 'Something went wrong' }}
          </div>
          <div v-else-if="winnerTeam" class="go-winner" :style="{color: winnerTeam.raw}">
            {{ winnerTeam.name }}
          </div>
          <div v-else class="go-draw">Draw</div>
          <div v-if="liveState.status !== 'error' && reasonLabel" class="mono go-reason">
            {{ reasonLabel }}
          </div>
        </div>
        <div v-if="liveState.summary" class="go-summary">
          <div class="mono up go-summary-title">
            Battle Summary · {{ liveState.summary.turns }} turns
          </div>
          <div class="go-teams">
            <div v-for="team in liveState.summary.teams" :key="team.id" class="go-team">
              <div class="go-team-head">
                <BsDot :color="field.teams.find(t => t.id === team.id)?.raw ?? 'var(--dim)'" :size="8"/>
                <span class="go-team-name">{{ team.name }}</span>
              </div>
              <template v-if="team.unitsTotal != null">
                <div class="go-stat-row go-stat-row--mb">
                  <span class="go-stat-label">Units lost</span>
                  <span class="mono go-stat-val" :class="team.unitsLost > 0 ? 'go-stat-val--bad' : 'go-stat-val--ok'">
                    {{ team.unitsLost }} / {{ team.unitsTotal }}
                  </span>
                </div>
                <div class="go-stat-row">
                  <span class="go-stat-label">Damage dealt</span>
                  <span class="mono go-stat-val go-stat-val--accent">{{ team.damageDealt }}</span>
                </div>
              </template>
              <template v-else-if="team.piecesLost != null">
                <div class="go-stat-row go-stat-row--mb">
                  <span class="go-stat-label">Pieces lost</span>
                  <span class="mono go-stat-val" :class="team.piecesLost > 0 ? 'go-stat-val--bad' : 'go-stat-val--ok'">
                    {{ team.piecesLost }}
                  </span>
                </div>
                <div class="go-stat-row">
                  <span class="go-stat-label">Remaining</span>
                  <span class="mono go-stat-val go-stat-val--ok">{{ team.piecesRemaining }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div class="go-actions">
          <button class="btn btn-ghost btn-sm" @click="$emit('dismiss')">Dismiss</button>
          <button class="btn btn-ghost btn-sm" @click="$emit('exit')">Back to Lobby</button>
          <button class="btn btn-sm" @click="$emit('new-game')">Start new game</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.go-scrim { position: fixed; inset: 0; z-index: 999; background: rgba(4,7,10,.82); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
.go-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 480px; max-width: 92vw; overflow: hidden; box-shadow: 0 24px 64px -12px rgba(0,0,0,.85); }
.go-head { padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid var(--line); }
.go-kicker { font-size: 10px; letter-spacing: .12em; color: var(--faint); margin-bottom: 10px; }
.go-error { font-size: 16px; font-weight: 700; letter-spacing: -.01em; color: #ff5f56; }
.go-winner { font-size: 36px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 4px; }
.go-draw { font-size: 28px; font-weight: 700; letter-spacing: -.01em; color: var(--dim); }
.go-reason { font-size: 11px; color: var(--faint); margin-top: 10px; }
.go-summary { padding: 20px 28px; border-bottom: 1px solid var(--line); }
.go-summary-title { font-size: 9px; letter-spacing: .1em; color: var(--faint); margin-bottom: 14px; }
.go-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.go-team { border: 1px solid var(--line); border-radius: var(--r); padding: 12px 14px; }
.go-team-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.go-team-name { font-size: 12px; font-weight: 700; }
.go-stat-row { display: flex; justify-content: space-between; }
.go-stat-row--mb { margin-bottom: 5px; }
.go-stat-label { font-size: 11px; color: var(--dim); }
.go-stat-val { font-size: 12px; font-weight: 600; }
.go-stat-val--bad { color: #ff5f56; }
.go-stat-val--ok { color: var(--ok); }
.go-stat-val--accent { color: var(--accent); }
.go-actions { padding: 16px 28px; display: flex; justify-content: flex-end; gap: 10px; }
</style>
