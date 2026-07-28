<script setup>
defineProps({
  teams:      Array,
  selectedId: { type: String, default: null },
  rdr:        Object,
  field:      Object,
  showHpBars: { type: Boolean, default: true },
});
defineEmits(['select', 'hover']);

// Same fallback every other HP consumer uses (SchematicLayer/HtmlUnit/SelectedUnitDetail):
// `hpNow` only tracks the scripted death fade, `currentHp` is the real per-turn value.
function hpFrac(u) {
  return (u.currentHp ?? u.hpNow) / u.hpMax;
}

// A portraitless unit shows its board glyph large instead of just a team dot — the same
// text HtmlUnit.vue's unitLabel() pulls from a game's spriteLayers (see CsMiniGame.js's
// numbered circle tokens), falling back to the unit's initial for games with no glyph.
function unitLabel(u) {
  const textLayer = u.spriteLayers?.find(l => l.shape === 'text');
  return textLayer ? textLayer.text : u.name?.[0]?.toUpperCase();
}
</script>

<template>
  <div class="roster">
    <div v-for="team in teams" :key="team.id" class="roster-team">
      <div class="roster-team-head">
        <BsDot :color="team.raw" :size="8"/>
        <span class="roster-team-name">{{team.name}}</span>
        <span class="mono roster-team-count">
          {{team.units.filter(u => !u.dead).length}}/{{team.units.length}}
        </span>
      </div>
      <div class="roster-grid">
        <div v-for="u in team.units" :key="u.id"
             class="roster-card"
             :class="{ 'roster-card--dead': u.dead }"
             :style="{
               borderColor: u.id === selectedId ? team.raw + '80' : 'var(--line)',
               background: u.id === selectedId ? team.raw + '12' : 'var(--bg2)',
             }"
             @click="$emit('select', u.id === selectedId ? null : u.id)"
             @mouseenter="$emit('hover', u.id)"
             @mouseleave="$emit('hover', null)">
          <div class="roster-portrait">
            <img v-if="u.portraitPath || u.imagePath"
                 :src="teamSpriteHref(u.portraitPath ?? u.imagePath, team.raw, field?.ui?.recolorTeamSprites)" :alt="u.name"
                 class="roster-img"/>
            <div v-else class="roster-portrait-empty"
                 :style="{background: u.dead ? 'var(--bg0)' : team.raw + '22'}">
              <span v-if="unitLabel(u)" class="roster-portrait-num"
                    :style="{color: u.dead ? 'var(--faint)' : team.raw}">{{unitLabel(u)}}</span>
              <BsDot v-else :color="u.dead ? 'var(--faint)' : team.raw" :size="10"/>
            </div>
          </div>
          <div class="roster-meta">
            <div class="roster-name" :class="{ 'roster-name--dead': u.dead }">
              {{u.name}}
            </div>
            <div class="mono roster-id">{{u.id}}</div>
          </div>
          <div class="roster-bars">
            <div v-if="!u.dead && u.hpMax != null && showHpBars" class="mono roster-hp-num">
              HP {{Math.round(u.currentHp ?? u.hpNow)}}/{{u.hpMax}}
            </div>
            <div v-if="!u.dead && u.hpMax != null && showHpBars"
                 class="roster-hp-track" :style="{background: rdr.hpTrack}">
              <div class="roster-hp-fill"
                   :style="{
                     width: (hpFrac(u)*100)+'%',
                     background: hpFrac(u) > 0.5 ? team.raw : hpFrac(u) > 0.25 ? '#f2b441' : '#ff5f56',
                   }"/>
            </div>
            <div v-if="!u.dead && u.maxMp != null" class="roster-mp-track">
              <div class="roster-mp-fill" :style="{width: ((u.mp ?? 0)/u.maxMp*100)+'%'}"/>
            </div>
            <div v-if="!u.dead && u.apMax != null" class="mono roster-ap">
              AP {{Number(u.apNow ?? 0).toFixed(u.apNow % 1 ? 1 : 0)}}/{{u.apMax}}
            </div>
            <div v-if="u.dead" class="mono roster-kia">KIA</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roster { flex: 1; padding: 12px 14px; overflow-y: auto; }
.roster-team { margin-bottom: 14px; }
.roster-team-head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.roster-team-name { font-size: 11px; font-weight: 600; }
.roster-team-count { font-size: 10px; color: var(--faint); margin-left: auto; }
.roster-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.roster-card { border-radius: 5px; cursor: pointer; overflow: hidden; border: 1px solid transparent; transition: border-color .15s; }
.roster-card--dead { opacity: 0.38; }
.roster-portrait { width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--bg0); }
.roster-img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: block; }
.roster-portrait-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.roster-portrait-num { font-size: 28px; font-weight: 800; line-height: 1; font-family: ui-monospace, monospace; }
.roster-meta { padding: 4px 5px 3px; }
.roster-name { font-size: 10px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2; color: var(--txt); }
.roster-name--dead { text-decoration: line-through; color: var(--faint); }
.roster-id { font-size: 8px; color: var(--faint); line-height: 1.2; }
.roster-bars { padding: 0 5px 5px; display: flex; flex-direction: column; gap: 2px; }
.roster-hp-num { font-size: 9px; font-weight: 700; color: var(--txt); }
.roster-hp-track { height: 3px; border-radius: 2px; overflow: hidden; }
.roster-hp-fill { height: 100%; border-radius: 2px; transition: width .3s; }
.roster-mp-track { height: 3px; border-radius: 2px; overflow: hidden; background: rgba(100,80,200,.2); }
.roster-mp-fill { height: 100%; border-radius: 2px; background: #9b6fff; transition: width .3s; }
.roster-kia { font-size: 8px; color: #ff5f56; text-align: center; padding-top: 1px; }
.roster-ap { font-size: 8px; color: var(--faint); }
</style>
