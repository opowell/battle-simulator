// Runtime team-color tinting for unit sprites that store their player-color region
// as a magenta ramp (currently SC1 — see games/sc1/teamColor.js, of which this is the
// browser-global twin). A game opts in with ui.recolorTeamSprites; SchematicLayer.vue
// calls window.recolorTeamSprite(spriteUrl, teamHex) and gets back a tinted object-URL.
//
// The magenta ramp is detected as pixels where red and blue both clearly exceed green;
// we keep each pixel's brightness (HSV value) and replace hue+saturation with the team's.
(function () {
  const cache = new Map();   // `${url}|${hex}` -> Promise<objectURL>

  function hexToHs(hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
    if (!m) return { h: 0, s: 0 };
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const s = max ? d / max : 0;
    return { h, s };
  }

  function hsvToRgb(h, s, v) {
    h = (((h % 360) + 360) % 360) / 60;
    const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 1)      { r = c; g = x; }
    else if (h < 2) { r = x; g = c; }
    else if (h < 3) { g = c; b = x; }
    else if (h < 4) { g = x; b = c; }
    else if (h < 5) { r = x; b = c; }
    else            { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function recolor(data, h, s) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r - g <= 25 || b - g <= 25) continue;     // not a magenta-ramp pixel
      const v = Math.max(r, g, b) / 255;
      const [nr, ng, nb] = hsvToRgb(h, s, v);
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
    }
  }

  window.recolorTeamSprite = function (url, hex) {
    const key = url + '|' + hex;
    if (cache.has(key)) return cache.get(key);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = img.naturalWidth; cv.height = img.naturalHeight;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const id = ctx.getImageData(0, 0, cv.width, cv.height);
          const { h, s } = hexToHs(hex);
          recolor(id.data, h, Math.max(s, 0.75));    // keep team colors vivid
          ctx.putImageData(id, 0, 0);
          cv.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
    cache.set(key, p);
    return p;
  };

  // Reactive template helper used by SchematicLayer / RosterPanel / SelectedUnitDetail.
  // Returns the tinted object-URL once ready, else the raw sprite; the shared reactive
  // cache means the first component to request a (sprite, team) pair recolors it for all.
  const tinted = (window.Vue ? Vue.reactive({}) : {});
  const inflight = new Set();
  window.teamSpriteHref = function (src, hex, enabled) {
    if (!src || !enabled || !hex) return src;
    const key = src + '|' + hex;
    if (tinted[key]) return tinted[key];
    if (!inflight.has(key)) {
      inflight.add(key);
      window.recolorTeamSprite(src, hex)
        .then(url => { tinted[key] = url; })
        .catch(() => {})
        .finally(() => inflight.delete(key));
    }
    return src;
  };
})();
