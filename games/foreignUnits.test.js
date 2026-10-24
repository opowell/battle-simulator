/**
 * Every registered game, against every other: each game's units can be put into
 * each other game (engine/foreignUnits.js).
 *
 * What is held to it, game by game:
 *   - it takes part at all: a conversion factor for all five stats, and a profile
 *     for every unit with an attack, a defense, a move (and hp, range, domain);
 *   - every unit of every other game has a chassis in it, for some side;
 *   - one unit of every other game, actually put into a roster, is built, drawn as
 *     itself, and survives a few turns of random play with the game's own rules.
 *
 * The unit tried from each source game rotates with the host, so across the whole
 * matrix most units of every game are really played somewhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerGames, takesPart, profilesOf, foreignCatalog, dressGrid, originOf, STATS,
} from '../engine/foreignUnits.js';
import { setupPreview, rosterFromState, cellMapper } from '../engine/startingSetup.js';
import { GameEngine } from '../engine/GameEngine.js';

import { ChessGame }         from './chess/index.js';
import { TacticalGame }      from './tactical/index.js';
import { Civ1Game }          from './civ1/index.js';
import { Civ2Game }          from './civ2/index.js';
import { RiskGame }          from './risk/index.js';
import { AxisAlliesGame }    from './axisallies/index.js';
import { CombatMissionGame } from './combatmission/index.js';
import { XComGame }          from './xcom/index.js';
import { AowGame }           from './aow/index.js';
import { CsGame }            from './cs/index.js';
import { CsMiniGame }        from './csmini/index.js';
import { FFTAGame }          from './ffta/index.js';
import { Sc1Game }           from './sc1/index.js';
import { Sc2Game }           from './sc2/index.js';
import { DoomGame }          from './doom/index.js';
import { MudAndBloodGame }   from './mudandblood/index.js';
import { KDiceGame }         from './kdice/index.js';
import { WarodDotsGame }     from './warofdots/WarodDotsGame.js';
import { SurvivGame }        from './surviv/index.js';
import { Memoir44Game }      from './memoir44/index.js';
import { ArenaGame }         from './arena/index.js';

// Seat ids as api-server.js's registry deals them.
const GAMES = [
  ['chess', ChessGame, ['white', 'black']],
  ['tactical', TacticalGame, ['p1', 'p2']],
  ['civ1', Civ1Game, ['p1', 'p2']],
  ['civ2', Civ2Game, ['p1', 'p2']],
  ['risk', RiskGame, ['p1', 'p2', 'p3']],
  ['axisallies', AxisAlliesGame, ['allies', 'axis']],
  ['combatmission', CombatMissionGame, ['p1', 'p2']],
  ['xcom', XComGame, ['xcom', 'aliens']],
  ['aow', AowGame, ['p1', 'p2']],
  ['cs', CsGame, ['ct', 't']],
  ['csmini', CsMiniGame, ['ct', 't']],
  ['ffta', FFTAGame, ['p1', 'p2']],
  ['sc1', Sc1Game, ['p1', 'p2']],
  ['sc2', Sc2Game, ['p1', 'p2']],
  ['doom', DoomGame, ['marine', 'demons']],
  ['mudandblood', MudAndBloodGame, ['allies', 'axis']],
  ['kdice', KDiceGame, ['p1', 'p2', 'p3']],
  ['warofdots', WarodDotsGame, ['player', 'ai']],
  ['surviv', SurvivGame, ['blue', 'red']],
  ['memoir44', Memoir44Game, ['allies', 'axis']],
  ['arena', ArenaGame, ['p1', 'p2']],
];

registerGames(Object.fromEntries(GAMES.map(([name, game]) => [name, game])));

const seats = (ids) => ids.map(id => ({ id, name: id }));

/** A seeded rng, so a failure here fails the same way every run. */
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Random play that orders the foreign unit about whenever it can. */
function keenOn(unitId, rng) {
  return {
    id: 'keen',
    chooseAction(_state, legal) {
      const its = legal.filter(a => a.unitId === unitId && a.type !== 'rotate');
      const pool = its.length && rng() < 0.7 ? its : legal.filter(a => a.type !== 'rotate');
      const from = pool.length ? pool : legal;
      return from[Math.floor(rng() * from.length)];
    },
  };
}

/** A side's pieces in a game that counts them per territory (Risk's armies, KDice's dice and reserve). */
function piecesOf(state, ownerId) {
  const onBoard = Object.values(state.board?.territories ?? {})
    .filter(t => t.owner === ownerId).reduce((n, t) => n + (t.armies ?? t.dice ?? 0), 0);
  return onBoard + (state.gameSpecific?.stock?.[ownerId] ?? 0);
}

/**
 * Where a unit for `ownerId` can go in `preview`: the free square nearest that
 * side's first unit, on a board that names its squares — else where that unit is.
 */
function spotFor(preview, ownerId) {
  const mine = preview.roster.find(u => u.ownerId === ownerId) ?? preview.roster[0];
  const cells = (preview.board?.cells ?? []).filter(c => c.pos != null);
  const key = (pos) => JSON.stringify(pos);
  const home = cells.find(c => key(c.pos) === key(mine?.position));
  if (!preview.placeable || !home) return mine?.position ?? null;
  // Board cells are in the board's own drawing units (pixels, for a hex map), so
  // nearness is measured there; a square is taken if any unit's position is it.
  const taken = new Set(preview.roster.map(u => key(u.position)));
  let best = null;
  for (const c of cells) {
    if (taken.has(key(c.pos))) continue;
    const d = Math.hypot(c.x - home.x, c.y - home.y);
    if (!best || d < best.d) best = { d, pos: c.pos };
  }
  return best?.pos ?? mine.position;
}

for (const [hostIndex, [name, game, ids]] of GAMES.entries()) {
  test(`${name}: every unit has all five stats, and every other game's units fit`, () => {
    assert.ok(takesPart(game), `${name} declares no foreignUnits`);
    for (const k of STATS) assert.ok(game.foreignUnits.scale[k] > 0, `${name}: no conversion factor for ${k}`);
    const profiles = profilesOf(game);
    assert.ok(Object.keys(profiles).length, `${name}: no unit profiles`);
    for (const [type, p] of Object.entries(profiles)) {
      for (const k of STATS) assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${name} ${type}: ${k} is ${p[k]}`);
      assert.ok(['land', 'sea', 'air'].includes(p.domain ?? 'land'), `${name} ${type}: domain ${p.domain}`);
    }

    const base = game.createInitialState(seats(ids), {});
    const offered = new Map(foreignCatalog(game, base).map(g => [g.game, new Set(g.units.map(u => u.type))]));
    for (const [other, source] of GAMES) {
      if (other === name) continue;
      for (const type of Object.keys(profilesOf(source))) {
        assert.ok(offered.get(other)?.has(type), `${name} has no chassis for ${other}'s ${type}`);
      }
    }
  });

  test(`${name}: a unit of every other game is built, shown as itself (or laid down as pieces), and plays`, async () => {
    const players = seats(ids);
    const preview = setupPreview(game, players, {});
    const own = rosterFromState(game.createInitialState(players, preview.config));
    const sides = [...new Set(own.map(u => u.ownerId))];
    for (const [sourceIndex, [other, source]] of GAMES.entries()) {
      // A game that takes no part is the first test's failure, not this one's.
      if (other === name || !takesPart(source) || !takesPart(game)) continue;
      const entry = foreignCatalog(game, game.createInitialState(players, preview.config))
        .find(g => g.game === other);
      const types = entry.units;
      const pick = types[(hostIndex + sourceIndex) % types.length];
      const ownerId = sides.find(s => pick.plays[s]) ?? Object.keys(pick.plays)[0];
      const roster = [...own, { ownerId, type: pick.type, game: other, position: spotFor(preview, ownerId) }];
      const seed = hostIndex * 100 + sourceIndex;
      const rng = rngFrom(seed);
      const label = `${other} ${pick.type} in ${name}`;

      let engine;
      try {
        engine = new GameEngine(game, players.map(p => ({ ...p, agent: null })), {
          ...preview.config, startingUnits: roster, rng, maxTurns: 3, stepLimit: 12,
        });
        engine._init();
      } catch (e) { assert.fail(`${label}: not built — ${e.stack}`); }

      if (game.foreignUnits.absorb) {
        // A game that counts its pieces takes the unit in as that many of them.
        const worth = Math.max(1, Math.round(pick.plays[ownerId].stats.hp));
        // The same seed deals the same map (KDice rolls its own from the session's rng).
        const before = piecesOf(game.createInitialState(players, { ...preview.config, rng: rngFrom(seed) }), ownerId);
        assert.equal(piecesOf(engine.state, ownerId), before + worth, `${label}: not laid down as ${worth} pieces`);
        assert.ok(!engine.state.units.some(originOf), `${label}: still a unit after being laid down`);
        for (const p of engine.players) p.agent = keenOn(null, rng);
        try {
          for (let i = 0; i < 12; i++) if ((await engine.step()).done) break;
        } catch (e) { assert.fail(`${label}: play crashed — ${e.stack}`); }
        continue;
      }

      const unit = engine.state.units.find(u => originOf(u)?.game === other);
      assert.ok(unit, `${label}: not on the board`);
      for (const p of engine.players) p.agent = keenOn(unit.id, rng);

      const drawnGrid = game.toGrid?.(engine.state) ?? null;
      const grid = drawnGrid ? dressGrid(game, engine.state, drawnGrid, cellMapper(game, engine.state, drawnGrid).toCell) : null;
      if (grid) {
        const drawn = [...(grid.cells ?? []), ...(grid.units ?? []), ...(grid.cells ?? []).flatMap(c => c.stack ?? [])]
          .some(c => c?.origin?.game === other);
        assert.ok(drawn, `${label}: not drawn as itself`);
      }

      try {
        for (let i = 0; i < 12; i++) if ((await engine.step()).done) break;
      } catch (e) { assert.fail(`${label}: play crashed — ${e.stack}`); }
    }
  });
}
