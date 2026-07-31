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

      // A short burst of HIGH-passed filtered noise gives the bright, plasticky "tock"
      // lichess/chess.com use — centering the band up near 2.8kHz (rather than ~1kHz)
      // is what actually reads as "bright" instead of "wooden thud".
      const dur = 0.055;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2800;
      filter.Q.value = 1.1;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.5, now + 0.002);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      noise.connect(filter).connect(noiseGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + dur);

      // A brief high "ping" layered under the noise gives the click a clear pitch
      // center (rather than pure hiss) — pitched up near 1.8kHz and decaying fast so
      // it reads as a crisp tap, not a bell.
      const ping = ctx.createOscillator();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(1800, now);
      ping.frequency.exponentialRampToValueAtTime(1500, now + 0.03);
      const pingGain = ctx.createGain();
      pingGain.gain.setValueAtTime(0.0001, now);
      pingGain.gain.exponentialRampToValueAtTime(0.22, now + 0.003);
      pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      ping.connect(pingGain).connect(ctx.destination);
      ping.start(now);
      ping.stop(now + 0.05);

      // A touch of low body keeps it from sounding thin — much quieter and shorter
      // than the noise/ping above so it stays underneath rather than dominating.
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(320, now);
      thump.frequency.exponentialRampToValueAtTime(180, now + 0.025);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.0001, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.14, now + 0.003);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      thump.connect(thumpGain).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.04);
    } catch { /* audio is a nicety — never let it break the move flow */ }
  }

  window.playChessMoveSound = playChessMoveSound;
})();
