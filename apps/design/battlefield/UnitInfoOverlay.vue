<script setup>
defineProps({ unit: { type: Object, default: null } });
defineEmits(['close', 'open-ability-info']);
const imgSrc = window.api.imgSrc;

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
    <div v-if="unit" class="uio-scrim" @click.self="$emit('close')">
      <div class="uio-panel">
        <div v-if="unit.mainImagePath" class="uio-hero">
          <img :key="unit.mainImagePath" :src="imgSrc(unit.mainImagePath)" :alt="unit.name"
               class="uio-hero-img"
               @error="e => e.target.closest('div').style.display='none'"/>
        </div>
        <div class="uio-head">
          <div class="uio-head-main">
            <div class="uio-title-row">
              <span class="uio-name">{{unit.name}}</span>
              <span v-if="unit.job" class="mono uio-job">
                {{unit.job}}
              </span>
              <span v-if="unit.moveRange != null" class="mono uio-move">
                Move {{unit.moveRange}}
              </span>
            </div>
            <p v-if="unit.description" class="uio-desc">
              {{unit.description}}
            </p>
          </div>
          <button class="uio-close" @click="$emit('close')">
            ×
          </button>
        </div>
        <div v-if="unit.stats" class="uio-section">
          <div class="panel-t uio-section-title">Base Stats</div>
          <div class="uio-stats">
            <div v-for="(val, key) in unit.stats" :key="key" class="uio-stat">
              <span class="mono uio-stat-v">{{val}}</span>
              <span class="up uio-stat-k">{{key}}</span>
            </div>
          </div>
        </div>
        <div v-if="unit.equipment?.length" class="uio-section">
          <div class="panel-t uio-section-title">Equipment</div>
          <div class="uio-eq-list">
            <div v-for="eq in unit.equipment" :key="eq.label" class="uio-eq">
              <span class="uio-eq-label">{{eq.label}}</span>
              <span class="mono uio-eq-val">{{eq.value}}</span>
            </div>
          </div>
        </div>
        <div v-if="unit.abilities?.length" class="uio-section">
          <div class="panel-t uio-section-title">Abilities</div>
          <div class="uio-ability-list">
            <div v-for="ab in unit.abilities" :key="ab.key ?? ab" class="uio-ability"
                 @click="$emit('open-ability-info', ab)">
              <span class="mono uio-badge" :class="'uio-badge--' + abilityTypeMeta(ab.type).kind">
                {{abilityTypeMeta(ab.type).label}}
              </span>
              <span class="uio-ability-name">{{ab.name ?? ab}}</span>
              <span class="mono uio-ability-cost">
                <template v-if="ab.range != null">Rng&nbsp;{{ab.range}}</template>
                <template v-if="ab.mpCost"> &middot; {{ab.mpCost}}&thinsp;MP</template>
              </span>
              <span class="uio-ability-effect">{{fmtAbilityEffect(ab)}}</span>
            </div>
          </div>
        </div>
        <div v-if="unit.reaction || unit.support" class="uio-section uio-section--last">
          <div class="panel-t uio-section-title">Passives</div>
          <div class="uio-passives">
            <div v-if="unit.reaction" class="uio-passive">
              <span class="mono uio-passive-tag uio-passive-tag--react">REACT</span>
              <div>
                <div class="uio-passive-name">{{unit.reaction.name ?? unit.reaction}}</div>
                <div v-if="unit.reaction.description" class="uio-passive-desc">{{unit.reaction.description}}</div>
              </div>
            </div>
            <div v-if="unit.support" class="uio-passive">
              <span class="mono uio-passive-tag uio-passive-tag--supp">SUPP</span>
              <div>
                <div class="uio-passive-name">{{unit.support.name ?? unit.support}}</div>
                <div v-if="unit.support.description" class="uio-passive-desc">{{unit.support.description}}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.uio-scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(4,7,10,.8); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(3px); }
.uio-panel { background: var(--bg1); border: 1px solid var(--line2); border-radius: var(--r2); width: 460px; max-width: 92vw; max-height: 88vh; overflow-y: auto; display: flex; flex-direction: column; box-shadow: 0 24px 64px -12px rgba(0,0,0,.7); }
.uio-hero { position: relative; flex-shrink: 0; background: var(--bg0); border-bottom: 1px solid var(--line); }
.uio-hero-img { width: 100%; display: block; max-height: 300px; object-fit: contain; }
.uio-head { padding: 16px 18px 12px; display: flex; align-items: flex-start; gap: 10px; border-bottom: 1px solid var(--line); }
.uio-head-main { flex: 1; }
.uio-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.uio-name { font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
.uio-job { font-size: 10px; padding: 2px 7px; border-radius: 3px; background: var(--bg3); color: var(--dim); letter-spacing: .04em; }
.uio-move { font-size: 10px; padding: 2px 7px; border-radius: 3px; background: rgba(66,198,230,.1); color: var(--accent); }
.uio-desc { margin: 0; font-size: 12px; color: var(--dim); line-height: 1.6; }
.uio-close { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line2); border-radius: var(--r); background: var(--bg2); color: var(--dim); font-size: 16px; cursor: pointer; line-height: 1; }
.uio-section { padding: 14px 18px; border-bottom: 1px solid var(--line); }
.uio-section--last { border-bottom: none; }
.uio-section-title { margin-bottom: 10px; }
.uio-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; }
.uio-stat { display: flex; flex-direction: column; align-items: center; background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r); padding: 8px 0; }
.uio-stat-v { font-size: 18px; font-weight: 700; color: var(--txt); }
.uio-stat-k { font-size: 8px; color: var(--faint); margin-top: 3px; letter-spacing: .08em; }
.uio-eq-list { display: flex; flex-direction: column; gap: 6px; }
.uio-eq { display: flex; justify-content: space-between; padding: 7px 10px; border-radius: var(--r); background: var(--bg2); border: 1px solid var(--line); }
.uio-eq-label { font-size: 11px; color: var(--dim); }
.uio-eq-val { font-size: 11px; font-weight: 600; }
.uio-ability-list { display: flex; flex-direction: column; gap: 4px; }
.uio-ability { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--r); background: var(--bg2); border: 1px solid var(--line); cursor: pointer; }
.uio-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; flex: none; letter-spacing: .04em; }
.uio-badge--physical { background: rgba(66,198,230,.12); color: var(--accent); }
.uio-badge--magic { background: rgba(180,140,255,.12); color: #b48cff; }
.uio-badge--item { background: rgba(70,211,154,.12); color: var(--ok); }
.uio-badge--support { background: rgba(242,180,65,.12); color: var(--warn); }
.uio-ability-name { font-size: 12px; font-weight: 600; flex: none; min-width: 96px; }
.uio-ability-cost { font-size: 10px; color: var(--faint); flex: none; }
.uio-ability-effect { font-size: 11px; color: var(--dim); flex: 1; text-align: right; }
.uio-passives { display: flex; flex-direction: column; gap: 6px; }
.uio-passive { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: var(--r); background: var(--bg2); border: 1px solid var(--line); }
.uio-passive-tag { font-size: 9px; padding: 1px 6px; border-radius: 3px; flex: none; margin-top: 1px; }
.uio-passive-tag--react { background: rgba(255,95,86,.12); color: #ff5f56; }
.uio-passive-tag--supp { background: rgba(70,211,154,.12); color: var(--ok); }
.uio-passive-name { font-size: 12px; font-weight: 600; }
.uio-passive-desc { font-size: 11px; color: var(--dim); margin-top: 2px; }
</style>
