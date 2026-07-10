<script setup>
defineProps({ ability: { type: Object, default: null } });
defineEmits(['close']);

function fmtAbilityEffect(ab) {
  const pct = ab.power ? Math.round(ab.power * 100) + '%' : null;
  const e = ab.effect ?? '';
  if (e === 'damage') {
    let s = pct ? `${pct} ATK` : 'Damage';
    if (ab.aoe) s += ` · AoE`;
    if (ab.knockback) s += ' · knockback';
    return s;
  }
  if (e === 'damage+status') {
    let s = pct ? `${pct} ATK` : 'Damage';
    if (ab.status) s += ` + ${ab.status}`;
    if (ab.aoe) s += ' · AoE';
    if (ab.knockback) s += ' · knockback';
    return s;
  }
  if (e === 'damage+steal-mp') return `${pct ? pct + ' ATK' : 'Damage'} + steal MP`;
  if (e === 'heal')        return `Heal (${pct ?? ''} MAG)`;
  if (e === 'heal-fixed')  return `+${ab.healAmount} HP`;
  if (e === 'heal-full')   return 'Full HP restore';
  if (e === 'status') { let s = ab.status ?? 'Status'; if (ab.aoe) s += ' · AoE'; return s; }
  if (e === 'steal-mp')    return 'Steal MP';
  if (e === 'cleanse')     return 'Remove all status effects';
  if (e === 'cleanse-one') return `Remove ${ab.status}`;
  if (e === 'restore-mp')  return `+${ab.mpAmount} MP`;
  if (e === 'revive')      return `Revive at ${Math.round((ab.reviveHpPct ?? 0.25) * 100)}% HP`;
  if (e === 'elixir')      return 'Full HP + MP restore';
  return e;
}

function abilityTypeMeta(type) {
  if (type === 'physical') return { label: 'PHY', kind: 'physical' };
  if (type === 'magic')    return { label: 'MAG', kind: 'magic' };
  if (type === 'item')     return { label: 'ITM', kind: 'item' };
  return                          { label: 'SUP', kind: 'support' };
}
</script>

<template>
  <teleport to="body">
    <div v-if="ability" class="aio-scrim" @click.self="$emit('close')">
      <div class="aio-panel">
        <div class="aio-head">
          <span class="mono aio-badge" :class="'aio-badge--' + abilityTypeMeta(ability.type).kind">
            {{abilityTypeMeta(ability.type).label}}
          </span>
          <span class="aio-name">{{ability.name}}</span>
          <button class="aio-close" @click="$emit('close')">
            ×
          </button>
        </div>
        <div class="aio-body">
          <div v-if="ability.effect">
            <div class="up aio-label">Effect</div>
            <div class="aio-effect">{{fmtAbilityEffect(ability)}}</div>
          </div>
          <div class="aio-stats">
            <div v-if="ability.range != null">
              <div class="up aio-label">Range</div>
              <div class="mono aio-stat">{{ability.range === 0 ? '—' : ability.range}}</div>
            </div>
            <div v-if="ability.mpCost">
              <div class="up aio-label">MP Cost</div>
              <div class="mono aio-stat aio-stat--mp">{{ability.mpCost}}</div>
            </div>
            <div v-if="ability.target">
              <div class="up aio-label">Target</div>
              <div class="mono aio-stat aio-stat--target">{{ability.target}}</div>
            </div>
            <div v-if="ability.power">
              <div class="up aio-label">Power</div>
              <div class="mono aio-stat">{{Math.round(ability.power * 100)}}%</div>
            </div>
          </div>
          <div v-if="ability.status || ability.aoe || ability.knockback" class="aio-tags">
            <span v-if="ability.status" class="mono aio-tag aio-tag--status">
              {{ability.status}}
            </span>
            <span v-if="ability.aoe" class="mono aio-tag aio-tag--aoe">
              AoE{{ability.aoeRadius ? ' r' + ability.aoeRadius : ''}}
            </span>
            <span v-if="ability.knockback" class="mono aio-tag aio-tag--knockback">
              knockback
            </span>
          </div>
          <p v-if="ability.description" class="aio-desc">
            {{ability.description}}
          </p>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.aio-scrim { position: fixed; inset: 0; z-index: 1001; background: rgba(4,7,10,.55); display: flex; align-items: center; justify-content: center; }
.aio-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 340px; max-width: 88vw; overflow: hidden; box-shadow: 0 24px 64px -12px rgba(0,0,0,.8); }
.aio-head { padding: 14px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
.aio-badge { font-size: 11px; padding: 3px 9px; border-radius: 4px; flex: none; letter-spacing: .04em; }
.aio-badge--physical { background: rgba(66,198,230,.12); color: var(--accent); }
.aio-badge--magic { background: rgba(180,140,255,.12); color: #b48cff; }
.aio-badge--item { background: rgba(70,211,154,.12); color: var(--ok); }
.aio-badge--support { background: rgba(242,180,65,.12); color: var(--warn); }
.aio-name { font-size: 18px; font-weight: 700; flex: 1; letter-spacing: -.01em; }
.aio-close { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 16px; cursor: pointer; line-height: 1; }
.aio-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.aio-label { font-size: 8px; color: var(--faint); margin-bottom: 4px; letter-spacing: .08em; }
.aio-effect { font-size: 13px; color: var(--txt); }
.aio-stats { display: flex; gap: 16px; flex-wrap: wrap; }
.aio-stat { font-size: 16px; font-weight: 700; }
.aio-stat--mp { color: #9b6fff; }
.aio-stat--target { text-transform: capitalize; }
.aio-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.aio-tag { font-size: 10px; padding: 2px 8px; border-radius: 3px; }
.aio-tag--status { background: rgba(242,180,65,.15); color: #f2b441; }
.aio-tag--aoe { background: rgba(66,198,230,.1); color: var(--accent); }
.aio-tag--knockback { background: rgba(255,95,86,.1); color: #ff5f56; }
.aio-desc { margin: 0; font-size: 12px; color: var(--dim); line-height: 1.6; border-top: 1px solid var(--line); padding-top: 10px; }
</style>
