<script setup>
import { ref, computed, watch } from 'vue';
import GameGallery from './GameGallery.vue';
import GameScenarioPicker from './GameScenarioPicker.vue';
import GameSetupFields from './GameSetupFields.vue';
import GameThumb from './GameThumb.vue';

const props = defineProps({
  game:     { type: Object,  default: null }, // null while the game list loads
  disabled: { type: Boolean, default: false },
});
defineEmits(['back', 'create', 'analysis-board']);

// The page for one game: what it is and which scenario, alongside how this
// session will be set up. The form seeds itself from the game's own defaults,
// so "Start" on an untouched form is a one-click start.
const cfg     = ref(null);
const scenKey = ref('');

watch(() => props.game, (g) => { scenKey.value = g?.scenarios?.[0]?.id ?? ''; }, { immediate: true });

const playersLabel = computed(() => {
  const g = props.game;
  if (!g) return '';
  return g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;
});
</script>

<template>
  <div class="gp">
   <div class="gp-inner">
    <div class="gp-head">
      <button class="btn btn-ghost btn-sm" @click="$emit('back')">
        <BsIcon name="back" :size="13" color="var(--dim)"/> Back
      </button>
      <span class="up gp-crumb">{{game?.name ?? '…'}}</span>
    </div>

    <div v-if="!game" class="gp-loading">Loading game…</div>

    <div v-else class="gp-cols">
      <!-- Left: what this game is, and which scenario of it to play -->
      <div class="panel gp-about">
        <GameGallery :game="game"/>
        <div class="gp-title">
          <span class="gp-icon"><GameThumb :name="game.name" :size="24"/></span>
          <div class="gp-title-text">
            <div class="gp-name">{{game.name}}</div>
            <div class="mono gp-players">{{playersLabel}}</div>
          </div>
        </div>
        <GameScenarioPicker :scenarios="game.scenarios ?? []" v-model="scenKey"/>
      </div>

      <!-- Right: this session's setup -->
      <div class="panel gp-setup">
        <div class="panel-h"><span class="panel-t">New Session</span></div>
        <div class="panel-b gp-form">
          <GameSetupFields :game="game" :scenario="scenKey" @update:config="cfg = $event"/>
        </div>
        <div class="gp-actions">
          <!-- A board with no opponent: you move every side, nothing is hidden
               from you, and (where the game has one) the database is open. -->
          <button class="btn gp-action" :disabled="disabled || !cfg" @click="$emit('analysis-board', cfg)"
                  title="Study board: play every side yourself, reveal the whole board, keep the database open">
            <BsIcon name="search" :size="14" color="var(--dim)"/> Analysis
          </button>
          <button class="btn btn-primary gp-action gp-start" :disabled="disabled || !cfg"
                  @click="$emit('create', cfg)">
            <BsIcon name="play" :size="15" color="#04222b" :stroke="2"/> Start
          </button>
        </div>
      </div>
    </div>
   </div>
  </div>
</template>

<style scoped>
/* Like the lobby: the page fills the window and each column scrolls inside its
   own panel, so Start never ends up below the fold on a game with a long
   options list. */
.gp{height:100%;padding:20px 24px 24px;display:flex;flex-direction:column;overflow:hidden}
.gp-inner{max-width:1180px;margin:0 auto;width:100%;flex:1;min-height:0;display:flex;flex-direction:column}
.gp-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex:none}
.gp-crumb{font-size:12px;color:var(--dim);letter-spacing:.06em}
.gp-loading{color:var(--faint);font-size:12px;padding:24px 0}
.gp-cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,400px) minmax(0,1fr);gap:16px}
/* Sized to its content (a game with no scenarios is just art and a name), but
   never taller than the page — a long scenario list scrolls inside it. */
.gp-about{align-self:start;max-height:100%;min-height:0;overflow-y:auto}
.gp-title{display:flex;align-items:center;gap:12px;padding:16px 18px;flex:none}
.gp-icon{width:40px;height:40px;border-radius:8px;display:grid;place-items:center;border:1px solid var(--line2);background:var(--bg2);flex:none}
.gp-title-text{min-width:0}
.gp-name{font-weight:700;font-size:18px}
.gp-players{font-size:11px;color:var(--dim)}
.gp-setup{min-height:0}
.gp-form{flex:1;min-height:0;overflow-y:auto;padding:18px 20px}
.gp-actions{flex:none;display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--line)}
.gp-action{justify-content:center;padding:11px 18px}
.gp-start{min-width:180px}

/* Too narrow for two columns: stack them and let the page scroll instead. */
@media (max-width: 900px) {
  .gp{overflow-y:auto}
  .gp-inner{flex:none}
  .gp-cols{display:block;min-height:0}
  .gp-about{overflow:visible;margin-bottom:16px}
  .gp-about :deep(.gg){max-height:220px}
  .gp-form{overflow:visible}
}
</style>
