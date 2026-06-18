/**
 * Fetch art images for FFTA jobs that are missing them.
 * Looks beyond the infobox — galleries, page content, etc.
 * Usage: node games/ffta/fetch-missing-art.mjs
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, 'images');
const API = 'https://finalfantasy.fandom.com/api.php';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; battle-simulator-scraper/1.0; educational)' };

// Jobs missing art + their wiki page candidates
const MISSING = {
  whiteMage:   ['White_Mage_(Final_Fantasy_Tactics_Advance)', 'White_Mage_(Tactics_Advance)'],
  blackMage:   ['Black_Mage_(Final_Fantasy_Tactics_Advance)', 'Black_Mage_(Tactics_Advance)'],
  archer:      ['Archer_(Final_Fantasy_Tactics_Advance)',     'Archer_(Tactics_Advance)'],
  thief:       ['Thief_(Final_Fantasy_Tactics_Advance)',      'Thief_(Tactics_Advance)'],
  illusionist: ['Illusionist_(Final_Fantasy_Tactics_Advance)','Illusionist_(Tactics_Advance)', 'Illusionist'],
  timeMage:    ['Time_Mage_(Final_Fantasy_Tactics_Advance)',  'Time_Mage_(Tactics_Advance)'],
};

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiGet(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params }))
    url.searchParams.set(k, v);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  return res.json();
}

async function resolvePage(title) {
  const data = await apiGet({ action: 'query', titles: title, redirects: '1' });
  const page = Object.values(data?.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;
  return page.title;
}

async function getPageHtml(title) {
  const data = await apiGet({ action: 'parse', page: title, prop: 'text', disableeditsection: '1' });
  return data?.parse?.text?.['*'] ?? null;
}

// Extract all full-size wikia CDN hrefs from HTML.
function extractAllImageHrefs(html) {
  const urls = [];
  for (const m of html.matchAll(/href="(https:\/\/[^"]*wikia\.nocookie\.net[^"]+)"/gi)) {
    const url = m[1];
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Score an image URL for "art" quality.
// Higher = more likely to be character art vs sprite/icon/thumb.
function scoreArtUrl(url) {
  const lower = url.toLowerCase();
  // Prefer large files over thumbnails (scale-to-width-down param)
  // URLs with /revision/latest? are full-size
  let score = 0;
  if (lower.includes('latest?')) score += 10;
  if (lower.includes('scale-to-width-down')) score -= 5;
  // Prefer jpg (artwork scans) over gif (sprites) or tiny png (icons)
  if (lower.includes('.jpg')) score += 3;
  if (lower.includes('.gif')) score -= 3;
  // Penalize known sprite/icon patterns
  if (lower.includes('sprite')) score -= 4;
  if (lower.includes('icon')) score -= 4;
  if (lower.includes('ffta2') || lower.includes('a2')) score -= 2; // Wrong game
  // Boost if url mentions the art/render pattern
  if (lower.includes('artwork') || lower.includes('art')) score += 4;
  if (lower.includes('ffta')) score += 2;
  return score;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  await writeFile(destPath, Buffer.from(buf));
}

function extFromUrl(url) {
  return url.match(/\.(gif|png|jpg|jpeg|webp)(?:[/?#]|$)/i)?.[1]?.toLowerCase() ?? 'jpg';
}

async function fetchArtForJob(job, pages) {
  let resolvedTitle = null;
  for (const candidate of pages) {
    resolvedTitle = await resolvePage(candidate);
    if (resolvedTitle) break;
    await delay(200);
  }
  if (!resolvedTitle) return console.log(`  ${job.padEnd(14)} page not found`);

  process.stdout.write(`  ${job.padEnd(14)} [${resolvedTitle}]`);
  const html = await getPageHtml(resolvedTitle);
  if (!html) return console.log(' (no html)');
  await delay(300);

  const allUrls = extractAllImageHrefs(html);
  if (!allUrls.length) return console.log(' (no image hrefs)');

  // Score and pick the best art candidate
  const scored = allUrls
    .map(url => ({ url, score: scoreArtUrl(url) }))
    .sort((a, b) => b.score - a.score);

  console.log(`\n    ${scored.length} images found, top candidates:`);
  for (const { url, score } of scored.slice(0, 5)) {
    const short = url.replace(/https:\/\/[^\/]+/, '').slice(0, 80);
    console.log(`      [${score.toString().padStart(3)}] ${short}`);
  }

  // Try downloading the top 3 candidates until one succeeds
  for (const { url } of scored.slice(0, 3)) {
    const ext = extFromUrl(url);
    const jobDir = resolve(IMAGES_DIR, job);
    await mkdir(jobDir, { recursive: true });
    const destPath = resolve(jobDir, `art.${ext}`);
    try {
      process.stdout.write(`    Downloading ${url.slice(-60)}...`);
      await downloadImage(url, destPath);
      console.log(` OK (art.${ext})`);
      return { art: [`art.${ext}`] };
    } catch (e) {
      console.log(` FAIL (${e.message})`);
    }
    await delay(300);
  }

  console.log(`    No art downloaded for ${job}`);
  return null;
}

async function main() {
  let manifest = {};
  try { manifest = JSON.parse(await readFile(resolve(IMAGES_DIR, 'manifest.json'), 'utf8')); } catch {}

  console.log('Fetching missing art images...\n');

  for (const [job, pages] of Object.entries(MISSING)) {
    await fetchArtForJob(job, pages);
    await delay(700);
  }

  // Update manifest with any newly downloaded art
  for (const job of Object.keys(MISSING)) {
    const jobDir = resolve(IMAGES_DIR, job);
    try {
      const files = await (await import('node:fs/promises')).readdir(jobDir);
      const artFiles = files.filter(f => f.startsWith('art'));
      if (artFiles.length && !manifest[job]?.art) {
        manifest[job] = manifest[job] ?? {};
        manifest[job].art = artFiles;
      }
    } catch {}
  }

  await writeFile(resolve(IMAGES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nDone. manifest.json updated.');
}

main().catch(e => { console.error(e); process.exit(1); });
