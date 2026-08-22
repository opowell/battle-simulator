<script setup>
import { computed } from 'vue';
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
  // Observer lock-step: the turn on screen has finished and the game is parked
  // until Next (see App.vue's awaitingStep) — nothing is being computed.
  awaitingStep:     { type: Boolean, default: false },
  liveState:        Object,
  units:            { type: Array, default: () => [] },
  // Set while the player is aiming a "button → pick a spot on the map" action (see
  // Battlefield.vue's `aiming`) — swaps the action list for a cancel prompt.
  aiming:           { type: Object, default: null },
  // Pair-action strength picker (ui.territoryPairVariant — Risk's attack dice): the
  // values the position offers, the one currently picked (null = the strongest the pair
  // allows), and what to call it. Battlefield owns the choice; a map click reads it.
  variantSpec:      { type: Object, default: null },
  variantValues:    { type: Array, default: () => [] },
  variantValue:     { type: Number, default: null },
  // Per-owner economy snapshot (civ1 only — see Civ1Game.toGrid's `civ` field),
  // keyed by player id. Drives the tax/luxury/science rates overlay below.
  civ:              { type: Object, default: null },
  // Every visible city / per-owner military roster (civ1 only — see Civ1Game.toGrid's
  // `cities`/`military` fields). Drive the Cities/Military overlays.
  cities:           { type: Array, default: () => [] },
  military:         { type: Object, default: null },
  // Which overview overlay is open ('cities'|'military'|'rates'|'science'|null).
  // Owned by Battlefield.vue rather than a local ref, because a keyboard binding can
  // open one too (ui.keys' `panel` effect — see keyBindings.js); the toolbar buttons
  // below just ask for the same change through update:panel.
  panel:            { type: String, default: null },
  // The viewer holds no seat — they are watching a game, not playing one (see
  // Battlefield's isObserver). There are no orders for them to give, so the panel
  // keeps only what is worth reading: the overview screens and the final result.
  observing:        { type: Boolean, default: false },
  // Whose empire the overview screens describe. Null follows the player currently
  // to move, which is what a seated player wants (it is always them). An observer
  // is never told a pending player — the server only names seats it is waiting on,
  // and an all-AI session has none — so Battlefield passes one explicitly, and the
  // screens stay on that civ instead of describing nobody.
  overviewPlayerId: { type: String, default: null },
});
defineEmits(['submit', 'aim', 'cancel-aim', 'goto', 'update:panel', 'set-variant']);

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
const taxActions      = computed(() => props.displayedActions.filter(a => a.type === 'set-tax'));
const luxActions      = computed(() => props.displayedActions.filter(a => a.type === 'set-luxury'));
const researchActions = computed(() => props.displayedActions.filter(a => a.type === 'set-research'));
// The empire the overview screens report on: whoever the viewer is watching
// through, falling back to the player to move (see overviewPlayerId).
const overviewId      = computed(() => props.overviewPlayerId ?? props.pendingPlayerId);
const myCiv           = computed(() => props.civ?.[overviewId.value] ?? null);

// With no seat and no overview screens to offer, an observer's panel would be an
// empty titled box — draw nothing at all instead. A finished game still has its
// result to report, whoever is watching.
const hasContent      = computed(() => !props.observing || !!props.civ || props.isDone);

// set-production also moves out: with more than one city its flat label ("Build
// militia") doesn't even say which city, and the City Inspector overlay (opened by
// clicking a city — see Battlefield.vue's selectedCity) already disambiguates that
// for free.
const OVERLAY_HANDLED = new Set(['set-tax', 'set-luxury', 'set-research', 'set-production']);
const allListActions = computed(() => aimedActions.value.filter(a => !OVERLAY_HANDLED.has(a.type)));

// One choice offered at several sizes — Risk's "how many armies follow the dice into the
// territory you just took" — arrives as a run of actions identical but for one number.
// A column of near-identical buttons is a bad way to ask "how many?", so those collapse
// into a single row of numbers. Purely structural: the panel doesn't know what the
// number means, only that it is the one thing that varies.
const NUMERIC_CHOICE_MIN = 3;
const numericChoices = computed(() => {
  const byType = new Map();
  for (const a of allListActions.value) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }
  const groups = [];
  for (const [type, actions] of byType) {
    if (actions.length < NUMERIC_CHOICE_MIN) continue;
    const keys = [...new Set(actions.flatMap(a => Object.keys(a)))].filter(k => k !== 'type');
    const varying = keys.filter(k => new Set(actions.map(a => JSON.stringify(a[k]))).size > 1);
    if (varying.length !== 1) continue;
    const field = varying[0];
    if (!actions.every(a => typeof a[field] === 'number')) continue;
    groups.push({ type, field, actions: [...actions].sort((a, b) => a[field] - b[field]) });
  }
  return groups;
});
const groupedTypes = computed(() => new Set(numericChoices.value.map(g => g.type)));
const listActions = computed(() => allListActions.value.filter(a => !groupedTypes.value.has(a.type)));

// Territory games (ui.territoryClick — kdice, risk) issue every territory action on the
// map, so the panel can be empty while there is plenty to do. Say what the map does
// instead: the game's own sentence for the phase in play (ui.phaseHints) if it wrote
// one — that is where a game explains what its current phase means, rules included —
// otherwise the generic shape of the clicks, where a tap acts on one territory only if
// the game named a tap action (ui.territoryTapType).
const territoryHint = computed(() => {
  const perPhase = props.ui?.phaseHints?.[props.liveState?.phase];
  if (perPhase) return perPhase;
  if (!props.ui?.territoryClick) return null;
  return props.ui.territoryTapType
    ? 'Tap a territory to act on it, or select one and click a neighbour.'
    : 'Select a territory, then click a neighbour.';
});

function fmtAction(action) {
  const t = action.type ?? '';
  // A game that knows how to say what one of its actions does says it (getLegalActions
  // may put a `label` on any action) — nothing here can describe "turn in these three
  // cards for six armies" from the action's fields alone.
  if (action.label) return action.label;
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
  // Territory-map actions (see Battlefield's territory-click flow): several buttons of
  // the same type differ only in which territory they act on, so name it — and the size
  // of the action where it carries one ("place-armies 3 → Ontario").
  if (action.territoryId != null) {
    const unit = props.units.find(u => u.id === action.territoryId);
    const where = unit?.name ?? action.territoryId;
    return action.count != null ? `${t} ${action.count} → ${where}` : `${t} → ${where}`;
  }
  return t + (action.unitId ? ' ' + action.unitId : '');
}
</script>

<template>
  <div v-if="hasContent" class="ap">
    <div class="panel-t ap-title">
      {{ observing ? 'Overview' : 'Actions' }}
      <span v-if="liveState.phase" class="mono ap-phase">
        · {{liveState.phase}}
      </span>
    </div>
    <div v-if="civ" class="ap-empire">
      <button class="action-btn ap-btn ap-btn--sm" @click="$emit('update:panel', 'cities')">Cities</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="$emit('update:panel', 'military')">Military</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="$emit('update:panel', 'rates')">Rates</button>
      <button class="action-btn ap-btn ap-btn--sm" @click="$emit('update:panel', 'science')">Science</button>
    </div>
    <div v-if="isDone" class="ap-done">
      {{liveState.result?.winner
        ? 'Winner: ' + liveState.result.winner
        : liveState.result?.draw ? 'Draw'
        : liveState.status === 'error' ? ('Error: ' + liveState.error)
        : 'Game over'}}
    </div>
    <!-- Everything below is about taking a turn, so none of it is for an observer:
         no orders to issue, and no "waiting for AI" either — the AI is the whole
         point of what they are watching, not something holding them up. -->
    <template v-else-if="!observing">
      <div v-if="!atLatest" class="ap-past">
        Viewing past state — advance to latest to issue orders.
      </div>
      <template v-else-if="isPending && (ui.freeSelection || ui.territoryClick || (selectedId && selectedId === activeUnitId) || (!selectedId && displayedActions.length))">
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
          <div v-else-if="territoryHint" class="mono ap-hint">{{territoryHint}}</div>
          <!-- Pair-action strength (Risk's attack dice): picked here, spent by a click on
               the map. "max" is the default and follows whatever the pair can manage. -->
          <div v-if="variantSpec && variantValues.length > 1" class="ap-variant">
            <span class="mono ap-variant-label">{{variantSpec.label ?? 'Strength'}}</span>
            <button class="ap-chip" :class="{ 'ap-chip--on': variantValue == null }"
                    title="Commit as many as the attack allows"
                    @click="$emit('set-variant', null)">max</button>
            <button v-for="v in variantValues" :key="v"
                    class="ap-chip" :class="{ 'ap-chip--on': variantValue === v }"
                    @click="$emit('set-variant', v)">{{v}}</button>
          </div>
          <!-- One choice at several sizes (Risk's occupying force) — a row of numbers. -->
          <div v-for="g in numericChoices" :key="'nc' + g.type" class="ap-variant">
            <span class="mono ap-variant-label">{{ui?.actionGroupLabels?.[g.type] ?? g.type.replace(/-/g, ' ')}}</span>
            <button v-for="a in g.actions" :key="a[g.field]"
                    class="ap-chip" @click="$emit('submit', a)">{{a[g.field]}}</button>
          </div>
          <div class="ap-list">
            <button v-for="(action, i) in listActions" :key="i"
                    class="action-btn ap-btn ap-btn--icon"
                    @click="action.__aim ? $emit('aim', action) : $emit('submit', action)">
              <img v-if="action.icon" :src="imgSrc(action.icon)" alt="" class="ap-icon"/>
              {{fmtAction(action)}}
            </button>
            <!-- On a territory map an empty list is normal: the hint above already says
                 where the actions are. -->
            <div v-if="!listActions.length && !numericChoices.length && !territoryHint" class="ap-empty">No actions.</div>
          </div>
        </template>
      </template>
      <template v-else-if="isPending">
        <div class="ap-prompt">
          Click the <b class="ap-accent">{{ui.freeSelection ? 'a piece' : 'active unit'}}</b> on the board to see actions.
        </div>
      </template>
      <div v-else class="ap-waiting">{{ awaitingStep ? 'Paused — press Next to play the turn.' : 'Waiting for AI…' }}</div>
    </template>
    <RatesOverlay :show="panel === 'rates'" :civ="myCiv" :taxActions="taxActions" :luxActions="luxActions"
                  @close="$emit('update:panel', null)" @submit="a => $emit('submit', a)"/>
    <ScienceOverlay :show="panel === 'science'" :civ="myCiv" :researchActions="researchActions"
                  @close="$emit('update:panel', null)" @submit="a => $emit('submit', a)"/>
    <CitiesOverlay :show="panel === 'cities'" :cities="cities" :playerId="overviewId"
                  @close="$emit('update:panel', null)" @goto="g => $emit('goto', g)"/>
    <MilitaryOverlay :show="panel === 'military'" :military="military" :playerId="overviewId"
                  @close="$emit('update:panel', null)"/>
  </div>
</template>

<style scoped>
.ap { padding: 12px 14px; border-top: 1px solid var(--line); }
.ap-title { margin-bottom: 8px; }
/* The global `.action-btn + .action-btn` margin is for stacked lists; in this
   grid it would only skip the first cell, so the row heights come out uneven. */
.ap-empire { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
.ap-empire .action-btn { margin-top: 0; }
.ap-btn--sm { justify-content: center; padding: 5px 0; }
.ap-phase { font-weight: 400; color: var(--faint); }
.ap-done { font-size: 12px; color: var(--ok); }
.ap-past { font-size: 11px; color: var(--accent); background: rgba(66,198,230,.08); border: 1px solid rgba(66,198,230,.2); border-radius: var(--r); padding: 7px 10px; }
.ap-prompt { font-size: 11px; color: var(--dim); margin-bottom: 8px; }
.ap-accent { color: var(--accent); }
.ap-money { color: var(--ok); }
.ap-variant { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.ap-variant-label { font-size: 10px; color: var(--faint); margin-right: 2px; }
.ap-chip { font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--line2); background: transparent; color: var(--dim); cursor: pointer; }
.ap-chip:hover { border-color: var(--accent); color: var(--accent); }
.ap-chip--on { border-color: var(--accent); color: var(--accent); background: rgba(66,198,230,.12); }
.ap-hint { font-size: 10px; color: var(--faint); margin-bottom: 8px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 4px; }
.ap-hint--aim { color: var(--accent); }
.ap-btn { font-size: 11px; font-family: var(--mono); }
.ap-btn--icon { display: flex; align-items: center; gap: 6px; }
.ap-list { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.ap-icon { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.ap-empty { font-size: 11px; color: var(--faint); }
.ap-waiting { font-size: 12px; color: var(--warn); }
</style>
