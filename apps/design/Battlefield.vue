<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer from './SchematicLayer.vue';
import AssetLayer     from './AssetLayer.vue';

const props = defineProps({
  liveState: Object,  // raw API session JSON
  field:     Object,
  theme:     String,
  fog:       { type: Boolean, default: false },
});
const emit = defineEmits(['exit', 'submit-action']);

// ── playback ─────────────────────────────────────────────────
const tFloat   = ref(0);
const playing  = ref(false);

// ── view toggles ─────────────────────────────────────────────
const renderer  = ref('schematic');
const showRuler = ref(false);

// ── selection ─────────────────────────────────────────────────
const selectedId = ref(null);

// ── stage sizing ──────────────────────────────────────────────
const stageEl = ref(null);
const stageW  = ref(900);
const stageH  = ref(600);

function updateStageSize() {
  if (stageEl.value) {
    stageW.value = stageEl.value.clientWidth;
    stageH.value = stageEl.value.clientHeight;
  }
}

// ── renderer palette ──────────────────────────────────────────
const rdr = computed(() => RDR[props.theme] || RDR.military);

// ── game UI flags (provided by the game definition, generic) ──
const ui = computed(() => props.field.ui ?? {});

// ── world → screen transform ──────────────────────────────────
const fit = computed(() => makeFitter(props.field.world, { w: stageW.value, h: stageH.value }, 24));

// ── live units at current time ─────────────────────────────────
const units = computed(() => computeUnits(props.field, tFloat.value));

// ── live session helpers ───────────────────────────────────────
const isLive          = computed(() => !!props.liveState);
const isPending       = computed(() => isLive.value && props.liveState.pendingPlayer &&
                                       props.liveState.humanPlayers?.includes(props.liveState.pendingPlayer));
const isDone          = computed(() => isLive.value && props.liveState.status !== 'active');
const legalActions    = computed(() => props.liveState?.legalActions ?? []);
const pendingPlayerId = computed(() => props.liveState?.pendingPlayer ?? null);

// ── move highlights ────────────────────────────────────────────
const displayUnits = units;

// Actions carry gridTo/gridFrom when the game populates them; otherwise fall back to {x,y}.
function actionGridCoord(action, field) {
  if (field === 'to')   return action.gridTo   ?? (action.to?.x   != null ? [action.to.x,   action.to.y]   : null);
  if (field === 'from') return action.gridFrom ?? (action.from?.x != null ? [action.from.x, action.from.y] : null);
  return null;
}

const unitMoves = computed(() => {
  if (!isPending.value || !selectedId.value) return [];
  return legalActions.value
    .filter(a => a.unitId === selectedId.value)
    .map(a => actionGridCoord(a, 'to'))
    .filter(Boolean);
});

// freeSelection: any unit can move; no pre-determined active unit (e.g. chess).
const activeUnitId = computed(() => {
  if (!isPending.value) return null;
  if (ui.value.freeSelection) return null;
  return legalActions.value.find(a => a.unitId)?.unitId ?? null;
});

watch(activeUnitId, (id) => {
  if (id) selectedId.value = id;
}, { immediate: true });

function handleSqClick(col, row) {
  if (isPending.value && selectedId.value) {
    const action = legalActions.value.find(a => {
      if (a.unitId !== selectedId.value) return false;
      const coords = actionGridCoord(a, 'to');
      return coords && coords[0] === col && coords[1] === row;
    });
    if (action) { submitAction(action); return; }
  }
  selectedId.value = null;
}

// ── selected unit ──────────────────────────────────────────────
const selectedUnit = computed(() => displayUnits.value.find(u => u.id === selectedId.value) || null);

// ── roster groups ──────────────────────────────────────────────
const rosterTeams = computed(() =>
  props.field.teams.map(t => ({
    ...t,
    units: displayUnits.value.filter(u => u.team === t.id),
  }))
);


const displayedActions = computed(() => {
  if (ui.value.freeSelection) {
    // Free-selection games: show only non-move actions for the selected unit (moves are shown as highlights).
    return legalActions.value.filter(a => a.unitId === selectedId.value && !actionGridCoord(a, 'to'));
  }
  if (unitMoves.value.length > 0)
    return legalActions.value.filter(a => a.type !== 'move');
  return legalActions.value;
});

function fmtAction(action) {
  const t = action.type ?? '';
  if (t === 'move') {
    if (typeof action.from === 'string' && typeof action.to === 'string')
      return action.from + ' → ' + action.to;
    if (action.to && typeof action.to === 'object')
      return `Move → (${action.to.x},${action.to.y})`;
    if (action.unitId) return `Move ${action.unitId}`;
  }
  if (t === 'castle')    return action.side === 'kingside' ? 'O-O' : 'O-O-O';
  if (t === 'attack')    return `Attack ${action.targetId ?? ''}`;
  if (t === 'end-turn')  return 'End Turn';
  if (t === 'end-phase') return 'End Phase';
  if (t === 'pass')      return 'Pass';
  if (t === 'ability') {
    const name = action.abilityName ?? action.ability ?? 'Ability';
    if (action.targetId != null) {
      const target = displayUnits.value.find(u => u.id === action.targetId);
      return target ? `${name} → ${target.name} (${action.targetId})` : `${name} → ${action.targetId}`;
    }
    return name;
  }
  return t + (action.unitId ? ' ' + action.unitId : '');
}

function submitAction(action) {
  emit('submit-action', { playerId: pendingPlayerId.value, action });
}

// ── playback RAF ──────────────────────────────────────────────
const PLAY_SPEED = 0.7;
let rafId = null;
let lastTs = 0;

function raf(ts) {
  if (playing.value && props.field.turns > 1) {
    const dt   = Math.min((ts - lastTs) / 1000, 0.1);
    const next = tFloat.value + dt * PLAY_SPEED;
    if (next >= props.field.turns - 1) {
      tFloat.value = props.field.turns - 1;
      playing.value = false;
    } else {
      tFloat.value = next;
    }
  }
  lastTs = ts;
  rafId = requestAnimationFrame(raf);
}

function togglePlay() {
  if (tFloat.value >= props.field.turns - 1) tFloat.value = 0;
  playing.value = !playing.value;
}

function stepBack() {
  playing.value = false;
  tFloat.value = Math.max(0, Math.floor(tFloat.value) - 1);
}

function stepFwd() {
  playing.value = false;
  tFloat.value = Math.min(props.field.turns - 1, Math.floor(tFloat.value) + 1);
}

function scrub(e) {
  playing.value = false;
  tFloat.value = parseFloat(e.target.value);
}

onMounted(() => {
  lastTs = performance.now();
  rafId = requestAnimationFrame(raf);
  updateStageSize();
  window.addEventListener('resize', updateStageSize);
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', updateStageSize);
});
</script>

<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">

    <!-- ── Toolbar ───────────────────────────────────────────── -->
    <div class="topbar" style="min-height:44px;padding:0 14px;border-bottom:1px solid var(--line)">
      <button class="btn btn-sm btn-ghost" style="gap:5px" @click="$emit('exit')">
        <BsIcon name="back" :size="13" color="var(--dim)"/>
        Lobby
      </button>
      <div style="margin-left:10px;display:flex;align-items:center;gap:8px">
        <BsIcon name="crosshair" :size="14" color="var(--accent)"/>
        <span style="font-weight:600;font-size:13px">{{field.game}}</span>
        <span class="mono" style="font-size:11px;color:var(--faint)">{{field.label}}</span>
      </div>

      <!-- Live status badge -->
      <div v-if="isLive" style="display:flex;align-items:center;gap:7px;margin-left:12px">
        <span v-if="isDone"
              style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(70,211,154,.1);color:var(--ok)">
          ✓ {{liveState.result?.winner ? 'Winner: ' + liveState.result.winner : 'Game over'}}
        </span>
        <span v-else-if="isPending"
              class="mono" style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(70,211,154,.1);color:var(--ok)">
          ● Your turn · {{pendingPlayerId}}
        </span>
        <span v-else
              class="mono" style="font-size:11px;padding:3px 8px;border-radius:4px;background:rgba(242,180,65,.1);color:var(--warn)">
          ○ AI thinking…
        </span>
      </div>

      <div style="flex:1"/>

      <button class="iconbtn" :style="{color: showRuler ? 'var(--accent)' : 'var(--dim)'}"
              title="Show ruler" style="width:32px;height:32px" @click="showRuler = !showRuler">
        <BsIcon name="move" :size="15"/>
      </button>
      <div class="seg" style="margin-left:8px">
        <button :class="{on: renderer==='schematic'}" style="padding:4px 10px;font-size:11px"
                @click="renderer='schematic'">Schematic</button>
        <button :class="{on: renderer==='asset'}" style="padding:4px 10px;font-size:11px"
                @click="renderer='asset'">Asset</button>
      </div>
    </div>

    <!-- ── Main: Stage + Sidebar ─────────────────────────────── -->
    <div style="flex:1;min-height:0;display:flex;overflow:hidden">

      <!-- Stage -->
      <div ref="stageEl" style="flex:1;position:relative;overflow:hidden">
        <SchematicLayer v-if="renderer === 'schematic'"
                        :field="field" :fit="fit" :units="displayUnits"
                        :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
                        :showRuler="showRuler" :rdr="rdr"
                        :legalSquares="unitMoves"
                        @select="id => selectedId = id"
                        @sq-click="handleSqClick"/>
        <AssetLayer v-else
                    :field="field" :fit="fit" :units="displayUnits"
                    :selectedId="selectedId" :fog="fog"
                    :showRuler="showRuler" :rdr="rdr"
                    @select="id => selectedId = id"/>
      </div>

      <!-- Sidebar -->
      <div style="width:240px;min-height:0;overflow-y:auto;border-left:1px solid var(--line);display:flex;flex-direction:column;background:var(--bg1)">

        <!-- Live: Actions panel -->
        <div v-if="isLive" style="padding:12px 14px;border-bottom:1px solid var(--line)">
          <div class="panel-t" style="margin-bottom:8px">
            Turn {{liveState.turn ?? 0}}
            <span v-if="liveState.phase" class="mono" style="font-weight:400;color:var(--faint)">
              · {{liveState.phase}}
            </span>
          </div>

          <!-- Game over -->
          <div v-if="isDone" style="font-size:12px;color:var(--ok)">
            {{liveState.result?.winner
              ? 'Winner: ' + liveState.result.winner
              : liveState.result?.draw ? 'Draw'
              : liveState.status === 'error' ? ('Error: ' + liveState.error)
              : 'Game over'}}
          </div>

          <!-- Human's turn with a unit selected (freeSelection: any piece; otherwise: must be the active unit) -->
          <template v-else-if="isPending && selectedId && (ui.freeSelection || selectedId === activeUnitId)">
            <div style="font-size:11px;color:var(--dim);margin-bottom:8px">
              Choose action for
              <b style="color:var(--accent)">{{pendingPlayerId}}</b>:
            </div>
            <div v-if="unitMoves.length" class="mono"
                 style="font-size:10px;color:var(--faint);margin-bottom:8px;padding:5px 8px;border:1px solid var(--line);border-radius:4px">
              Tap a highlighted square to move
            </div>
            <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
              <button v-for="(action, i) in displayedActions" :key="i"
                      class="action-btn"
                      style="font-size:11px;font-family:var(--mono)"
                      @click="submitAction(action)">
                {{fmtAction(action)}}
              </button>
              <div v-if="!displayedActions.length" style="font-size:11px;color:var(--faint)">
                No actions.
              </div>
            </div>
          </template>
          <!-- Human's turn, no unit selected -->
          <template v-else-if="isPending">
            <div style="font-size:11px;color:var(--dim)">
              Click the <b style="color:var(--accent)">{{ui.freeSelection ? 'a piece' : 'active unit'}}</b> on the board to see actions.
            </div>
          </template>

          <!-- AI's turn -->
          <div v-else style="font-size:12px;color:var(--warn)">
            Waiting for AI…
          </div>
        </div>

        <!-- Game log -->
        <div v-if="isLive" style="border-bottom:1px solid var(--line);display:flex;flex-direction:column;max-height:200px">
          <div class="panel-t" style="padding:7px 14px;flex-shrink:0">Log</div>
          <div style="overflow-y:auto;flex:1">
            <div v-if="!liveState.log?.length" style="padding:4px 14px 8px;font-size:11px;color:var(--faint)">
              No moves yet.
            </div>
            <div v-for="entry in [...(liveState.log ?? [])].reverse()" :key="entry.turnNumber"
                 style="padding:3px 14px;border-bottom:1px solid var(--line);font-size:11px">
              <span class="mono" style="font-size:9px;color:var(--faint);margin-right:6px">T{{entry.turnNumber}}</span>
              <span v-for="(pa, i) in entry.playerActions" :key="i"
                    style="display:inline;margin-right:8px">
                <b :style="{color:'var(--accent)'}">{{pa.playerId}}</b>
                {{ fmtAction(pa.action) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Selected unit detail -->
        <div v-if="selectedUnit" style="padding:12px 14px;border-bottom:1px solid var(--line)">
          <!-- Header -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <BsDot :color="selectedUnit.teamObj.raw" :size="9"/>
            <span style="font-weight:700;font-size:13px">{{selectedUnit.name}}</span>
            <span class="mono" style="font-size:10px;color:var(--faint)">({{selectedUnit.id}})</span>
            <span v-if="selectedUnit.isActive"
                  class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(70,211,154,.15);color:var(--ok)">
              ACTIVE
            </span>
          </div>

          <!-- Location -->
          <div v-if="selectedUnit.x != null" class="mono" style="font-size:10px;color:var(--faint);margin-bottom:8px">
            ({{Math.floor(selectedUnit.x)}}, {{Math.floor(selectedUnit.y)}})
          </div>

          <div v-if="selectedUnit.dead" class="mono" style="font-size:11px;color:#ff5f56">KIA</div>
          <template v-else>

            <!-- HP bar -->
            <template v-if="selectedUnit.hpMax != null && field.ui?.showHpBars !== false">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="font-size:10px;color:var(--dim)">HP</span>
                <span class="mono" style="font-size:10px">
                  {{Math.round(selectedUnit.currentHp ?? selectedUnit.hpNow)}} / {{selectedUnit.hpMax}}
                </span>
              </div>
              <div style="height:4px;border-radius:2px;overflow:hidden;margin-bottom:6px"
                   :style="{background: rdr.hpTrack}">
                <div style="height:100%;border-radius:2px;transition:width .3s"
                     :style="{
                       width: ((selectedUnit.currentHp ?? selectedUnit.hpNow)/selectedUnit.hpMax*100)+'%',
                       background: (selectedUnit.currentHp ?? selectedUnit.hpNow)/selectedUnit.hpMax > 0.5 ? selectedUnit.teamObj.raw
                                 : (selectedUnit.currentHp ?? selectedUnit.hpNow)/selectedUnit.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
                     }"/>
              </div>
            </template>

            <!-- MP bar -->
            <template v-if="selectedUnit.maxMp != null">
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="font-size:10px;color:var(--dim)">MP</span>
                <span class="mono" style="font-size:10px">{{selectedUnit.mp ?? 0}} / {{selectedUnit.maxMp}}</span>
              </div>
              <div style="height:4px;border-radius:2px;overflow:hidden;margin-bottom:8px;background:rgba(100,80,200,.2)">
                <div style="height:100%;border-radius:2px;background:#9b6fff;transition:width .3s"
                     :style="{width: ((selectedUnit.mp ?? 0)/selectedUnit.maxMp*100)+'%'}"/>
              </div>
            </template>

            <!-- Stats grid -->
            <template v-if="selectedUnit.stats">
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:8px">
                <div v-for="(val, key) in selectedUnit.stats" :key="key"
                     style="display:flex;flex-direction:column;align-items:center;background:var(--bg3);border-radius:3px;padding:3px 0">
                  <span class="mono" style="font-size:12px;font-weight:700;color:var(--txt)">{{val}}</span>
                  <span class="up" style="font-size:8px;color:var(--faint)">{{key}}</span>
                </div>
              </div>
            </template>

            <!-- Moved/Acted flags -->
            <div v-if="selectedUnit.moved != null" style="display:flex;gap:5px;margin-bottom:8px">
              <span class="mono" style="font-size:9px;padding:2px 5px;border-radius:3px"
                    :style="{background: selectedUnit.moved ? 'rgba(255,95,86,.12)' : 'rgba(70,211,154,.12)',
                             color:      selectedUnit.moved ? '#ff5f56' : 'var(--ok)'}">
                {{selectedUnit.moved ? 'MOVED' : 'CAN MOVE'}}
              </span>
              <span class="mono" style="font-size:9px;padding:2px 5px;border-radius:3px"
                    :style="{background: selectedUnit.acted ? 'rgba(255,95,86,.12)' : 'rgba(70,211,154,.12)',
                             color:      selectedUnit.acted ? '#ff5f56' : 'var(--ok)'}">
                {{selectedUnit.acted ? 'ACTED' : 'CAN ACT'}}
              </span>
            </div>

            <!-- Status effects -->
            <div v-if="selectedUnit.statusEffects?.length" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
              <span v-for="fx in selectedUnit.statusEffects" :key="fx"
                    class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(242,180,65,.15);color:#f2b441">
                {{fx}}
              </span>
            </div>

            <!-- Abilities -->
            <div v-if="selectedUnit.abilities?.length">
              <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Abilities</div>
              <div style="display:flex;flex-wrap:wrap;gap:3px">
                <span v-for="ab in selectedUnit.abilities" :key="ab.key ?? ab"
                      style="font-size:10px;padding:2px 6px;border-radius:3px;background:var(--bg3)"
                      :style="{color: selectedUnit.teamObj.raw}">
                  {{ab.name ?? ab}}
                </span>
              </div>
            </div>
          </template>

          <div style="margin-top:8px;font-size:10px" :style="{color: selectedUnit.teamObj.raw + 'cc'}">
            {{selectedUnit.teamObj.name}}
          </div>
        </div>

        <!-- Roster -->
        <div style="flex:1;padding:12px 14px;overflow-y:auto">
          <div v-for="team in rosterTeams" :key="team.id" style="margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
              <BsDot :color="team.raw" :size="8"/>
              <span style="font-size:11px;font-weight:600">{{team.name}}</span>
              <span class="mono" style="font-size:10px;color:var(--faint);margin-left:auto">
                {{team.units.filter(u => !u.dead).length}}/{{team.units.length}}
              </span>
            </div>
            <div v-for="u in team.units" :key="u.id"
                 style="display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:4px;cursor:pointer;margin-bottom:2px"
                 :style="{
                   background: u.id === selectedId ? team.raw + '18' : 'transparent',
                   opacity: u.dead ? 0.38 : 1,
                 }"
                 @click="selectedId = u.id === selectedId ? null : u.id">
              <BsDot :color="u.dead ? 'var(--faint)' : team.raw" :size="7"/>
              <span style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                    :style="{textDecoration: u.dead ? 'line-through' : 'none', color: u.dead ? 'var(--faint)' : ''}">
                {{u.name}}
              </span>
              <span class="mono" style="font-size:9px;color:var(--faint)">{{u.id}}</span>
              <div v-if="!u.dead && u.hpMax != null && field.ui?.showHpBars !== false"
                   style="width:32px;height:3px;border-radius:2px;overflow:hidden;flex:none"
                   :style="{background: rdr.hpTrack}">
                <div style="height:100%;border-radius:2px"
                     :style="{width: (u.hpNow/u.hpMax*100)+'%', background: team.raw}"/>
              </div>
              <span v-else class="mono" style="font-size:9px;color:var(--faint)">KIA</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Bottom bar ─────────────────────────────────────────── -->
    <div style="border-top:1px solid var(--line);padding:8px 14px;display:flex;align-items:center;gap:10px;background:var(--bg1)">

      <!-- Animation timeline (non-live multi-turn fields) -->
      <template v-if="!isLive && field.turns > 1">
        <button class="iconbtn" style="width:30px;height:30px" @click="stepBack">
          <BsIcon name="stepb" :size="15" color="var(--dim)"/>
        </button>
        <button class="btn btn-sm" style="min-width:62px;justify-content:center;gap:5px" @click="togglePlay">
          <BsIcon :name="playing ? 'pause' : 'play'" :size="13" :color="playing ? 'var(--dim)' : 'var(--accent)'"/>
          {{playing ? 'Pause' : 'Play'}}
        </button>
        <button class="iconbtn" style="width:30px;height:30px" @click="stepFwd">
          <BsIcon name="step" :size="15" color="var(--dim)"/>
        </button>
        <input type="range" style="flex:1;min-width:0"
               :min="0" :max="field.turns - 1" step="0.05"
               :value="tFloat" @input="scrub"/>
        <span class="mono" style="font-size:11px;color:var(--dim);white-space:nowrap;min-width:72px;text-align:right">
          T {{Math.floor(tFloat)}} / {{field.turns - 1}}
        </span>
      </template>

      <!-- Live session status -->
      <template v-else-if="isLive">
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
        <div style="flex:1"/>
      </template>

      <template v-else>
        <span class="mono" style="font-size:11px;color:var(--faint)">{{field.label}}</span>
        <div style="flex:1"/>
      </template>

      <BsIcon name="clock" :size="14" color="var(--faint)"/>
    </div>
  </div>
</template>
