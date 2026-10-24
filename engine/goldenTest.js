/**
 * The test side of golden replays (engine/golden.js): one node:test per case in
 * the golden.json beside the calling test file. Each game's golden.test.js is
 * just a call to this, so a game carries its goldens and their test with it.
 *
 * A mismatch is a change in what the game does. If it was meant, re-record the
 * game's goldens with `node scripts/golden.mjs <game>` and commit them with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGolden } from './golden.js';

export function goldenTests(testUrl) {
  const golden = JSON.parse(readFileSync(new URL('./golden.json', testUrl), 'utf8'));
  const loaded = import(new URL(golden.module, testUrl).href).then(mod => mod[golden.export]);
  for (const c of golden.cases) {
    test(`${golden.game} golden replay: ${c.id}`, async () => {
      const game = await loaded;
      const run = await runGolden(game, { players: c.players, config: c.config, seed: c.seed, steps: c.steps });
      const { hashes, ...rest } = run;
      const { hashes: want, id, players, config, seed, steps, ...wantRest } = c;
      // The summary first: it says how far the run got before it went another way.
      assert.deepEqual(rest, wantRest, `${golden.game} ${c.id}: the run went differently`);
      assert.deepEqual(hashes, want, `${golden.game} ${c.id}: the same run, different results`);
    });
  }
}
