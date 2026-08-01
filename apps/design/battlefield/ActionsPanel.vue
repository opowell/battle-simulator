<script setup>
import { computed, ref } from 'vue';
import RatesOverlay    from './RatesOverlay.vue';
import CitiesOverlay   from './CitiesOverlay.vue';
import MilitaryOverlay from './MilitaryOverlay.vue';
import ScienceOverlay  from './ScienceOverlay.vue';
const props = defineProps({
  isDone:           Boolean,
  atLatest:         Boolean,
  isPending:        Boolean,
  selectedId:       { type: String, default: null },
  activeUnitId:     { type: String, default: null },
  ui:               Object,
  unitMoves:        { type: Array, default: () => [] },
  // Whether unitMoves are 'queue-move' actions rather than 'move' — see
  // Battlefield.vue's queuingMoves (games/moveQueue.js).
  queuingMoves:     { type: Boolean, default: false },
  displayedActions: { type: Array, default: () => [] },
  pendingPlayerId:  { type: String, default: null },
  liveState:        Object,
  units:            { type: Array, default: () => [] },
  // Set while the player is aiming a "button → pick a spot on the map" action (see
  // Battlefield.vue's `aiming`) — swaps the action list for a cancel prompt.
  aiming:           { type: Object, default: null },
  // Per-owner economy snapshot (civ1 only — see Civ1Game.toGrid's `civ` field),
  // keyed by player id. Drives the tax/luxury/science rates overlay below.
  civ:              { type: Object, default: null },
  // Every visible city / per-owner military roster (civ1 only — see Civ1Game.toGrid's
  // `cities`/`military` fields). Drive the Cities/Military overlays.
  cities:           { type: Array, default: () => [] },
  military:         { type: Object, default: null },
});
defineEmits(['submit', 'aim', 'cancel-aim', 'goto']);

// Action types listed in field.ui.aimedActionTypes resolve their target by clicking
// the map (see SchematicLayer.vue's aiming overlay) instead of one button per legal
// instance — collapse each into a single representative button per unit here (CS
// lists every not-yet-acted unit's legal actions at once, not just the selected
// one, so the key must include unitId). 'throw' groups by grenade type too (one
// button per grenade held); 'shoot' and 'move' collapse every target/destination
// to one button — on continuous-location maps 'move' otherwise lists one
// "Move → (x,y)" button per candidate point, which reads as a huge, arbitrary list.
const imgSrc = window.api.imgSrc;

const aimedActions = computed(() => {
  const types = new Set(props.ui?.aimedActionTypes ?? []);
  if (!types.size) return props.displayedActions;
  const seen = new Set();
  const out = [];
  for (const action of props.displayedActions) {
    if (!types.has(action.type)) { out.push(action); continue; }
    const key = `${action.type}:${action.unitId}:${action.grenade ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (action.type === 'shoot')
      out.push({ type: 'shoot', unitId: action.unitId, icon: action.icon, range: action.range, __aim: true });
    else if (action.type === 'move')
      out.push({ type: 'move', unitId: action.unitId, __aim: true });
    else if (action.type === 'rotate')
      out.push({ type: 'rotate', unitId: action.unitId, __aim: true });
    else
      out.push({ ...action, __aim: true });
  }
  return out;
});

// CS money is per-unit (each player has their own wallet). Show the money of the unit
// whose buys are currently in focus (the selected/active one) — displayedActions is
// already filtered to that unit, so buy buttons don't need to repeat its id.
const activeMoney = computed(() => {
  if (!props.selectedId) return null;
  const u = props.units.find(x => x.id === props.selectedId);
  return u?.money ?? null;
});

// Civ1's set-tax/set-luxury/set-research actions come one per legal target value
// (see Civ1Game.js's getLegalActions) — a dozen-plus buttons that would drown out
// everything else in the empire-actions list. Their overlays (Rates/Science) are
// always-visible toolbar buttons instead (see ap-empire below), not tucked inside
// the turn-gated action list, so these action types are filtered out of it entirely
// rather than collapsed into a placeholder there.
const showRates    = ref(false);
const showCities   = ref(false);
const showMilitary = ref(false);
const showScience  = ref(false);
const taxActions      = computed(() => props.displayedActions.filter(a => a.type === 'set-tax'));
const luxActions      = computed(() => props.displayedActions.filter(a => a.type === 'set-luxury'));
const researchActions = computed(() => props.displayedActions.filter(a => a.type === 'set-research'));
const myCiv        = computed(() => props.civ?.[props.pendingPlayerId] ?? null);

// set-production also moves out: with more than one city its flat label ("Build
// militia") doesn't even say which city, and the City Inspector overlay (opened by
// clicking a city — see Battlefield.vue's selectedCity) already disambiguates that
// for free.
const OVERLAY_HANDLED = new Set(['set-tax', 'set-luxury', 'set-research', 'set-production']);
const listActions = computed(() => aimedActions.value.filter(a => !OVERLAY_HANDLED.has(a.type)));

function fmtAction(action) {
  const t = action.type ?? '';
  if (t === 'move') {
    if (action.__aim) return 'Move…';
    if (typeof action.from === 'string' && typeof action.to === 'string')
      return action.from + ' → ' + action.to;
    if (action.to && typeof action.to === 'object')
      return `Move → (${Number(action.to.x).toFixed(2)},${Number(action.to.y).toFixed(2)})`;
    if (action.unitId) return `Move ${action.unitId}`;
  }
  if (t === 'castle')    return action.side === 'kingside' ? 'O-O' : 'O-O-O';
  if (t === 'attack')    return `Attack ${action.targetId ?? ''}`;
  if (t === 'shoot') {
    if (action.targetId == null) return 'Shoot';
    const target = props.units.find(u => u.id === action.targetId);
    const label = target ? (target.unitName ?? target.name ?? target.id) : action.targetId;
    return `Shoot ${label}`;
  }
  if (t === 'throw')     return action.name ? `Throw ${action.name}` : 'Throw Grenade';
  if (t === 'rotate')    return 'Rotate…';
  if (t === 'punch')     return 'Punch…';
  if (t === 'buy')       return action.name ? `Buy ${action.name}` : `Buy ${action.item ?? ''}`;
  if (t === 'end-buy')   return 'Done Buying';
  if (t === 'queue-pop') return 'Undo last queued move';
  if (t === 'crouch')    return 'Crouch';
  if (t === 'stand')     return 'Stand Up';
  // Civ1 empire/settler actions. (set-tax/set-luxury/set-research/set-production are
  // filtered out of this list entirely — see OVERLAY_HANDLED — so no label is needed
  // for them here; their overlays format their own buttons.)
  if (t === 'change-government') return `Revolution → ${action.government}`;
  if (t === 'launch-spaceship') return '🚀 Launch Spaceship';
  if (t === 'found-city')     return 'Found City';
  if (t === 'build-road')     return 'Build Road';
  if (t === 'irrigate')       return 'Irrigate';
  if (t === 'build-mine')     return 'Build Mine';
  if (t === 'clear-terrain')  return 'Clear Terrain';
  if (t === 'skip-unit')      return 'Skip Unit';
  if (t === 'fortify')        return 'Fortify';
  if (t === 'sentry')         return 'Sentry';
  if (t === 'end-turn')  return action.direction ? `End Turn · Face ${action.direction}` : 'End Turn';
  if (t === 'end-phase') return 'End Phase';
  if (t === 'pass')      return 'Pass';
  if (t === 'ability') {
    const name = action.abilityName ?? action.ability ?? 'Ability';
    if (action.targetId != null) {
      const target = props.units.find(u => u.id === action.targetId);
      return target ? `${name} → ${target.name} (${action.targetId})` : `${name} → ${action.targetId}`;
    }
    return name;
  }
  return t + (action.unitId ? ' ' + action.unitId : '');
}
</script>

<template>
  <div class="ap">
    <div class="panel-t ap-title">
      Actions
      <span v-if="liveState.phase" class="mono ap-phase">
        · {{liveState.phase}}
      </span>
    </div>
    <div v-if="civ" class="ap-empire">
      <button class="action-btn ap-btn ap-btn--sm" @click="showCities = true">Cities</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="showMilitary = true">Military</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="showRates = true">Rates</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="showScience = true">Science</button>
    </div>
    <div v-if="isDone" class="ap-done">
      {{liveState.result?.winner
        ? 'Winner: ' + liveState.result.winner
        : liveState.result?.draw ? 'Draw'
        : liveState.status === 'error' ? ('Error: ' + liveState.error)
        : 'Game over'}}
    </div>
    <div v-else-if="!atLatest" class="ap-past">
      Viewing past state — advance to latest to issue orders.
    </div>
    <template v-else-if="isPending && (ui.freeSelection || (selectedId && selectedId === activeUnitId) || (!selectedId && displayedActions.length))">
      <div class="ap-prompt">
        Choose action for <b class="ap-accent">{{pendingPlayerId}}</b>:
        <span v-if="activeMoney != null" class="mono ap-money">
          {{selectedId}} ${{activeMoney}}</span>
      </div>
      <template v-if="aiming">
        <div class="mono ap-hint ap-hint--aim">
          {{aiming.type === 'throw' ? 'Click the map to throw'
            : aiming.type === 'move' ? 'Click the map to move'
            : aiming.type === 'rotate' ? 'Click the map to face that direction'
            : aiming.type === 'punch' ? 'Click the map to choose a punch direction' : 'Click the map to aim'}}
        </div>
        <button class="action-btn ap-btn" @click="$emit('cancel-aim')">Cancel</button>
      </template>
      <template v-else>
        <div v-if="unitMoves.length && !ui?.aimedActionTypes?.includes('move')" class="mono ap-hint">
          {{queuingMoves ? 'Tap a highlighted square to queue a move' : 'Tap a highlighted square to move'}}
        </div>
        <div class="ap-list">
          <button v-for="(action, i) in listActions" :key="i"
                  class="action-btn ap-btn ap-btn--icon"
                  @click="action.__aim ? $emit('aim', action) : $emit('submit', action)">
            <img v-if="action.icon" :src="imgSrc(action.icon)" alt="" class="ap-icon"/>
            {{fmtAction(action)}}
          </button>
          <div v-if="!listActions.length" class="ap-empty">No actions.</div>
        </div>
      </template>
    </template>
    <template v-else-if="isPending">
      <div class="ap-prompt">
        Click the <b class="ap-accent">{{ui.freeSelection ? 'a piece' : 'active unit'}}</b> on the board to see actions.
      </div>
    </template>
    <div v-else class="ap-waiting">Waiting for AI…</div>
    <RatesOverlay :show="showRates" :civ="myCiv" :taxActions="taxActions" :luxActions="luxActions"
                  @close="showRates = false" @submit="a => $emit('submit', a)"/>
    <ScienceOverlay :show="showScience" :civ="myCiv" :researchActions="researchActions"
                  @close="showScience = false" @submit="a => $emit('submit', a)"/>
    <CitiesOverlay :show="showCities" :cities="cities" :playerId="pendingPlayerId"
                  @close="showCities = false" @goto="g => $emit('goto', g)"/>
    <MilitaryOverlay :show="showMilitary" :military="military" :playerId="pendingPlayerId"
                  @close="showMilitary = false"/>
  </div>
</template>

<style scoped>
.ap { padding: 12px 14px; border-top: 1px solid var(--line); }
.ap-title { margin-bottom: 8px; }
.ap-empire { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
.ap-btn--sm { justify-content: center; padding: 5px 0; }
.ap-phase { font-weight: 400; color: var(--faint); }
.ap-done { font-size: 12px; color: var(--ok); }
.ap-past { font-size: 11px; color: var(--accent); background: rgba(66,198,230,.08); border: 1px solid rgba(66,198,230,.2); border-radius: var(--r); padding: 7px 10px; }
.ap-prompt { font-size: 11px; color: var(--dim); margin-bottom: 8px; }
.ap-accent { color: var(--accent); }
.ap-money { color: var(--ok); }
.ap-hint { font-size: 10px; color: var(--faint); margin-bottom: 8px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 4px; }
.ap-hint--aim { color: var(--accent); }
.ap-btn { font-size: 11px; font-family: var(--mono); }
.ap-btn--icon { display: flex; align-items: center; gap: 6px; }
.ap-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.ap-icon { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.ap-empty { font-size: 11px; color: var(--faint); }
.ap-waiting { font-size: 12px; color: var(--warn); }
</style>
