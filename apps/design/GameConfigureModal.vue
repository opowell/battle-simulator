<script setup>
import { ref, computed, watch } from 'vue';
import AiDifficultyField from './AiDifficultyField.vue';
import GameThumb from './GameThumb.vue';

const props = defineProps({
  game:     { type: Object,  default: null }, // null = closed
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'create']);

const scens    = computed(() => props.game?.scenarios ?? []);
const scenKey  = ref('');
const name     = ref('');
const maxTurns = ref(300);
const gameOpts = ref({});
const slots    = ref([]);

function applyScenario(sc) {
  const ov = gameDefaults.scenarioOverrides(sc);
  maxTurns.value = ov.maxTurns ?? 300;
  if (ov.fogOfWar != null) gameOpts.value = { ...gameOpts.value, fogOfWar: ov.fogOfWar };
  slots.value = gameDefaults.makeSlots(props.game);
}

// Re-seed the whole form whenever a different game is opened.
watch(() => props.game, (g) => {
  if (!g) return;
  name.value = '';
  gameOpts.value = gameDefaults.initGameOpts(g);
  const sc = g.scenarios?.[0];
  if (sc) { scenKey.value = sc.id; applyScenario(sc); }
  else    { scenKey.value = ''; maxTurns.value = 300; slots.value = gameDefaults.makeSlots(g); }
}, { immediate: true });

function chooseScenario(sc) {
  scenKey.value = sc.id;
  applyScenario(sc);
}

function addSlot() {
  const max = props.game?.maxPlayers ?? 8;
  if (slots.value.length >= max) return;
  slots.value = [...slots.value, {
    id:    'slot' + slots.value.length,
    name:  'CPU ' + slots.value.length,
    agent: gameDefaults.defaultCpuAgent(props.game),
    color: gameDefaults.TEAM_COLORS[slots.value.length % gameDefaults.TEAM_COLORS.length],
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
  const idx = gameDefaults.TEAM_COLORS.indexOf(slots.value[i].color);
  setSlot(i, { color: gameDefaults.TEAM_COLORS[(idx + 1) % gameDefaults.TEAM_COLORS.length] });
}

function handleCreate() {
  emit('create', {
    game:      props.game.name,
    name:      name.value || props.game.name,
    gameOpts:  { ...gameOpts.value },
    maxTurns:  maxTurns.value,
    scenario:  scenKey.value,
    players:   slots.value,
  });
}
</script>

<template>
  <teleport to="body">
    <div v-if="game" class="modal-scrim" @click.self="$emit('close')">
      <div class="modal-panel gcm">
        <div class="gcm-head">
          <GameThumb :name="game.name" :size="20"/>
          <b class="gcm-name">{{game.name}}</b>
          <span class="gcm-sub">Configure</span>
        </div>
        <button class="modal-close gcm-close" @click="$emit('close')">×</button>

        <div class="gcm-body">
          <!-- Scenario -->
          <div v-if="scens.length" class="gcm-scenario">
            <div class="gcm-section-label">Scenario</div>
            <button v-for="sc in scens" :key="sc.id"
                    class="scenrow" :class="{sel: sc.id === scenKey}"
                    @click="chooseScenario(sc)">
              <div class="scenmark">
                <BsIcon name="flag" :size="14"/>
              </div>
              <div class="gcm-scen-text">
                <div class="gcm-scen-name">{{sc.name}}</div>
                <div class="gcm-scen-desc">{{sc.description}}</div>
              </div>
            </button>
          </div>

          <div class="field gcm-name-field">
            <label>Session name</label>
            <input v-model="name" :placeholder="(game.name ?? 'game') + ' — ' + new Date().toISOString().slice(5,16).replace('T',' ')"/>
          </div>

          <!-- Player slots -->
          <div class="gcm-players-head">
            <label class="gcm-players-label">Players</label>
            <button v-if="game.minPlayers !== game.maxPlayers"
                    class="btn btn-sm btn-ghost" @click="addSlot" :disabled="slots.length >= (game.maxPlayers ?? 8)">
              + Add slot
            </button>
          </div>
          <div v-for="(sl, i) in slots" :key="sl.id" class="slot">
            <button @click="cycleColor(i)" title="Cycle colour" class="gcm-color-btn">
              <BsDot :color="sl.color" :size="13"/>
            </button>
            <input :value="sl.name" @input="setSlot(i, {name: $event.target.value})" class="gcm-input"/>
            <select :value="sl.agent" @change="setSlot(i, {agent: $event.target.value})" class="gcm-input">
              <option value="human">Human</option>
              <option v-for="a in (game.agents ?? [])" :key="a.id" :value="a.id">{{a.name}}</option>
            </select>
            <button v-if="game.minPlayers !== game.maxPlayers"
                    class="iconbtn gcm-rm" @click="rmSlot(i)"
                    :disabled="slots.length <= (game.minPlayers ?? 2)">
              <BsIcon name="trash" :size="14" color="var(--dim)"/>
            </button>
          </div>

          <!-- Game options + engine config -->
          <div class="gcm-options">
            <template v-for="opt in (game.gameOptions ?? [])" :key="opt.id">
              <div v-if="opt.type === 'boolean'" class="field">
                <label>{{opt.label}}</label>
                <div class="seg gcm-seg">
                  <button :class="{on: !gameOpts[opt.id]}" @click="gameOpts[opt.id] = false" class="gcm-seg-btn">Off</button>
                  <button :class="{on:  gameOpts[opt.id]}" @click="gameOpts[opt.id] = true"  class="gcm-seg-btn">On</button>
                </div>
              </div>
              <div v-else-if="opt.type === 'select'" class="field">
                <label>{{opt.label}}</label>
                <select v-model="gameOpts[opt.id]" class="gcm-input">
                  <option v-for="o in opt.options" :key="o.value" :value="o.value">{{o.label}}</option>
                </select>
              </div>
              <div v-else-if="opt.type === 'range'" class="field" :title="opt.description">
                <label>{{opt.label}} · {{gameOpts[opt.id]}}</label>
                <input type="range" :min="opt.min ?? 0" :max="opt.max ?? 100" :step="opt.step ?? 1" v-model.number="gameOpts[opt.id]"/>
              </div>
              <div v-else-if="opt.type === 'integer'" class="field" :title="opt.description">
                <label>{{opt.label}}</label>
                <input type="text" inputmode="numeric" class="gcm-input"
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

          <button class="btn btn-primary gcm-start"
                  :disabled="disabled"
                  @click="handleCreate">
            <BsIcon name="play" :size="15" color="#04222b" :stroke="2"/>
            Start
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.gcm{width:560px;max-width:92vw;max-height:88vh}
.gcm-head{display:flex;align-items:center;gap:9px;padding:14px 44px 14px 18px;border-bottom:1px solid var(--line);flex:none}
.gcm-body{padding:18px 20px;overflow-y:auto}
.gcm-name{font-size:14px}
.gcm-sub{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.gcm-close{position:absolute;top:9px;right:10px}
.gcm-scenario{margin-bottom:16px}
.gcm-section-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.gcm-scen-text{min-width:0;text-align:left}
.gcm-scen-name{font-weight:600;font-size:13px}
.gcm-scen-desc{font-size:11px;color:var(--dim);margin-top:2px}
.gcm-name-field{margin-bottom:14px}
.gcm-players-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.gcm-players-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
.gcm-color-btn{border:none;background:none;padding:0;cursor:pointer;line-height:0}
.gcm-input{padding:5px 8px;font-size:12px}
.gcm-rm{width:30px;height:30px}
.gcm-options{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.gcm-seg{font-size:11px}
.gcm-seg-btn{padding:3px 9px}
.gcm-start{width:100%;justify-content:center;margin-top:18px;padding:11px}
</style>
