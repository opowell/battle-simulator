<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer from './SchematicLayer.vue';
import AssetLayer     from './AssetLayer.vue';

const props = defineProps({
  liveState: Object,  // raw API session JSON
  field:     Object,
  theme:     String,
});
const emit = defineEmits(['exit', 'submit-action']);

// ── playback ─────────────────────────────────────────────────
const tFloat   = ref(0);
const playing  = ref(false);

// ── view toggles ─────────────────────────────────────────────
const renderer  = ref('schematic');
const fogOn     = ref(false);
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

// ── world → screen transform ──────────────────────────────────
const fit = computed(() => makeFitter(props.field.world, { w: stageW.value, h: stageH.value }, 24));

// ── live units at current time ─────────────────────────────────
const units = computed(() => computeUnits(props.field, tFloat.value));

// ── chess interactive board ──────────────────────────────────
const isChess = computed(() => props.field?.game === 'chess');

const chessBoard = ref({});

watch(() => props.field, (f) => {
  if (!f || f.game !== 'chess') return;
  const b = {};
  for (const u of f.units) {
    const col = Math.floor(u.path[0][0]);
    const row = Math.floor(u.path[0][1]);
    b[`${col},${row}`] = { id: u.id, team: u.team, type: u.type, name: u.name, hp: u.hp };
  }
  chessBoard.value = b;
  selectedId.value = null;
}, { immediate: true });

const chessDisplayUnits = computed(() => {
  if (!isChess.value) return [];
  const teams = props.field?.teams || [];
  return Object.entries(chessBoard.value).map(([key, piece]) => {
    const [col, row] = key.split(',').map(Number);
    const teamObj = teams.find(t => t.id === piece.team) || { raw: '#fff', name: '', id: '' };
    return {
      ...piece,
      x: col + 0.5, y: row + 0.5,
      ang: 0,
      next: { x: col + 0.5, y: row + 0.5, ang: 0 },
      dead: false,
      hpNow: piece.hp, hpMax: piece.hp,
      teamObj,
      friendly: piece.team === (teams[0] || {}).id,
      visible: true,
    };
  });
});

const displayUnits = computed(() => isChess.value ? chessDisplayUnits.value : units.value);

// ── chess helpers ─────────────────────────────────────────────
function squareLabel(col, row) { return String.fromCharCode(97 + col) + (8 - row); }
function parseSquare(sq) { return [sq.charCodeAt(0) - 97, 8 - parseInt(sq[1])]; }

const selectedSquare = computed(() => {
  if (!isChess.value || !selectedId.value) return null;
  const sel = chessDisplayUnits.value.find(u => u.id === selectedId.value);
  return sel ? squareLabel(Math.floor(sel.x), Math.floor(sel.y)) : null;
});

const chessMoves = computed(() => {
  if (!isChess.value || !selectedSquare.value || !isPending.value) return [];
  return legalActions.value
    .filter(a => a.type === 'move' && a.from === selectedSquare.value)
    .map(a => parseSquare(a.to));
});

function applyChessMove(fromSq, toCol, toRow) {
  const [fromCol, fromRow] = parseSquare(fromSq);
  const b = { ...chessBoard.value };
  b[`${toCol},${toRow}`] = b[`${fromCol},${fromRow}`];
  delete b[`${fromCol},${fromRow}`];
  chessBoard.value = b;
  selectedId.value = null;
}

function handleSqClick(col, row) {
  const toSq = squareLabel(col, row);
  if (selectedSquare.value && isPending.value) {
    const isLegal = chessMoves.value.some(([c, r]) => c === col && r === row);
    if (isLegal) {
      const action = legalActions.value.find(
        a => a.type === 'move' && a.from === selectedSquare.value && a.to === toSq
      );
      if (action) {
        applyChessMove(selectedSquare.value, col, row);
        submitAction(action);
        return;
      }
    }
  }
  const here = chessDisplayUnits.value.find(u => Math.floor(u.x) === col && Math.floor(u.y) === row);
  selectedId.value = here ? here.id : null;
}

function chessSquareLabel(u) {
  return squareLabel(Math.floor(u.x), Math.floor(u.y));
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


// ── live session helpers ───────────────────────────────────────
const isLive          = computed(() => !!props.liveState);
const isPending       = computed(() => isLive.value && props.liveState.pendingPlayer &&
                                       props.liveState.humanPlayers?.includes(props.liveState.pendingPlayer));
const isDone          = computed(() => isLive.value && props.liveState.status !== 'active');
const legalActions    = computed(() => props.liveState?.legalActions ?? []);
const pendingPlayerId = computed(() => props.liveState?.pendingPlayer ?? null);

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

      <button class="iconbtn" :style="{color: fogOn ? 'var(--accent)' : 'var(--dim)'}"
              title="Fog of war" style="width:32px;height:32px" @click="fogOn = !fogOn">
        <BsIcon name="fog" :size="15"/>
      </button>
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
                        :selectedId="selectedId" :fog="fogOn"
                        :showRuler="showRuler" :rdr="rdr"
                        :legalSquares="chessMoves"
                        @select="id => selectedId = id"
                        @sq-click="handleSqClick"/>
        <AssetLayer v-else
                    :field="field" :fit="fit" :units="displayUnits"
                    :selectedId="selectedId" :fog="fogOn"
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

          <!-- Human's turn -->
          <template v-else-if="isPending">
            <div style="font-size:11px;color:var(--dim);margin-bottom:8px">
              Choose action for
              <b style="color:var(--accent)">{{pendingPlayerId}}</b>:
            </div>
            <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
              <button v-for="(action, i) in legalActions" :key="i"
                      class="action-btn"
                      style="font-size:11px;font-family:var(--mono)"
                      @click="submitAction(action)">
                {{fmtAction(action)}}
              </button>
              <div v-if="!legalActions.length" style="font-size:11px;color:var(--faint)">
                No legal actions.
              </div>
            </div>
          </template>

          <!-- AI's turn -->
          <div v-else style="font-size:12px;color:var(--warn)">
            Waiting for AI…
          </div>
        </div>

        <!-- Selected unit detail -->
        <div v-if="selectedUnit" style="padding:12px 14px;border-bottom:1px solid var(--line)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <BsDot :color="selectedUnit.teamObj.raw" :size="9"/>
            <span style="font-weight:700;font-size:13px">{{selectedUnit.name}}</span>
            <span class="mono" style="font-size:10px;color:var(--faint)">{{selectedUnit.type || ''}}</span>
          </div>
          <div v-if="selectedUnit.dead" class="mono" style="font-size:11px;color:#ff5f56">KIA</div>
          <template v-else>
            <template v-if="!isChess">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="font-size:11px;color:var(--dim)">HP</span>
                <span class="mono" style="font-size:11px">{{Math.round(selectedUnit.hpNow)}} / {{selectedUnit.hpMax}}</span>
              </div>
              <div style="height:5px;border-radius:3px;overflow:hidden;margin-bottom:8px"
                   :style="{background: rdr.hpTrack}">
                <div style="height:100%;border-radius:3px;transition:width .3s"
                     :style="{
                       width: (selectedUnit.hpNow/selectedUnit.hpMax*100)+'%',
                       background: selectedUnit.hpNow/selectedUnit.hpMax > 0.5 ? selectedUnit.teamObj.raw
                                 : selectedUnit.hpNow/selectedUnit.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
                     }"/>
              </div>
            </template>
            <div v-else style="font-size:11px;color:var(--dim);margin-bottom:8px">
              {{chessSquareLabel(selectedUnit)}}
            </div>
          </template>
          <div style="margin-top:6px;font-size:10px" :style="{color: selectedUnit.teamObj.raw + 'cc'}">
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
              <div v-if="!u.dead && !isChess"
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
