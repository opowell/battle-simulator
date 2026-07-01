<script setup>
defineProps({
  isDone:      Boolean,
  dismissed:   Boolean,
  liveState:   Object,
  winnerTeam:  { type: Object, default: null },
  reasonLabel: { type: String, default: '' },
  field:       Object,
});
defineEmits(['dismiss', 'exit']);
</script>

<template>
  <teleport to="body">
    <div v-if="isDone && !dismissed"
         style="position:fixed;inset:0;z-index:999;background:rgba(4,7,10,.82);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)"
         @click.self="$emit('dismiss')">
      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:480px;max-width:92vw;overflow:hidden;box-shadow:0 24px 64px -12px rgba(0,0,0,.85)">
        <div style="padding:32px 28px 20px;text-align:center;border-bottom:1px solid var(--line)">
          <div class="mono up" style="font-size:10px;letter-spacing:.12em;color:var(--faint);margin-bottom:10px">
            {{ liveState.result?.outcome === 'win' ? 'Victory' : 'Battle Over' }}
          </div>
          <div v-if="winnerTeam"
               style="font-size:36px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px"
               :style="{color: winnerTeam.raw}">
            {{ winnerTeam.name }}
          </div>
          <div v-else style="font-size:28px;font-weight:700;letter-spacing:-.01em;color:var(--dim)">Draw</div>
          <div v-if="reasonLabel" class="mono" style="font-size:11px;color:var(--faint);margin-top:10px">
            {{ reasonLabel }}
          </div>
        </div>
        <div v-if="liveState.summary" style="padding:20px 28px;border-bottom:1px solid var(--line)">
          <div class="mono up" style="font-size:9px;letter-spacing:.1em;color:var(--faint);margin-bottom:14px">
            Battle Summary · {{ liveState.summary.turns }} turns
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div v-for="team in liveState.summary.teams" :key="team.id"
                 style="border:1px solid var(--line);border-radius:var(--r);padding:12px 14px">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
                <BsDot :color="field.teams.find(t => t.id === team.id)?.raw ?? 'var(--dim)'" :size="8"/>
                <span style="font-size:12px;font-weight:700">{{ team.name }}</span>
              </div>
              <template v-if="team.unitsTotal != null">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                  <span style="font-size:11px;color:var(--dim)">Units lost</span>
                  <span class="mono" style="font-size:12px;font-weight:600"
                        :style="{color: team.unitsLost > 0 ? '#ff5f56' : 'var(--ok)'}">
                    {{ team.unitsLost }} / {{ team.unitsTotal }}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="font-size:11px;color:var(--dim)">Damage dealt</span>
                  <span class="mono" style="font-size:12px;font-weight:600;color:var(--accent)">{{ team.damageDealt }}</span>
                </div>
              </template>
              <template v-else-if="team.piecesLost != null">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                  <span style="font-size:11px;color:var(--dim)">Pieces lost</span>
                  <span class="mono" style="font-size:12px;font-weight:600"
                        :style="{color: team.piecesLost > 0 ? '#ff5f56' : 'var(--ok)'}">
                    {{ team.piecesLost }}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="font-size:11px;color:var(--dim)">Remaining</span>
                  <span class="mono" style="font-size:12px;font-weight:600;color:var(--ok)">{{ team.piecesRemaining }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div style="padding:16px 28px;display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-ghost btn-sm" @click="$emit('dismiss')">Dismiss</button>
          <button class="btn btn-sm" @click="$emit('exit')">Back to Lobby</button>
        </div>
      </div>
    </div>
  </teleport>
</template>
