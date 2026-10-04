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
      // Classic sad-trombone "wah wah wah waaaah". A plain oscillator envelope reads
      // as a synth beep, not brass — what actually gives it that muted-horn "wah"
      // vowel is a resonant bandpass filter sweeping open then closed on each note
      // (the same trick a wah-wah pedal uses), so one continuous sawtooth voice runs
      // through a single swept filter rather than four independent tone bursts.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 5;
      const gain = ctx.createGain();
      osc.connect(filter).connect(gain).connect(ctx.destination);

      // Four descending notes (G4, F4, E4, D4), each sagging ~6% flat right before
      // the next lands, plus a light vibrato on the held final "waaaah".
      const notes = [
        { freq: 392.00, start: 0,    dur: 0.5 },
        { freq: 349.23, start: 0.55, dur: 0.5 },
        { freq: 329.63, start: 1.1,  dur: 0.5 },
        { freq: 293.66, start: 1.65, dur: 1.9 },
      ];
      gain.gain.setValueAtTime(0.0001, now);
      for (const { freq, start, dur } of notes) {
        const t0 = now + start;
        const tEnd = t0 + dur;
        osc.frequency.setValueAtTime(freq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.94, tEnd);
        gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
        gain.gain.setValueAtTime(0.3, t0 + dur * 0.55);
        gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);
        filter.frequency.setValueAtTime(500, t0);
        filter.frequency.exponentialRampToValueAtTime(1600, t0 + dur * 0.35);
        filter.frequency.exponentialRampToValueAtTime(500, tEnd);
      }

      const last = notes[3];
      const vibrato = ctx.createOscillator();
      const vibratoGain = ctx.createGain();
      vibrato.frequency.value = 5.5;
      vibratoGain.gain.value = 20; // cents
      vibrato.connect(vibratoGain).connect(osc.detune);
      const vibratoStart = now + last.start + last.dur * 0.3;
      const stopAt = now + last.start + last.dur + 0.05;
      vibrato.start(vibratoStart);
      vibrato.stop(stopAt);
      osc.start(now);
      osc.stop(stopAt);
    } catch { /* audio is a nicety — never let it break the turn flow */ }
  }

  window.playTurnSound = playTurnSound;
  window.playWinSound = playWinSound;
  window.playLoseSound = playLoseSound;
})();
