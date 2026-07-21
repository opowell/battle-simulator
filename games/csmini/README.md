# CS-mini

A deliberately tiny Counter-Strike: **2 units per team, one small map, one weapon.**
Built to be simple enough to read top-to-bottom in one file
([CsMiniGame.js](CsMiniGame.js)) while still capturing the CS feel — cones of
vision, holding an angle, reloading at the wrong moment.

## The brief, mapped to rules

| Spec | Rule |
|---|---|
| Two teams, two units each | **CT** (blue, plays first) and **T** (red), 2 units apiece |
| Units have 5 HP, a shot does 1 damage | `MAX_HP = 5`, `SHOT_DAMAGE = 1` |
| One 8×6 map with a 2×2 block in the middle | Walls at (3,2)(4,2)(3,3)(4,3) — impassable, block sight and bullets |
| A turn is 5 "seconds" | Each unit gets a **5-second budget** when its team activates; every action spends 1 second |
| Move, range 3 | At most **3 squares** of movement per turn (a separate `moveLeft` budget), one step at a time |
| Shoot — unlimited range, straight ray, stops at first contact | A ray from shooter to a visible enemy; the first unit it reaches takes the hit |
| Reload takes 1 second | The gun holds **one round**; after firing a unit must spend a second reloading. Loaded/empty carries between turns |
| Vision 1 square/second, 90° in front | A **90° cone**, **5 squares** deep (1 sq/s × 5 s), pointing where the unit faces; the wall blocks it |
| Fog on, two AIs, human observes | Fog defaults **on**; pick the greedy AI for both seats and watch as an observer |

Facing follows movement and snaps onto whatever you shoot; an explicit **rotate**
(1 second) lets a stationary unit look somewhere new. Wipe the other team to win.

## One spec, four worlds (space × time)

Everything above is the *default* world (discrete space, discrete time). But the
whole movement model comes from **one number** — a unit's speed (move range 3) —
handed to [`games/spacetime.js`](../spacetime.js), which derives how movement
behaves in any of the four quadrants of the (space × time) plane, plus sequential
or simultaneous play. Nothing about the game is re-specified per mode:

| | **Discrete time** (per-turn budget) | **Continuous time** (a clock; moves have a cooldown) |
|---|---|---|
| **Discrete space** (grid cells) | *default* — up to 3 cells/turn, one step at a time. Double speed → twice as far. | A step is instant but is followed by a cooldown of `stepDist / speed` of the turn window. Double speed → half the cooldown (twice the steps). |
| **Continuous space** (free points) | One move goes to any point within `speed` of the unit, instantly. Double speed → double the range. | The unit slides to the point; arrival is `dist / speed` later. Double speed → twice as fast. |

Pick a world from config (`space`, `time`, `play`) — in the demo:

```sh
node demo/csmini-demo.js --auto --space=continuous --time=continuous --play=simultaneous
node demo/csmini-demo.js --auto --space=continuous --time=discrete
node demo/csmini-demo.js --auto --time=continuous --play=simultaneous
```

or from the web UI's **Space / Time / Play** dropdowns. See
[`games/spacetime.js`](../spacetime.js) for the framework and
`games/spacetime.test.js` + `games/csmini/spacetime.test.js` for the full matrix.

## Turn model

The game rides the engine's discrete one-action-per-step loop. A team stays
active, spending its two units' seconds one action at a time (moves, shots,
reloads and rotates freely interleaved between the two units), until the budget
is gone or it plays `end-turn`; then the other team activates with fresh budgets.
`end-turn` is always legal, so the action list is never empty while a team lives.

## Actions

- `move` — one step to an open, unoccupied neighbour (8-directional). Costs 1 second + 1 move square; faces the step direction.
- `shoot` — at a visible enemy with a clear ray. Costs 1 second, empties the chamber, faces the target.
- `reload` — chamber a round. Costs 1 second (offered only when empty).
- `rotate` — face one of eight directions in place. Costs 1 second.
- `end-turn` — hand the round to the other team.

## AI

`CsMiniGame` implements `evaluateState`, so the engine's generic **greedy** agent
(`agents/GreedyAgent.js`, selectable as *AI (greedy heuristic)*) plays it out of
the box: it shoots what it sees, reloads when empty, and pushes toward the enemy
(toward the far spawn when fog leaves it blind). Seat-swapped, greedy beats the
random agent **100%** of games with fog on or off.

> **Fog note.** `getVisibleState` strips hidden enemies out of the `units` array,
> so `getResult` reads survivor counts from `gameSpecific.alive` (common
> knowledge) instead of counting units — otherwise a fogged-out enemy team reads
> as "eliminated" and hands the greedy agent's terminal value a phantom win.

## Try it

```sh
# Terminal demo
node demo/csmini-demo.js --auto            # greedy vs greedy, fog on
node demo/csmini-demo.js --auto --random   # random vs random
node demo/csmini-demo.js --auto --nofog    # fog off
node demo/csmini-demo.js                    # you (CT) vs greedy AI (T)

# Tests
node --test games/csmini/index.test.js

# Web UI: start the server, open /ui/design, pick "csmini",
# set both seats to "AI (greedy heuristic)", leave Fog of War on,
# and allow observers.
node api-server.js
```
