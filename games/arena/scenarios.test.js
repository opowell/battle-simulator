// Every scenario of Arena's, in every mode its board allows, played through the
// engine: random play must stay legal and end (or reach the turn limit), and the
// generic AI must be able to play each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '#core/engine/index.js';
import { RandomAgent } from '#core/agents/RandomAgent.js';
import { makeGenericAgent } from '#core/agents/generic/GenericAgent.js';
import { checkSpec, resolveSpec } from '#core/battle/spec.js';
import { ArenaGame } from './index.js';
import { SPECS } from './specs/index.js';
import * as hooks from './hooks.js';

const PLAYERS = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
const MODES = [];
for (const space of ['discrete', 'continuous']) for (const time of ['discrete', 'continuous']) for (const simultaneousTurns of [false, true]) for (const fogOfWar of [false, true]) {
  MODES.push({ space, time, simultaneousTurns, fogOfWar });
}

test('every spec checks out', () => {
  for (const spec of Object.values(SPECS)) assert.deepEqual(checkSpec(resolveSpec(spec), hooks), [], spec.id);
});

for (const id of Object.keys(SPECS)) {
  test(`${id}: plays legally in every (space × time × play × fog) mode`, async () => {
    for (const mode of MODES) {
      const players = PLAYERS.map(p => ({ ...p, agent: RandomAgent }));
      const engine = new GameEngine(ArenaGame, players, { spec: id, ...mode, maxTurns: 8 });
      const { result } = await engine.run();
      assert.ok(result, `${id} ${JSON.stringify(mode)}`);
      const s = engine.state;
      // A board without a plane under it is always discrete space.
      if (['hex', 'regions'].includes(s.board.topology)) assert.equal(s.gameSpecific.spacetime.space, 'discrete');
      for (const p of PLAYERS) ArenaGame.toGrid(ArenaGame.getVisibleState(s, p.id));
    }
  });
}

test('the generic AI plays every spec', async () => {
  for (const id of Object.keys(SPECS)) {
    for (const time of ['discrete', 'continuous']) {
      const players = PLAYERS.map(p => ({ ...p, agent: makeGenericAgent(ArenaGame, { timeMs: 15 }) }));
      const { result } = await new GameEngine(ArenaGame, players, { spec: id, time, maxTurns: 4 }).run();
      assert.ok(result, `${id} ${time}`);
    }
  }
});
