<script setup>
defineProps({ teams: Array });
</script>

<template>
  <div style="padding:12px 14px;border-top:1px solid var(--line)">
    <div class="panel-t" style="margin-bottom:8px">Captured</div>
    <div v-if="teams.every(t => !t.units.length)" style="font-size:11px;color:var(--faint)">
      None yet.
    </div>
    <div v-for="team in teams" :key="team.id">
      <template v-if="team.units.length">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;margin-top:8px">
          <BsDot :color="team.raw" :size="7"/>
          <span style="font-size:10px;font-weight:600">{{team.name}}</span>
          <span class="mono" style="font-size:10px;color:var(--faint);margin-left:auto">{{team.units.length}}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span v-for="u in team.units" :key="u.id"
                class="mono"
                style="font-size:11px;padding:2px 7px;border-radius:3px;background:var(--bg2);color:var(--faint);text-decoration:line-through">
            {{u.name}}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
