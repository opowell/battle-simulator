// Chess move sound — a short wooden "clack", played when a move is submitted (drag
// release or click-to-move; see Battlefield.vue's submitAction). Synthesised on the fly
// (see sound.js's note on why: no asset files, works offline). Loaded as a plain
// <script> in index.html, exposing window.playChessMoveSound.
(function () {
  let ctx = null;

  function playChessMoveSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;

      // A short burst of filtered noise reads as a wooden "clack" — a plain oscillator
      // here would sound like a synth beep, not a piece landing on a board.
      const dur = 0.08;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1000;
      filter.Q.value = 0.8;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.45, now + 0.004);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      noise.connect(filter).connect(noiseGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);

      // A short low thump underneath gives the clack some weight.
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(200, now);
      thump.frequency.exponentialRampToValueAtTime(85, now + 0.06);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.3, now + 0.004);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      thump.connect(thumpGain).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.08);
    } catch { /* audio is a nicety — never let it break the move flow */ }
  }

  window.playChessMoveSound = playChessMoveSound;
})();
