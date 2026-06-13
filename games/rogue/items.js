let _nextId = 0;
const nid = () => `item-${_nextId++}`;

export const ITEM_DEFS = {
  food:                 { name: 'ration of food',           char: '%', toInventory: true  },
  potion_healing:       { name: 'potion of healing',        char: '!', toInventory: true  },
  potion_extra_healing: { name: 'potion of extra healing',  char: '!', toInventory: true  },
  potion_strength:      { name: 'potion of gain strength',  char: '!', toInventory: true  },
  scroll_map:           { name: 'scroll of magic map',      char: '?', toInventory: true  },
  weapon_sword:         { name: 'sword',        char: ')', toInventory: false, weapon: 'sword',       dmg: [1,6] },
  weapon_long_sword:    { name: 'long sword',   char: ')', toInventory: false, weapon: 'long sword',  dmg: [1,8] },
  weapon_2h_sword:      { name: '2-handed sword', char: ')', toInventory: false, weapon: '2h sword',  dmg: [1,10] },
  armor_leather:        { name: 'leather armor',  char: ']', toInventory: false, armor: 'leather',    ac: 2 },
  armor_ring_mail:      { name: 'ring mail',      char: ']', toInventory: false, armor: 'ring mail',  ac: 3 },
  armor_chain_mail:     { name: 'chain mail',     char: ']', toInventory: false, armor: 'chain mail', ac: 5 },
  armor_plate_mail:     { name: 'plate mail',     char: ']', toInventory: false, armor: 'plate mail', ac: 7 },
  gold:                 { name: 'gold pieces',    char: '*', toInventory: false },
};

const POOL_BY_LEVEL = [
  ['food','food','potion_healing','gold','gold'],                                                     // 1
  ['food','potion_healing','gold','weapon_sword','armor_leather','scroll_map','potion_extra_healing'], // 2
  ['food','potion_healing','potion_extra_healing','gold','armor_ring_mail','weapon_sword','scroll_map'],
  ['food','potion_healing','weapon_sword','weapon_long_sword','armor_chain_mail','potion_strength'],
  ['food','potion_healing','potion_extra_healing','weapon_long_sword','armor_chain_mail','potion_strength'],
  ['food','potion_extra_healing','weapon_long_sword','weapon_2h_sword','armor_plate_mail','potion_strength'],
  ['food','potion_extra_healing','weapon_2h_sword','armor_plate_mail','potion_strength','scroll_map'],
  ['food','potion_extra_healing','weapon_2h_sword','armor_plate_mail','potion_strength'],
  ['food','potion_extra_healing','weapon_2h_sword','armor_plate_mail','potion_strength'],
  ['food','potion_extra_healing','weapon_2h_sword','armor_plate_mail','potion_strength'],
];

export function spawnItems(rooms, dungeonLevel, rng) {
  const pool = POOL_BY_LEVEL[Math.min(dungeonLevel - 1, POOL_BY_LEVEL.length - 1)];
  const count = 3 + Math.floor(dungeonLevel * 0.6);
  const occupied = new Set();
  const items = [];

  for (let i = 0; i < count; i++) {
    const room = rooms[Math.floor(rng() * rooms.length)];
    let x, y, key, tries = 0;
    do {
      x = room.x + Math.floor(rng() * room.w);
      y = room.y + Math.floor(rng() * room.h);
      key = `${x},${y}`;
      tries++;
    } while (occupied.has(key) && tries < 20);
    if (tries >= 20) continue;
    occupied.add(key);

    const type = pool[Math.floor(rng() * pool.length)];
    const item = { id: nid(), type, x, y, pickedUp: false };
    if (type === 'gold') item.amount = 5 + Math.floor(rng() * dungeonLevel * 8);
    items.push(item);
  }
  return items;
}

// Auto-pickup when hero walks over item. Returns { hero, message }.
export function applyPickup(hero, item, rng) {
  const def = ITEM_DEFS[item.type];
  if (!def) return { hero, message: '' };

  if (item.type === 'gold') {
    const amt = item.amount ?? 1;
    return {
      hero: { ...hero, attrs: { ...hero.attrs, gold: hero.attrs.gold + amt } },
      message: `You pick up ${amt} gold pieces.`,
    };
  }

  if (def.weapon) {
    const [cd, cs] = hero.attrs.weaponDmg;
    const [nd, ns] = def.dmg;
    if (nd * ns > cd * cs) {
      return {
        hero: { ...hero, attrs: { ...hero.attrs, weapon: def.weapon, weaponDmg: def.dmg } },
        message: `You wield the ${def.name}!`,
      };
    }
    return { hero, message: `You find a ${def.name} (your ${hero.attrs.weapon} is better).` };
  }

  if (def.armor) {
    if (def.ac > hero.attrs.armorClass) {
      return {
        hero: { ...hero, attrs: { ...hero.attrs, armor: def.armor, armorClass: def.ac } },
        message: `You wear the ${def.name} (AC ${def.ac}).`,
      };
    }
    return { hero, message: `You find ${def.name} (your armor is better).` };
  }

  if (def.toInventory) {
    const newInv = [...hero.attrs.inventory, { id: item.id, type: item.type, name: def.name }];
    return {
      hero: { ...hero, attrs: { ...hero.attrs, inventory: newInv } },
      message: `You pick up a ${def.name}.`,
    };
  }

  return { hero, message: '' };
}

// Use an item from inventory. Returns { hero, message, effect? }
// effect: { type: 'feed', amount } | { type: 'map' }
export function useInventoryItem(hero, slot, rng) {
  const item = hero.attrs.inventory[slot];
  if (!item) return { hero, message: 'Nothing there.' };

  const removeSlot = () => {
    const inv = hero.attrs.inventory.filter((_, i) => i !== slot);
    return { ...hero, attrs: { ...hero.attrs, inventory: inv } };
  };

  if (item.type === 'food') {
    const amt = 350 + Math.floor(rng() * 250);
    return { hero: removeSlot(), message: 'You eat a ration of food. Yum!', effect: { type: 'feed', amount: amt } };
  }
  if (item.type === 'potion_healing') {
    const heal = 1 + Math.floor(rng() * 8);
    const h2 = removeSlot();
    return {
      hero: { ...h2, hp: Math.min(h2.maxHp, h2.hp + heal) },
      message: `You drink a potion of healing. (+${heal} HP)`,
    };
  }
  if (item.type === 'potion_extra_healing') {
    const heal = 2 + Math.floor(rng() * 8) + Math.floor(rng() * 8);
    const h2 = removeSlot();
    return {
      hero: { ...h2, hp: Math.min(h2.maxHp, h2.hp + heal) },
      message: `You drink a potion of extra healing. (+${heal} HP)`,
    };
  }
  if (item.type === 'potion_strength') {
    const h2 = removeSlot();
    return {
      hero: { ...h2, maxHp: h2.maxHp + 2, hp: h2.hp + 2, attrs: { ...h2.attrs, strength: h2.attrs.strength + 1 } },
      message: 'You feel much stronger! (Str+1, MaxHP+2)',
    };
  }
  if (item.type === 'scroll_map') {
    return { hero: removeSlot(), message: 'The scroll reveals the dungeon!', effect: { type: 'map' } };
  }

  return { hero, message: `You can't use the ${item.name} like that.` };
}
