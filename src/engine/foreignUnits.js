/**
 * foreignUnits.js — units from one game playing under another game's rules.
 *
 * A session has ONE set of rules, its game's, but its roster may name units of
 * any other game that lends them out: an SC1 marine standing in a civ1 army, a
 * chess knight in a tactical skirmish. The rules never learn a new unit: every
 * game reads a unit's stats out of a table of its own, by type, and has
 * behaviour keyed on its own type names. So a foreign unit plays AS one of the
 * host's own types, its CHASSIS — moving and fighting the way that type does —
 * but with its stats converted from its own game's numbers into the host's, and
 * wearing its own game's picture and name.
 *
 * ── The conversion factor ────────────────────────────────────────────────────
 * Games count in very different numbers: a civ1 unit has 10 hp, an SC1 marine 40,
 * a Doom baron 400. Each game that takes part declares a `scale` — what ONE point
 * of each stat in the common vocabulary below is worth in its own numbers, which
 * in practice is its standard line infantryman. A stat converts as
 *
 *     host value = source value × host.scale[stat] / source.scale[stat]
 *
 * so a unit twice as tough as a marine comes out twice as tough as a legion. The
 * vocabulary is deliberately small — what every game has some reading of:
 *
 *   hp       how much punishment it takes before it dies
 *   attack   how hard it hits (damage, combat strength — the game's own notion)
 *   defense  how well it resists being hit
 *   range    how far it attacks, in its own board's cells (1 = adjacent)
 *   move     how far it moves in a turn, in its own board's cells
 *
 * plus a `domain` ('land' | 'sea' | 'air') that decides which chassis it may take.
 * Every unit of every game has all five (games/foreignUnits.test.js holds every
 * registered game to it).
 *
 * ── The general adjustment factor ────────────────────────────────────────────
 * `scale` makes one game's standard infantryman the same as another's. Whether
 * that is fair — whether a Doom marine SHOULD stand level with a civ1 militia —
 * is a separate question, answered by each game's `factor` (default 1): its
 * strength stats (hp, attack, defense) count `factor` times over when they are
 * compared with another game's. A game with factor 2 lends out units twice as
 * strong, and a unit lent to it comes in at half. Range and move are distances on
 * a board — `scale` alone says how one board's cells compare with another's — so
 * the factor leaves them be.
 *
 * ── A stat a game's rules can't set unit by unit ─────────────────────────────
 * Doom, X-Com and Mud and Blood have no armour: a hit is a hit. Memoir '44 has
 * one, but only two settings of it (which die faces kill infantry, which armor).
 * Such a game says where the stat goes instead, `fold: { defense: 'hp' }`. A
 * foreign unit then keeps its chassis's defense, and its own above or below that
 * is carried in its hp — twice the defense takes twice the hits to kill, which is
 * what twice the hp does. A game with no armour at all needn't give its profiles
 * a defense: they read as the standard, one point (`scale.defense`).
 *
 * ── What a game declares (all optional; see src/kit/types.js) ──────────────────
 *
 *   game.foreignUnits = {
 *     scale,                       // the conversion factor, per stat — all five
 *     factor,                      // the general adjustment factor (default 1)
 *     fold,                        // { stat: 'hp' } for a stat its rules have no knob for
 *     absorb,                      // true for a game that counts its pieces (Risk's armies,
 *                                  //   KDice's dice): a unit laid out there becomes its hp's worth
 *                                  //   of them (its applyStartingUnits does it), not a unit drawn as itself
 *     profiles(),                  // { type: { hp, attack, …, domain, chassis? } } in its own numbers —
 *                                  //   every type it lends out, and every type it can put a foreign unit in
 *     art(type, seat),             // { imagePath, glyph, name } — how its unit looks, for seat 0, 1, …
 *     table,                       // import: the type table its rules read (UNITS) — the foreign
 *     write(entry, stats),         //   type is registered there, as the chassis's entry with the
 *                                  //   converted stats written in
 *     adopt(unit, stats),          // import: write converted stats onto the unit itself, for rules
 *                                  //   that read them off the unit (xcom's attrs.aim) rather than a table
 *     realize(chassis, stats),     // what a unit given `stats` really ends up with once the game has
 *                                  //   rounded them its own way — what a setup screen shows
 *   }
 *
 * A game with a `table` registers each foreign type in it under a key of its own
 * (`sc1:marine`) as a NON-ENUMERABLE property: every `UNITS[u.type]` the rules,
 * the AI and the renderer do finds the converted entry, while everything that
 * lists the table (production menus, an AI's build choices, the setup editor's
 * own types) never sees it. The key depends only on the source unit and the host,
 * so registering it again — another session, a replay — finds the same entry.
 * A game without one keeps the chassis's own type on the unit (chess must: its
 * move generator knows six types) and `adopt` carries the stats, if it has any.
 *
 * Which games exist is the api-server's registry, handed over with registerGames.
 */

/** The stats of the common vocabulary, in the order they are shown. */
export const STATS = ['hp', 'attack', 'defense', 'range', 'move'];

/** The stats a game's general adjustment factor applies to: strength, not distance. */
export const STRENGTH_STATS = ['hp', 'attack', 'defense'];

/** A game's general adjustment factor (1 unless it declares one). */
export function factorOf(game) {
  const f = game?.foreignUnits?.factor;
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : 1;
}

/** What one point of `stat` in `game`'s numbers is worth in the common vocabulary. */
function worth(game, stat) {
  const s = game?.foreignUnits?.scale?.[stat];
  if (!(s > 0)) return null;
  return (STRENGTH_STATS.includes(stat) ? factorOf(game) : 1) / s;
}

/** The stats `game`'s rules carry in another stat ({ defense: 'hp' }), as entries. */
const folded = (game) => Object.entries(game?.foreignUnits?.fold ?? {});

const games = new Map();   // registry name ('sc1') → game definition

/**
 * Tell this module which games exist, as the api-server's GAMES registry
 * ({ name: { game } }) or as plain { name: definition }.
 */
export function registerGames(map) {
  for (const [name, entry] of Object.entries(map ?? {})) {
    const def = entry?.game ?? entry;
    if (def) games.set(name, def);
  }
}

/** A registered game definition by its registry name, or null. */
export function gameNamed(name) { return games.get(name) ?? null; }

/** The registry name of a game definition ('sc1' for Sc1Game), or null. */
export function nameOfGame(game) {
  for (const [name, def] of games) if (def === game) return name;
  return null;
}

/**
 * Whether `game` takes part: lends its units to the other games and takes theirs in.
 * Both need its unit profiles and its conversion factor, so it is one question.
 */
export const takesPart = (game) => typeof game?.foreignUnits?.profiles === 'function' && !!game.foreignUnits.scale;

/** The key a foreign type is registered under in a host's table. */
export const foreignKey = (from, type) => `${from}:${type}`;

/** Where a unit came from — { game, type, seat } — or null for the host's own. */
export function originOf(unit) {
  return unit?.origin && typeof unit.origin === 'object' && unit.origin.game ? unit.origin : null;
}

const profileCache = new WeakMap();
/** Every type `game` lends out, with its stats in its own numbers. */
export function profilesOf(game) {
  if (!takesPart(game)) return {};
  let p = profileCache.get(game);
  if (!p) {
    p = game.foreignUnits.profiles() ?? {};
    // A stat the rules carry in another one reads, on every unit, as the standard.
    const standard = folded(game).map(([k]) => [k, game.foreignUnits.scale?.[k]]).filter(([, v]) => v > 0);
    if (standard.length) {
      p = Object.fromEntries(Object.entries(p).map(([type, prof]) => [type, { ...Object.fromEntries(standard), ...prof }]));
    }
    profileCache.set(game, p);
  }
  return p;
}

/**
 * `stats` in `from`'s numbers, in `to`'s — only the stats both have a reading of.
 * Each goes through the common vocabulary: its worth in `from` over its worth in
 * `to`, which is the ratio of the two scales times, for a strength stat, the ratio
 * of the two games' general adjustment factors.
 */
export function convertStats(stats, from, to) {
  const out = {};
  for (const k of STATS) {
    const v = stats?.[k];
    const a = worth(from, k), b = worth(to, k);
    if (typeof v !== 'number' || !Number.isFinite(v) || a == null || b == null) continue;
    out[k] = v * a / b;
  }
  return out;
}

/** A converted stat as a whole number of at least `min` (most rules count in integers). */
export const whole = (v, min = 1) => Math.max(min, Math.round(Number(v) || 0));

/** The average of a [min, max] damage roll — how such a game reads its attack. */
export const meanOf = ([lo, hi]) => (lo + hi) / 2;

/** A [min, max] damage roll rescaled to average `mean`, its spread kept in proportion. */
export function rescaleRoll([lo, hi], mean) {
  const f = lo + hi > 0 ? (2 * mean) / (lo + hi) : 1;
  const a = whole(lo * f);
  return [a, Math.max(a, whole(hi * f))];
}

/** The common-vocabulary reading of `stats` in `game`'s numbers (each stat at its worth). */
function common(stats, game) {
  const out = {};
  for (const k of STATS) {
    const w = worth(game, k);
    if (typeof stats?.[k] === 'number' && w != null) out[k] = stats[k] * w;
  }
  return out;
}

// How much each stat counts in picking a chassis: toughness and punch decide what a
// unit IS far more than how far it walks.
const WEIGHT = { hp: 1, attack: 1, defense: 0.6, range: 0.5, move: 0.5 };

/**
 * The host type a unit with these common-vocabulary stats plays as: the closest one,
 * stat for stat on a log scale (twice as tough is as far as half as tough), among the
 * types the host offers as a chassis and can actually make here. A unit keeps its
 * domain wherever the host has a chassis of that domain.
 */
function pickChassis(host, base, stats, domain, ownerId) {
  const profiles = profilesOf(host);
  const canMake = (type) => typeof host.createSetupUnit === 'function'
    || (base?.units ?? []).some(u => u && u.alive !== false && u.type === type && !originOf(u));
  let best = null;
  for (const [type, p] of Object.entries(profiles)) {
    if (p.chassis === false || !canMake(type)) continue;
    // A type only one side's rules know how to play (Doom's marine shoots guns, its
    // demons claws and fireballs) carries only that side's units.
    if (ownerId != null && Array.isArray(p.owners) && !p.owners.includes(ownerId)) continue;
    const c = common(p, host);
    let d = (p.domain ?? 'land') === (domain ?? 'land') ? 0 : 100;
    for (const k of STATS) {
      if (c[k] == null || stats[k] == null) continue;
      d += WEIGHT[k] * Math.log((c[k] + 0.05) / (stats[k] + 0.05)) ** 2;
    }
    if (!best || d < best.d) best = { type, d };
  }
  return best?.type ?? null;
}

/**
 * Everything about one foreign unit in `host`, worked out without building it:
 * the chassis it plays as for `ownerId`, and its stats in the host's numbers (a
 * stat the source has no reading of is the chassis's own). Null when it cannot go
 * there.
 */
export function foreignSpec(host, base, from, type, ownerId = null) {
  const source = gameNamed(from);
  if (!takesPart(host) || !takesPart(source) || source === host) return null;
  const profile = profilesOf(source)[type];
  if (!profile) return null;
  const chassis = pickChassis(host, base, common(profile, source), profile.domain, ownerId);
  if (!chassis) return null;
  const own = profilesOf(host)[chassis];
  const converted = convertStats(profile, source, host);
  const stats = {};
  for (const k of STATS) {
    const v = converted[k] ?? own[k];
    if (v != null) stats[k] = v;
  }
  // A stat the host's rules can't set unit by unit rides in the one they carry it
  // in: twice its chassis's defense, twice the hp. The unit keeps the chassis's.
  for (const [k, into] of folded(host)) {
    const kept = own[k] ?? host.foreignUnits.scale?.[k];
    if (!(kept > 0) || typeof stats[k] !== 'number' || typeof stats[into] !== 'number') continue;
    stats[into] *= stats[k] / kept;
    stats[k] = kept;
  }
  return { from, type, chassis, stats, source: profile };
}

/** How a unit of `from` looks: its own game's picture, letter and name. */
export function foreignArt(from, type, seat = 0) {
  const source = gameNamed(from);
  const art = source?.foreignUnits?.art?.(type, seat) ?? {};
  return {
    imagePath: art.imagePath ?? null,
    glyph: art.glyph ?? String(type)[0]?.toUpperCase() ?? '?',
    name: art.name ?? type,
    game: source?.name ?? from,
  };
}

/**
 * Why a roster entry naming a foreign unit cannot go into `host`, or '' when it can.
 * The entry says where its unit comes from in `game` ('sc1') beside its `type`.
 */
export function foreignEntryError(host, base, entry) {
  const hostName = nameOfGame(host);
  if (!takesPart(host)) return `${host?.name ?? hostName} does not take units from other games`;
  const source = gameNamed(entry.game);
  if (!source) return `no game "${entry.game}"`;
  if (!takesPart(source)) return `${source.name ?? entry.game} does not lend its units to other games`;
  if (!profilesOf(source)[entry.type]) return `"${entry.type}" is not a unit of ${source.name ?? entry.game}`;
  if (!foreignSpec(host, base, entry.game, entry.type, entry.ownerId)) return `no ${host.name ?? hostName} unit can carry a ${source.name ?? entry.game} ${entry.type}`;
  return '';
}

/** The seat number of `ownerId` in `base` — which of a source's sides its art is drawn as. */
export function seatOf(base, ownerId) {
  const seats = (base?.players ?? []).map(p => p.id);
  const i = seats.indexOf(ownerId);
  if (i >= 0) return i;
  const owners = [...new Set((base?.units ?? []).map(u => u?.ownerId))];
  return Math.max(0, owners.indexOf(ownerId));
}

/**
 * `table[key]`, registered the way a foreign type is (non-enumerable, frozen, once)
 * — for a game whose rules read a unit's stats from some OTHER table than its
 * type's, such as the weapon it carries (CS, Surviv). `make()` builds the entry the
 * first time; the key should name everything it depends on, so that registering
 * it again — another session, a replay — finds the same one.
 */
export function lend(table, key, make) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    Object.defineProperty(table, key, { value: Object.freeze(make()), enumerable: false, configurable: false, writable: false });
  }
  return key;
}

const chassisOfKey = new WeakMap();   // host table → Map(registered key → chassis it copies)

/**
 * The host's type for a foreign unit: its table's entry registered under the
 * foreign key (a game with a table), or the chassis itself (a game without one).
 */
function hostType(host, spec) {
  const fu = host.foreignUnits;
  if (!fu.table) return spec.chassis;
  // The same unit plays as the same chassis for every side of nearly every game; a
  // game whose sides need different ones gets a key per chassis after the first.
  let key = foreignKey(spec.from, spec.type);
  const was = chassisOfKey.get(fu.table)?.get(key);
  if (was != null && was !== spec.chassis) key = `${key}@${spec.chassis}`;
  if (!Object.prototype.hasOwnProperty.call(fu.table, key)) {
    if (!chassisOfKey.has(fu.table)) chassisOfKey.set(fu.table, new Map());
    chassisOfKey.get(fu.table).set(key, spec.chassis);
    const chassisEntry = structuredClone(fu.table[spec.chassis]);
    const entry = fu.write ? fu.write(chassisEntry, spec.stats, spec) : chassisEntry;
    Object.defineProperty(fu.table, key, { value: Object.freeze(entry), enumerable: false, configurable: false, writable: false });
  }
  return key;
}

/**
 * Build one foreign unit for a roster: `entry` ({ ownerId, type, game, position })
 * as a unit of `host` with id `id`. `native(spec)` builds a host unit the way the
 * roster builds its own (startingSetup.js's mint, minus the id it already chose).
 */
export function mintForeign(host, base, entry, id, native) {
  const spec = foreignSpec(host, base, entry.game, entry.type, entry.ownerId);
  if (!spec) throw new Error(`startingUnits: ${foreignEntryError(host, base, entry) || `no way to build a ${entry.game} "${entry.type}"`}`);
  const type = hostType(host, spec);
  // A host with a table makes the unit FROM the registered entry where it has a
  // factory, so whatever it derives from its stats (moves left, shields) is the
  // foreign unit's own; one without makes a plain chassis to write onto.
  let unit = { ...native({ ...entry, id, type }, spec.chassis), id, type, ownerId: entry.ownerId, alive: true };
  if (typeof unit.hp === 'number' && spec.stats.hp != null) {
    const hp = whole(spec.stats.hp);
    unit = { ...unit, hp, ...(typeof unit.maxHp === 'number' ? { maxHp: hp } : {}) };
  }
  if (typeof host.foreignUnits.adopt === 'function') unit = host.foreignUnits.adopt(unit, spec.stats, spec);
  return { ...unit, id, ownerId: entry.ownerId, alive: true, origin: { game: spec.from, type: spec.type, chassis: spec.chassis, seat: seatOf(base, entry.ownerId) } };
}

/**
 * The stats a foreign unit really plays with in `host`: what the host makes of the
 * converted ones (its own rounding, its own floors), or — for a host with nowhere
 * to write stats, like chess — simply the chassis's own.
 */
function applied(host, spec) {
  const fu = host.foreignUnits;
  if (typeof fu.realize === 'function') return { ...spec.stats, ...fu.realize(spec.chassis, spec.stats, spec) };
  if (!fu.table && typeof fu.adopt !== 'function') return profilesOf(host)[spec.chassis] ?? {};
  return spec.stats;
}

/** `stats` rounded for showing (one decimal), only the ones with a value. */
const shown = (stats) => Object.fromEntries(STATS.filter(k => typeof stats?.[k] === 'number').map(k => [k, Math.round(stats[k] * 10) / 10]));

/**
 * Every unit `host` could take from the other games, grouped by game, for a setup
 * screen: what it is, what it looks like, its stats in its own game, and — for each
 * side that could field it — what it plays as here and its stats in the host's
 * numbers (`plays[ownerId]`; a chassis may only carry one side's units). Empty when
 * the host takes none.
 */
export function foreignCatalog(host, base, ownerIds = null) {
  if (!takesPart(host)) return [];
  const hostName = nameOfGame(host);
  const hostProfiles = profilesOf(host);
  const owners = ownerIds ?? [...new Set([
    ...(base?.players ?? []).map(p => p.id),
    ...(base?.units ?? []).filter(u => u && u.alive !== false).map(u => u.ownerId),
  ])];
  const out = [];
  for (const [name, source] of games) {
    if (name === hostName || source === host || !takesPart(source)) continue;
    const units = [];
    for (const [type, profile] of Object.entries(profilesOf(source))) {
      const plays = {};
      for (const ownerId of owners) {
        const spec = foreignSpec(host, base, name, type, ownerId);
        if (!spec) continue;
        const chassisArt = host.foreignUnits.art?.(spec.chassis, seatOf(base, ownerId));
        plays[ownerId] = { chassis: spec.chassis, chassisName: chassisArt?.name ?? spec.chassis, stats: shown(applied(host, spec)), own: shown(hostProfiles[spec.chassis]) };
      }
      if (!Object.keys(plays).length) continue;
      const art = foreignArt(name, type, 0);
      units.push({ type, name: art.name, imagePath: art.imagePath, glyph: art.glyph, source: shown(profile), plays });
    }
    if (units.length) out.push({ game: name, title: source.name ?? name, units });
  }
  return out;
}

/**
 * `grid` (a host's toGrid of `state`) with every foreign unit drawn as itself:
 * its own game's picture, letter and name in place of the chassis's, and a tag
 * saying where it is from and what it plays as. The host's renderer drew the
 * chassis — it knows no other — so this is done after it, for every game alike.
 *
 * A unit is found by id where the renderer names it (a cell's unitId, a stacked
 * token, an entry of a positioned `units` list), else by the cell it stands on.
 */
export function dressGrid(game, state, grid, toCell = null) {
  if (!grid || typeof grid !== 'object') return grid;
  const foreign = (state?.units ?? []).filter(u => u && u.alive !== false && originOf(u));
  if (!foreign.length) return grid;
  const byId = new Map(foreign.map(u => [u.id, u]));
  const chassisName = (u) => game?.foreignUnits?.art?.(u.origin.chassis, u.origin.seat)?.name ?? u.origin.chassis;
  const dress = (cell, u) => {
    const art = foreignArt(u.origin.game, u.origin.type, u.origin.seat);
    // Every picture the chassis was drawn with goes: a unit whose own game draws it
    // as a letter is a letter here too, not the chassis's sprite.
    const { spriteLayers: _layers, mainImagePath: _main, ...rest } = cell;
    const converted = game?.foreignUnits?.table || typeof game?.foreignUnits?.adopt === 'function';
    const tag = {
      label: `${art.game} · as ${chassisName(u)}`,
      title: `${art.name}, from ${art.game} — moves and fights as a ${chassisName(u)} here${converted ? ', its stats converted into this game\'s' : ''}`,
    };
    return {
      ...rest,
      glyph: art.glyph,
      unitName: art.name,
      imagePath: art.imagePath,
      portraitPath: art.imagePath,
      tags: [...(Array.isArray(rest.tags) ? rest.tags : []), tag],
      origin: { game: u.origin.game, type: u.origin.type, chassis: u.origin.chassis },
    };
  };

  const placed = new Map();
  if (toCell) {
    for (const u of foreign) {
      const at = toCell(u.position);
      if (at) placed.set(`${at[0]},${at[1]}`, u);
    }
  }
  const cells = Array.isArray(grid.cells) ? grid.cells.map((c) => {
    let out = c;
    const u = c.unitId != null ? byId.get(c.unitId) : (c.glyph && (c.col ?? c.x) != null ? placed.get(`${c.col ?? c.x},${c.row ?? c.y}`) : undefined);
    if (u) out = dress(out, u);
    if (Array.isArray(c.stack) && c.stack.some(s => byId.has(s.unitId))) {
      out = { ...out, stack: c.stack.map(s => (byId.has(s.unitId) ? dress(s, byId.get(s.unitId)) : s)) };
    }
    return out;
  }) : grid.cells;
  const units = Array.isArray(grid.units)
    ? grid.units.map(x => (x && byId.has(x.id) ? dress(x, byId.get(x.id)) : x))
    : grid.units;
  return { ...grid, cells, units };
}

/**
 * A `foreignUnits` declaration for a game whose rules read every stat from one
 * type table — the common case. `read(entry, type)` is a type in the common
 * vocabulary (its own numbers), `write(entry, stats)` the entry with converted
 * stats written in.
 */
export function tableUnits({ table, scale, read, write, art, chassis = () => true }) {
  return {
    scale,
    table,
    write,
    art,
    realize: (type, stats, spec) => read(write(structuredClone(table[type]), stats, spec), type) ?? {},
    profiles: () => Object.fromEntries(Object.keys(table).map((type) => {
      const p = read(table[type], type);
      return p ? [type, { ...p, ...(chassis(type, table[type]) ? {} : { chassis: false }) }] : null;
    }).filter(Boolean)),
  };
}
