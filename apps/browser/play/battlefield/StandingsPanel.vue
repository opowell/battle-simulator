<script setup>
// A game's leaderboard, as its toGrid hands it over (grid.standings):
//   { title?, columns: [{ key, label, title? }], rows: [{ playerId, values, out? }], note? }
// Rows come ranked; this only draws them — a colour dot and name per player (from the
// board's own team list), one cell per column, the player to move marked, and anyone
// knocked out struck through at the foot. Nothing here knows what a column means.
// Two homes, like the orders: the left column (`titled` — it names itself there), or a
// docked panel whose own bar carries the name.
defineProps({
  titled:    { type: Boolean, default: false },
  standings: { type: Object, required: true },
  teams:     { type: Array, default: () => [] },
  // The player whose turn it is, marked in the table.
  activeId:  { type: String, default: null },
});
</script>

<template>
  <div class="sd" :class="{ 'sd--titled': titled }">
    <div v-if="titled" class="panel-t sd-title">{{ standings.title ?? 'Standings' }}</div>
    <table class="sd-table">
      <thead>
        <tr>
          <th class="sd-rank">#</th>
          <th class="sd-name">Player</th>
          <th v-for="c in standings.columns" :key="c.key" class="sd-num" :title="c.title ?? c.label">{{c.label}}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in standings.rows" :key="r.playerId"
            class="sd-row" :class="{ 'sd-row--out': r.out, 'sd-row--active': r.playerId === activeId && !r.out }">
          <td class="sd-rank mono">{{ r.out ? '–' : i + 1 }}</td>
          <td class="sd-name">
            <span class="sd-who">
              <BsDot :color="teams.find(t => t.id === r.playerId)?.raw ?? '#8a96a1'" :size="8"/>
              <span class="sd-pname">{{ teams.find(t => t.id === r.playerId)?.name ?? r.playerId }}</span>
              <span v-if="r.out" class="sd-tag">out</span>
              <span v-else-if="r.playerId === activeId" class="sd-tag sd-tag--turn" title="To move">▶</span>
            </span>
          </td>
          <td v-for="c in standings.columns" :key="c.key" class="sd-num mono">{{ r.out ? '' : r.values?.[c.key] }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="standings.note" class="sd-note">{{ standings.note }}</div>
  </div>
</template>

<style scoped>
.sd { padding: 6px 10px 10px; overflow: auto; box-sizing: border-box; }
.sd--titled { padding: 12px 10px 12px 14px; border-top: 1px solid var(--line); overflow: visible; }
.sd-title { margin-bottom: 6px; }
.sd-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.sd-table th { font-weight: 600; font-size: 10px; color: var(--dim); text-align: left; padding: 4px 3px; border-bottom: 1px solid var(--line); white-space: nowrap; cursor: default; }
.sd-table td { padding: 4px 3px; border-bottom: 1px solid var(--line); }
.sd-num { text-align: right !important; }
.sd-rank { width: 16px; color: var(--faint); }
.sd-who { display: inline-flex; align-items: center; gap: 6px; }
.sd-pname { font-weight: 600; white-space: nowrap; }
.sd-row--active { background: var(--bg2); }
.sd-row--out .sd-pname { text-decoration: line-through; color: var(--faint); font-weight: 400; }
.sd-tag { font-size: 9px; color: var(--faint); text-transform: uppercase; letter-spacing: .04em; }
.sd-tag--turn { color: var(--accent); }
.sd-note { margin-top: 6px; font-size: 10px; color: var(--faint); }
</style>
