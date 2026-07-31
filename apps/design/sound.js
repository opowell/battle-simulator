// Tiny Web Audio "your turn" chime, plus "victory"/"defeat" stingers for game-over. No
// asset files — synthesised on the fly so it works offline and needs no network/CSP
// allowances. Loaded as a plain <script> in index.html (vue3-sfc-loader can't
// `import` a plain .js), exposing window.playTurnSound / window.playWinSound /
// window.playLoseSound.
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

  function playWinSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // A quick rising "ta-da" run (C5→E5→G5→C6)...
      const run = [523.25, 659.25, 783.99, 1046.5];
      run.forEach((freq, i) => {
        const t0 = now + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.2);
      });
      // ...landing on a sustained major chord "cheer" swell.
      const chordStart = now + run.length * 0.09;
      const chord = [783.99, 1046.5, 1318.5]; // G5, C6, E6
      for (const freq of chord) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, chordStart);
        gain.gain.exponentialRampToValueAtTime(0.12, chordStart + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, chordStart + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(chordStart);
        osc.stop(chordStart + 0.95);
      }
    } catch { /* audio is a nicety — never let it break the turn flow */ }
  }

  function playLoseSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      // A descending two-note "womp womp", each note sliding down into a low sigh.
      const notes = [[392.0, 0, 0.32], [293.66, 0.34, 0.55]]; // G4, then D4
      for (const [freq, offset, dur] of notes) {
        const t0 = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }
    } catch { /* audio is a nicety — never let it break the turn flow */ }
  }

  window.playTurnSound = playTurnSound;
  window.playWinSound = playWinSound;
  window.playLoseSound = playLoseSound;
})();
