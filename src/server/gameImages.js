/**
 * gameImages.js — which file an image URL of a game names.
 *
 *   /images/:game/:job        → games/:game/{images,assets}/:job.*        (a flat file)
 *   /images/:game/:job/:type  → games/:game/{images,assets}/:job/:type*   (GIF first)
 *
 * The server serves them (battleServer.js); scripts/export-pack.mjs copies them
 * into a game's pack in library/.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// GIF preferred over PNG/JPG for animated sprites.
const TYPE_EXT_PREF = { gif: 0, png: 1, jpg: 2, jpeg: 2, webp: 3 };
const stem = (f) => { const dot = f.lastIndexOf('.'); return dot < 0 ? f : f.slice(0, dot); };
const clean = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '');

/** The files that might be `job[/type]` in `gameDir`, best first. */
export async function gameImageFiles(gameDir, job, type) {
  const safe = clean(job);
  const out = [];
  for (const base of [resolve(gameDir, 'images'), resolve(gameDir, 'assets')]) {
    if (type) {
      const safeType = clean(type);
      const subdir = resolve(base, safe);
      let files;
      try { files = await readdir(subdir); } catch { continue; }
      out.push(...files
        .map(f => { const dot = f.lastIndexOf('.'); return dot < 0 ? null : { f, ext: f.slice(dot + 1).toLowerCase() }; })
        .filter(x => x && stem(x.f).startsWith(safeType))
        .sort((a, b) => (TYPE_EXT_PREF[a.ext] ?? 99) - (TYPE_EXT_PREF[b.ext] ?? 99))
        .map(({ f }) => resolve(subdir, f)));
    } else {
      let files;
      try { files = await readdir(base); } catch { continue; }
      for (const f of files) if (f.lastIndexOf('.') > 0 && stem(f) === safe) out.push(resolve(base, f));
    }
  }
  return out;
}
