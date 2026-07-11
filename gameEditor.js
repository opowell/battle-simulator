/**
 * gameEditor.js — CRUD for game *definitions* (the metadata registry in
 * api-server.js) and their raw source files, for the /ui/game-editor app.
 *
 * The registry is the hardcoded `const GAMES = { … }` object literal in
 * api-server.js. Its values mix data (player counts, defaultPlayers) with
 * a live class reference (`game: ChessGame`), so we can't just JSON-parse it.
 * Instead we:
 *   • parse   — extract the block, stringify the class token, eval to an object;
 *   • rewrite — regenerate the whole block from a plain-object model, turning the
 *               `game: "ChessGame"` string back into a bare identifier.
 *
 * Every metadata/create/delete edit rewrites api-server.js on disk. Because the
 * running process has already imported everything, changes only take effect
 * after a server restart — the API flags `restartRequired: true` and the editor
 * shows a banner. (Per project conventions the dev server restarts freely.)
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { resolve, sep, extname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Registry parsing / serialization
// ---------------------------------------------------------------------------

const BLOCK_RE = /const GAMES = \{\n([\s\S]*?)\n\};/;

/** Parse the GAMES block from api-server.js source into a plain object. */
export function parseRegistry(serverSrc) {
  const m = serverSrc.match(BLOCK_RE);
  if (!m) throw new Error('Could not locate `const GAMES = { … }` in api-server.js');
  // Turn `game: ChessGame` into `game: "ChessGame"` so the literal is data-only,
  // then evaluate it. The inner text is trusted (our own source file).
  const inner = m[1].replace(/game:\s*([A-Za-z0-9_$]+)/g, 'game: "$1"');
  // eslint-disable-next-line no-new-func
  const obj = new Function(`return ({${inner}})`)();
  return obj; // { name: { game: "XxxGame", minPlayers, maxPlayers, defaultPlayers } }
}

/** Public list shape for the editor (array, source-of-truth ordering). */
export function registryList(serverSrc) {
  const obj = parseRegistry(serverSrc);
  return Object.entries(obj).map(([name, e]) => ({
    name,
    gameClass: e.game,
    minPlayers: e.minPlayers,
    maxPlayers: e.maxPlayers,
    defaultPlayers: e.defaultPlayers,
  }));
}

function serializePlayers(players) {
  return '[' + players.map(p => `{ id: '${p.id}', name: '${String(p.name).replace(/'/g, "\\'")}' }`).join(', ') + ']';
}

const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));

/**
 * Regenerate the whole `const GAMES = { … };` block, column-aligning the fields
 * the way the hand-written registry does so edits produce a minimal diff.
 */
function serializeRegistry(obj) {
  const rows = Object.entries(obj);
  const keyW  = Math.max(...rows.map(([n]) => n.length + 1));                 // "name:"
  const gameW = Math.max(...rows.map(([, e]) => `game: ${e.game},`.length));
  const maxW  = Math.max(...rows.map(([, e]) => `maxPlayers: ${e.maxPlayers},`.length));
  const lines = rows.map(([name, e]) =>
    `  ${padEnd(name + ':', keyW)} { ${padEnd(`game: ${e.game},`, gameW)} ` +
    `minPlayers: ${e.minPlayers}, ` +
    `${padEnd(`maxPlayers: ${e.maxPlayers},`, maxW)} defaultPlayers: ${serializePlayers(e.defaultPlayers)} },`
  );
  return `const GAMES = {\n${lines.join('\n')}\n};`;
}

/** Replace the GAMES block in server source with a freshly serialized one. */
export function rewriteRegistry(serverSrc, obj) {
  if (!BLOCK_RE.test(serverSrc)) throw new Error('Could not locate GAMES block to rewrite');
  return serverSrc.replace(BLOCK_RE, serializeRegistry(obj));
}

// ---------------------------------------------------------------------------
// Game-class imports (for create / delete)
// ---------------------------------------------------------------------------

const GAME_IMPORT_RE = /^import \{\s*([A-Za-z0-9_$]+)\s*\}\s*from\s*'(\.\/games\/[^']+)';[ \t]*$/gm;

function gameImportLines(serverSrc) {
  const out = [];
  let m;
  GAME_IMPORT_RE.lastIndex = 0;
  while ((m = GAME_IMPORT_RE.exec(serverSrc))) out.push({ cls: m[1], from: m[2], full: m[0] });
  return out;
}

/** Insert an import for a new game class after the last game import. */
function addGameImport(serverSrc, cls, name) {
  const imports = gameImportLines(serverSrc);
  const last = imports[imports.length - 1];
  const line = `import { ${cls} } from './games/${name}/index.js';`;
  if (!last) throw new Error('No existing game imports to anchor a new import');
  const idx = serverSrc.indexOf(last.full) + last.full.length;
  return serverSrc.slice(0, idx) + '\n' + line + serverSrc.slice(idx);
}

/** Remove the import line for a given game class. */
function removeGameImport(serverSrc, cls) {
  const imports = gameImportLines(serverSrc);
  const target = imports.find(i => i.cls === cls);
  if (!target) return serverSrc;
  // Drop the whole line including its trailing newline.
  return serverSrc.replace(new RegExp('^' + escapeRe(target.full) + '\\n', 'm'), '');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function classNameFor(name) {
  // "warofdots" -> "WarofdotsGame". Split on non-alphanumerics so "mud_blood"
  // and "mud-blood" both title-case cleanly.
  const camel = String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('');
  return camel + 'Game';
}

export function validateName(name) {
  if (!name || typeof name !== 'string') return 'Missing game name';
  if (!/^[a-z][a-z0-9]*$/.test(name)) return 'Name must be lowercase letters/digits, starting with a letter (e.g. "mygame")';
  return null;
}

function normalizeMeta(meta) {
  const minPlayers = Number(meta.minPlayers);
  const maxPlayers = Number(meta.maxPlayers);
  if (!Number.isInteger(minPlayers) || minPlayers < 2) throw new Error('minPlayers must be an integer ≥ 2');
  if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers) throw new Error('maxPlayers must be an integer ≥ minPlayers');
  const players = Array.isArray(meta.defaultPlayers) ? meta.defaultPlayers : [];
  if (players.length < 2) throw new Error('Need at least 2 default players');
  for (const p of players) {
    if (!p || !/^[A-Za-z0-9_-]+$/.test(p.id || '')) throw new Error(`Invalid player id: ${JSON.stringify(p.id)}`);
    if (!p.name) throw new Error(`Player ${p.id} needs a name`);
  }
  return {
    minPlayers,
    maxPlayers,
    defaultPlayers: players.map(p => ({ id: p.id, name: p.name })),
  };
}

// ---------------------------------------------------------------------------
// Metadata update / create / delete — all rewrite api-server.js on disk
// ---------------------------------------------------------------------------

export async function updateGameMeta(serverPath, name, meta) {
  const src = await readFile(serverPath, 'utf8');
  const obj = parseRegistry(src);
  if (!obj[name]) throw new Error(`Unknown game: ${name}`);
  const norm = normalizeMeta(meta);
  obj[name] = { game: obj[name].game, ...norm };
  await writeFile(serverPath, rewriteRegistry(src, obj));
  return { name, ...norm, gameClass: obj[name].game };
}

export async function createGame(serverPath, gamesDir, name, meta) {
  const nameErr = validateName(name);
  if (nameErr) throw new Error(nameErr);
  const src = await readFile(serverPath, 'utf8');
  const obj = parseRegistry(src);
  if (obj[name]) throw new Error(`Game "${name}" already exists`);
  const norm = normalizeMeta(meta);
  const cls = classNameFor(name);
  if (Object.values(obj).some(e => e.game === cls)) throw new Error(`Class name ${cls} is already in use`);

  // Scaffold the game directory first, so the import resolves on restart.
  const dir = resolve(gamesDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.js'), `export { ${cls} } from './${cls}.js';\n`);
  await writeFile(join(dir, `${cls}.js`), scaffoldGameClass(cls, name, norm));
  await writeFile(join(dir, 'README.md'), `# ${name}\n\nScaffolded by the game editor. Implement the game logic in \`${cls}.js\`.\n`);

  // Register it: append entry + import, then rewrite the file.
  obj[name] = { game: cls, ...norm };
  let out = rewriteRegistry(src, obj);
  out = addGameImport(out, cls, name);
  await writeFile(serverPath, out);
  return { name, gameClass: cls, ...norm };
}

export async function deleteGame(serverPath, gamesDir, name) {
  const src = await readFile(serverPath, 'utf8');
  const obj = parseRegistry(src);
  if (!obj[name]) throw new Error(`Unknown game: ${name}`);
  const cls = obj[name].game;
  delete obj[name];
  let out = rewriteRegistry(src, obj);
  out = removeGameImport(out, cls);
  await writeFile(serverPath, out);
  // Remove the directory too.
  await rm(resolve(gamesDir, name), { recursive: true, force: true });
  return { name };
}

// ---------------------------------------------------------------------------
// Raw source files
// ---------------------------------------------------------------------------

const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.txt']);
const SKIP_DIRS = new Set(['images', 'assets', 'node_modules', '.git']);

/** Recursively list editable text files in a game dir (relative paths). */
export async function listGameFiles(gamesDir, name) {
  const root = resolve(gamesDir, name);
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(join(dir, ent.name), relPath);
      } else if (TEXT_EXT.has(extname(ent.name))) {
        const s = await stat(join(dir, ent.name));
        out.push({ path: relPath, size: s.size });
      }
    }
  }
  await walk(root, '');
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Resolve a file path safely inside a game dir, or throw. */
function safeFile(gamesDir, name, relPath) {
  const root = resolve(gamesDir, name);
  const abs = resolve(root, relPath || '');
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error('Path escapes game directory');
  if (!TEXT_EXT.has(extname(abs))) throw new Error('Only text files are editable');
  return abs;
}

export async function readGameFile(gamesDir, name, relPath) {
  const abs = safeFile(gamesDir, name, relPath);
  return readFile(abs, 'utf8');
}

export async function writeGameFile(gamesDir, name, relPath, content) {
  const abs = safeFile(gamesDir, name, relPath);
  await mkdir(resolve(abs, '..'), { recursive: true });
  await writeFile(abs, content);
  return { path: relPath, size: Buffer.byteLength(content) };
}

// ---------------------------------------------------------------------------
// New-game scaffold — a minimal but fully-runnable GameDefinition.
// ---------------------------------------------------------------------------

function scaffoldGameClass(cls, name, meta) {
  const startHp = 20;
  return `/**
 * ${cls} — scaffolded by the game editor.
 *
 * A minimal, fully-runnable turn-based duel: each player owns one champion with
 * ${startHp} HP; on your turn you 'attack' the enemy for a few damage or 'end-turn'.
 * First to drop every enemy champion wins. Replace this with your real rules —
 * it implements the required GameDefinition hooks (see games/types.js).
 */

const START_HP = ${startHp};
const ATTACK_DMG = 6;

export const ${cls} = {
  name: '${name}',

  scenarios: [
    { id: 'standard', name: 'Standard', description: 'A quick duel', config: {} },
  ],

  createInitialState(players, _config, _rng = Math.random) {
    const units = players.map(p => ({
      id: \`\${p.id}-champion\`,
      ownerId: p.id,
      type: 'champion',
      position: null,
      alive: true,
      hp: START_HP,
      maxHp: START_HP,
    }));
    return {
      gameName: '${name}',
      turnNumber: 1,
      activePlayers: [players[0].id],
      currentPhase: 'action',
      players,
      board: {},
      units,
      lastActions: null,
      gameSpecific: {},
    };
  },

  getLegalActions(state, playerId) {
    const me = state.units.find(u => u.ownerId === playerId && u.alive);
    const enemies = state.units.filter(u => u.ownerId !== playerId && u.alive);
    const actions = [];
    if (me) {
      for (const target of enemies) {
        actions.push({ type: 'attack', unitId: me.id, targetId: target.id });
      }
    }
    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions, _rng = Math.random) {
    const { playerId, action } = playerActions[0];
    const playerIds = state.players.map(p => p.id);

    if (action.type === 'attack') {
      const units = state.units.map(u => {
        if (u.id !== action.targetId) return u;
        const hp = Math.max(0, (u.hp ?? 0) - ATTACK_DMG);
        return { ...u, hp, alive: hp > 0 };
      });
      return { ...state, units, lastActions: playerActions };
    }

    // end-turn — pass to the next player, bump the turn counter on wrap.
    const idx = playerIds.indexOf(playerId);
    const nextIdx = (idx + 1) % playerIds.length;
    return {
      ...state,
      activePlayers: [playerIds[nextIdx]],
      turnNumber: nextIdx === 0 ? state.turnNumber + 1 : state.turnNumber,
      lastActions: playerActions,
    };
  },

  getResult(state) {
    const playerIds = state.players.map(p => p.id);
    for (const pid of playerIds) {
      const alive = state.units.some(u => u.ownerId === pid && u.alive);
      if (!alive) {
        const winner = playerIds.find(id => id !== pid);
        return { outcome: 'win', winnerId: winner, reason: 'all-enemies-eliminated' };
      }
    }
    return null;
  },

  // Heuristic leaf value for the generic ObscuroAgent: our HP minus theirs.
  evaluateState(state, playerId) {
    let score = 0;
    for (const u of state.units) {
      if (!u.alive) continue;
      score += (u.ownerId === playerId ? 1 : -1) * ((u.hp ?? 0) + 10);
    }
    return score;
  },

  renderState(state) {
    const summary = state.players.map(p => {
      const u = state.units.find(x => x.ownerId === p.id);
      return \`\${p.name}: \${u && u.alive ? u.hp + 'hp' : 'defeated'}\`;
    }).join('  |  ');
    return \`Turn \${state.turnNumber} — \${state.activePlayers[0]} to move\\n\${summary}\`;
  },
};
`;
}
