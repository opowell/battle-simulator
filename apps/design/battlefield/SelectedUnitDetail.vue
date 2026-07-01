<script setup>
defineProps({
  unit:  Object,
  field: Object,
  rdr:   Object,
});
defineEmits(['open-info', 'open-ability-info']);
</script>

<template>
  <div style="padding:12px 14px;border-bottom:1px solid var(--line)">
    <div v-if="unit.portraitPath || unit.imagePath"
         style="display:flex;justify-content:center;margin-bottom:10px">
      <img :src="unit.portraitPath ?? unit.imagePath" :alt="unit.name"
           style="width:72px;height:72px;object-fit:contain;image-rendering:pixelated;border-radius:4px;border:1px solid var(--line)"/>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <BsDot :color="unit.teamObj.raw" :size="9"/>
      <span style="font-weight:700;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--line3)"
            :title="field.ui?.showUnitInfo !== false ? 'View unit info' : ''"
            @click="$emit('open-info', unit)">{{unit.name}}</span>
      <span class="mono" style="font-size:10px;color:var(--faint)">({{unit.id}})</span>
      <span v-if="unit.isActive"
            class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(70,211,154,.15);color:var(--ok)">
        ACTIVE
      </span>
    </div>
    <div v-if="unit.x != null" class="mono" style="font-size:10px;color:var(--faint);margin-bottom:8px">
      ({{Math.floor(unit.x)}}, {{Math.floor(unit.y)}})
    </div>
    <div v-if="unit.dead" class="mono" style="font-size:11px;color:#ff5f56">KIA</div>
    <template v-else>
      <template v-if="unit.hpMax != null && field.ui?.showHpBars !== false">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:10px;color:var(--dim)">HP</span>
          <span class="mono" style="font-size:10px">
            {{Math.round(unit.currentHp ?? unit.hpNow)}} / {{unit.hpMax}}
          </span>
        </div>
        <div style="height:4px;border-radius:2px;overflow:hidden;margin-bottom:6px" :style="{background: rdr.hpTrack}">
          <div style="height:100%;border-radius:2px;transition:width .3s"
               :style="{
                 width: ((unit.currentHp ?? unit.hpNow)/unit.hpMax*100)+'%',
                 background: (unit.currentHp ?? unit.hpNow)/unit.hpMax > 0.5 ? unit.teamObj.raw
                           : (unit.currentHp ?? unit.hpNow)/unit.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
               }"/>
        </div>
      </template>
      <template v-if="unit.maxMp != null">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:10px;color:var(--dim)">MP</span>
          <span class="mono" style="font-size:10px">{{unit.mp ?? 0}} / {{unit.maxMp}}</span>
        </div>
        <div style="height:4px;border-radius:2px;overflow:hidden;margin-bottom:8px;background:rgba(100,80,200,.2)">
          <div style="height:100%;border-radius:2px;background:#9b6fff;transition:width .3s"
               :style="{width: ((unit.mp ?? 0)/unit.maxMp*100)+'%'}"/>
        </div>
      </template>
      <template v-if="unit.stats">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:8px">
          <div v-for="(val, key) in unit.stats" :key="key"
               style="display:flex;flex-direction:column;align-items:center;background:var(--bg3);border-radius:3px;padding:3px 0">
            <span class="mono" style="font-size:12px;font-weight:700;color:var(--txt)">{{val}}</span>
            <span class="up" style="font-size:8px;color:var(--faint)">{{key}}</span>
          </div>
        </div>
      </template>
      <div v-if="unit.moved != null" style="display:flex;gap:5px;margin-bottom:8px">
        <span class="mono" style="font-size:9px;padding:2px 5px;border-radius:3px"
              :style="{background: unit.moved ? 'rgba(255,95,86,.12)' : 'rgba(70,211,154,.12)',
                       color:      unit.moved ? '#ff5f56' : 'var(--ok)'}">
          {{unit.moved ? 'MOVED' : 'CAN MOVE'}}
        </span>
        <span class="mono" style="font-size:9px;padding:2px 5px;border-radius:3px"
              :style="{background: unit.acted ? 'rgba(255,95,86,.12)' : 'rgba(70,211,154,.12)',
                       color:      unit.acted ? '#ff5f56' : 'var(--ok)'}">
          {{unit.acted ? 'ACTED' : 'CAN ACT'}}
        </span>
      </div>
      <div v-if="unit.statusEffects?.length" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
        <span v-for="fx in unit.statusEffects" :key="fx"
              class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(242,180,65,.15);color:#f2b441">
          {{fx}}
        </span>
      </div>
      <div v-if="unit.abilities?.length">
        <div style="font-size:9px;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Abilities</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px">
          <span v-for="ab in unit.abilities" :key="ab.key ?? ab"
                style="font-size:10px;padding:2px 6px;border-radius:3px;background:var(--bg3);cursor:pointer"
                :style="{color: unit.teamObj.raw}"
                @click="$emit('open-ability-info', ab)">
            {{ab.name ?? ab}}
          </span>
        </div>
      </div>
    </template>
    <div style="margin-top:8px;font-size:10px" :style="{color: unit.teamObj.raw + 'cc'}">
      {{unit.teamObj.name}}
    </div>
  </div>
</template>
