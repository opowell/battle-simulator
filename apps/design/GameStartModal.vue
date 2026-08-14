<script setup>
import { ref, computed, watch } from 'vue';
import GameGallery from './GameGallery.vue';
import GameScenarioPicker from './GameScenarioPicker.vue';
import GameSetupFields from './GameSetupFields.vue';
import GameThumb from './GameThumb.vue';

const props = defineProps({
  game:     { type: Object,  default: null }, // null = closed
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'create', 'analysis-board']);

// One dialog: what the game is and which scenario, plus how this session is set
// up. The form seeds itself from the game's defaults, so "Start" on an untouched
// form is the old one-click quick start.
const cfg     = ref(null);
const scenKey = ref('');

watch(() => props.game, (g) => { scenKey.value = g?.scenarios?.[0]?.id ?? ''; }, { immediate: true });

// A game with scenarios to choose between earns the two-column layout: cover art
// and scenarios beside the form. Without them there is nothing to put in that
// column, so the dialog stays narrow and stacks instead.
const wide = computed(() => (props.game?.scenarios?.length ?? 0) > 0);

const playersLabel = computed(() => {
  const g = props.game;
  if (!g) return '';
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;
});
</script>

<template>
  <teleport to="body">
    <div v-if="game" class="modal-scrim" @click.self="$emit('close')">
      <div class="modal-panel gsm" :class="{'gsm--wide': wide}">
        <button class="modal-close" @click="$emit('close')">×</button>

        <div class="gsm-cols">
          <div class="gsm-left">
            <GameGallery :game="game"/>
            <div class="gsm-head">
              <span class="gsm-icon"><GameThumb :name="game.name" :size="22"/></span>
              <div class="gsm-name-wrap">
                <div class="gsm-name">{{game.name}}</div>
                <div class="mono gsm-players">{{playersLabel}}</div>
              </div>
            </div>
            <GameScenarioPicker :scenarios="game.scenarios ?? []" v-model="scenKey"/>
          </div>

          <div class="gsm-right">
            <div class="gsm-right-head">
              <span class="gsm-right-title">New session</span>
            </div>
            <div class="gsm-form">
              <GameSetupFields :game="game" :scenario="scenKey" @update:config="cfg = $event"/>
            </div>
          </div>
        </div>

        <div class="gsm-actions">
          <!-- A board with no opponent: you move every side, nothing is hidden
               from you, and (where the game has one) the database is open. -->
          <button class="btn gsm-action" :disabled="disabled || !cfg" @click="$emit('analysis-board', cfg)"
                  title="Study board: play every side yourself, reveal the whole board, keep the database open">
            <BsIcon name="search" :size="14" color="var(--dim)"/> Analysis
          </button>
          <button class="btn btn-primary gsm-action gsm-start" :disabled="disabled || !cfg"
                  @click="$emit('create', cfg)">
            <BsIcon name="play" :size="15" color="#04222b" :stroke="2"/> Start
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
/* Stacked: cover art on top, form under it, the whole thing scrolling. */
.gsm{width:560px;max-width:92vw;max-height:88vh}
.gsm-cols{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto}
.gsm-left{display:flex;flex-direction:column;flex:none}
/* Stacked, the cover art is a banner over the form, not the main event. */
.gsm-left :deep(.gg){max-height:200px}
.gsm-right{display:flex;flex-direction:column}
.gsm-right-head{display:none}
.gsm-form{padding:18px 20px}
.gsm-head{display:flex;align-items:center;gap:12px;padding:16px 18px}
.gsm-icon{width:38px;height:38px;border-radius:8px;display:grid;place-items:center;border:1px solid var(--line2);background:var(--bg2);flex:none}
.gsm-name-wrap{min-width:0}
.gsm-name{font-weight:700;font-size:17px}
.gsm-players{font-size:11px;color:var(--dim)}
.gsm-actions{flex:none;display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--line)}
.gsm-action{justify-content:center;padding:11px 18px}
.gsm-start{min-width:180px}

/* Side by side, once there is a scenario list to fill the left column and room
   on screen for it. Each column scrolls on its own. */
@media (min-width: 860px) {
  .gsm--wide{width:900px}
  .gsm--wide .gsm-cols{flex-direction:row;overflow:hidden}
  .gsm--wide .gsm-left{width:340px;border-right:1px solid var(--line);overflow-y:auto}
  .gsm--wide .gsm-left :deep(.gg){max-height:none}
  .gsm--wide .gsm-right{flex:1;min-width:0;min-height:0}
  .gsm--wide .gsm-right-head{display:flex;align-items:center;flex:none;padding:14px 18px;border-bottom:1px solid var(--line)}
  .gsm--wide .gsm-form{flex:1;min-height:0;overflow-y:auto}
}
.gsm-right-title{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
</style>
