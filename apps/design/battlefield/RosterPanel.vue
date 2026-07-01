<script setup>
defineProps({
  teams:      Array,
  selectedId: { type: String, default: null },
  rdr:        Object,
  field:      Object,
});
defineEmits(['select']);
</script>

<template>
  <div style="flex:1;padding:12px 14px;overflow-y:auto">
    <div v-for="team in teams" :key="team.id" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
        <BsDot :color="team.raw" :size="8"/>
        <span style="font-size:11px;font-weight:600">{{team.name}}</span>
        <span class="mono" style="font-size:10px;color:var(--faint);margin-left:auto">
          {{team.units.filter(u => !u.dead).length}}/{{team.units.length}}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <div v-for="u in team.units" :key="u.id"
             style="border-radius:5px;cursor:pointer;overflow:hidden;border:1px solid transparent;transition:border-color .15s"
             :style="{
               borderColor: u.id === selectedId ? team.raw + '80' : 'var(--line)',
               background: u.id === selectedId ? team.raw + '12' : 'var(--bg2)',
               opacity: u.dead ? 0.38 : 1,
             }"
             @click="$emit('select', u.id === selectedId ? null : u.id)">
          <div style="width:100%;aspect-ratio:1;overflow:hidden;background:var(--bg0)">
            <img v-if="u.portraitPath || u.imagePath"
                 :src="u.portraitPath ?? u.imagePath" :alt="u.name"
                 style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block"/>
            <div v-else style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">
              <BsDot :color="u.dead ? 'var(--faint)' : team.raw" :size="10"/>
            </div>
          </div>
          <div style="padding:4px 5px 3px">
            <div style="font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2"
                 :style="{textDecoration: u.dead ? 'line-through' : 'none', color: u.dead ? 'var(--faint)' : 'var(--txt)'}">
              {{u.name}}
            </div>
            <div class="mono" style="font-size:8px;color:var(--faint);line-height:1.2">{{u.id}}</div>
          </div>
          <div style="padding:0 5px 5px;display:flex;flex-direction:column;gap:2px">
            <div v-if="!u.dead && u.hpMax != null && field.ui?.showHpBars !== false"
                 style="height:3px;border-radius:2px;overflow:hidden" :style="{background: rdr.hpTrack}">
              <div style="height:100%;border-radius:2px;transition:width .3s"
                   :style="{
                     width: (u.hpNow/u.hpMax*100)+'%',
                     background: u.hpNow/u.hpMax > 0.5 ? team.raw : u.hpNow/u.hpMax > 0.25 ? '#f2b441' : '#ff5f56',
                   }"/>
            </div>
            <div v-if="!u.dead && u.maxMp != null"
                 style="height:3px;border-radius:2px;overflow:hidden;background:rgba(100,80,200,.2)">
              <div style="height:100%;border-radius:2px;background:#9b6fff;transition:width .3s"
                   :style="{width: ((u.mp ?? 0)/u.maxMp*100)+'%'}"/>
            </div>
            <div v-if="u.dead" class="mono" style="font-size:8px;color:#ff5f56;text-align:center;padding-top:1px">KIA</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
