// ammoType, damage [min,max], range (Manhattan), accuracy (%), pellets per shot
export const WEAPONS = {
  pistol: {
    label: 'Pistol',
    ammoType: 'bullet', ammoPerShot: 1,
    damage: [7, 13], range: 10, accuracy: 75, pellets: 1,
  },
  shotgun: {
    label: 'Shotgun',
    ammoType: 'shell', ammoPerShot: 1,
    damage: [5, 10], range: 6, accuracy: 65, pellets: 5,
  },
  chaingun: {
    label: 'Chaingun',
    ammoType: 'bullet', ammoPerShot: 3,
    damage: [7, 13], range: 10, accuracy: 70, pellets: 3,
  },
  rocketlauncher: {
    label: 'Rocket Launcher',
    ammoType: 'rocket', ammoPerShot: 1,
    damage: [40, 80], range: 12, accuracy: 90, pellets: 1, splash: true,
  },
  plasma: {
    label: 'Plasma Rifle',
    ammoType: 'cell', ammoPerShot: 1,
    damage: [20, 30], range: 12, accuracy: 85, pellets: 1,
  },
};

export const AMMO_CAPS = { bullet: 200, shell: 50, rocket: 10, cell: 200 };

// Weapon rank for auto-upgrade on pickup (higher = better)
export const WEAPON_RANK = { pistol: 0, shotgun: 1, chaingun: 2, rocketlauncher: 3, plasma: 4 };
