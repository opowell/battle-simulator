<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  sessions:  { type: Array,  default: () => [] },
  apiGames:  { type: Array,  default: () => [] },
  serverErr: { type: String, default: '' },
});

const emit = defineEmits(['open-session', 'create', 'delete-session', 'refresh']);

const TEAM_COLORS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)', '#b48cff', '#ff9e64'];

const selGame  = ref('cs');
const game     = computed(() => GAMES.find(g => g.key === selGame.value) || GAMES[0]);
const scens    = computed(() => scenariosFor(selGame.value));
const scenKey  = ref(scens.value[0]?.key ?? '');
const name     = ref('');
const fog      = ref(true);
const maxTurns = ref(300);
const slots    = ref(makeSlots(game.value));

function makeSlots(g, n) {
  n = Math.max(2, Math.min(g.max, n || g.min));
  return Array.from({ length: n }, (_, i) => ({
    id:    'slot' + i,
    name:  i === 0 ? 'You' : (g.multi && i > 0 && i < g.min ? 'Open slot' : 'CPU ' + i),
    agent: i === 0 ? 'human' : (g.multi && i < g.min && i > 0 ? 'open' : 'ai'),
    color: TEAM_COLORS[i % TEAM_COLORS.length],
  }));
}

function pick(g) {
  selGame.value = g.key;
  name.value = '';
  const sc = scenariosFor(g.key)[0];
  if (sc) { scenKey.value = sc.key; applyScenario(game.value, sc); }
  else     { slots.value = makeSlots(g); }
}

function chooseScenario(sc) {
  scenKey.value = sc.key;
  applyScenario(game.value, sc);
}

function applyScenario(g, sc) {
  maxTurns.value = sc.maxTurns ?? 300;
  if (sc.fog != null) fog.value = sc.fog;
  slots.value = makeSlots(g, sc.players);
}

function addSlot() {
  if (slots.value.length >= game.value.max) return;
  slots.value = [...slots.value, {
    id:    'slot' + slots.value.length,
    name:  'CPU ' + slots.value.length,
    agent: 'ai',
    color: TEAM_COLORS[slots.value.length % TEAM_COLORS.length],
  }];
}

function rmSlot(i) {
  if (slots.value.length <= 2) return;
  slots.value = slots.value.filter((_, k) => k !== i);
}

function setSlot(i, patch) {
  slots.value = slots.value.map((sl, k) => k === i ? { ...sl, ...patch } : sl);
}

function cycleColor(i) {
  const idx = TEAM_COLORS.indexOf(slots.value[i].color);
  setSlot(i, { color: TEAM_COLORS[(idx + 1) % TEAM_COLORS.length] });
}

function handleCreate() {
  emit('create', {
    game:      selGame.value,
    name:      name.value || game.value.name,
    fog:       fog.value,
    maxTurns:  maxTurns.value,
    players:   slots.value,
  });
}

function gameFor(key) { return GAMES.find(x => x.key === key) || {}; }

function sessionStatusLabel(s) {
  if (s.status === 'done')   return 'Finished';
  if (s.status === 'error')  return 'Error';
  if (s.pendingPlayer)       return 'Your turn';
  return 'Active';
}

function sessionStatusColor(s) {
  if (s.status === 'done' || s.status === 'error') return 'var(--faint)';
  if (s.pendingPlayer) return 'var(--ok)';
  return 'var(--warn)';
}
</script>

<template>
  <div class="lobby">

    <!-- ── Left: Active Sessions ── -->
    <div class="panel" style="min-height:0">
      <div class="panel-h">
        <span class="panel-t">Active Sessions</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font-size:11px;color:var(--dim)">{{sessions.length}} live</span>
          <button class="btn btn-sm btn-ghost" style="padding:3px 8px" @click="$emit('refresh')" title="Refresh">
            <BsIcon name="clock" :size="12" color="var(--dim)"/>
          </button>
        </div>
      </div>
      <div class="panel-b">

        <!-- Server error -->
        <div v-if="serverErr"
             style="padding:10px 12px;border:1px solid var(--danger);border-radius:var(--r);background:rgba(255,95,86,.07);font-size:12px;color:var(--danger);margin-bottom:12px">
          ⚠ {{serverErr}}
        </div>

        <!-- Empty state -->
        <div v-if="!sessions.length && !serverErr"
             style="padding:20px 0;color:var(--faint);font-size:12px;text-align:center">
          No active sessions — create one →
        </div>

        <!-- Session rows -->
        <div v-for="s in sessions" :key="s.id" class="sessionrow">
          <div class="gicon">
            <BsIcon :name="gameFor(s.game).icon || 'grid'" :size="20" color="var(--accent)"/>
          </div>
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:9px;min-width:0">
              <b style="font-weight:600;white-space:nowrap;flex:none">
                {{gameFor(s.game).name || s.game}}
              </b>
              <span class="mono" style="font-size:10px;color:var(--faint);flex:none">
                #{{s.id.slice(0, 8)}}
              </span>
              <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;flex:none"
                    :style="{color: sessionStatusColor(s)}">
                <BsDot :color="sessionStatusColor(s)" :size="7"/>
                {{sessionStatusLabel(s)}}
              </span>
            </div>
            <div style="margin-top:5px;display:flex;gap:10px">
              <span class="mono" style="font-size:10px;color:var(--faint)">turn {{s.turn ?? 0}}</span>
              <span v-if="s.pendingPlayer"
                    class="mono" style="font-size:10px;color:var(--dim)">
                · waiting: {{s.pendingPlayer}}
              </span>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-sm btn-ghost" style="padding:4px 7px;opacity:.5"
                    title="Delete session"
                    @click.stop="$emit('delete-session', s.id)">✕</button>
            <button class="btn btn-sm" @click="$emit('open-session', s)"
                    :style="s.pendingPlayer ? {borderColor:'var(--accent)',color:'var(--accent)'} : {}">
              {{s.status === 'done' ? 'Review' : 'Resume'}}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Right: New Session ── -->
    <div class="panel" style="min-height:0">
      <div class="panel-h">
        <span class="panel-t">New Session</span>
        <span style="font-size:16px;color:var(--dim);line-height:1">+</span>
      </div>
      <div class="panel-b">

        <!-- 1 · Game -->
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:9px">
          1 · Game definition
        </div>
        <div class="gamegrid">
          <div v-for="g in GAMES" :key="g.key"
               class="gamecard" :class="{sel: g.key === selGame}"
               @click="pick(g)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <BsIcon :name="g.icon" :size="20" :color="g.key === selGame ? 'var(--accent)' : 'var(--txt)'"/>
              <span class="mono" style="font-size:9px;color:var(--faint)">{{g.key}}</span>
            </div>
            <div>
              <div style="font-weight:600;font-size:13px">{{g.name}}</div>
              <div style="font-size:10.5px;color:var(--dim)">{{g.cat}}</div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <span class="tag">{{g.min === g.max ? g.min : g.min + '–' + g.max}}P</span>
              <span class="tag">{{g.multi ? 'multi' : 'solo'}}</span>
            </div>
          </div>
        </div>

        <!-- 2 · Scenario -->
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:10px">
            2 · Scenario
          </div>
          <button v-for="sc in scens" :key="sc.key"
                  class="scenrow" :class="{sel: sc.key === scenKey}"
                  @click="chooseScenario(sc)">
            <div class="scenmark">
              <BsIcon name="flag" :size="14"/>
            </div>
            <div style="min-width:0;text-align:left">
              <div style="font-weight:600;font-size:13px">
                {{sc.name}}
                <span class="mono" style="margin-left:7px;font-size:10px;color:var(--dim);font-weight:400">{{sc.sub}}</span>
              </div>
              <div style="font-size:11px;color:var(--dim);margin-top:2px">{{sc.blurb}}</div>
            </div>
            <span class="mono" style="font-size:10px;color:var(--faint);white-space:nowrap">{{sc.players}}P</span>
          </button>
        </div>

        <!-- 3 · Configure -->
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <span style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)">3 · Configure</span>
            <span style="display:flex;align-items:center;gap:8px">
              <BsIcon :name="game.icon" :size="15" color="var(--accent)"/>
              <b style="font-size:13px">{{game.name}}</b>
            </span>
          </div>
          <p style="font-size:12px;color:var(--dim);margin:0 0 14px">{{game.blurb}}</p>

          <div class="field" style="margin-bottom:14px">
            <label>Session name</label>
            <input v-model="name" :placeholder="game.name + ' — ' + new Date().toISOString().slice(5,16).replace('T',' ')"/>
          </div>

          <!-- Player slots -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <label style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)">Players</label>
            <button class="btn btn-sm btn-ghost" @click="addSlot" :disabled="slots.length >= game.max">
              + Add slot
            </button>
          </div>
          <div v-for="(sl, i) in slots" :key="sl.id" class="slot">
            <button @click="cycleColor(i)" title="Cycle colour"
                    style="border:none;background:none;padding:0;cursor:pointer;line-height:0">
              <BsDot :color="sl.color" :size="13"/>
            </button>
            <input :value="sl.name" @input="setSlot(i, {name: $event.target.value})"
                   style="padding:5px 8px;font-size:12px"/>
            <select :value="sl.agent" @change="setSlot(i, {agent: $event.target.value})"
                    style="padding:5px 8px;font-size:12px">
              <option value="human">Human</option>
              <option value="ai">AI (random)</option>
            </select>
            <button class="iconbtn" style="width:30px;height:30px" @click="rmSlot(i)"
                    :disabled="slots.length <= 2">
              <BsIcon name="trash" :size="14" color="var(--dim)"/>
            </button>
          </div>

          <!-- Engine config -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px">
            <div class="field">
              <label>Fog of war</label>
              <div class="seg" style="font-size:11px">
                <button :class="{on: !fog}" @click="fog = false" style="padding:3px 9px">Off</button>
                <button :class="{on: fog}"  @click="fog = true"  style="padding:3px 9px">On</button>
              </div>
            </div>
            <div class="field">
              <label>Max turns · {{maxTurns}}</label>
              <input type="range" min="50" max="500" step="10" v-model.number="maxTurns"/>
            </div>
          </div>

          <button class="btn btn-primary"
                  style="width:100%;justify-content:center;margin-top:18px;padding:11px"
                  :disabled="!!serverErr"
                  @click="handleCreate">
            <BsIcon name="play" :size="15" color="#04222b" :stroke="2"/>
            Create &amp; enter battlefield
          </button>
          <div v-if="serverErr" style="margin-top:8px;font-size:11px;color:var(--danger);text-align:center">
            Server offline — start it with: node api-server.js
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
