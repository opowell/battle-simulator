// Counter-Strike sound effects — short weapon/action clips (games/cs/sounds/*.wav,
// sourced from GameBanana CS 1.6 sound mods) served at /sounds/cs/:name by
// api-server.js. Loaded as a plain <script> in index.html (see sound.js's note:
// vue3-sfc-loader can't `import` a plain .js), exposing window.playCsSound(kind).
(function () {
  const KINDS = new Set([
    'rifle', 'pistol', 'smg', 'shotgun', 'heavy', 'sniper', 'melee',
    'footstep', 'explosion', 'flashbang', 'death', 'bombbeep',
  ]);
  // A few source clips run long (echo tails / padded silence in the original
  // upload) — cut playback short so turns don't stall waiting out 4-10s of audio.
  const MAX_MS = { sniper: 2200, explosion: 2500, flashbang: 1800 };
  const VOLUME = { footstep: 0.45, bombbeep: 0.7, death: 0.6 };

  function playCsSound(kind) {
    if (!KINDS.has(kind)) return;
    try {
      const audio = new Audio(`/sounds/cs/${kind}`);
      audio.volume = VOLUME[kind] ?? 0.8;
      audio.play().catch(() => {});
      const cap = MAX_MS[kind];
      if (cap) setTimeout(() => audio.pause(), cap);
    } catch { /* audio is a nicety — never let it break the game flow */ }
  }

  window.playCsSound = playCsSound;
})();
