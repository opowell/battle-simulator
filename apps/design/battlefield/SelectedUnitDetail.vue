<script setup>
defineProps({
  unit:       Object,
  field:      Object,
  rdr:        Object,
  showHpBars: { type: Boolean, default: true },
});
defineEmits(['open-info', 'open-ability-info']);
const imgSrc = window.api.imgSrc;
</script>

<template>
  <div class="sud">
    <div v-if="unit.portraitPath || unit.imagePath" class="sud-portrait">
      <img :src="teamSpriteHref(unit.portraitPath ?? unit.imagePath, unit.teamObj?.raw, field?.ui?.recolorTeamSprites)" :alt="unit.name"
           class="sud-portrait-img"/>
    </div>
    <div class="sud-namerow">
      <BsDot :color="unit.teamObj.raw" :size="9"/>
      <span class="sud-name"
            :title="field.ui?.showUnitInfo !== false ? 'View unit info' : ''"
            @click="$emit('open-info', unit)">{{unit.name}}</span>
      <span class="mono sud-id">({{unit.id}})</span>
      <span v-if="unit.isActive" class="mono sud-active">
        ACTIVE
      </span>
    </div>
    <!-- Which group this unit belongs to, in that group's own colour (see App.vue's
         `tags`) — Risk's continent. Sits directly under the name because it's part of
         naming the thing, not a stat about it. -->
    <div v-if="unit.tags?.length" class="sud-tags">
      <span v-for="tag in unit.tags" :key="tag.label" class="sud-tag" :title="tag.title ?? ''">
        <!-- The group's own colour as a swatch rather than as the chip's text, so the
             label stays legible whether that colour is a dark map fill or a bright one. -->
        <BsDot v-if="tag.color" :color="tag.color" :size="8"/>
        {{tag.label}}
      </span>
    </div>
    <div v-if="unit.x != null" class="mono sud-coord">
      ({{Math.floor(unit.x)}}, {{Math.floor(unit.y)}})
    </div>
    <div v-if="unit.money != null" class="mono sud-money">
      ${{unit.money}}
    </div>
    <div v-if="unit.dead" class="mono sud-kia">KIA</div>
    <template v-else>
      <template v-if="unit.hpMax != null && showHpBars">
        <div class="sud-barlabel">
          <span class="sud-barlabel-k">HP</span>
          <span class="mono sud-barlabel-v">
            {{Math.round(unit.currentHp ?? unit.hpNow)}} / {{unit.hpMax}}
          </span>
        </div>
        <div class="sud-hp-track" :style="{background: rdr.hpTrack}">
          <div class="sud-hp-fill"
               :style="{
                 width: ((unit.currentHp ?? unit.hpNow)/unit.hpMax*100)+'%',
                 background: (unit.currentHp ?? unit.hpNow)/unit.hpMax > 0.5 ? unit.teamObj.raw
                           : (unit.currentHp ?? unit.hpNow)/unit.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
               }"/>
        </div>
      </template>
      <template v-if="unit.maxMp != null">
        <div class="sud-barlabel">
          <span class="sud-barlabel-k">MP</span>
          <span class="mono sud-barlabel-v">{{unit.mp ?? 0}} / {{unit.maxMp}}</span>
        </div>
        <div class="sud-mp-track">
          <div class="sud-mp-fill" :style="{width: ((unit.mp ?? 0)/unit.maxMp*100)+'%'}"/>
        </div>
      </template>
      <!-- Queued future moves (civ1 goto orders) — shown only for the selected unit;
           the map draws every unit's queue (see HtmlLayer's queueSegments/queueDots). -->
      <div v-if="unit.queue?.length && field.ui?.moveQueue !== false" class="sud-section">
        <div class="sud-section-title">Queued moves</div>
        <div class="sud-queue-list">
          <span v-for="(wp, i) in unit.queue" :key="i" class="sud-queue-chip">
            {{i+1}}. ({{wp.x}}, {{wp.y}})
          </span>
        </div>
        <div class="mono sud-queue-hint">Backspace removes the last one</div>
      </div>
      <template v-if="unit.stats">
        <div class="sud-stats">
          <div v-for="(val, key) in unit.stats" :key="key" class="sud-stat">
            <span class="mono sud-stat-v">{{val}}</span>
            <span class="up sud-stat-k">{{key}}</span>
          </div>
        </div>
      </template>
      <div v-if="unit.moved != null" class="sud-flags">
        <span class="mono sud-flag" :class="unit.moved ? 'sud-flag--bad' : 'sud-flag--ok'">
          {{unit.moved ? 'MOVED' : 'CAN MOVE'}}
        </span>
        <span class="mono sud-flag" :class="unit.acted ? 'sud-flag--bad' : 'sud-flag--ok'">
          {{unit.acted ? 'ACTED' : 'CAN ACT'}}
        </span>
      </div>
      <div v-if="unit.statusEffects?.length" class="sud-status">
        <span v-for="fx in unit.statusEffects" :key="fx" class="mono sud-status-tag">
          {{fx}}
        </span>
      </div>
      <div v-if="unit.equipment?.length" class="sud-section">
        <div class="sud-section-title">Equipment</div>
        <div class="sud-eq-list">
          <div v-for="eq in unit.equipment" :key="eq.label" class="sud-eq">
            <span class="sud-eq-label">{{eq.label}}</span>
            <span class="sud-eq-val">
              <img v-if="eq.icon" :src="imgSrc(eq.icon)" :alt="eq.value" class="sud-eq-icon"/>
              <span class="mono sud-eq-num">{{eq.value}}</span>
            </span>
          </div>
        </div>
      </div>
      <div v-if="unit.abilities?.length">
        <div class="sud-section-title">Abilities</div>
        <div class="sud-abilities">
          <span v-for="ab in unit.abilities" :key="ab.key ?? ab"
                class="sud-ability"
                :style="{color: unit.teamObj.raw}"
                @click="$emit('open-ability-info', ab)">
            {{ab.name ?? ab}}
          </span>
        </div>
      </div>
    </template>
    <div class="sud-team" :style="{color: unit.teamObj.raw + 'cc'}">
      {{unit.teamObj.name}}
    </div>
  </div>
</template>

<style scoped>
.sud { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.sud-portrait { display: flex; justify-content: center; margin-bottom: 10px; }
.sud-portrait-img { width: 72px; height: 72px; object-fit: contain; image-rendering: pixelated; border-radius: 4px; border: 1px solid var(--line); }
.sud-namerow { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.sud-name { font-weight: 700; font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--line3); }
.sud-id { font-size: 10px; color: var(--faint); }
.sud-active { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(70,211,154,.15); color: var(--ok); }
.sud-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.sud-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; padding: 2px 7px; border-radius: 10px; background: var(--bg3); color: var(--txt); }
.sud-coord { font-size: 10px; color: var(--faint); margin-bottom: 8px; }
.sud-money { font-size: 11px; color: var(--ok); margin-bottom: 8px; }
.sud-kia { font-size: 11px; color: #ff5f56; }
.sud-barlabel { display: flex; justify-content: space-between; margin-bottom: 3px; }
.sud-barlabel-k { font-size: 10px; color: var(--dim); }
.sud-barlabel-v { font-size: 10px; }
.sud-hp-track { height: 4px; border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
.sud-hp-fill { height: 100%; border-radius: 2px; transition: width .3s; }
.sud-mp-track { height: 4px; border-radius: 2px; overflow: hidden; margin-bottom: 8px; background: rgba(100,80,200,.2); }
.sud-mp-fill { height: 100%; border-radius: 2px; background: #9b6fff; transition: width .3s; }
.sud-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 4px; margin-bottom: 8px; }
.sud-stat { display: flex; flex-direction: column; align-items: center; background: var(--bg3); border-radius: 3px; padding: 3px 0; }
.sud-stat-v { font-size: 12px; font-weight: 700; color: var(--txt); }
.sud-stat-k { font-size: 8px; color: var(--faint); }
.sud-flags { display: flex; gap: 5px; margin-bottom: 8px; }
.sud-flag { font-size: 9px; padding: 2px 5px; border-radius: 3px; }
.sud-flag--bad { background: rgba(255,95,86,.12); color: #ff5f56; }
.sud-flag--ok { background: rgba(70,211,154,.12); color: var(--ok); }
.sud-status { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.sud-status-tag { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(242,180,65,.15); color: #f2b441; }
.sud-section { margin-bottom: 8px; }
.sud-section-title { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
.sud-queue-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.sud-queue-chip { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: var(--bg3); color: var(--txt); font-family: var(--mono); }
.sud-queue-hint { font-size: 9px; color: var(--faint); }
.sud-eq-list { display: flex; flex-direction: column; gap: 2px; }
.sud-eq { display: flex; align-items: center; justify-content: space-between; font-size: 10px; }
.sud-eq-label { color: var(--faint); }
.sud-eq-val { display: flex; align-items: center; gap: 5px; }
.sud-eq-icon { width: 18px; height: 18px; object-fit: contain; }
.sud-eq-num { color: var(--txt); }
.sud-abilities { display: flex; flex-wrap: wrap; gap: 3px; }
.sud-ability { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--bg3); cursor: pointer; }
.sud-team { margin-top: 8px; font-size: 10px; }
</style>
