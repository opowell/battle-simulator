# The generic AI

`agent: 'generic'`, "AI (generic tactics)". It plays any battle the engine can
run, from the units' numbers alone. It never calls a game's `evaluateState`, so a
game needs no AI of its own to have a capable opponent.

```js
import { makeGenericAgent } from './agents/generic/GenericAgent.js';
{ id: 'p2', name: 'CPU', agent: makeGenericAgent(MyGame, { timeMs: 250 }) }
```

## How it reads a game: [battleView.js](battleView.js)

Every unit becomes `{ owner, point, hp, maxHp, attack, defense, range, speed,
rate, vision }`, taken from the most specific source there is:

1. `game.unitAttributes(state, unit)`: the generic unit contract (src/kit/types.js);
2. `unit.stats`, `unit.attrs`, and the unit's own fields under the usual names;
3. the game's per-type table (`unitStats()`, or the `foreignUnits` profiles every
   registered game declares);
4. neutral defaults.

Positions are numeric `{x, y}` (BigNumber too), `{col, row}`, or algebraic
squares (`"e4"`), or whatever `game.unitPoint` says. Distance is Euclidean in
continuous space and Chebyshev on a grid.

## How it judges a position: [evaluate.js](evaluate.js)

```
material  − threat weight · what the enemy could do to me next turn
          + strike weight · what I could do to the enemy
          − approach      · how far my fighters still have to close
```

All in units of the battle's own mean stats, so the same weights read chess
pieces, FFTA black mages and Arena archers. Pressure is a greedy assignment of
attackers to targets within `speed + range`, with damage already assigned
counted so no unit is killed twice. The weights follow the play mode:
sequential means the enemy answers first, while simultaneous and real-time
strikes land together.

## How it decides: [GenericAgent.js](GenericAgent.js)

A **beam search over its own turn**. Each candidate is applied with the game's
real `applyActions` and the result evaluated, and the best few sequences are
extended until the turn ends, the move passes to another seat, or the depth
runs out. It plays the first action of the best sequence and searches again at
the next decision, so "move into range, then strike" is planned as one turn
without the game describing what a turn is.

What makes it work in every mode:

- **Continuous space**: it searches whatever points the game enumerates
  (`getSearchActions` for continuous-location games).
- **Continuous time**: an order takes time, so right after it nothing has
  visibly changed. A game reports commitments through `unitAttributes`
  (`heading`, `striking`), and the evaluation judges a unit where it is going,
  with its strike as good as landed.
- **Simultaneous**: it works out which seat it is from its legal actions, since
  several seats can be on move at one instant.
- **Readiness**: where the legal list is cheap to compute (under 0.5 ms), it
  checks at every leaf which strikes the game really allows. That covers a
  loaded gun, a target in the vision cone, a strike left this turn. Reloading
  or turning to face the enemy is then worth what it makes possible.
- **Fog**: it remembers enemies it has seen and plays against those ghosts where
  it last saw them. It forgets the position once it looks there and finds them
  gone, and drops ghosts beyond a side's survivor count. With nothing known, it
  marches on the enemy's start.
- **Damage scale**: every strike it simulates shows what the game really deals,
  and a running mean of that against the generic formula calibrates it.
- **No fidgeting**: it ends the turn unless an action beats that by a real
  margin.

Options: `{ beam: 4, depth: 4, timeMs: 250, expand: 48, aggression: 1, minGain: 1e-3 }`.

`genericEvaluateState(game)` exposes the evaluation as an `evaluateState`, so
`GreedyAgent` or the Obscuro search can play a game that has none.

## Measured

`npm run bench:generic` (see [demo/generic-ai-bench.mjs](../../demo/generic-ai-bench.mjs)
for options). Games are played in seat-swapped pairs, at 150 ms per decision,
with a turn limit of 40 (Arena), 100 (FFTA) or 60 (cs, whose matches are cut to
first-to-two-rounds).

2026-10-24, wins–losses–draws:

| Game | Opponent | Modes | W–L–D |
|---|---|---|---|
| Arena | Greedy on the same generic evaluation | all 8, 8 games each | 64–0–0 |
| Arena, fog | random | all 8, 8 games each | 61–0–3 |
| Arena | itself | all 8, 2 games each | 7–8–1 |
| FFTA | Greedy on FFTA's own evaluator | sequential, 20 games | 0–0–20 |
| FFTA | Greedy on FFTA's own evaluator | we-go, 12 games | 0–1–11 |
| cs | Greedy on cs's own evaluator | we-go, 20 matches | 0–20–0 |

The FFTA and cs rows were measured with up to ten games running at once, which
leaves a time-budgeted agent less search per decision than a quiet machine
would. Tactical (35–3–2) and CS-mini (1–19–0), which these rows replace, are gone.

**Where it is weak:** games decided by mechanics that aren't unit numbers. cs
turns on facing, vision cones, reloading and the bomb. The generic AI sees those
only through the legal list, and loses every match to Greedy playing cs's
hand-written evaluator. In FFTA neither side finishes the other within 100
turns, so the comparison against a hand-written evaluator is no longer
decisive there; Greedy against itself doesn't finish sequential FFTA in 300.
Objectives other than killing (cities, flags, checkmate) count only when they
end the game within its search.
