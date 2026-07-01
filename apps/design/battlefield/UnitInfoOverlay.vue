<script setup>
defineProps({ unit: { type: Object, default: null } });
defineEmits(['close', 'open-ability-info']);

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
    <div v-if="unit"
         style="position:fixed;inset:0;z-index:1000;background:rgba(4,7,10,.8);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)"
         @click.self="$emit('close')">
      <div style="background:var(--bg1);border:1px solid var(--line2);border-radius:var(--r2);width:460px;max-width:92vw;max-height:88vh;overflow-y:auto;display:flex;flex-direction:column;box-shadow:0 24px 64px -12px rgba(0,0,0,.7)">
        <div v-if="unit.mainImagePath" style="position:relative;flex-shrink:0;background:var(--bg0);border-bottom:1px solid var(--line)">
          <img :key="unit.mainImagePath" :src="unit.mainImagePath" :alt="unit.name"
               style="width:100%;display:block;max-height:300px;object-fit:contain"
               @error="e => e.target.closest('div').style.display='none'"/>
        </div>
        <div style="padding:16px 18px 12px;display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid var(--line)">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:22px;font-weight:700;letter-spacing:-.01em">{{unit.name}}</span>
              <span v-if="unit.job"
                    class="mono" style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--bg3);color:var(--dim);letter-spacing:.04em">
                {{unit.job}}
              </span>
              <span v-if="unit.moveRange != null"
                    class="mono" style="font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(66,198,230,.1);color:var(--accent)">
                Move {{unit.moveRange}}
              </span>
            </div>
            <p v-if="unit.description" style="margin:0;font-size:12px;color:var(--dim);line-height:1.6">
              {{unit.description}}
            </p>
          </div>
          <button @click="$emit('close')"
                  style="flex:none;width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r);background:var(--bg2);color:var(--dim);font-size:16px;cursor:pointer;line-height:1">
            ×
          </button>
        </div>
        <div v-if="unit.stats" style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="panel-t" style="margin-bottom:10px">Base Stats</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            <div v-for="(val, key) in unit.stats" :key="key"
                 style="display:flex;flex-direction:column;align-items:center;background:var(--bg2);border:1px solid var(--line);border-radius:var(--r);padding:8px 0">
              <span class="mono" style="font-size:18px;font-weight:700;color:var(--txt)">{{val}}</span>
              <span class="up" style="font-size:8px;color:var(--faint);margin-top:3px;letter-spacing:.08em">{{key}}</span>
            </div>
          </div>
        </div>
        <div v-if="unit.abilities?.length" style="padding:14px 18px;border-bottom:1px solid var(--line)">
          <div class="panel-t" style="margin-bottom:10px">Abilities</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div v-for="ab in unit.abilities" :key="ab.key ?? ab"
                 style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line);cursor:pointer"
                 @click="$emit('open-ability-info', ab)">
              <span class="mono" style="font-size:9px;padding:1px 5px;border-radius:3px;flex:none;letter-spacing:.04em"
                    :style="{background: abilityTypeMeta(ab.type).bg, color: abilityTypeMeta(ab.type).color}">
                {{abilityTypeMeta(ab.type).label}}
              </span>
              <span style="font-size:12px;font-weight:600;flex:none;min-width:96px">{{ab.name ?? ab}}</span>
              <span class="mono" style="font-size:10px;color:var(--faint);flex:none">
                <template v-if="ab.range != null">Rng&nbsp;{{ab.range}}</template>
                <template v-if="ab.mpCost"> &middot; {{ab.mpCost}}&thinsp;MP</template>
              </span>
              <span style="font-size:11px;color:var(--dim);flex:1;text-align:right">{{fmtAbilityEffect(ab)}}</span>
            </div>
          </div>
        </div>
        <div v-if="unit.reaction || unit.support" style="padding:14px 18px">
          <div class="panel-t" style="margin-bottom:10px">Passives</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div v-if="unit.reaction"
                 style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line)">
              <span class="mono" style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(255,95,86,.12);color:#ff5f56;flex:none;margin-top:1px">REACT</span>
              <div>
                <div style="font-size:12px;font-weight:600">{{unit.reaction.name ?? unit.reaction}}</div>
                <div v-if="unit.reaction.description" style="font-size:11px;color:var(--dim);margin-top:2px">{{unit.reaction.description}}</div>
              </div>
            </div>
            <div v-if="unit.support"
                 style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line)">
              <span class="mono" style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(70,211,154,.12);color:var(--ok);flex:none;margin-top:1px">SUPP</span>
              <div>
                <div style="font-size:12px;font-weight:600">{{unit.support.name ?? unit.support}}</div>
                <div v-if="unit.support.description" style="font-size:11px;color:var(--dim);margin-top:2px">{{unit.support.description}}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>
