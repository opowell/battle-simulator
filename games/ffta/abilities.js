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
    power: 1.3, mpCost: 8, effect: 'damage',
  },
  thunder: {
    name: 'Thunder', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage',
  },
  blizzard: {
    name: 'Blizzard', type: 'magic', range: 3, target: 'enemy',
    power: 1.3, mpCost: 8, effect: 'damage',
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
  },
  gust: {
    name: 'Gust', type: 'magic', range: 3, target: 'enemy',
    power: 0.9, mpCost: 8, effect: 'damage+status', status: 'blind',
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
  },
  phantasm: {
    name: 'Phantasm', type: 'magic', range: 4, target: 'enemy',
    power: 1.1, mpCost: 12, effect: 'damage+status', status: 'blind',
  },
  rockseal: {
    name: 'Rockseal', type: 'physical', range: 1, target: 'enemy',
    power: 0.5, mpCost: 6, effect: 'damage+status', status: 'stop',
  },

  // ── Warrior (bangaa) ──────────────────────────────────────────────────────
  bash: {
    name: 'Bash', type: 'physical', range: 1, target: 'enemy',
    power: 1.0, mpCost: 0, effect: 'damage+status', status: 'stop',
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
    name: 'Saint Cross', type: 'magic', range: 1, target: 'enemy',
    power: 1.3, mpCost: 12, effect: 'damage',
  },

  // ── Alchemist (nu-mou) ────────────────────────────────────────────────────
  'hi-potion': {
    name: 'Hi-Potion', type: 'magic', range: 2, target: 'ally',
    power: 1.8, mpCost: 12, effect: 'heal',
  },

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
    power: 1.4, mpCost: 0, effect: 'damage',
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
    power: 0.6, mpCost: 0, effect: 'damage+status', status: 'stop',
  },

  // ── Blue Mage (human) ─────────────────────────────────────────────────────
  'bad-breath': {
    name: 'Bad Breath', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 8, effect: 'status', status: 'blind',
  },
  'aqua-breath': {
    name: 'Aqua Breath', type: 'magic', range: 3, target: 'enemy',
    power: 1.2, mpCost: 10, effect: 'damage',
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
    power: 1.0, mpCost: 0, effect: 'damage',
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
    power: 1.4, mpCost: 0, effect: 'damage',
  },
  'moogle-eye': {
    name: 'Moogle Eye', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 6, effect: 'status', status: 'blind',
  },
  'sheep-count': {
    name: 'Sheep Count', type: 'magic', range: 3, target: 'enemy',
    power: 0, mpCost: 8, effect: 'status', status: 'slow',
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
};
