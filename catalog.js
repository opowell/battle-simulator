/**
 * catalog.js — every object the /ui/console app browses, as plain records.
 *
 * The console is one result set over many kinds of thing: games, the sessions
 * being played, the recordings left on disk, and what each game defines (its
 * scenarios, unit types, sides, agents, options and source files). This module
 * derives all of them from what the server already holds, so nothing here
 * knows about any particular game:
 *
 *   • games, sides, scenarios, agents, options — the GAMES registry and each
 *     game definition's own declared fields;
 *   • units — setupPreview(), the same opening position the setup screen edits,
 *     so a unit type is named and pictured exactly as that game's renderer does;
 *   • sessions — the live Session objects;
 *   • recordings — the session records persisted under sessions/;
 *   • files — gameEditor's listing of each game's editable source.
 *
 * Every record carries `game` (a list for an agent, which several games offer),
 * the key the console narrows by.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The unit types `game` defines, one record each: what the setup screen would
 * call and draw it, and how many of it each side starts with. A type the game
 * offers but nobody starts with has no roster entry to name or picture it, so
 * it is pictured by the preview's unitArt — the game's own art hook, the same
 * one the setup screen's unit picker draws — and keeps no art only when that
 * has none either.
 */
export function unitRecords(gameName, preview) {
  const byType = new Map();
  const typeOf = (entry) => entry.type ?? entry.label ?? entry.id;
  for (const type of preview.unitTypes ?? []) {
    if (type != null) byType.set(type, { type, label: type, imagePath: null, glyph: null, starting: 0, owners: new Set() });
  }
  for (const entry of preview.roster ?? []) {
    const type = typeOf(entry);
    if (type == null) continue;
    let unit = byType.get(type);
    if (!unit) {
      unit = { type, label: type, imagePath: null, glyph: null, starting: 0, owners: new Set() };
      byType.set(type, unit);
    }
    // The first unit of a type that has a name or a picture speaks for the type.
    if (unit.starting === 0 || (!unit.imagePath && entry.imagePath)) {
      unit.label = entry.label ?? type;
      unit.imagePath = entry.imagePath ?? unit.imagePath;
      unit.glyph = entry.glyph ?? unit.glyph;
    }
    unit.starting += 1;
    if (entry.ownerId != null) unit.owners.add(String(entry.ownerId));
  }
  // The unit's own side first, then any side: a type's art can differ by side.
  for (const unit of byType.values()) {
    if (unit.imagePath) continue;
    const sides = [...unit.owners, ...Object.keys(preview.unitArt ?? {})];
    const art = sides.map((side) => preview.unitArt?.[side]?.[unit.type]).find((a) => a?.imagePath);
    if (!art) continue;
    unit.imagePath = art.imagePath;
    unit.glyph ??= art.glyph ?? null;
    if (unit.starting === 0 && art.name) unit.label = art.name;
  }
  return [...byType.values()].map((unit) => ({
    id: `${gameName}/${unit.type}`,
    game: gameName,
    type: String(unit.type),
    label: String(unit.label),
    imagePath: unit.imagePath,
    glyph: unit.glyph,
    starting: unit.starting,
    owners: [...unit.owners],
  }));
}

/** One live session as a record: who is in it, how far it has got, how it ended. */
export function sessionRecord(session) {
  const players = (session.params?.players ?? []).map((p) => ({
    id: p.id, name: p.name ?? p.id, agent: p.agent ?? 'human',
  }));
  return {
    id: session.id,
    game: session.gameName,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    turn: session.engine.state?.turnNumber ?? null,
    pendingPlayer: session.pendingAction()?.playerId ?? null,
    players,
    humans: players.filter((p) => p.agent === 'human').length,
    scenario: session.params?.config?.scenario ?? null,
    fog: !!session.fog,
    result: session.result ?? null,
  };
}

/**
 * Everything but the move log, out of a persisted session record — the log is
 * most of a recording's size and none of what the console shows.
 */
export function recordingRecord(file, size, record) {
  const players = (record.params?.players ?? []).map((p) => ({
    id: p.id, name: p.name ?? p.id, agent: p.agent ?? 'human',
  }));
  return {
    id: record.id ?? file,
    file,
    size,
    game: record.game ?? null,
    createdAt: record.createdAt ?? null,
    status: record.status ?? null,
    result: record.result ?? null,
    players,
    scenario: record.params?.config?.scenario ?? null,
    fog: !!record.fog,
    moves: Array.isArray(record.log) ? record.log.length : 0,
  };
}

/**
 * Reads the recordings under `dir`, re-parsing only files whose size or mtime
 * moved since the last call. A long recording is megabytes of JSON, and a live
 * one is rewritten on every move, so the cache is what keeps a catalog request
 * from re-reading the whole directory each time.
 */
export function createRecordingReader(dir) {
  const cache = new Map(); // file -> { key, record }
  return async function readRecordings() {
    let names;
    try { names = (await readdir(dir)).filter((name) => name.endsWith('.json')); }
    catch { return []; }
    const out = [];
    const seen = new Set();
    for (const name of names) {
      seen.add(name);
      try {
        const info = await stat(resolve(dir, name));
        const key = `${info.size}:${info.mtimeMs}`;
        let hit = cache.get(name);
        if (hit?.key !== key) {
          const record = recordingRecord(name, info.size, JSON.parse(await readFile(resolve(dir, name), 'utf8')));
          hit = { key, record };
          cache.set(name, hit);
        }
        out.push(hit.record);
      } catch {
        // Half-written (a live session mid-save) or not a recording: skip it this time.
      }
    }
    for (const name of cache.keys()) if (!seen.has(name)) cache.delete(name);
    return out;
  };
}

/**
 * The whole catalog.
 *
 * @param {object} p
 * @param {Record<string, {game, minPlayers, maxPlayers, defaultPlayers}>} p.games  the GAMES registry
 * @param {object[]} p.sessions        live Session objects
 * @param {object[]} p.recordings      createRecordingReader() output
 * @param {Record<string, {path, size}[]>} p.files  editable source files per game
 * @param {(game, players, config) => object} p.setupPreview
 * @param {{id, name}[]} p.builtinAgents   agents every game offers
 * @param {object[]} p.engineOptions       options every game offers
 * @param {object[]} [p.pending]           registry entries this process has not
 *   loaded — created (or edited) since it started, so live only after a restart
 */
export function buildCatalog({ games, sessions, recordings, files, setupPreview, builtinAgents, engineOptions, pending = [] }) {
  const out = { games: [], sides: [], scenarios: [], units: [], agents: [], options: [], files: [], sessions: [], recordings: [] };
  const agentsById = new Map();
  const count = (list, name) => list.filter((r) => r.game === name).length;

  out.sessions = sessions.map(sessionRecord);
  // A recording outlives its session. One still marked active that no live
  // session owns was cut off — the server stopped mid-game — rather than ongoing.
  const live = new Set(out.sessions.map((s) => s.id));
  out.recordings = recordings.map((r) => ({
    ...r,
    live: live.has(r.id),
    status: r.status === 'active' && !live.has(r.id) ? 'interrupted' : r.status,
  }));

  for (const [name, entry] of Object.entries(games)) {
    const game = entry.game;

    for (const [i, side] of (entry.defaultPlayers ?? []).entries()) {
      out.sides.push({ id: `${name}/${side.id}`, game: name, side: side.id, name: side.name ?? side.id, seat: i + 1 });
    }

    for (const sc of game.scenarios ?? []) {
      out.scenarios.push({
        id: `${name}/${sc.id}`,
        game: name,
        scenario: sc.id,
        name: sc.name ?? sc.label ?? sc.id,
        description: sc.description ?? '',
        players: Array.isArray(sc.config?.players) ? sc.config.players.length : (entry.defaultPlayers?.length ?? 0),
        fog: !!(sc.config?.fog ?? sc.config?.fogOfWar),
        config: sc.config ?? {},
      });
    }

    let units = [];
    let unitsError = null;
    try {
      const players = (entry.defaultPlayers ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id }));
      units = unitRecords(name, setupPreview(game, players, {}));
    } catch (e) { unitsError = e.message; }
    out.units.push(...units);

    // A game's own agent replaces a builtin of the same id, as the setup screen does.
    const agents = new Map(builtinAgents.map((a) => [a.id, { id: a.id, name: a.name, own: false, analyzable: false }]));
    for (const a of game.agents ?? []) agents.set(a.id, { id: a.id, name: a.name ?? a.id, own: true, analyzable: !!a.analyze });
    for (const a of agents.values()) {
      const key = a.own ? `${name}/${a.id}` : a.id;
      let rec = agentsById.get(key);
      if (!rec) {
        rec = { id: key, agent: a.id, name: a.name, own: a.own, analyzable: a.analyzable, game: [] };
        agentsById.set(key, rec);
      }
      rec.game.push(name);
    }

    for (const opt of game.gameOptions ?? []) {
      out.options.push({
        id: `${name}/${opt.id}`, game: name, option: opt.id, name: opt.label ?? opt.id,
        description: opt.description ?? '', type: opt.type ?? 'unknown', default: opt.default ?? null,
        engine: false,
      });
    }

    for (const f of files[name] ?? []) {
      out.files.push({ id: `${name}/${f.path}`, game: name, path: f.path, size: f.size });
    }

    out.games.push({
      id: name,
      game: name,
      name,
      title: game.name ?? name,
      minPlayers: entry.minPlayers,
      maxPlayers: entry.maxPlayers,
      defaultPlayers: entry.defaultPlayers ?? [],
      scenarios: (game.scenarios ?? []).length,
      units: units.length,
      unitsError,
      options: (game.gameOptions ?? []).length,
      agents: agents.size,
      files: (files[name] ?? []).length,
      sessions: count(out.sessions, name),
      recordings: count(out.recordings, name),
      fog: (game.gameOptions ?? []).some((o) => o.id === 'fogOfWar'),
      live: true,
    });
  }

  for (const entry of pending) {
    if (games[entry.name]) continue;
    // Its source is on disk already, and editing it is what a new game is for.
    for (const f of files[entry.name] ?? []) {
      out.files.push({ id: `${entry.name}/${f.path}`, game: entry.name, path: f.path, size: f.size });
    }
    out.games.push({
      id: entry.name, game: entry.name, name: entry.name, title: entry.name,
      minPlayers: entry.minPlayers, maxPlayers: entry.maxPlayers, defaultPlayers: entry.defaultPlayers ?? [],
      scenarios: 0, units: 0, unitsError: null, options: 0, agents: 0,
      files: (files[entry.name] ?? []).length, sessions: 0, recordings: count(out.recordings, entry.name),
      fog: false, live: false,
    });
  }

  // Engine options are offered by every game, so they are one record each rather
  // than one per game; `game` lists them all so narrowing to any game keeps them.
  const everyGame = Object.keys(games);
  for (const opt of engineOptions) {
    out.options.push({
      id: `engine/${opt.id}`, game: everyGame, option: opt.id, name: opt.label ?? opt.id,
      description: opt.description ?? '', type: opt.type ?? 'unknown', default: opt.default ?? null,
      engine: true,
    });
  }

  out.agents = [...agentsById.values()];
  return out;
}
