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
};
