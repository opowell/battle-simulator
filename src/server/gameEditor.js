/**
 * gameEditor.js — CRUD for game *definitions* (the registry, games/games.json)
 * and their raw source files, for the /ui/game-editor app.
 *
 * The registry is JSON (see registry.js): each entry names the module and export
 * that hold the game, and its seating. Every edit writes the whole file back the
 * way formatRegistry lays it out — one line per game — so an edit to one game is
 * a one-line diff and leaves every other entry, its `note` included, as it was.
 *
 * Because the running process has already imported everything, changes only
 * take effect after a server restart — the API flags `restartRequired: true`
 * and the editor shows a banner. (Per project conventions the dev server
 * restarts freely.)
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { resolve, sep, extname, join, dirname, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Registry parsing / serialization
// ---------------------------------------------------------------------------

/** The registry's entries: { name: { module, export, minPlayers, maxPlayers, defaultPlayers, note? } }. */
export function parseRegistry(text) {
  return JSON.parse(text);
}

/** Public list shape for the editor (array, source-of-truth ordering). */
export function registryList(text) {
  return Object.entries(parseRegistry(text)).map(([name, e]) => ({
    name,
    gameClass: e.export,
    minPlayers: e.minPlayers,
    maxPlayers: e.maxPlayers,
    defaultPlayers: e.defaultPlayers,
  }));
}

// A value on one line, `{ "a": 1, "b": [2, 3] }`.
function inline(v) {
  if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ') + ' }';
  return JSON.stringify(v);
}

/** The registry as the file holds it: one line per game, names aligned. */
export function formatRegistry(obj) {
  const rows = Object.entries(obj);
  const w = Math.max(0, ...rows.map(([n]) => JSON.stringify(n).length + 1));
  const lines = rows.map(([n, e]) => `  ${(JSON.stringify(n) + ':').padEnd(w)} ${inline(e)}`);
  return '{\n' + lines.join(',\n') + '\n}\n';
}

/** Replace `name`'s entry, or add it at the end if it has none. */
export function setRegistryEntry(text, name, entry) {
  return formatRegistry({ ...parseRegistry(text), [name]: entry });
}

/** Remove `name`'s entry. */
export function removeRegistryEntry(text, name) {
  const obj = parseRegistry(text);
  if (!obj[name]) throw new Error(`Could not find the "${name}" entry in the registry`);
  delete obj[name];
  return formatRegistry(obj);
}

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
// Metadata update / create / delete — all rewrite the registry file on disk
// ---------------------------------------------------------------------------

export async function updateGameMeta(registryPath, name, meta) {
  const src = await readFile(registryPath, 'utf8');
  const obj = parseRegistry(src);
  if (!obj[name]) throw new Error(`Unknown game: ${name}`);
  const norm = normalizeMeta(meta);
  const { module, export: cls, note } = obj[name];
  const entry = { module, export: cls, ...norm, ...(note != null ? { note } : {}) };
  await writeFile(registryPath, setRegistryEntry(src, name, entry));
  return { name, ...norm, gameClass: cls };
}

export async function createGame(registryPath, gamesDir, name, meta) {
  const nameErr = validateName(name);
  if (nameErr) throw new Error(nameErr);
  const src = await readFile(registryPath, 'utf8');
  const obj = parseRegistry(src);
  if (obj[name]) throw new Error(`Game "${name}" already exists`);
  const norm = normalizeMeta(meta);
  const cls = classNameFor(name);
  if (Object.values(obj).some(e => e.export === cls)) throw new Error(`Class name ${cls} is already in use`);

  // Scaffold the game directory first, so the import resolves on restart.
  const dir = resolve(gamesDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.js'), `export { ${cls} } from './${cls}.js';\n`);
  await writeFile(join(dir, `${cls}.js`), scaffoldGameClass(cls, name, norm));
  await writeFile(join(dir, 'README.md'), `# ${name}\n\nScaffolded by the game editor. Implement the game logic in \`${cls}.js\`.\n`);

  // Register it: the module path is relative to the registry file.
  let module = relative(dirname(resolve(registryPath)), join(dir, 'index.js')).split(sep).join('/');
  if (!module.startsWith('.')) module = './' + module;
  await writeFile(registryPath, setRegistryEntry(src, name, { module, export: cls, ...norm }));
  return { name, gameClass: cls, ...norm };
}

export async function deleteGame(registryPath, gamesDir, name) {
  const src = await readFile(registryPath, 'utf8');
  await writeFile(registryPath, removeRegistryEntry(src, name));
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
 * it implements the required GameDefinition hooks (see src/kit/types.js).
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
