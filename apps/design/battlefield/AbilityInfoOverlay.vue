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
  if (type === 'physical') return { label: 'PHY', color: 'var(--accent)', bg: 'rgba(66,198,230,.12)' };
  if (type === 'magic')    return { label: 'MAG', color: '#b48cff',       bg: 'rgba(180,140,255,.12)' };
  if (type === 'item')     return { label: 'ITM', color: 'var(--ok)',     bg: 'rgba(70,211,154,.12)' };
  return                          { label: 'SUP', color: 'var(--warn)',   bg: 'rgba(242,180,65,.12)' };
}
</script>

<template>
  <teleport to="body">
    <div v-if="ability"
         style="position:fixed;inset:0;z-index:1001;background:rgba(4,7,10,.55);display:flex;align-items:center;justify-content:center"
         @click.self="$emit('close')">
      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:340px;max-width:88vw;overflow:hidden;box-shadow:0 24px 64px -12px rgba(0,0,0,.8)">
        <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
          <span class="mono" style="font-size:11px;padding:3px 9px;border-radius:4px;flex:none;letter-spacing:.04em"
                :style="{background: abilityTypeMeta(ability.type).bg, color: abilityTypeMeta(ability.type).color}">
            {{abilityTypeMeta(ability.type).label}}
          </span>
          <span style="font-size:18px;font-weight:700;flex:1;letter-spacing:-.01em">{{ability.name}}</span>
          <button @click="$emit('close')"
                  style="flex:none;width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
          <div v-if="ability.effect">
            <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:4px;letter-spacing:.08em">Effect</div>
            <div style="font-size:13px;color:var(--txt)">{{fmtAbilityEffect(ability)}}</div>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div v-if="ability.range != null">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Range</div>
              <div class="mono" style="font-size:16px;font-weight:700">{{ability.range === 0 ? '—' : ability.range}}</div>
            </div>
            <div v-if="ability.mpCost">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">MP Cost</div>
              <div class="mono" style="font-size:16px;font-weight:700;color:#9b6fff">{{ability.mpCost}}</div>
            </div>
            <div v-if="ability.target">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Target</div>
              <div class="mono" style="font-size:16px;font-weight:700;text-transform:capitalize">{{ability.target}}</div>
            </div>
            <div v-if="ability.power">
              <div class="up" style="font-size:8px;color:var(--faint);margin-bottom:3px;letter-spacing:.08em">Power</div>
              <div class="mono" style="font-size:16px;font-weight:700">{{Math.round(ability.power * 100)}}%</div>
            </div>
          </div>
          <div v-if="ability.status || ability.aoe || ability.knockback" style="display:flex;gap:5px;flex-wrap:wrap">
            <span v-if="ability.status" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(242,180,65,.15);color:#f2b441">
              {{ability.status}}
            </span>
            <span v-if="ability.aoe" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(66,198,230,.1);color:var(--accent)">
              AoE{{ability.aoeRadius ? ' r' + ability.aoeRadius : ''}}
            </span>
            <span v-if="ability.knockback" class="mono"
                  style="font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(255,95,86,.1);color:#ff5f56">
              knockback
            </span>
          </div>
          <p v-if="ability.description"
             style="margin:0;font-size:12px;color:var(--dim);line-height:1.6;border-top:1px solid var(--line);padding-top:10px">
            {{ability.description}}
          </p>
        </div>
      </div>
    </div>
  </teleport>
</template>
