export const ABILITIES = {
  attack: {
    name: 'Attack', type: 'physical', range: 1, target: 'enemy',
    power: 1.0, mpCost: 0, effect: 'damage',
  },
  shieldbearer: {
    name: 'Shieldbearer', type: 'support', range: 0, target: 'self',
    power: 0, mpCost: 0, effect: 'status', status: 'protect',
  },
  'rend-armor': {
    name: 'Rend Armor', type: 'physical', range: 1, target: 'enemy',
    power: 0.7, mpCost: 0, effect: 'damage+status', status: 'armor-break',
  },
  cure: {
    name: 'Cure', type: 'magic', range: 2, target: 'ally',
    power: 1.2, mpCost: 6, effect: 'heal',
  },
  protect: {
    name: 'Protect', type: 'magic', range: 2, target: 'ally',
    power: 0, mpCost: 8, effect: 'status', status: 'protect',
  },
  fire: {
    name: 'Fire', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage', element: 'fire',
  },
  thunder: {
    name: 'Thunder', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage', element: 'thunder',
  },
  blizzard: {
    name: 'Blizzard', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage', element: 'blizzard',
  },
  aim: {
    name: 'Aim', type: 'physical', range: 4, target: 'enemy',
    power: 0.9, mpCost: 0, effect: 'damage',
  },
  blind: {
    name: 'Blackout', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 6, effect: 'status', status: 'blind',
  },
  steal: {
    name: 'Steal', type: 'physical', range: 1, target: 'enemy',
    power: 0, mpCost: 0, effect: 'steal-mp',
  },
  mug: {
    name: 'Mug', type: 'physical', range: 1, target: 'enemy',
    power: 0.8, mpCost: 0, effect: 'damage+steal-mp',
  },
  powerbreak: {
    name: 'Powerbreak', type: 'physical', range: 1, target: 'enemy',
    power: 0.6, mpCost: 0, effect: 'damage+status', status: 'atk-break',
  },
  shatter: {
    name: 'Shatter', type: 'physical', range: 1, target: 'enemy',
    power: 1.5, mpCost: 0, effect: 'damage',
  },
  'holy-blade': {
    name: 'Holy Blade', type: 'magic', range: 1, target: 'enemy',
    power: 1.2, mpCost: 0, effect: 'damage',
  },
  throw: {
    name: 'Throw', type: 'physical', range: 3, target: 'enemy',
    power: 0.8, mpCost: 0, effect: 'damage',
  },
  shadowstitch: {
    name: 'Shadowstitch', type: 'physical', range: 1, target: 'enemy',
    power: 0.4, mpCost: 0, effect: 'damage+status', status: 'blind',
  },
  jump: {
    name: 'Jump', type: 'physical', range: 2, target: 'enemy',
    power: 1.8, mpCost: 0, effect: 'damage',
  },
  flood: {
    name: 'Flood', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage',
    aoe: 'diamond', aoeRadius: 1,
  },
  gust: {
    name: 'Gust', type: 'magic', range: 4, target: 'enemy',
    power: 0.9, mpCost: 8, effect: 'damage+status', status: 'blind',
    aoe: 'line',
  },
  slow: {
    name: 'Slow', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 8, effect: 'status', status: 'slow',
  },
  haste: {
    name: 'Haste', type: 'magic', range: 2, target: 'ally',
    power: 0, mpCost: 8, effect: 'status', status: 'haste',
  },
  eidolon: {
    name: 'Eidolon', type: 'magic', range: 4, target: 'enemy',
    power: 2.0, mpCost: 24, effect: 'damage',
    aoe: 'diamond', aoeRadius: 1,
  },
  phantasm: {
    name: 'Phantasm', type: 'magic', range: 4, target: 'enemy',
    power: 1.1, mpCost: 12, effect: 'damage+status', status: 'blind',
    aoe: 'diamond', aoeRadius: 1,
  },
  rockseal: {
    name: 'Rockseal', type: 'physical', range: 1, target: 'enemy',
    power: 0.5, mpCost: 6, effect: 'damage+status', status: 'stop',
  },

  // ── Warrior (bangaa) ──────────────────────────────────────────────────────
  bash: {
    name: 'Bash', type: 'physical', range: 1, target: 'enemy',
    power: 1.0, mpCost: 0, effect: 'damage+status', status: 'stop', knockback: true,
  },
  'battle-cry': {
    name: 'Battle Cry', type: 'support', range: 0, target: 'self',
    power: 0, mpCost: 0, effect: 'status', status: 'haste',
  },

  // ── White Monk (bangaa) ───────────────────────────────────────────────────
  chakra: {
    name: 'Chakra', type: 'magic', range: 0, target: 'self',
    power: 1.0, mpCost: 8, effect: 'heal',
  },
  'air-render': {
    name: 'Air Render', type: 'physical', range: 2, target: 'enemy',
    power: 0.9, mpCost: 0, effect: 'damage',
  },

  // ── Bishop (bangaa) ───────────────────────────────────────────────────────
  holy: {
    name: 'Holy', type: 'magic', range: 3, target: 'enemy',
    power: 1.4, mpCost: 10, effect: 'damage',
  },
  cura: {
    name: 'Cura', type: 'magic', range: 2, target: 'ally',
    power: 1.6, mpCost: 10, effect: 'heal',
  },
  esuna: {
    name: 'Esuna', type: 'magic', range: 2, target: 'ally',
    power: 0, mpCost: 8, effect: 'cleanse',
  },

  // ── Templar (bangaa) ──────────────────────────────────────────────────────
  'magic-hammer': {
    name: 'Magic Hammer', type: 'magic', range: 3, target: 'enemy',
    power: 0.3, mpCost: 8, effect: 'damage+steal-mp',
  },
  'saint-cross': {
    name: 'Saint Cross', type: 'magic', range: 2, target: 'enemy',
    power: 1.3, mpCost: 12, effect: 'damage',
    aoe: 'diamond', aoeRadius: 1,
  },

  // ── Items (Alchemist / Juggler) ───────────────────────────────────────────
  potion: {
    name: 'Potion', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'heal-fixed', healAmount: 50,
  },
  'hi-potion': {
    name: 'Hi-Potion', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'heal-fixed', healAmount: 150,
  },
  'x-potion': {
    name: 'X-Potion', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'heal-full',
  },
  ether: {
    name: 'Ether', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'restore-mp', mpAmount: 30,
  },
  'hi-ether': {
    name: 'Hi-Ether', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'restore-mp', mpAmount: 60,
  },
  elixir: {
    name: 'Elixir', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'elixir',
  },
  'phoenix-down': {
    name: 'Phoenix Down', type: 'item', range: 2, target: 'dead-ally',
    mpCost: 0, effect: 'revive', reviveHpPct: 0.25,
  },
  antidote: {
    name: 'Antidote', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'cleanse-one', status: 'poison',
  },
  'eye-drops': {
    name: 'Eye Drops', type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'cleanse-one', status: 'blind',
  },
  "maiden's-kiss": {
    name: "Maiden's Kiss", type: 'item', range: 2, target: 'ally',
    mpCost: 0, effect: 'cleanse-one', status: 'sleep',
  },

  // ── Alchemist (nu-mou) ────────────────────────────────────────────────────

  // ── Morpher (nu-mou) ──────────────────────────────────────────────────────
  'call-beast': {
    name: 'Call Beast', type: 'physical', range: 2, target: 'enemy',
    power: 1.1, mpCost: 0, effect: 'damage',
  },
  'wild-boar': {
    name: 'Wild Boar', type: 'physical', range: 1, target: 'enemy',
    power: 0.9, mpCost: 0, effect: 'damage+status', status: 'slow',
  },

  // ── Fencer (viera) ────────────────────────────────────────────────────────
  lunge: {
    name: 'Lunge', type: 'physical', range: 1, target: 'enemy',
    power: 1.4, mpCost: 0, effect: 'damage', knockback: true,
  },
  'feather-blow': {
    name: 'Feather Blow', type: 'physical', range: 1, target: 'enemy',
    power: 0.7, mpCost: 0, effect: 'damage+status', status: 'armor-break',
  },

  // ── Sniper (viera) ────────────────────────────────────────────────────────
  'long-range': {
    name: 'Long Range', type: 'physical', range: 5, target: 'enemy',
    power: 1.0, mpCost: 0, effect: 'damage',
  },
  'last-breath': {
    name: 'Last Breath', type: 'physical', range: 4, target: 'enemy',
    power: 0.6, mpCost: 0, effect: 'damage+status', status: 'doom',
  },

  // ── Blue Mage (human) ─────────────────────────────────────────────────────
  'bad-breath': {
    name: 'Bad Breath', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 8, effect: 'status', status: 'poison',
    aoe: 'diamond', aoeRadius: 1,
  },
  'aqua-breath': {
    name: 'Aqua Breath', type: 'magic', range: 3, target: 'enemy',
    power: 1.2, mpCost: 10, effect: 'damage',
    aoe: 'diamond', aoeRadius: 1,
  },

  // ── Hunter (human) ────────────────────────────────────────────────────────
  'aim-plus': {
    name: 'Aim+', type: 'physical', range: 4, target: 'enemy',
    power: 1.2, mpCost: 0, effect: 'damage',
  },
  net: {
    name: 'Net', type: 'physical', range: 3, target: 'enemy',
    power: 0.3, mpCost: 0, effect: 'damage+status', status: 'slow',
  },
  hunt: {
    name: 'Hunt', type: 'physical', range: 1, target: 'enemy',
    power: 1.6, mpCost: 0, effect: 'damage',
  },

  // ── Mog Knight (moogle) ───────────────────────────────────────────────────
  'mog-attack': {
    name: 'Mog Attack', type: 'physical', range: 1, target: 'enemy',
    power: 1.4, mpCost: 0, effect: 'damage',
  },
  'mog-rush': {
    name: 'Mog Rush', type: 'physical', range: 2, target: 'enemy',
    power: 1.0, mpCost: 0, effect: 'damage', knockback: true,
  },

  // ── Juggler (moogle) ──────────────────────────────────────────────────────
  'toss-item': {
    name: 'Toss Item', type: 'physical', range: 3, target: 'enemy',
    power: 0.8, mpCost: 0, effect: 'damage',
  },
  smile: {
    name: 'Smile', type: 'magic', range: 2, target: 'ally',
    power: 0, mpCost: 6, effect: 'status', status: 'haste',
  },

  // ── Animist (moogle) ──────────────────────────────────────────────────────
  'chocobo-rush': {
    name: 'Chocobo Rush', type: 'physical', range: 2, target: 'enemy',
    power: 1.4, mpCost: 0, effect: 'damage', knockback: true,
  },
  'moogle-eye': {
    name: 'Moogle Eye', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 6, effect: 'status', status: 'blind',
  },
  'sheep-count': {
    name: 'Sheep Count', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 8, effect: 'status', status: 'sleep',
  },

  // ── Gunner (moogle) ───────────────────────────────────────────────────────
  'burst-shot': {
    name: 'Burst Shot', type: 'physical', range: 4, target: 'enemy',
    power: 1.3, mpCost: 0, effect: 'damage',
  },
  fireshot: {
    name: 'Fireshot', type: 'magic', range: 4, target: 'enemy',
    power: 1.1, mpCost: 8, effect: 'damage',
  },
  sootshot: {
    name: 'Sootshot', type: 'physical', range: 3, target: 'enemy',
    power: 0.4, mpCost: 0, effect: 'damage+status', status: 'slow',
  },

  // ── Reaction abilities (passive, trigger on being hit) ────────────────────
  counter: {
    name: 'Counter', category: 'reaction',
    description: 'Counterattack with a basic strike after taking melee physical damage',
  },
  'weapon-guard': {
    name: 'Weapon Guard', category: 'reaction',
    description: '50% chance to evade physical attacks',
  },
  reflex: {
    name: 'Reflex', category: 'reaction',
    description: '50% chance to evade magic attacks',
  },
  'mp-shield': {
    name: 'MP Shield', category: 'reaction',
    description: 'Half of HP damage taken is absorbed by MP instead',
  },
  'absorb-hp': {
    name: 'Absorb HP', category: 'reaction',
    description: 'Recover 25% of HP damage taken',
  },

  // ── Support abilities (passive, always active) ────────────────────────────
  'defense-boost': {
    name: 'Defense Boost', category: 'support',
    description: '+20% DEF',
  },
  'attack-boost': {
    name: 'Attack Boost', category: 'support',
    description: '+20% ATK',
  },
  'magic-boost': {
    name: 'Magic Boost', category: 'support',
    description: '+20% MAG',
  },
  resilience: {
    name: 'Resilience', category: 'support',
    description: '+20% RES',
  },
  'move-plus': {
    name: 'Move+', category: 'support',
    description: '+1 movement range',
  },
  awareness: {
    name: 'Awareness', category: 'support',
    description: 'Immune to Blind',
  },
};
