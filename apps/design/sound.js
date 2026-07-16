// Tiny Web Audio "your turn" chime. No asset files — synthesised on the fly so it
// works offline and needs no network/CSP allowances. Loaded as a plain <script> in
// index.html (vue3-sfc-loader can't `import` a plain .js), exposing window.playTurnSound.
(function () {
  let ctx = null;

  function playTurnSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      // Browsers suspend the context until the first user gesture; resume() is a no-op
      // once it's already running, so it's safe to call every time.
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // A gentle two-note rise (A5 → E6), each a short sine blip with a soft envelope.
      const notes = [[880, 0], [1318.5, 0.12]];
      for (const [freq, offset] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = now + offset;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.24);
      }
    } catch { /* audio is a nicety — never let it break the turn flow */ }
  }

  window.playTurnSound = playTurnSound;
})();
