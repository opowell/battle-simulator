<script setup>
import { computed } from 'vue';
const props = defineProps({
  field:           Object,
  liveState:       Object,
  isLive:          Boolean,
  isDone:          Boolean,
  isPending:       Boolean,
  pendingPlayerId: { type: String, default: null },
  // Whose economy to show in the status strip below — the human's own side, not
  // necessarily whoever's turn it currently is (see Battlefield's analysisPlayerId).
  // Only civ1 populates field.civ, so this renders nothing for every other game.
  statusPlayerId:  { type: String, default: null },
  showMenu:        Boolean,
  ui:              Object,
  // Board renderer switch — only offered for square tile grids, the boards HtmlLayer can
  // draw (see Battlefield's isGridBoard). Lets you A/B the SVG and HTML renderers live.
  showRenderer:    { type: Boolean, default: false },
  htmlRenderer:    { type: Boolean, default: false },
});
defineEmits(['toggle-menu', 'show-help', 'set-renderer']);
const myCiv = computed(() => props.field?.civ?.[props.statusPlayerId] ?? null);
</script>

<template>
  <div class="gh">
    <div class="gh-top">
      <BsIcon name="crosshair" :size="14" color="var(--accent)"/>
      <span v-if="ui.help" class="gh-game gh-game--link"
            :title="'How to play ' + field.game"
            @click="$emit('show-help')">
        {{field.game}}
        <span class="gh-help">?</span>
      </span>
      <span v-else class="gh-game">{{field.game}}</span>
      <button class="iconbtn gh-menu-btn" title="Menu"
              :class="{ 'gh-menu-btn--on': showMenu }"
              @click="$emit('toggle-menu')">
        <BsIcon name="grid" :size="12" :color="showMenu ? 'var(--accent)' : 'var(--dim)'"/>
      </button>
      <span class="mono gh-turn">Turn {{liveState?.turn ?? 0}}</span>
    </div>
    <div v-if="isLive" class="gh-status">
      <span v-if="isDone" class="gh-chip gh-chip--ok">
        ✓ {{liveState.result?.winner ? 'Winner: ' + liveState.result.winner : 'Game over'}}
      </span>
      <span v-else-if="isPending" class="mono gh-chip gh-chip--ok">
        ● Your turn · {{pendingPlayerId}}
      </span>
      <span v-else class="mono gh-chip gh-chip--warn">
        ○ AI thinking…
      </span>
    </div>
    <div v-if="myCiv" class="mono gh-civstat">
      <span class="gh-civstat-item" title="Treasury">
        <BsIcon name="zap" :size="10" color="var(--faint)"/>{{myCiv.gold}}
      </span>
      <span class="gh-civstat-item" title="Government">{{myCiv.government}}</span>
      <span class="gh-civstat-item" title="Tax / Luxury / Science">
        {{myCiv.taxRate}}/{{myCiv.luxRate}}/{{100 - myCiv.taxRate - myCiv.luxRate}}
      </span>
      <span v-if="myCiv.research" class="gh-civstat-item" title="Researching">{{myCiv.research}}</span>
      <span v-if="myCiv.anarchyTurns" class="gh-civstat-item gh-civstat-item--warn">Anarchy</span>
    </div>
    <div v-if="showRenderer" class="gh-rdr">
      <span class="gh-rdr-label">Board</span>
      <div class="seg gh-seg">
        <button :class="{ on: !htmlRenderer }" class="gh-seg-btn"
                title="Draw the board with the SVG renderer"
                @click="$emit('set-renderer', false)">SVG</button>
        <button :class="{ on: htmlRenderer }" class="gh-seg-btn"
                title="Draw the board with the HTML renderer"
                @click="$emit('set-renderer', true)">HTML</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gh { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.gh-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.gh-game { font-weight: 700; font-size: 14px; }
.gh-game--link { cursor: pointer; display: flex; align-items: center; gap: 5px; }
.gh-help { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(66,198,230,.12); color: var(--accent); font-weight: 500; letter-spacing: .04em; }
.gh-menu-btn { width: 22px; height: 22px; }
.gh-menu-btn--on { border-color: var(--accent); }
.gh-turn { font-size: 11px; color: var(--faint); margin-left: auto; }
.gh-status { display: flex; }
.gh-civstat { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--dim); }
.gh-civstat-item { display: flex; align-items: center; gap: 3px; }
.gh-civstat-item--warn { color: var(--warn); }
.gh-rdr { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.gh-rdr-label { font-size: 10px; color: var(--faint); letter-spacing: .06em; text-transform: uppercase; }
.gh-seg { font-size: 10px; margin-left: auto; }
.gh-seg-btn { padding: 2px 8px; }
.gh-chip { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.gh-chip--ok { background: rgba(70,211,154,.1); color: var(--ok); }
.gh-chip--warn { background: rgba(242,180,65,.1); color: var(--warn); }
</style>
