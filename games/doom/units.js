import { makePos } from '../coord.js';

// AP is a continuous per-turn budget, not a slot count: moving costs 1 AP per tile
// travelled (see DoomGame.applyActions) and shooting costs a flat `shootCost`. Values
// below are `oldMaxAP * oldMoveRange` (total tiles a unit could once cover in a turn)
// with `shootCost` set to the old per-slot moveRange, so a unit can still fire exactly
// as many shots per turn, or move exactly as far, as under the old discrete-AP system.
//
// accuracy, damage [min,max], range: intrinsic demon attack stats
export const MONSTER_DEFS = {
  zombieman:  { hp: 20,  maxAP: 6, shootCost: 3, damage: [5,10],   range: 6,  accuracy: 55, pellets: 1, symbol: 'z' },
  shotgunner: { hp: 30,  maxAP: 6, shootCost: 3, damage: [4,8],    range: 5,  accuracy: 55, pellets: 3, symbol: 'g' },
  imp:        { hp: 60,  maxAP: 6, shootCost: 3, damage: [10,20],  range: 8,  accuracy: 60, pellets: 1, symbol: 'i' },
  demon:      { hp: 100, maxAP: 4, shootCost: 4, damage: [40,60],  range: 1,  accuracy: 80, pellets: 1, symbol: 'D' },
  cacodemon:  { hp: 200, maxAP: 3, shootCost: 3, damage: [20,35],  range: 8,  accuracy: 60, pellets: 1, symbol: 'C' },
  baron:      { hp: 400, maxAP: 2, shootCost: 2, damage: [30,60],  range: 10, accuracy: 70, pellets: 1, symbol: 'B' },
};

export function createMarine(id, position) {
  return {
    id,
    ownerId: 'marine',
    type: 'doomguy',
    position: makePos(position.x, position.y),
    alive: true,
    hp: 100, maxHp: 100,
    armor: 50,
    weapon: 'shotgun',
    ammo: { bullet: 100, shell: 30, rocket: 0, cell: 0 },
    attrs: { maxAP: 8, shootCost: 4, symbol: '@' },
    perTurn: { ap: 8 },
  };
}

export function createMonster(id, type, position) {
  const def = MONSTER_DEFS[type];
  return {
    id,
    ownerId: 'demon',
    type,
    position: makePos(position.x, position.y),
    alive: true,
    hp: def.hp, maxHp: def.hp,
    attrs: {
      damage:    def.damage,
      range:     def.range,
      accuracy:  def.accuracy,
      pellets:   def.pellets,
      maxAP:     def.maxAP,
      shootCost: def.shootCost,
      symbol:    def.symbol,
    },
    perTurn: { ap: def.maxAP },
  };
}
