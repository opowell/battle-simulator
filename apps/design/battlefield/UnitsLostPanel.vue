<script setup>
defineProps({ teams: Array });
</script>

<template>
  <div class="lost">
    <div class="panel-t lost-title">Captured</div>
    <div v-if="teams.every(t => !t.units.length)" class="lost-empty">
      None yet.
    </div>
    <div v-for="team in teams" :key="team.id">
      <template v-if="team.units.length">
        <div class="lost-team">
          <BsDot :color="team.raw" :size="7"/>
          <span class="lost-team-name">{{team.name}}</span>
          <span class="mono lost-count">{{team.units.length}}</span>
        </div>
        <div class="lost-units">
          <span v-for="u in team.units" :key="u.id" class="mono lost-unit">
            {{u.name}}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.lost { padding: 12px 14px; border-top: 1px solid var(--line); }
.lost-title { margin-bottom: 8px; }
.lost-empty { font-size: 11px; color: var(--faint); }
.lost-team { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; margin-top: 8px; }
.lost-team-name { font-size: 10px; font-weight: 600; }
.lost-count { font-size: 10px; color: var(--faint); margin-left: auto; }
.lost-units { display: flex; flex-wrap: wrap; gap: 4px; }
.lost-unit { font-size: 11px; padding: 2px 7px; border-radius: 3px; background: var(--bg2); color: var(--faint); text-decoration: line-through; }
</style>
