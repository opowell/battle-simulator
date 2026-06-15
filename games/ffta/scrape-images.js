/**
 * Scrape Final Fantasy Tactics Advance job images from the Final Fantasy wiki.
 * Downloads art, portrait(s), and sprite(s) for each job.
 *
 * Usage: node games/ffta/scrape-images.js [--force]
 *
 * Output structure:
 *   games/ffta/images/{job}/art.jpg
 *   games/ffta/images/{job}/portrait.png  (or portrait_1.png, portrait_2.png if multiple)
 *   games/ffta/images/{job}/sprite.gif    (or sprite_1.gif, sprite_2.gif if multiple)
 *   games/ffta/images/manifest.json
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, 'images');
const API = 'https://finalfantasy.fandom.com/api.php';

const JOB_PAGES = {
  soldier:      ['Soldier_(Tactics_Advance)', 'Soldier_(Final_Fantasy_Tactics_Advance)'],
  whiteMage:    ['White_Mage_(Tactics_Advance)', 'White_Mage_(Final_Fantasy_Tactics_Advance)'],
  blackMage:    ['Black_Mage_(Tactics_Advance)', 'Black_Mage_(Final_Fantasy_Tactics_Advance)'],
  archer:       ['Archer_(Tactics_Advance)', 'Archer_(Final_Fantasy_Tactics_Advance)'],
  thief:        ['Thief_(Tactics_Advance)', 'Thief_(Final_Fantasy_Tactics_Advance)'],
  fighter:      ['Fighter_(Tactics_Advance)', 'Fighter_(Final_Fantasy_Tactics_Advance)'],
  paladin:      ['Paladin_(Tactics_Advance)', 'Paladin_(Final_Fantasy_Tactics_Advance)'],
  ninja:        ['Ninja_(Tactics_Advance)', 'Ninja_(Final_Fantasy_Tactics_Advance)'],
  dragoon:      ['Dragoon_(Tactics_Advance)', 'Dragoon_(Final_Fantasy_Tactics_Advance)'],
  elementalist: ['Elementalist_(Tactics_Advance)', 'Elementalist_(Final_Fantasy_Tactics_Advance)'],
  redMage:      ['Red_Mage_(Tactics_Advance)', 'Red_Mage_(Final_Fantasy_Tactics_Advance)'],
  timeMage:     ['Time_Mage_(Tactics_Advance)', 'Time_Mage_(Final_Fantasy_Tactics_Advance)'],
  summoner:     ['Summoner_(Tactics_Advance)', 'Summoner_(Final_Fantasy_Tactics_Advance)'],
  illusionist:  ['Illusionist_(Tactics_Advance)', 'Illusionist_(Final_Fantasy_Tactics_Advance)'],
  assassin:     ['Assassin_(Tactics_Advance)', 'Assassin_(Final_Fantasy_Tactics_Advance)'],
  warrior:      ['Warrior_(Tactics_Advance)', 'Warrior_(Final_Fantasy_Tactics_Advance)'],
  whiteMonk:    ['White_Monk_(Tactics_Advance)', 'White_Monk_(Final_Fantasy_Tactics_Advance)'],
  bishop:       ['Bishop_(Tactics_Advance)', 'Bishop_(Final_Fantasy_Tactics_Advance)'],
  templar:      ['Templar_(Tactics_Advance)', 'Templar_(Final_Fantasy_Tactics_Advance)'],
  alchemist:    ['Alchemist_(Tactics_Advance)', 'Alchemist_(Final_Fantasy_Tactics_Advance)'],
  morpher:      ['Morpher_(Tactics_Advance)', 'Morpher_(Final_Fantasy_Tactics_Advance)', 'Morpher'],
  fencer:       ['Fencer_(Tactics_Advance)', 'Fencer_(Final_Fantasy_Tactics_Advance)'],
  sniper:       ['Sniper_(Tactics_Advance)', 'Sniper_(Final_Fantasy_Tactics_Advance)'],
  blueMage:     ['Blue_Mage_(Tactics_Advance)', 'Blue_Mage_(Final_Fantasy_Tactics_Advance)'],
  hunter:       ['Hunter_(Tactics_Advance)', 'Hunter_(Final_Fantasy_Tactics_Advance)'],
  mogKnight:    ['Mog_Knight_(Tactics_Advance)', 'Mog_Knight', 'Moogle_Knight'],
  juggler:      ['Juggler_(Tactics_Advance)', 'Juggler_(Final_Fantasy_Tactics_Advance)'],
  animist:      ['Animist_(Tactics_Advance)', 'Animist_(Final_Fantasy_Tactics_Advance)', 'Animist'],
  gunner:       ['Gunner_(Tactics_Advance)', 'Gunner_(Final_Fantasy_Tactics_Advance)', 'Gunner'],
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; battle-simulator-scraper/1.0; educational)',
};

async function apiGet(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params }))
    url.searchParams.set(k, v);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  return res.json();
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolvePage(title) {
  const data = await apiGet({ action: 'query', titles: title, redirects: '1' });
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;
  return page.title;
}

async function getPageHtml(title) {
  const data = await apiGet({ action: 'parse', page: title, prop: 'text', disableeditsection: '1' });
  return data?.parse?.text?.['*'] ?? null;
}

// Extract the href URL from <a class="...image..."> tags in an HTML fragment.
// These hrefs point directly to full-size CDN images.
function extractImageHrefs(fragment) {
  const urls = [];
  for (const m of fragment.matchAll(/href="(https:\/\/[^"]*wikia\.nocookie\.net[^"]+)"/gi)) {
    const url = m[1];
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Parse the portable infobox and return { art, portraits, sprites } as URL arrays.
function parseInfobox(html) {
  const result = { art: [], portraits: [], sprites: [] };

  const asideStart = html.indexOf('<aside');
  const asideEnd = html.indexOf('</aside>', asideStart) + 8;
  if (asideStart < 0) return result;
  const infobox = html.substring(asideStart, asideEnd);

  // Main art: <figure class="pi-image" data-source="image">
  const artFigRe = /<figure\b[^>]*data-source="image"[^>]*>([\s\S]*?)<\/figure>/i;
  const artMatch = infobox.match(artFigRe);
  if (artMatch) result.art = extractImageHrefs(artMatch[0]);

  // Portrait and sprite sections: <div data-source="portrait|sprite">...</div>
  for (const m of infobox.matchAll(/<div\b[^>]*data-source="(portrait|sprite)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)) {
    const type = m[1];          // "portrait" or "sprite"
    const block = m[0];
    const urls = extractImageHrefs(block);
    if (type === 'portrait') result.portraits = urls;
    else result.sprites = urls;
  }

  return result;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  await writeFile(destPath, Buffer.from(buf));
}

function extFromUrl(url) {
  return url.match(/\.(gif|png|jpg|jpeg|webp)(?:[/?#]|$)/i)?.[1]?.toLowerCase() ?? 'png';
}

async function saveGroup(urls, jobDir, baseName) {
  const saved = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = extFromUrl(url);
    const filename = urls.length === 1 ? `${baseName}.${ext}` : `${baseName}_${i + 1}.${ext}`;
    try {
      await downloadImage(url, resolve(jobDir, filename));
      saved.push(filename);
      process.stdout.write(` ${filename}`);
    } catch (e) {
      process.stdout.write(` [err:${filename}]`);
    }
    await delay(300);
  }
  return saved;
}

async function processJob(job, pageTitle) {
  const html = await getPageHtml(pageTitle);
  if (!html) return null;
  await delay(400);

  const { art, portraits, sprites } = parseInfobox(html);

  if (!art.length && !portraits.length && !sprites.length) {
    process.stdout.write(' (no infobox images found)');
    return null;
  }

  const jobDir = resolve(IMAGES_DIR, job);
  await mkdir(jobDir, { recursive: true });

  const saved = {};
  const artFiles = await saveGroup(art, jobDir, 'art');
  if (artFiles.length) saved.art = artFiles;
  const portraitFiles = await saveGroup(portraits, jobDir, 'portrait');
  if (portraitFiles.length) saved.portraits = portraitFiles;
  const spriteFiles = await saveGroup(sprites, jobDir, 'sprite');
  if (spriteFiles.length) saved.sprites = spriteFiles;

  return saved;
}

async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });

  let manifest = {};
  try { manifest = JSON.parse(await readFile(resolve(IMAGES_DIR, 'manifest.json'), 'utf8')); } catch {}

  const force = process.argv.includes('--force');

  for (const [job, candidates] of Object.entries(JOB_PAGES)) {
    if (!force && manifest[job]?.art) {
      console.log(`  ${job.padEnd(14)} (cached)`);
      continue;
    }
    process.stdout.write(`  ${job.padEnd(14)}`);

    let resolvedTitle = null;
    for (const candidate of candidates) {
      try {
        resolvedTitle = await resolvePage(candidate);
        if (resolvedTitle) break;
        await delay(200);
      } catch {}
    }

    if (!resolvedTitle) {
      console.log(' (page not found)');
      await delay(300);
      continue;
    }

    try {
      const saved = await processJob(job, resolvedTitle);
      if (saved) manifest[job] = saved;
    } catch (e) {
      process.stdout.write(` ERROR: ${e.message}`);
    }
    console.log();
    await delay(600);
  }

  await writeFile(resolve(IMAGES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. manifest.json updated (${Object.keys(manifest).length} jobs).`);
}

main().catch(e => { console.error(e); process.exit(1); });
