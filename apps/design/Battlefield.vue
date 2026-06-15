<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import SchematicLayer from './SchematicLayer.vue';

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
const showRuler = ref(false);

// ── selection ─────────────────────────────────────────────────
const selectedId = ref(null);

// ── unit info overlay ─────────────────────────────────────────
const infoUnit    = ref(null);
const infoAbility = ref(null);

function openInfo(u) {
  if (props.field.ui?.showUnitInfo === false) return;
  infoUnit.value = u;
}

function closeInfo() {
  infoUnit.value = null;
}

function openAbilityInfo(ab) {
  infoAbility.value = typeof ab === 'string' ? { name: ab } : ab;
}

function closeAbilityInfo() {
  infoAbility.value = null;
}

function fmtAbilityEffect(ab) {
  const pct = ab.power ? Math.round(ab.power * 100) + '%' : null;
  const e = ab.effect ?? '';
  if (e === 'damage') {
    let s = pct ? `${pct} ATK` : 'Damage';
    if (ab.aoe) s += ` · AoE`;
    if (ab.knockback) s += ' · knockback';
    return s;
  }
  if (e === 'damage+status') {
    let s = pct ? `${pct} ATK` : 'Damage';
    if (ab.status) s += ` + ${ab.status}`;
    if (ab.aoe) s += ' · AoE';
    if (ab.knockback) s += ' · knockback';
    return s;
  }
  if (e === 'damage+steal-mp') return `${pct ? pct + ' ATK' : 'Damage'} + steal MP`;
  if (e === 'heal')       return `Heal (${pct ?? ''} MAG)`;
  if (e === 'heal-fixed') return `+${ab.healAmount} HP`;
  if (e === 'heal-full')  return 'Full HP restore';
  if (e === 'status') {
    let s = ab.status ?? 'Status';
    if (ab.aoe) s += ' · AoE';
    return s;
  }
  if (e === 'steal-mp')   return 'Steal MP';
  if (e === 'cleanse')    return 'Remove all status effects';
  if (e === 'cleanse-one') return `Remove ${ab.status}`;
  if (e === 'restore-mp') return `+${ab.mpAmount} MP`;
  if (e === 'revive')     return `Revive at ${Math.round((ab.reviveHpPct ?? 0.25) * 100)}% HP`;
  if (e === 'elixir')     return 'Full HP + MP restore';
  return e;
}

function abilityTypeMeta(type) {
  if (type === 'physical') return { label: 'PHY', color: 'var(--accent)', bg: 'rgba(66,198,230,.12)' };
  if (type === 'magic')    return { label: 'MAG', color: '#b48cff',       bg: 'rgba(180,140,255,.12)' };
  if (type === 'item')     return { label: 'ITM', color: 'var(--ok)',     bg: 'rgba(70,211,154,.12)' };
  return                          { label: 'SUP', color: 'var(--warn)',   bg: 'rgba(242,180,65,.12)' };
}

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

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (infoAbility.value) closeAbilityInfo();
    else closeInfo();
  }
}

onMounted(() => {
  lastTs = performance.now();
  rafId = requestAnimationFrame(raf);
  updateStageSize();
  window.addEventListener('resize', updateStageSize);
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', updateStageSize);
  window.removeEventListener('keydown', onKeyDown);
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
    </div>

    <!-- ── Main: Left panel + Stage + Sidebar ───────────────── -->
    <div style="flex:1;min-height:0;display:flex;overflow:hidden">

      <!-- Left: Selected unit panel -->
      <div style="width:240px;min-height:0;overflow-y:auto;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--bg1)">

        <!-- Selected unit detail -->
        <div v-if="selectedUnit" style="padding:12px 14px;border-bottom:1px solid var(--line)">
          <!-- Portrait -->
          <div v-if="selectedUnit.portraitPath || selectedUnit.imagePath"
               style="display:flex;justify-content:center;margin-bottom:10px">
            <img :src="selectedUnit.portraitPath ?? selectedUnit.imagePath"
                 :alt="selectedUnit.name"
                 style="width:72px;height:72px;object-fit:contain;image-rendering:pixelated;border-radius:4px;border:1px solid var(--line)"/>
          </div>
          <!-- Header -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <BsDot :color="selectedUnit.teamObj.raw" :size="9"/>
            <span style="font-weight:700;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--line3)"
                  :title="field.ui?.showUnitInfo !== false ? 'View unit info' : ''"
                  @click="openInfo(selectedUnit)">{{selectedUnit.name}}</span>
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
                      style="font-size:10px;padding:2px 6px;border-radius:3px;background:var(--bg3);cursor:pointer"
                      :style="{color: selectedUnit.teamObj.raw}"
                      @click="openAbilityInfo(ab)">
                  {{ab.name ?? ab}}
                </span>
              </div>
            </div>
          </template>

          <div style="margin-top:8px;font-size:10px" :style="{color: selectedUnit.teamObj.raw + 'cc'}">
            {{selectedUnit.teamObj.name}}
          </div>
        </div>

        <!-- Empty state when no unit selected -->
        <div v-else style="padding:12px 14px;font-size:11px;color:var(--faint)">
          Select a unit to view details.
        </div>

        <!-- Live: Actions panel -->
        <div v-if="isLive" style="padding:12px 14px;border-top:1px solid var(--line)">
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
      </div>

      <!-- Stage -->
      <div ref="stageEl" style="flex:1;position:relative;overflow:hidden">
        <SchematicLayer :field="field" :fit="fit" :units="displayUnits"
                        :selectedId="selectedId" :activeUnitId="activeUnitId" :fog="fog"
                        :showRuler="showRuler" :rdr="rdr"
                        :legalSquares="unitMoves"
                        @select="id => selectedId = id"
                        @sq-click="handleSqClick"/>
      </div>

      <!-- Right Sidebar: Log, Roster -->
      <div style="width:240px;min-height:0;overflow-y:auto;border-left:1px solid var(--line);display:flex;flex-direction:column;background:var(--bg1)">

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
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
              <div v-for="u in team.units" :key="u.id"
                   style="border-radius:5px;cursor:pointer;overflow:hidden;border:1px solid transparent;transition:border-color .15s"
                   :style="{
                     borderColor: u.id === selectedId ? team.raw + '80' : 'var(--line)',
                     background: u.id === selectedId ? team.raw + '12' : 'var(--bg2)',
                     opacity: u.dead ? 0.38 : 1,
                   }"
                   @click="selectedId = u.id === selectedId ? null : u.id">
                <!-- Portrait -->
                <div style="width:100%;aspect-ratio:1;overflow:hidden;background:var(--bg0)">
                  <img v-if="u.portraitPath || u.imagePath"
                       :src="u.portraitPath ?? u.imagePath"
                       :alt="u.name"
                       style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block"/>
                  <div v-else style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
                    <BsDot :color="u.dead ? 'var(--faint)' : team.raw" :size="10"/>
                  </div>
                </div>
                <!-- Name + ID -->
                <div style="padding:4px 5px 3px">
                  <div style="font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2"
                       :style="{textDecoration: u.dead ? 'line-through' : 'none', color: u.dead ? 'var(--faint)' : 'var(--txt)'}">
                    {{u.name}}
                  </div>
                  <div class="mono" style="font-size:8px;color:var(--faint);line-height:1.2">{{u.id}}</div>
                </div>
                <!-- Bars -->
                <div style="padding:0 5px 5px;display:flex;flex-direction:column;gap:2px">
                  <div v-if="!u.dead && u.hpMax != null && field.ui?.showHpBars !== false"
                       style="height:3px;border-radius:2px;overflow:hidden"
                       :style="{background: rdr.hpTrack}">
                    <div style="height:100%;border-radius:2px;transition:width .3s"
                         :style="{
                           width: (u.hpNow/u.hpMax*100)+'%',
                           background: u.hpNow/u.hpMax > 0.5 ? team.raw : u.hpNow/u.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
                         }"/>
                  </div>
                  <div v-if="!u.dead && u.maxMp != null"
                       style="height:3px;border-radius:2px;overflow:hidden;background:rgba(100,80,200,.2)">
                    <div style="height:100%;border-radius:2px;background:#9b6fff;transition:width .3s"
                         :style="{width: ((u.mp ?? 0)/u.maxMp*100)+'%'}"/>
                  </div>
                  <div v-if="u.dead" class="mono" style="font-size:8px;color:#ff5f56;text-align:center;padding-top:1px">KIA</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Game log -->
        <div v-if="isLive" style="border-top:1px solid var(--line);display:flex;flex-direction:column;max-height:200px">
          <div class="panel-t" style="padding:7px 14px;flex-shrink:0">Log</div>
          <div style="overflow-y:auto;flex:1">
            <div v-if="!liveState.log?.length" style="padding:4px 14px 8px;font-size:11px;color:var(--faint)">
              No moves yet.
            </div>
            <div v-for="(entry, ei) in [...(liveState.log ?? [])].reverse()" :key="ei"
                 style="padding:3px 14px;border-bottom:1px solid var(--line);font-size:11px">
              <span class="mono" style="font-size:9px;color:var(--faint);margin-right:6px">T{{entry.turnNumber}}</span>
              <span v-for="(pa, i) in entry.playerActions" :key="i"
                    style="display:inline;margin-right:8px">
                <b :style="{color:'var(--accent)'}">{{pa.playerId}}</b>
                {{ fmtAction(pa.action) }}
              </span>
              <span v-for="(ev, evi) in (entry.events ?? [])" :key="'e'+evi"
                    class="mono"
                    :style="{
                      fontSize: '10px',
                      marginRight: '5px',
                      color: ev.type === 'damage' ? 'var(--danger)' : ev.type === 'heal' ? 'var(--ok)' : 'var(--dim)',
                    }">
                {{ ev.type === 'damage' ? (ev.died ? '†' : '') + '−' + ev.amount
                 : ev.type === 'heal'   ? '+' + ev.amount
                 : '†' }}
              </span>
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

  <!-- ── Unit Info Overlay ────────────────────────────────────── -->
  <teleport to="body">
    <div v-if="infoUnit"
         style="position:fixed;inset:0;z-index:1000;background:rgba(4,7,10,.8);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)"
         @click.self="closeInfo">

      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:460px;max-width:92vw;max-height:88vh;overflow-y:auto;display:flex;flex-direction:column;box-shadow:0 24px 64px -12px rgba(0,0,0,.7)">

        <!-- Large art image -->
        <div v-if="infoUnit.mainImagePath" style="position:relative;flex-shrink:0;background:var(--bg0);border-bottom:1px solid var(--line)">
          <img :key="infoUnit.mainImagePath"
               :src="infoUnit.mainImagePath"
               :alt="infoUnit.name"
               style="width:100%;display:block;max-height:300px;object-fit:contain"
               @error="e => e.target.closest('div').style.display='none'"/>
        </div>

        <!-- Header: name, job key, close button -->
        <div style="padding:16px 18px 12px;display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid var(--line)">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:22px;font-weight:700;letter-spacing:-.01em">{{infoUnit.name}}</span>
              <span v-if="infoUnit.job"
                    class="mono" style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--bg3);color:var(--dim);letter-spacing:.04em">
                {{infoUnit.job}}
              </span>
              <span v-if="infoUnit.moveRange != null"
                    class="mono" style="font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(66,198,230,.1);color:var(--accent)">
                Move {{infoUnit.moveRange}}
              </span>
            </div>
            <p v-if="infoUnit.description"
               style="margin:0;font-size:12px;color:var(--dim);line-height:1.6">
              {{infoUnit.description}}
            </p>
          </div>
          <button @click="closeInfo"
                  style="flex:none;width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>

        <!-- Base stats grid -->
        <div v-if="infoUnit.stats" style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="panel-t" style="margin-bottom:10px">Base Stats</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            <div v-for="(val, key) in infoUnit.stats" :key="key"
                 style="display:flex;flex-direction:column;align-items:center;background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);padding:8px 0">
              <span class="mono" style="font-size:18px;font-weight:700;color:var(--txt)">{{val}}</span>
              <span class="up" style="font-size:8px;color:var(--faint);margin-top:3px;letter-spacing:.08em">{{key}}</span>
            </div>
          </div>
        </div>

        <!-- Abilities -->
        <div v-if="infoUnit.abilities?.length" style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="panel-t" style="margin-bottom:10px">Abilities</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div v-for="ab in infoUnit.abilities" :key="ab.key ?? ab"
                 style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line);cursor:pointer"
                 @click="openAbilityInfo(ab)">
              <span class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;flex:none;letter-spacing:.04em"
                    :style="{background: abilityTypeMeta(ab.type).bg, color: abilityTypeMeta(ab.type).color}">
                {{abilityTypeMeta(ab.type).label}}
              </span>
              <span style="font-size:12px;font-weight:600;flex:none;min-width:96px">{{ab.name ?? ab}}</span>
              <span class="mono" style="font-size:10px;color:var(--faint);flex:none">
                <template v-if="ab.range != null">Rng&nbsp;{{ab.range}}</template>
                <template v-if="ab.mpCost"> &middot; {{ab.mpCost}}&thinsp;MP</template>
              </span>
              <span style="font-size:11px;color:var(--dim);flex:1;text-align:right">
                {{fmtAbilityEffect(ab)}}
              </span>
            </div>
          </div>
        </div>

        <!-- Passives: reaction + support -->
        <div v-if="infoUnit.reaction || infoUnit.support" style="padding:14px 18px">
          <div class="panel-t" style="margin-bottom:10px">Passives</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div v-if="infoUnit.reaction"
                 style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line)">
              <span class="mono" style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(255,95,86,.12);color:#ff5f56;flex:none;margin-top:1px">REACT</span>
              <div>
                <div style="font-size:12px;font-weight:600">{{infoUnit.reaction.name ?? infoUnit.reaction}}</div>
                <div v-if="infoUnit.reaction.description" style="font-size:11px;color:var(--dim);margin-top:2px">{{infoUnit.reaction.description}}</div>
              </div>
            </div>
            <div v-if="infoUnit.support"
                 style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line)">
              <span class="mono" style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(70,211,154,.12);color:var(--ok);flex:none;margin-top:1px">SUPP</span>
              <div>
                <div style="font-size:12px;font-weight:600">{{infoUnit.support.name ?? infoUnit.support}}</div>
                <div v-if="infoUnit.support.description" style="font-size:11px;color:var(--dim);margin-top:2px">{{infoUnit.support.description}}</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </teleport>

  <!-- ── Ability Info Overlay ───────────────────────────────────── -->
  <teleport to="body">
    <div v-if="infoAbility"
         style="position:fixed;inset:0;z-index:1001;background:rgba(4,7,10,.55);display:flex;align-items:center;justify-content:center"
         @click.self="closeAbilityInfo">

      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:340px;max-width:88vw;overflow:hidden;box-shadow:0 24px 64px -12px rgba(0,0,0,.8)">

        <!-- Header -->
        <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
          <span class="mono" style="font-size:11px;padding:3px 9px;border-radius:4px;flex:none;letter-spacing:.04em"
                :style="{background: abilityTypeMeta(infoAbility.type).bg, color: abilityTypeMeta(infoAbility.type).color}">
            {{abilityTypeMeta(infoAbility.type).label}}
          </span>
          <span style="font-size:18px;font-weight:700;flex:1;letter-spacing:-.01em">{{infoAbility.name}}</span>
          <button @click="closeAbilityInfo"
                  style="flex:none;width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>

        <!-- Details -->
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">

          <!-- Effect -->
          <div v-if="infoAbility.effect">
            <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:4px;letter-spacing:.08em">Effect</div>
            <div style="font-size:13px;color:var(--txt)">{{fmtAbilityEffect(infoAbility)}}</div>
          </div>

          <!-- Stat pills row -->
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div v-if="infoAbility.range != null">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Range</div>
              <div class="mono" style="font-size:16px;font-weight:700">{{infoAbility.range === 0 ? '—' : infoAbility.range}}</div>
            </div>
            <div v-if="infoAbility.mpCost">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">MP Cost</div>
              <div class="mono" style="font-size:16px;font-weight:700;color:#9b6fff">{{infoAbility.mpCost}}</div>
            </div>
            <div v-if="infoAbility.target">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Target</div>
              <div class="mono" style="font-size:16px;font-weight:700;text-transform:capitalize">{{infoAbility.target}}</div>
            </div>
            <div v-if="infoAbility.power">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Power</div>
              <div class="mono" style="font-size:16px;font-weight:700">{{Math.round(infoAbility.power * 100)}}%</div>
            </div>
          </div>

          <!-- Tags -->
          <div v-if="infoAbility.status || infoAbility.aoe || infoAbility.knockback" style="display:flex;gap:5px;flex-wrap:wrap">
            <span v-if="infoAbility.status" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(242,180,65,.15);color:#f2b441">
              {{infoAbility.status}}
            </span>
            <span v-if="infoAbility.aoe" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(66,198,230,.1);color:var(--accent)">
              AoE{{infoAbility.aoeRadius ? ' r' + infoAbility.aoeRadius : ''}}
            </span>
            <span v-if="infoAbility.knockback" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(255,95,86,.1);color:#ff5f56">
              knockback
            </span>
          </div>

          <!-- Description (if present) -->
          <p v-if="infoAbility.description"
             style="margin:0;font-size:12px;color:var(--dim);line-height:1.6;border-top:1px solid var(--line);padding-top:10px">
            {{infoAbility.description}}
          </p>
        </div>
      </div>
    </div>
  </teleport>
</template>
