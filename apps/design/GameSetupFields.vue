<script setup>
import { ref, computed, watch } from 'vue';
import AiDifficultyField from './AiDifficultyField.vue';

const props = defineProps({
  game:     { type: Object, default: null },
  // Chosen next door, in GameScenarioPicker: picking one re-seeds the fields it
  // has an opinion about (turn limit, fog, player slots).
  scenario: { type: String, default: '' },
});
// The whole form as one object, re-emitted on every change; the parent decides
// what to do with it (start a session, open an analysis board, …).
const emit = defineEmits(['update:config']);

const maxTurns = ref(300);
const gameOpts = ref({});
const slots    = ref([]);

// Lay a scenario's config over the game's plain defaults. Called with the options
// already re-seeded, so leaving a scenario also leaves whatever it had set rather
// than carrying it into the next one.
function applyScenario(sc) {
  const ov = gameDefaults.scenarioOverrides(sc);
  maxTurns.value = ov.maxTurns ?? 300;
  gameOpts.value = { ...gameOpts.value, ...ov.config };
  // A scenario may seat the table itself — e.g. two AIs and no human seat, for a
  // match that is watched rather than played.
  slots.value = gameDefaults.makeSlots(props.game, null, ov.players);
}

// Re-seed the whole form whenever a different game — or scenario — is chosen.
watch(() => props.game, (g) => {
  if (!g) return;
  gameOpts.value = gameDefaults.initGameOpts(g);
  maxTurns.value = 300;
  applyScenario(g.scenarios?.find(s => s.id === props.scenario));
}, { immediate: true });

watch(() => props.scenario, () => {
  if (!props.game) return;
  gameOpts.value = gameDefaults.initGameOpts(props.game);
  applyScenario(props.game.scenarios?.find(s => s.id === props.scenario));
});

watch([maxTurns, gameOpts, slots, () => props.scenario], () => {
  if (!props.game) return;
  emit('update:config', {
    game:     props.game.name,
    gameOpts: { ...gameOpts.value },
    maxTurns: maxTurns.value,
    scenario: props.scenario || undefined,
    players:  slots.value,
  });
}, { deep: true, immediate: true });

// The colours a slot can be cycled through: one per seat this game can seat, so
// the choice never runs out before the seats do (teamPalette generates them).
const palette = computed(() => teamPalette.seatColors(props.game, props.game?.maxPlayers ?? 8));

function addSlot() {
  const max = props.game?.maxPlayers ?? 8;
  if (slots.value.length >= max) return;
  slots.value = [...slots.value, {
    id:    'slot' + slots.value.length,
    name:  'CPU ' + slots.value.length,
    agent: gameDefaults.defaultCpuAgent(props.game),
    color: palette.value[slots.value.length],
  }];
}

function rmSlot(i) {
  const min = props.game?.minPlayers ?? 2;
  if (slots.value.length <= min) return;
  slots.value = slots.value.filter((_, k) => k !== i);
}

function setSlot(i, patch) {
  slots.value = slots.value.map((sl, k) => k === i ? { ...sl, ...patch } : sl);
}

function cycleColor(i) {
  const idx = palette.value.indexOf(slots.value[i].color);
  setSlot(i, { color: palette.value[(idx + 1) % palette.value.length] });
}
</script>

<template>
  <div v-if="game" class="gsf">
    <!-- Player slots -->
    <div class="gsf-players-head">
      <label class="gsf-section-label">Players</label>
      <button v-if="game.minPlayers !== game.maxPlayers"
              class="btn btn-sm btn-ghost" @click="addSlot" :disabled="slots.length >= (game.maxPlayers ?? 8)">
        + Add slot
      </button>
    </div>
    <div v-for="(sl, i) in slots" :key="sl.id" class="slot">
      <button @click="cycleColor(i)" title="Cycle colour" class="gsf-color-btn">
        <BsDot :color="sl.color" :size="13"/>
      </button>
      <input :value="sl.name" @input="setSlot(i, {name: $event.target.value})" class="gsf-input"/>
      <select :value="sl.agent" @change="setSlot(i, {agent: $event.target.value})" class="gsf-input">
        <option value="human">Human</option>
        <option v-for="a in (game.agents ?? [])" :key="a.id" :value="a.id">{{a.name}}</option>
      </select>
      <button v-if="game.minPlayers !== game.maxPlayers"
              class="iconbtn gsf-rm" @click="rmSlot(i)"
              :disabled="slots.length <= (game.minPlayers ?? 2)">
        <BsIcon name="trash" :size="14" color="var(--dim)"/>
      </button>
    </div>

    <!-- Game options + engine config -->
    <div class="gsf-options">
      <template v-for="opt in (game.gameOptions ?? [])" :key="opt.id">
        <div v-if="opt.type === 'boolean'" class="field">
          <label>{{opt.label}}</label>
          <div class="seg gsf-seg">
            <button :class="{on: !gameOpts[opt.id]}" @click="gameOpts[opt.id] = false" class="gsf-seg-btn">Off</button>
            <button :class="{on:  gameOpts[opt.id]}" @click="gameOpts[opt.id] = true"  class="gsf-seg-btn">On</button>
          </div>
        </div>
        <div v-else-if="opt.type === 'select'" class="field">
          <label>{{opt.label}}</label>
          <select v-model="gameOpts[opt.id]" class="gsf-input">
            <option v-for="o in opt.options" :key="o.value" :value="o.value">{{o.label}}</option>
          </select>
        </div>
        <div v-else-if="opt.type === 'range'" class="field" :title="opt.description">
          <label>{{opt.label}} · {{gameOpts[opt.id]}}</label>
          <input type="range" :min="opt.min ?? 0" :max="opt.max ?? 100" :step="opt.step ?? 1" v-model.number="gameOpts[opt.id]"/>
        </div>
        <div v-else-if="opt.type === 'integer'" class="field" :title="opt.description">
          <label>{{opt.label}}</label>
          <input type="text" inputmode="numeric" class="gsf-input"
                 :placeholder="opt.placeholder ?? ''"
                 :value="gameOpts[opt.id]"
                 @input="gameOpts[opt.id] = $event.target.value.replace(/[^0-9]/g, '')"/>
        </div>
        <AiDifficultyField v-else-if="opt.type === 'ai-difficulty'" :opt="opt"
          v-model:power="gameOpts[opt.id]"
          v-model:time="gameOpts[opt.timeKey ?? 'aiTimeMs']"
          v-model:mode="gameOpts[opt.id + 'Mode']"/>
      </template>
      <div class="field">
        <label>Max turns · {{maxTurns}}</label>
        <input type="range" min="50" max="500" step="10" v-model.number="maxTurns"/>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gsf-section-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.gsf-players-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.gsf-players-head .gsf-section-label{margin-bottom:0}
.gsf-color-btn{border:none;background:none;padding:0;cursor:pointer;line-height:0}
.gsf-input{padding:5px 8px;font-size:12px}
.gsf-rm{width:30px;height:30px}
.gsf-options{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.gsf-seg{font-size:11px}
.gsf-seg-btn{padding:3px 9px}
</style>
