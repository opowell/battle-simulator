// gate.test.js — the core knows no game. Nothing under src/ or apps/ may import
// from a game's folder or name a game in code; comments may, and do, use one as
// an example. What a game needs from the core it asks for through the game
// definition (its ui.* flags, uiPlugins, …), never by the core knowing its name.
//
// Arena is the exception: it is the core's own scenarios (its rules are
// src/battle), and the mixed ones name the library's games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES_DIR = join(ROOT, 'games');
const CORE_RULESETS = new Set(['arena']);
// The games are the ones still here and the ones that left, whose packs are in
// library/: having left is no licence for the core to name them.
const dirsIn = (dir) => readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory());
const GAMES = [...new Set([...dirsIn(GAMES_DIR), ...dirsIn(join(ROOT, 'library'))])].filter(n => !CORE_RULESETS.has(n));

const SKIP_DIRS = new Set(['vendor', 'node_modules']);
function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) files(p, out); }
    else if (/\.(m?js|vue|html)$/.test(name)) out.push(p);
  }
  return out;
}

/** JS with its comments blanked out, strings kept: a scanner that knows quotes. */
function stripJsComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; if (c !== '`' && src[j] === '\n') break; j++; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The code in a file, comments gone: script blocks as JS, markup without <!-- -->. */
function codeOf(path) {
  const src = readFileSync(path, 'utf8');
  if (/\.m?js$/.test(path)) return stripJsComments(src);
  const markup = src.replace(/<!--[\s\S]*?-->/g, '');
  return markup.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) => open + stripJsComments(body) + close)
    .replace(/<style\b[\s\S]*?<\/style>/g, '');
}

const ids = GAMES.map(g => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NAMED = new RegExp(`(['"\`])(${ids})\\1`, 'g');
const REACHES = new RegExp(`games/(${ids})(/|['"\`])`, 'g');

test('no file under src/ or apps/ imports a game or names one in code', () => {
  const found = [];
  for (const path of [...files(join(ROOT, 'src')), ...files(join(ROOT, 'apps'))]) {
    const code = codeOf(path);
    const rel = relative(ROOT, path);
    for (const line of code.split('\n')) {
      for (const m of line.matchAll(NAMED)) found.push(`${rel}: names ${m[0]} — ${line.trim().slice(0, 100)}`);
      for (const m of line.matchAll(REACHES)) found.push(`${rel}: reaches into games/${m[1]} — ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('the scanner sees through comments, and not through code', () => {
  assert.doesNotMatch(stripJsComments("// 'zz' in a comment\n/* 'yy' */ const a = 1;"), /zz|yy/);
  assert.match(stripJsComments("const url = 'http://x'; const g = 'zz';"), /'zz'/);
});
