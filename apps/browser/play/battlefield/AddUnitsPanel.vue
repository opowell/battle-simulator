<script setup>
// "Add units" — put new units straight onto the board of the game in progress.
// Pick a side and a unit type, then click squares on the map: each click adds one
// there. A panel (see PanelDesk); the board's clicks reach it through `place`,
// which the host calls while `armed` says a unit is in hand.
//
// Entirely generic, and the same contract the Game settings units editor uses
// (StartingUnitsField): POST /sessions/:id/setup says which units are on the board,
// which types may be added and the game's own position for every board square;
// what goes back is that roster plus the new unit, through POST /sessions/:id/reconfigure.
// Under fog the roster is only what this seat can see, and the server keeps every
// unit it could not see exactly as it was.
import { ref, computed, watch, onUnmounted } from 'vue';

const props = defineProps({
  liveState: { type: Object, default: null },
  teams:     { type: Array, default: () => [] },   // field.teams — names and colours
  recolor:   Boolean,                               // field.ui.recolorTeamSprites
});
const emit = defineEmits(['arm']);

const preview = ref(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const owner = ref('');
const type = ref('');
const armed = ref(false);

const sessionId = computed(() => props.liveState?.id ?? null);
const by = computed(() => props.liveState?.viewerId ?? null);

async function load() {
  if (!sessionId.value) return;
  loading.value = true; error.value = '';
  try {
    preview.value = await window.api.liveSetup(sessionId.value, { config: {}, by: by.value });
    if (!sides.value.some(s => s.id === owner.value)) owner.value = sides.value[0]?.id ?? '';
    if (!preview.value.unitTypes.includes(type.value)) type.value = preview.value.unitTypes[0] ?? '';
  } catch (e) {
    error.value = e.message;
    preview.value = null;
  } finally { loading.value = false; }
}
load();
// Another turn, or anyone's settings change, can move the units: read them again.
watch(() => `${props.liveState?.turn}|${props.liveState?.changes?.length}`, () => { if (!busy.value) load(); });

// The sides a unit can belong to: the seats, and any side of the game's own that
// already holds units (cs's teams, doom's demons) — see engine/startingSetup.js.
const sides = computed(() => {
  const ids = [...props.teams.map(t => t.id), ...(preview.value?.roster ?? []).map(u => u.ownerId)];
  return [...new Set(ids)].filter(id => id != null).map((id) => {
    const team = props.teams.find(t => t.id === id);
    return { id, name: team?.name ?? id, color: team?.raw ?? team?.color ?? 'var(--dim)' };
  });
});
const side = computed(() => sides.value.find(s => s.id === owner.value) ?? null);
// What a unit of each type looks like for the chosen side (setup's `unitArt`):
// the picker shows the unit itself, its name only on hover.
const artOf = (t) => preview.value?.unitArt?.[owner.value]?.[t]
  ?? { imagePath: null, glyph: String(t)[0]?.toUpperCase() ?? '?', name: t };
const countOf = (id) => (preview.value?.roster ?? []).filter(u => u.ownerId === id).length;

const supported = computed(() => !!preview.value && preview.value.unitTypes.length > 0);
const placeable = computed(() => !!preview.value?.placeable && !!preview.value?.board?.width);

// The roster as reconfigure takes it: units already on the board keep their ids.
const current = () => (preview.value?.roster ?? [])
  .map(({ id, ownerId, type: t, position }) => (id ? { id, ownerId, type: t, position } : { ownerId, type: t, position }));

async function add(position) {
  if (busy.value || !owner.value || !type.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await window.api.reconfigure(sessionId.value, {
      units: [...current(), { ownerId: owner.value, type: type.value, position }],
      by: by.value,
    });
    notice.value = `Added ${type.value} for ${side.value?.name ?? owner.value}.`;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally { busy.value = false; }
}

/** A board square was clicked while a unit is in hand: put one there. */
function place(col, row) {
  if (!armed.value) return false;
  const cell = (preview.value?.board?.cells ?? []).find(c => c.x === col && c.y === row);
  if (cell?.pos == null) { error.value = 'A unit cannot stand on that square.'; return true; }
  add(cell.pos);
  return true;
}
defineExpose({ place, disarm: () => { armed.value = false; } });

// Where squares are not positions a game can be told about, a new unit joins its
// side's army instead — beside the first of its units, as the setup editor does.
function addBesideArmy() {
  const home = (preview.value?.roster ?? []).find(u => u.ownerId === owner.value);
  add(home?.position ?? null);
}

function toggleArmed() { armed.value = !armed.value; }
watch(armed, on => emit('arm', on ? { ownerId: owner.value, type: type.value } : null));
watch([owner, type], () => { if (armed.value) emit('arm', { ownerId: owner.value, type: type.value }); });
// Nothing is left in hand once the panel goes.
onUnmounted(() => { if (armed.value) emit('arm', null); });
</script>

<template>
  <div class="au">
    <div v-if="loading && !preview" class="au-note">Reading the board…</div>
    <div v-else-if="!preview" class="au-note au-err">{{ error || 'This game has no board to add units to.' }}</div>
    <div v-else-if="!supported" class="au-note">This game has no units that can be added.</div>
    <template v-else>
      <label class="au-label">Side</label>
      <div class="au-sides">
        <button v-for="s in sides" :key="s.id" class="au-side" :class="{ on: s.id === owner }" @click="owner = s.id">
          <BsDot :color="s.color" :size="9"/>
          <span class="au-side-name">{{ s.name }}</span>
          <span class="mono au-count">{{ countOf(s.id) }}</span>
        </button>
      </div>

      <label class="au-label">Unit<span v-if="type" class="au-picked"> · {{ artOf(type).name }}</span></label>
      <div class="au-types">
        <button v-for="t in preview.unitTypes" :key="t" class="au-type" :class="{ on: t === type }"
                :title="artOf(t).name" :aria-label="artOf(t).name" @click="type = t">
          <img v-if="artOf(t).imagePath" :src="teamSpriteHref(artOf(t).imagePath, side?.color, recolor)" alt=""/>
          <span v-else class="au-glyph" :style="{ color: side?.color }">{{ artOf(t).glyph }}</span>
        </button>
      </div>

      <div class="au-foot">
        <template v-if="placeable">
          <button class="btn btn-sm" :class="armed ? 'btn-primary' : ''" :disabled="!owner || !type" @click="toggleArmed">
            <BsIcon name="plus" :size="13"/> {{ armed ? 'Placing — click the map' : 'Place on the map' }}
          </button>
          <span class="au-note">{{ armed ? 'Each click on a square adds one. Esc or this button to stop.' : 'Then click squares on the map to add units there.' }}</span>
        </template>
        <template v-else>
          <button class="btn btn-sm btn-primary" :disabled="!owner || !type || busy" @click="addBesideArmy">
            <BsIcon name="plus" :size="13"/> Add beside {{ side?.name ?? 'its side' }}'s army
          </button>
          <span class="au-note">This board's squares aren't places a unit can be put directly.</span>
        </template>
      </div>

      <div v-if="busy" class="au-note">Adding…</div>
      <div v-else-if="error" class="au-note au-err">{{ error }}</div>
      <div v-else-if="notice" class="au-note au-ok">{{ notice }}</div>
      <div v-if="preview.hiddenUnits" class="au-note">
        {{ preview.hiddenUnits }} unit{{ preview.hiddenUnits === 1 ? ' is' : 's are' }} out of your sight, and will stay as they are.
      </div>
    </template>
  </div>
</template>

<style scoped>
.au { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.au-label { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); margin-top: 4px; }
.au-sides { display: flex; flex-direction: column; gap: 3px; }
.au-side { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg2); text-align: left; font-size: 12px; }
.au-side.on, .au-type.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.au-side-name { flex: 1; font-weight: 600; }
.au-count { font-size: 11px; color: var(--faint); }
.au-picked { text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--txt); }
.au-types { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 4px; }
.au-type { aspect-ratio: 1; padding: 3px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg2); cursor: pointer; }
.au-type:hover { border-color: var(--line2); background: var(--bg3); }
.au-type img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: block; }
.au-glyph { font-size: 15px; font-weight: 700; }
.au-foot { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; }
.au-note { font-size: 11px; color: var(--dim); }
.au-err { color: var(--danger); }
.au-ok { color: var(--ok); }
</style>
