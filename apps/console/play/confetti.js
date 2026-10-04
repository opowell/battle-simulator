// Full-window confetti burst for game-win celebrations. Canvas-based, no assets or
// libraries — draws small rotating rectangles that fall under gravity with a bit of
// horizontal drift, then fades out and removes itself. Loaded as a plain <script> in
// index.html (see sound.js's note), exposing window.playConfetti.
(function () {
  const COLORS = ['#ff5f56', '#ffbd2e', '#27c93f', '#5ac8fa', '#af7bff', '#ff6fae'];
  const DURATION_MS = 3200;
  const FADE_MS = 500;

  let raf = null;
  let canvas = null;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (canvas) { canvas.remove(); canvas = null; }
  }

  function playConfetti() {
    try {
      stop(); // a second call restarts the burst rather than stacking canvases
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;z-index:2000;pointer-events:none;';
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      document.body.appendChild(canvas);
      const ctx2d = canvas.getContext('2d');

      const count = Math.round((canvas.width * canvas.height) / 12000);
      const pieces = Array.from({ length: Math.min(Math.max(count, 80), 220) }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.5,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 6,
        vx: -1.2 + Math.random() * 2.4,
        vy: 2 + Math.random() * 2.5,
        rot: Math.random() * Math.PI * 2,
        vr: -0.2 + Math.random() * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));

      const start = performance.now();
      const frame = (now) => {
        const elapsed = now - start;
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        const fadeStart = DURATION_MS - FADE_MS;
        ctx2d.globalAlpha = elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / FADE_MS) : 1;
        for (const p of pieces) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.03;
          p.rot += p.vr;
          ctx2d.save();
          ctx2d.translate(p.x, p.y);
          ctx2d.rotate(p.rot);
          ctx2d.fillStyle = p.color;
          ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx2d.restore();
        }
        if (elapsed < DURATION_MS) raf = requestAnimationFrame(frame);
        else stop();
      };
      raf = requestAnimationFrame(frame);
    } catch { /* confetti is a nicety — never let it break the game flow */ }
  }

  window.playConfetti = playConfetti;
})();
