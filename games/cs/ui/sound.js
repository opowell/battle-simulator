// Counter-Strike sound effects — short weapon/action clips (games/cs/sounds/*.wav,
// sourced from GameBanana CS 1.6 sound mods) served at /sounds/cs/:name by the server.
// cs's `sound` plugin (apps/browser/play/plugins.js): the board calls onEntry for each
// log entry as it plays the turn, and `at` puts each sound where the replay reaches it.
const KINDS = new Set([
  'rifle', 'pistol', 'smg', 'shotgun', 'heavy', 'sniper', 'melee',
  'footstep', 'explosion', 'flashbang', 'death', 'bombbeep',
]);
// A few source clips run long (echo tails / padded silence in the original
// upload) — cut playback short so turns don't stall waiting out 4-10s of audio.
const MAX_MS = { sniper: 2200, explosion: 2500, flashbang: 1800 };
const VOLUME = { footstep: 0.45, bombbeep: 0.7, death: 0.6 };

function play(kind) {
  if (!KINDS.has(kind)) return;
  try {
    const audio = new Audio(`${window.api?.basePath ?? ''}/sounds/cs/${kind}`);
    audio.volume = VOLUME[kind] ?? 0.8;
    audio.play().catch(() => {});
    const cap = MAX_MS[kind];
    if (cap) setTimeout(() => audio.pause(), cap);
  } catch { /* audio is a nicety — never let it break the game flow */ }
}

// A shot's sound is its weapon's: `field.units[].type` is the same
// pistol/smg/shotgun/heavy/rifle/sniper/melee tag CsGame.js's toGrid stamps for the
// marker-shape hash. Actions sound when they start (t0); a grenade's blast and a death
// when the entry's events land (t1).
export function onEntry({ entry, unitsById, at }) {
  const t0 = entry.t0 ?? 0, t1 = entry.t1 ?? t0;
  for (const { action } of entry.playerActions ?? []) {
    if (action.type === 'shoot')        at(t0, () => play(unitsById.get(action.unitId)?.type ?? 'rifle'));
    else if (action.type === 'move')    at(t0, () => play('footstep'));
    else if (action.type === 'plant')   at(t0, () => play('bombbeep'));
    else if (action.type === 'throw') {
      if (action.grenade === 'he')      at(t1, () => play('explosion'));
      else if (action.grenade === 'flash') at(t1, () => play('flashbang'));
    }
  }
  for (const ev of entry.events ?? []) {
    if (ev.type === 'died' || (ev.type === 'damage' && ev.died)) at(t1, () => play('death'));
  }
}
