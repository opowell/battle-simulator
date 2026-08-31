<script setup>
// "Starting units" — the setup-screen editor for the roster a game opens with:
// which units each side has, and (wherever a game's positions are board squares)
// where each of them stands. Entirely generic: the server hands back the game's
// own opening roster, the board it sits on and the unit types that may be added
// (POST /games/:name/setup), and what goes back is the edited roster as
// config.startingUnits. See engine/startingSetup.js for the whole contract.
//
// Off by default, and off means absent: the session config carries no roster at
// all, so the game builds its own opening exactly as it always did.
import { ref, computed, watch } from 'vue';
import SetupBoard from './SetupBoard.vue';

const props = defineProps({
  game:     { type: Object, default: null },
  scenario: { type: String, default: '' },
  // The form's seats, already resolved to the ids the session will be created
  // with (gameDefaults.seatIds), plus name and colour for the list.
  players:  { type: Array, default: () => [] },
  // The rest of the form's game/engine options — the preview has to be built from
  // the same ones, or the roster would be laid out on a different board.
  config:   { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:units', 'update:config']);

const on       = ref(false);
const loading  = ref(false);
const error    = ref('');
const preview  = ref(null);
const roster   = ref([]);          // [{ id?, ownerId, type, position, cell, glyph, imagePath }]
const selected = ref(null);
// The inputs the roster in hand was built from — so a re-fetch happens when the
// board could have changed underneath it, and not merely because we ourselves
// just pinned a map seed into the options.
let builtFrom = '';

const inputKey = () => JSON.stringify({
  g: props.game?.name, s: props.scenario,
  p: props.players.map(p => p.id),
  c: Object.fromEntries(Object.entries(props.config).filter(([k]) => k !== 'startingUnits')),
});

async function load() {
  const key = inputKey();
  const { startingUnits, ...config } = props.config;
  loading.value = true; error.value = '';
  try {
    const data = await window.api.setupPreview(props.game.name, {
      players: props.players.map(p => ({ id: p.id, name: p.name })),
      config,
    });
    preview.value = data;
    roster.value = data.roster.map(u => ({ ...u }));
    selected.value = null;
    // Whatever the game pinned rather than re-rolling (a map seed) goes back into
    // the form, so the session is created on the world these units were placed on.
    const pins = Object.fromEntries(Object.entries(data.config ?? {}).filter(([k, v]) => config[k] !== v));
    builtFrom = JSON.stringify({ ...JSON.parse(key), c: { ...JSON.parse(key).c, ...pins } });
    if (Object.keys(pins).length) emit('update:config', pins);
  } catch (e) {
    error.value = e.message;
    preview.value = null;
    roster.value = [];
  } finally { loading.value = false; }
}

watch([on, () => inputKey()], () => {
  if (!on.value || !props.game) return;
  if (inputKey() === builtFrom && preview.value) return;   // nothing we care about moved
  load();
});

// A game whose units aren't customisable at all (its pieces aren't in `units` —
// Risk's armies, KDice's dice) has nothing for this editor to show.
const supported = computed(() => !preview.value || preview.value.roster.length > 0);
const placeable = computed(() => !!preview.value?.placeable && !!preview.value?.board?.width);

// The roster, grouped the way it is edited: by the side that owns it. Usually the
// seats, but a game may own units under a name of its own (cs's teams, doom's
// demons), so the groups come from the roster rather than from the player list.
const groups = computed(() => {
  const by = new Map();
  for (const u of roster.value) (by.get(u.ownerId) ?? by.set(u.ownerId, []).get(u.ownerId)).push(u);
  return [...by.entries()].map(([ownerId, units]) => {
    const seat = props.players.find(p => p.id === ownerId);
    return { ownerId, units, name: seat?.name ?? ownerId, color: seat?.color ?? 'var(--dim)' };
  });
});

const colorOf = (ownerId) => groups.value.find(g => g.ownerId === ownerId)?.color ?? 'var(--dim)';
const tokens = computed(() => roster.value.map(u => ({ ...u, color: colorOf(u.ownerId) })));

const imgSrc = (path) => window.api.imgSrc(path);

const squareLabel = (u) => (typeof u.position === 'string' ? u.position
  : u.cell ? `${u.cell[0]},${u.cell[1]}` : '—');

// ── editing ────────────────────────────────────────────────────────────────
let added = 0;
const idx = (u) => roster.value.indexOf(u);

function put(i, patch) {
  roster.value = roster.value.map((u, k) => (k === i ? { ...u, ...patch } : u));
}

/**
 * Pick a unit up, or put the one in hand down. One click does both, because on a
 * board they ARE one gesture: an empty hand takes whatever is on the square, a
 * full one places what it is holding — and clicking the square a held unit is
 * already on puts it back down where it was.
 */
function pickCell([col, row]) {
  const here = roster.value.find(u => u.cell && u.cell[0] === col && u.cell[1] === row);
  if (!selected.value) { selected.value = here?.key ?? here?.id ?? null; return; }
  const i = roster.value.findIndex(u => (u.key ?? u.id) === selected.value);
  if (i < 0) { selected.value = null; return; }
  const at = roster.value[i].cell;
  if (at && at[0] === col && at[1] === row) { selected.value = null; return; }
  put(i, { cell: [col, row], position: cellPosition([col, row], roster.value[i]) });
  selected.value = null;
}

/**
 * The game's own kind of position for a board cell. Every cell of the preview board
 * carries it ({x,y}, 'e4', whatever this game uses), so nothing here has to know
 * how any game names a square — see engine/startingSetup.js's cellMapper.
 */
function cellPosition([col, row], like) {
  const cell = (preview.value?.board?.cells ?? []).find(c => c.x === col && c.y === row);
  return cell?.pos ?? like?.position ?? null;
}

function addUnit(ownerId, type) {
  if (!type) return;
  // Next to that side's other units — an added unit should turn up where its army
  // is, not in a corner of the map — and selected, ready to be put somewhere else.
  const home = roster.value.find(u => u.ownerId === ownerId);
  const key = 'new' + (added++);
  roster.value = [...roster.value, {
    key, ownerId, type,
    position: home?.position ?? null,
    cell: home?.cell ?? null,
    glyph: null, imagePath: null,
  }];
  selected.value = key;
}

function removeUnit(u) {
  roster.value = roster.value.filter(x => x !== u);
  selected.value = null;
}

function setType(u, type) {
  // A different unit is a different unit: drop the id so the server builds a new
  // one of that type rather than trying to keep the old one's stats.
  put(idx(u), { type, id: undefined, key: u.key ?? ('new' + (added++)), glyph: null, imagePath: null });
}

function reset() {
  roster.value = (preview.value?.roster ?? []).map(u => ({ ...u }));
  selected.value = null;
}

// What the form sends: the edited roster, or nothing at all when the switch is off.
watch([on, roster], () => {
  emit('update:units', on.value && roster.value.length
    ? roster.value.map(({ ownerId, type, position, id }) => (id ? { id, ownerId, type, position } : { ownerId, type, position }))
    : null);
}, { deep: true });
</script>

<template>
  <div class="su">
    <div class="su-head">
      <div>
        <label class="gsf-section-label">Starting units</label>
        <div class="su-sub">Which units each side begins with{{ placeable ? ', and where they stand' : '' }}</div>
      </div>
      <div class="seg gsf-seg">
        <button :class="{on: !on}" @click="on = false" class="gsf-seg-btn">Default</button>
        <button :class="{on:  on}" @click="on = true"  class="gsf-seg-btn">Custom</button>
      </div>
    </div>

    <div v-if="on" class="su-body">
      <div v-if="loading" class="su-note">Laying out the opening position…</div>
      <div v-else-if="error" class="su-note su-err">{{ error }}</div>
      <div v-else-if="!supported" class="su-note">This game has no per-unit starting roster to edit.</div>
      <template v-else-if="preview">
        <SetupBoard v-if="placeable" :board="preview.board" :tokens="tokens"
                    :selected-id="selected" @pick-cell="pickCell"/>
        <div v-if="placeable" class="su-note">
          {{ selected ? 'Click a square to place it.' : 'Click a unit to pick it up.' }}
        </div>

        <div v-for="g in groups" :key="g.ownerId" class="su-group">
          <div class="su-group-h">
            <BsDot :color="g.color" :size="11"/>
            <span class="su-owner">{{ g.name }}</span>
            <span class="mono su-count">{{ g.units.length }}</span>
            <select class="gsf-input su-add" :value="''" @change="addUnit(g.ownerId, $event.target.value); $event.target.value = ''">
              <option value="">+ Add unit…</option>
              <option v-for="t in preview.unitTypes" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div v-for="u in g.units" :key="u.key ?? u.id" class="su-row"
               :class="{ on: (u.key ?? u.id) === selected }"
               @click="selected = (u.key ?? u.id) === selected ? null : (u.key ?? u.id)">
            <span class="su-token" :style="{ background: g.color }">
              <img v-if="u.imagePath" :src="imgSrc(u.imagePath)" alt=""/>
              <template v-else>{{ (u.glyph || u.type[0]).toUpperCase() }}</template>
            </span>
            <select class="gsf-input su-type" :value="u.type" @click.stop
                    @change="setType(u, $event.target.value)">
              <option v-for="t in preview.unitTypes" :key="t" :value="t">{{ t }}</option>
            </select>
            <span class="mono su-sq">{{ squareLabel(u) }}</span>
            <button class="iconbtn su-rm" @click.stop="removeUnit(u)" title="Remove">
              <BsIcon name="trash" :size="13" color="var(--dim)"/>
            </button>
          </div>
        </div>

        <button class="btn btn-sm btn-ghost su-reset" @click="reset">Reset to the game's own opening</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.su{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
.su-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.su-sub{font-size:11px;color:var(--faint);margin-top:2px}
.su-body{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.su-note{font-size:11px;color:var(--dim)}
.su-err{color:var(--danger)}
.su-group-h{display:flex;align-items:center;gap:8px;margin:6px 0 4px}
.su-owner{font-size:12px;font-weight:600}
.su-count{font-size:11px;color:var(--faint)}
.su-add{margin-left:auto;padding:3px 6px;font-size:11px}
.su-row{display:flex;align-items:center;gap:8px;padding:3px 6px;border:1px solid transparent;border-radius:var(--r);cursor:pointer}
.su-row:hover{background:var(--bg2)}
.su-row.on{border-color:var(--accent);background:var(--bg2)}
.su-token{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;flex:none;
  font-size:10px;font-weight:700;color:#08121a;overflow:hidden}
.su-token img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.su-type{padding:3px 6px;font-size:11px;flex:1;min-width:0}
.su-sq{font-size:11px;color:var(--dim);min-width:46px;text-align:right}
.su-rm{width:24px;height:24px}
.su-reset{align-self:flex-start;margin-top:4px}
</style>
