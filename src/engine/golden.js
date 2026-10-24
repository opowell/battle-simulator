/**
 * Golden replays: a seeded, fixed-length run of a game, boiled down to hashes.
 *
 * A run seats RandomAgent in every seat and steps the engine a fixed number of
 * times. Everything random is seeded from one number: the engine's `config.rng`
 * (which the game's createInitialState sees too), and, for the length of the run,
 * `Math.random` (RandomAgent, and any game code that draws from it) and `Date.now`
 * (ids some games mint from the clock). So the same game, config, seed and step
 * count give the same hashes, on any machine, until the game's rules change.
 *
 * What is hashed is everything a game shows the outside world: the opening
 * position, the final position, the log, the board as `toGrid` draws it, and each
 * seat's fogged view. Each gets a hash of its own, so a mismatch says where the
 * behaviour moved. The hashes are committed per game (games/<game>/golden.json,
 * written by scripts/golden.mjs) and each game's golden.test.js holds it to
 * them — a game moved, split or refactored must reproduce them exactly.
 */
import { createHash } from 'node:crypto';
import { GameEngine } from './GameEngine.js';
import { RandomAgent } from '../agents/RandomAgent.js';

/** A small, fast seeded PRNG: uniform floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `value` as JSON with every object's keys sorted, so a hash depends on what a
 * state holds and not on the order its fields were written in. Values JSON
 * can't carry go the way JSON.stringify sends them (functions and undefined
 * dropped, non-finite numbers null); a Map or Set is written as its entries.
 */
export function canonical(value) {
  const walk = (v) => {
    if (v && typeof v.toJSON === 'function') v = v.toJSON();
    if (v instanceof Map) v = [...v.entries()];
    else if (v instanceof Set) v = [...v];
    if (Array.isArray(v)) return '[' + v.map(x => {
      const s = walk(x);
      return s === undefined ? 'null' : s;
    }).join(',') + ']';
    if (v && typeof v === 'object') {
      const parts = [];
      for (const k of Object.keys(v).sort()) {
        const s = walk(v[k]);
        if (s !== undefined) parts.push(JSON.stringify(k) + ':' + s);
      }
      return '{' + parts.join(',') + '}';
    }
    if (typeof v === 'function' || v === undefined || typeof v === 'symbol') return undefined;
    if (typeof v === 'bigint') return JSON.stringify(v.toString());
    return JSON.stringify(v);
  };
  return walk(value) ?? 'null';
}

/** A short content hash of `value` (see canonical). */
export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

/** `fn()`'s value, or what it threw — a part of the run that crashes is still a result. */
function attempt(fn) {
  try { return fn(); } catch (e) { return { error: String(e?.message ?? e) }; }
}

/** Swap in seeded Math.random and a counting Date.now; returns the restorer. */
function seedGlobals(seed) {
  const random = Math.random, now = Date.now;
  Math.random = mulberry32(seed ^ 0x9e3779b9);
  let tick = 0;
  Date.now = () => 1767225600000 + tick++;
  return () => { Math.random = random; Date.now = now; };
}

/**
 * One golden run of `game`.
 * @param {object} game                       a GameDefinition
 * @param {object} spec
 * @param {{id: string, name?: string}[]} spec.players
 * @param {object} [spec.config]               session config, as the setup form would send it
 * @param {number} [spec.seed]
 * @param {number} spec.steps                  engine steps to run (fewer if the game ends)
 * @returns {Promise<{ran: number, plies: number, turn: number|null, result: object|null,
 *   error?: string, hashes: {initial: string, state: string, log: string, grid: string, visible: string}}>}
 */
export async function runGolden(game, { players, config = {}, seed = 1, steps }) {
  const restore = seedGlobals(seed);
  try {
    // As api-server.js builds a session's engine config.
    const fogOfWar = config.fog ?? config.fogOfWar ?? game.defaultConfig?.fogOfWar ?? false;
    const engine = new GameEngine(game,
      players.map(p => ({ id: p.id, name: p.name ?? p.id, agent: RandomAgent })),
      { ...game.defaultConfig, ...config, fogOfWar, rng: mulberry32(seed) });
    engine._init();
    const initial = engine.state;
    let ran = 0, error;
    try {
      while (ran < steps) {
        ran++;
        const { done } = await engine.step();
        if (done) break;
      }
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const state = engine.state;
    const visible = Object.fromEntries((state?.players ?? players).map(p =>
      [p.id, game.getVisibleState ? attempt(() => game.getVisibleState(state, p.id)) : null]));
    return {
      ran,
      plies: engine.log.length,
      turn: state?.turnNumber ?? null,
      result: engine.result ?? null,
      ...(error ? { error } : {}),
      hashes: {
        initial: digest(initial),
        state: digest(state),
        log: digest(engine.log),
        grid: digest(game.toGrid ? attempt(() => game.toGrid(state)) : null),
        visible: digest(visible),
      },
    };
  } finally {
    restore();
  }
}
