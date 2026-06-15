let _nextId = 0;
const nid = () => `item-${_nextId++}`;

// ── Item definitions ──────────────────────────────────────────────────────────

export const ITEM_DEFS = {
  // Food
  food:                    { name: 'ration of food',       char: '%', category: 'food' },
  // Potions
  potion_healing:          { name: 'potion of healing',             char: '!', category: 'potion' },
  potion_extra_healing:    { name: 'potion of extra healing',       char: '!', category: 'potion' },
  potion_strength:         { name: 'potion of gain strength',       char: '!', category: 'potion' },
  potion_restore_strength: { name: 'potion of restore strength',    char: '!', category: 'potion' },
  potion_haste:            { name: 'potion of haste self',          char: '!', category: 'potion' },
  potion_blindness:        { name: 'potion of blindness',           char: '!', category: 'potion' },
  potion_confusion:        { name: 'potion of confusion',           char: '!', category: 'potion' },
  potion_see_invisible:    { name: 'potion of see invisible',       char: '!', category: 'potion' },
  potion_levitation:       { name: 'potion of levitation',          char: '!', category: 'potion' },
  potion_poison:           { name: 'potion of poison',              char: '!', category: 'potion' },
  // Scrolls
  scroll_map:              { name: 'scroll of magic map',           char: '?', category: 'scroll' },
  scroll_identify:         { name: 'scroll of identify',            char: '?', category: 'scroll' },
  scroll_teleport:         { name: 'scroll of teleportation',       char: '?', category: 'scroll' },
  scroll_remove_curse:     { name: 'scroll of remove curse',        char: '?', category: 'scroll' },
  scroll_enchant_weapon:   { name: 'scroll of enchant weapon',      char: '?', category: 'scroll' },
  scroll_enchant_armor:    { name: 'scroll of enchant armor',       char: '?', category: 'scroll' },
  scroll_scare_monster:    { name: 'scroll of scare monster',       char: '?', category: 'scroll' },
  scroll_hold_monster:     { name: 'scroll of hold monster',        char: '?', category: 'scroll' },
  scroll_aggravate_monster:{ name: 'scroll of aggravate monster',   char: '?', category: 'scroll' },
  scroll_create_monster:   { name: 'scroll of create monster',      char: '?', category: 'scroll' },
  // Weapons
  weapon_dagger:           { name: 'dagger',          char: ')', category: 'weapon', weapon: 'dagger',       dmg: [1,4] },
  weapon_mace:             { name: 'mace',             char: ')', category: 'weapon', weapon: 'mace',         dmg: [2,4] },
  weapon_sword:            { name: 'short sword',      char: ')', category: 'weapon', weapon: 'short sword',  dmg: [1,6] },
  weapon_long_sword:       { name: 'long sword',       char: ')', category: 'weapon', weapon: 'long sword',   dmg: [1,8] },
  weapon_2h_sword:         { name: '2-handed sword',   char: ')', category: 'weapon', weapon: '2h sword',     dmg: [1,10] },
  weapon_spear:            { name: 'spear',            char: ')', category: 'weapon', weapon: 'spear',        dmg: [1,8] },
  weapon_flail:            { name: 'flail',            char: ')', category: 'weapon', weapon: 'flail',        dmg: [2,4] },
  // Armor
  armor_leather:           { name: 'leather armor',    char: ']', category: 'armor', armor: 'leather',       ac: 2 },
  armor_studded_leather:   { name: 'studded leather',  char: ']', category: 'armor', armor: 'studded leather', ac: 3 },
  armor_ring_mail:         { name: 'ring mail',         char: ']', category: 'armor', armor: 'ring mail',     ac: 3 },
  armor_scale_mail:        { name: 'scale mail',        char: ']', category: 'armor', armor: 'scale mail',    ac: 4 },
  armor_chain_mail:        { name: 'chain mail',        char: ']', category: 'armor', armor: 'chain mail',    ac: 5 },
  armor_banded_mail:       { name: 'banded mail',       char: ']', category: 'armor', armor: 'banded mail',   ac: 6 },
  armor_splint_mail:       { name: 'splint mail',       char: ']', category: 'armor', armor: 'splint mail',   ac: 6 },
  armor_plate_mail:        { name: 'plate mail',        char: ']', category: 'armor', armor: 'plate mail',    ac: 7 },
  // Rings (go to inventory; use-item to equip)
  ring_slow_digestion:     { name: 'ring of slow digestion',  char: '=', category: 'ring', effect: 'slow_digestion' },
  ring_regeneration:       { name: 'ring of regeneration',    char: '=', category: 'ring', effect: 'regeneration' },
  ring_add_strength:       { name: 'ring of add strength',    char: '=', category: 'ring', effect: 'add_strength' },
  ring_protection:         { name: 'ring of protection',      char: '=', category: 'ring', effect: 'protection' },
  ring_see_invisible:      { name: 'ring of see invisible',   char: '=', category: 'ring', effect: 'see_invisible' },
  ring_stealth:            { name: 'ring of stealth',         char: '=', category: 'ring', effect: 'stealth' },
  ring_teleportation:      { name: 'ring of teleportation',   char: '=', category: 'ring', effect: 'teleportation' },
  // Wands (go to inventory; use-item to zap)
  wand_light:              { name: 'wand of light',           char: '/', category: 'wand', wandEffect: 'light',          charges: [3,8] },
  wand_magic_missile:      { name: 'wand of magic missile',   char: '/', category: 'wand', wandEffect: 'magic_missile',  charges: [3,6] },
  wand_slow_monster:       { name: 'wand of slow monster',    char: '/', category: 'wand', wandEffect: 'slow_monster',   charges: [3,6] },
  wand_polymorph:          { name: 'wand of polymorph',       char: '/', category: 'wand', wandEffect: 'polymorph',      charges: [2,5] },
  wand_fire:               { name: 'wand of fire',            char: '/', category: 'wand', wandEffect: 'fire',           charges: [3,6] },
  wand_cold:               { name: 'wand of cold',            char: '/', category: 'wand', wandEffect: 'cold',           charges: [3,6] },
  wand_drain_life:         { name: 'wand of drain life',      char: '/', category: 'wand', wandEffect: 'drain_life',     charges: [2,5] },
  // Gold
  gold:                    { name: 'gold pieces',              char: '*', category: 'gold' },
};

// ── Disguise name pools ───────────────────────────────────────────────────────

const POTION_COLORS = [
  'amber','aquamarine','black','blue','brown','clear','crimson','cyan',
  'ecru','gold','green','grey','magenta','orange','pink','plaid',
  'purple','red','silver','tan','ultraviolet','vermilion','violet','white','yellow',
];
const SCROLL_LABELS = [
  'ZLORF','XKCD','PLUGH','AARGH','QWERT','BLORB','FLARP','GORP',
  'SNERT','ZORK','FNORD','XYZZY','MUNG','FROB','GRUEL','ZAP',
];
const RING_GEMS = [
  'agate','alexandrite','amethyst','carnelian','diamond','emerald',
  'garnet','jade','kryptonite','moonstone','obsidian','onyx','opal',
  'pearl','ruby','sapphire','tiger eye','topaz','turquoise','zircon',
];
const WAND_MATERIALS = [
  'avocado','bamboo','cedar','cherry','cypress','ebony','elm','hemlock',
  'hickory','iron','jade','locust','mahogany','maple','oak','pine',
  'platinum','rowan','teak','walnut',
];

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateDisguiseMap(rng) {
  const potionTypes  = Object.keys(ITEM_DEFS).filter(k => ITEM_DEFS[k].category === 'potion');
  const scrollTypes  = Object.keys(ITEM_DEFS).filter(k => ITEM_DEFS[k].category === 'scroll');
  const ringTypes    = Object.keys(ITEM_DEFS).filter(k => ITEM_DEFS[k].category === 'ring');
  const wandTypes    = Object.keys(ITEM_DEFS).filter(k => ITEM_DEFS[k].category === 'wand');

  const colors   = shuffle(POTION_COLORS, rng);
  const labels   = shuffle(SCROLL_LABELS, rng);
  const gems     = shuffle(RING_GEMS, rng);
  const materials= shuffle(WAND_MATERIALS, rng);

  const map = {};
  potionTypes.forEach((t, i)  => { map[t] = `${colors[i % colors.length]} potion`; });
  scrollTypes.forEach((t, i)  => { map[t] = `scroll labeled ${labels[i % labels.length]}`; });
  ringTypes.forEach((t, i)    => { map[t] = `${gems[i % gems.length]} ring`; });
  wandTypes.forEach((t, i)    => { map[t] = `${materials[i % materials.length]} wand`; });
  return map;
}

export function getDisplayName(type, disguiseMap, identified) {
  const def = ITEM_DEFS[type];
  if (!def) return type;
  const needsId = ['potion','scroll','ring','wand'].includes(def.category);
  if (!needsId || identified.has(type)) return def.name;
  return disguiseMap[type] ?? def.name;
}

// ── Spawn pool by level ───────────────────────────────────────────────────────

const POOL_BY_LEVEL = [
  // 1
  ['food','food','potion_healing','gold','gold','scroll_identify','weapon_dagger'],
  // 2
  ['food','potion_healing','gold','weapon_mace','armor_leather','scroll_map','potion_extra_healing',
   'scroll_identify','ring_slow_digestion','wand_light'],
  // 3
  ['food','potion_healing','potion_extra_healing','gold','armor_ring_mail','weapon_sword',
   'scroll_map','scroll_identify','scroll_enchant_weapon','ring_regeneration','wand_magic_missile'],
  // 4
  ['food','potion_healing','weapon_sword','weapon_long_sword','armor_scale_mail','armor_chain_mail',
   'potion_strength','scroll_enchant_armor','ring_add_strength','wand_slow_monster','scroll_teleport'],
  // 5
  ['food','potion_healing','potion_extra_healing','weapon_long_sword','armor_chain_mail',
   'potion_strength','scroll_enchant_weapon','ring_protection','wand_fire','potion_haste',
   'scroll_hold_monster','armor_banded_mail'],
  // 6
  ['food','potion_extra_healing','weapon_long_sword','weapon_2h_sword','armor_plate_mail',
   'potion_strength','scroll_map','ring_see_invisible','wand_cold','potion_see_invisible',
   'scroll_scare_monster','armor_splint_mail'],
  // 7
  ['food','potion_extra_healing','weapon_2h_sword','weapon_spear','armor_plate_mail',
   'potion_strength','scroll_enchant_weapon','ring_stealth','wand_polymorph',
   'potion_haste','scroll_remove_curse','wand_drain_life'],
  // 8+
  ['food','potion_extra_healing','weapon_2h_sword','weapon_flail','armor_plate_mail',
   'potion_strength','scroll_enchant_armor','ring_regeneration','ring_protection',
   'wand_fire','wand_cold','potion_haste','scroll_hold_monster','wand_drain_life'],
];

export function spawnItems(rooms, dungeonLevel, rng) {
  const pool     = POOL_BY_LEVEL[Math.min(dungeonLevel - 1, POOL_BY_LEVEL.length - 1)];
  const count    = 3 + Math.floor(dungeonLevel * 0.6);
  const occupied = new Set();
  const items    = [];

  for (let i = 0; i < count; i++) {
    const room = rooms[Math.floor(rng() * rooms.length)];
    let x, y, key, tries = 0;
    do {
      x   = room.x + Math.floor(rng() * room.w);
      y   = room.y + Math.floor(rng() * room.h);
      key = `${x},${y}`;
      tries++;
    } while (occupied.has(key) && tries < 20);
    if (tries >= 20) continue;
    occupied.add(key);

    const type = pool[Math.floor(rng() * pool.length)];
    const item = { id: nid(), type, x, y, pickedUp: false };
    if (type === 'gold') {
      item.amount = 5 + Math.floor(rng() * dungeonLevel * 8);
    }
    // Weapon/armor can spawn with enchantment
    const def = ITEM_DEFS[type];
    if (def?.category === 'weapon' || def?.category === 'armor') {
      const roll = rng();
      item.enchant = roll < 0.1 ? -1 : roll > 0.7 ? 1 : roll > 0.9 ? 2 : 0;
    }
    // Wands get random charges
    if (def?.category === 'wand') {
      const [lo, hi] = def.charges;
      item.charges = lo + Math.floor(rng() * (hi - lo + 1));
    }
    items.push(item);
  }
  return items;
}

// ── Auto-pickup ───────────────────────────────────────────────────────────────

export function applyPickup(hero, item, rng, disguiseMap, identified) {
  const def = ITEM_DEFS[item.type];
  if (!def) return { hero, message: '', identified };

  const displayName = getDisplayName(item.type, disguiseMap ?? {}, identified ?? new Set());

  if (item.type === 'gold') {
    const amt = item.amount ?? 1;
    return {
      hero: { ...hero, attrs: { ...hero.attrs, gold: hero.attrs.gold + amt } },
      message: `You pick up ${amt} gold pieces.`,
      identified,
    };
  }

  if (def.category === 'weapon') {
    const curScore = hero.attrs.weaponDmg[0] * hero.attrs.weaponDmg[1] + (hero.attrs.weaponEnchant ?? 0);
    const newScore = def.dmg[0] * def.dmg[1] + (item.enchant ?? 0);
    const enchStr  = enchantStr(item.enchant);
    if (newScore > curScore) {
      return {
        hero: { ...hero, attrs: { ...hero.attrs, weapon: def.weapon, weaponDmg: def.dmg, weaponEnchant: item.enchant ?? 0 } },
        message: `You wield the ${enchStr}${def.name}!`,
        identified,
      };
    }
    return { hero, message: `You find a ${enchStr}${def.name} (your ${hero.attrs.weapon} is better).`, identified };
  }

  if (def.category === 'armor') {
    const curAC = hero.attrs.armorClass + (hero.attrs.armorEnchant ?? 0);
    const newAC = def.ac + (item.enchant ?? 0);
    const enchStr = enchantStr(item.enchant);
    if (newAC > curAC) {
      return {
        hero: { ...hero, attrs: { ...hero.attrs, armor: def.armor, armorClass: def.ac, armorEnchant: item.enchant ?? 0 } },
        message: `You wear the ${enchStr}${def.name} (AC ${newAC}).`,
        identified,
      };
    }
    return { hero, message: `You find ${enchStr}${def.name} (your armor is better).`, identified };
  }

  // Potions, scrolls, food, rings, wands → inventory
  const invItem = { id: item.id, type: item.type, name: def.name };
  if (def.category === 'wand') invItem.charges = item.charges ?? 3;
  const newInv = [...hero.attrs.inventory, invItem];
  return {
    hero: { ...hero, attrs: { ...hero.attrs, inventory: newInv } },
    message: `You pick up a ${displayName}.`,
    identified,
  };
}

function enchantStr(enchant) {
  if (!enchant) return '';
  return enchant > 0 ? `+${enchant} ` : `${enchant} `;
}

// ── Use item from inventory ───────────────────────────────────────────────────
// Returns { hero, message, effect?, identified }
// effect: { type: 'feed'|'map'|'teleport'|'scare'|'hold_all'|'aggravate'|'spawn_monster'|'light_room' }

export function useInventoryItem(hero, slot, rng, disguiseMap, identified, tiles, units) {
  const item = hero.attrs.inventory[slot];
  if (!item) return { hero, message: 'Nothing there.', identified };

  const ident = new Set(identified ?? []);
  ident.add(item.type);  // using an item identifies it

  const removeSlot = (h) => {
    const inv = (h ?? hero).attrs.inventory.filter((_, i) => i !== slot);
    return { ...(h ?? hero), attrs: { ...(h ?? hero).attrs, inventory: inv } };
  };

  const def = ITEM_DEFS[item.type];
  const realName = def?.name ?? item.type;

  // Food
  if (item.type === 'food') {
    const amt = 350 + Math.floor(rng() * 250);
    return { hero: removeSlot(), message: 'You eat a ration of food. Yum!', effect: { type: 'feed', amount: amt }, identified: ident };
  }

  // Potions
  if (item.type === 'potion_healing') {
    const heal = 1 + Math.floor(rng() * 8);
    const h2 = removeSlot();
    return { hero: { ...h2, hp: Math.min(h2.maxHp, h2.hp + heal) }, message: `You drink a ${realName}. (+${heal} HP)`, identified: ident };
  }
  if (item.type === 'potion_extra_healing') {
    const heal = 2 + Math.floor(rng() * 8) + Math.floor(rng() * 8);
    const h2 = removeSlot();
    return { hero: { ...h2, hp: Math.min(h2.maxHp, h2.hp + heal) }, message: `You drink a ${realName}. (+${heal} HP)`, identified: ident };
  }
  if (item.type === 'potion_strength') {
    const h2 = removeSlot();
    return {
      hero: { ...h2, maxHp: h2.maxHp + 2, hp: h2.hp + 2, attrs: { ...h2.attrs, strength: h2.attrs.strength + 1 } },
      message: `You feel much stronger! (Str+1, MaxHP+2)`, identified: ident,
    };
  }
  if (item.type === 'potion_restore_strength') {
    const h2 = removeSlot();
    return {
      hero: { ...h2, attrs: { ...h2.attrs, strength: Math.max(h2.attrs.strength, 16) } },
      message: `Your strength returns!`, identified: ident,
    };
  }
  if (item.type === 'potion_haste') {
    const h2 = removeSlot();
    const eff = { ...h2.attrs.effects, haste: (h2.attrs.effects.haste ?? 0) + 10 };
    return { hero: { ...h2, attrs: { ...h2.attrs, effects: eff } }, message: `You feel yourself moving much faster!`, identified: ident };
  }
  if (item.type === 'potion_blindness') {
    const h2 = removeSlot();
    const eff = { ...h2.attrs.effects, blind: (h2.attrs.effects.blind ?? 0) + 15 };
    return { hero: { ...h2, attrs: { ...h2.attrs, effects: eff } }, message: `A blindness overcomes you!`, identified: ident };
  }
  if (item.type === 'potion_confusion') {
    const h2 = removeSlot();
    const dur = 5 + Math.floor(rng() * 8);
    const eff = { ...h2.attrs.effects, confused: (h2.attrs.effects.confused ?? 0) + dur };
    return { hero: { ...h2, attrs: { ...h2.attrs, effects: eff } }, message: `You feel confused!`, identified: ident };
  }
  if (item.type === 'potion_see_invisible') {
    const h2 = removeSlot();
    const eff = { ...h2.attrs.effects, see_invisible: (h2.attrs.effects.see_invisible ?? 0) + 40 };
    return { hero: { ...h2, attrs: { ...h2.attrs, effects: eff } }, message: `Your eyes tingle!`, identified: ident };
  }
  if (item.type === 'potion_levitation') {
    const h2 = removeSlot();
    const eff = { ...h2.attrs.effects, levitate: (h2.attrs.effects.levitate ?? 0) + 20 };
    return { hero: { ...h2, attrs: { ...h2.attrs, effects: eff } }, message: `You start floating!`, identified: ident };
  }
  if (item.type === 'potion_poison') {
    const h2 = removeSlot();
    const strLoss = 1 + Math.floor(rng() * 3);
    const newStr  = Math.max(3, h2.attrs.strength - strLoss);
    return {
      hero: { ...h2, attrs: { ...h2.attrs, strength: newStr, effects: { ...h2.attrs.effects, poisoned: true } } },
      message: `You feel very sick! (Str -${strLoss})`, identified: ident,
    };
  }

  // Scrolls
  if (item.type === 'scroll_map') {
    return { hero: removeSlot(), message: 'The scroll reveals the dungeon!', effect: { type: 'map' }, identified: ident };
  }
  if (item.type === 'scroll_identify') {
    // Identify all items in inventory
    const newIdent = new Set(ident);
    for (const it of hero.attrs.inventory) newIdent.add(it.type);
    return { hero: removeSlot(), message: 'You feel more knowledgeable!', identified: newIdent };
  }
  if (item.type === 'scroll_teleport') {
    return { hero: removeSlot(), message: 'You feel a wrenching sensation!', effect: { type: 'teleport' }, identified: ident };
  }
  if (item.type === 'scroll_remove_curse') {
    return { hero: removeSlot(), message: 'You feel a warm glow. Your possessions feel lighter.', identified: ident };
  }
  if (item.type === 'scroll_enchant_weapon') {
    const h2 = removeSlot();
    const newEnchant = (h2.attrs.weaponEnchant ?? 0) + 1;
    return {
      hero: { ...h2, attrs: { ...h2.attrs, weaponEnchant: newEnchant } },
      message: `Your ${h2.attrs.weapon} glows blue! (+${newEnchant} enchantment)`, identified: ident,
    };
  }
  if (item.type === 'scroll_enchant_armor') {
    const h2 = removeSlot();
    const newEnchant = (h2.attrs.armorEnchant ?? 0) + 1;
    return {
      hero: { ...h2, attrs: { ...h2.attrs, armorEnchant: newEnchant } },
      message: `Your armor glows silver! (+${newEnchant} enchantment)`, identified: ident,
    };
  }
  if (item.type === 'scroll_scare_monster') {
    return { hero: removeSlot(), message: 'You hear a maniacal laughter!', effect: { type: 'scare' }, identified: ident };
  }
  if (item.type === 'scroll_hold_monster') {
    return { hero: removeSlot(), message: 'The monsters freeze in place!', effect: { type: 'hold_all', turns: 5 }, identified: ident };
  }
  if (item.type === 'scroll_aggravate_monster') {
    return { hero: removeSlot(), message: 'You hear a high-pitched shriek!', effect: { type: 'aggravate' }, identified: ident };
  }
  if (item.type === 'scroll_create_monster') {
    return { hero: removeSlot(), message: 'You hear a faint cry nearby!', effect: { type: 'spawn_monster' }, identified: ident };
  }

  // Rings → equip
  if (def?.category === 'ring') {
    const h2 = removeSlot();
    if (!h2.attrs.leftRing) {
      return {
        hero: { ...h2, attrs: { ...h2.attrs, leftRing: { type: item.type, name: def.name, effect: def.effect } } },
        message: `You put on the ${def.name} (left hand).`, identified: ident,
      };
    }
    if (!h2.attrs.rightRing) {
      return {
        hero: { ...h2, attrs: { ...h2.attrs, rightRing: { type: item.type, name: def.name, effect: def.effect } } },
        message: `You put on the ${def.name} (right hand).`, identified: ident,
      };
    }
    // Both slots full – put back
    const inv = [...h2.attrs.inventory, item];
    return {
      hero: { ...h2, attrs: { ...h2.attrs, inventory: inv } },
      message: `You are already wearing two rings.`, identified: ident,
    };
  }

  // Wands → zap toward nearest visible monster (or random direction if none)
  if (def?.category === 'wand') {
    const invItem = hero.attrs.inventory[slot];
    if ((invItem.charges ?? 0) <= 0) {
      return { hero, message: `The ${def.name} is empty.`, identified: ident };
    }
    // Decrement charges
    const newInv = hero.attrs.inventory.map((it, i) =>
      i === slot ? { ...it, charges: (it.charges ?? 1) - 1 } : it
    );
    const h2 = { ...hero, attrs: { ...hero.attrs, inventory: newInv } };
    return {
      hero: h2,
      message: `You zap the ${def.name}!`,
      effect: { type: 'wand', wandEffect: def.wandEffect },
      identified: ident,
    };
  }

  return { hero, message: `You can't use the ${realName} like that.`, identified: ident };
}

// ── Drop item from inventory ──────────────────────────────────────────────────
// Returns { hero, droppedItem }

export function dropInventoryItem(hero, slot) {
  const item = hero.attrs.inventory[slot];
  if (!item) return { hero, droppedItem: null };
  const inv  = hero.attrs.inventory.filter((_, i) => i !== slot);
  const h2   = { ...hero, attrs: { ...hero.attrs, inventory: inv } };
  const dropped = {
    id: item.id,
    type: item.type,
    x: hero.position.x,
    y: hero.position.y,
    pickedUp: false,
    charges: item.charges,
  };
  return { hero: h2, droppedItem: dropped };
}
