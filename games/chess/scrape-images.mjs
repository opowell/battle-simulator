/**
 * Download chess piece SVGs from lichess's open-source cburnett piece set (CC BY-SA 3.0).
 * Usage: node games/chess/scrape-images.mjs [--theme cburnett]
 * Output: games/chess/images/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, 'images');

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'];
const COLORS = ['w', 'b'];

const theme = process.argv.find(a => a.startsWith('--theme='))?.split('=')[1] ?? 'cburnett';
const BASE = `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/${theme}`;

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await mkdir(IMAGES_DIR, { recursive: true });
  console.log(`Downloading chess pieces (theme: ${theme}) from lichess/lila...\n`);

  for (const color of COLORS) {
    for (const piece of PIECES) {
      const filename = `${color}${piece}.svg`;
      const url = `${BASE}/${filename}`;
      process.stdout.write(`  ${filename.padEnd(10)}`);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        await writeFile(resolve(IMAGES_DIR, filename), text, 'utf8');
        console.log('OK');
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
      }
      await delay(150);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
