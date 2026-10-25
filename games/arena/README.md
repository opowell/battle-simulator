# Arena

The core's own battle: a BattleGame ([src/battle/](../../src/battle/README.md)) and
its scenarios. The original Arena is its default: a board of terrain cells and
armies of units that are nothing but numbers. Every other scenario is a battle
spec ([specs/](specs/)) showing off part of the core model, and the library's maps
are scenarios too, where the units of every game mix. Everything runs in every
corner of (space × time × play) its board allows, with fog on or off, and is
played by the generic AI ([src/agents/generic/](../../src/agents/generic/README.md)):
Arena has no evaluator of its own on purpose.

## Units

Every unit carries its own numbers in `unit.stats`; the types below are only
presets. A customised roster may field anything, including other games' units
(converted by `src/engine/foreignUnits.js`).

| Stat | Meaning |
|---|---|
| `hp` | damage it takes to kill (on the unit: `hp` / `maxHp`) |
| `attack` | how hard it hits |
| `defense` | how well it resists a hit |
| `range` | how far it strikes (beyond 1, a missile: needs a clear line) |
| `speed` | movement points per turn window |
| `rate` | strikes per turn window |
| `vision` | how far it sees (fog of war) |

| Type | HP | ATK | DEF | Range | Speed | Rate | Vision |
|---|---|---|---|---|---|---|---|
| `infantry` | 10 | 4 | 4 | 1 | 3 | 1 | 4 |
| `archer` | 7 | 4 | 2 | 4 | 3 | 1 | 5 |
| `cavalry` | 10 | 5 | 3 | 1 | 6 | 1 | 5 |
| `knight` | 16 | 6 | 6 | 1 | 2 | 1 | 3 |
| `artillery` | 6 | 8 | 1 | 6 | 2 | 1 | 4 |
| `scout` | 5 | 2 | 2 | 1 | 8 | 2 | 8 |

A strike deals `max(1, ⌊attack² / (attack + defense × (1 + cover))⌋)` —
deterministic, always an integer.

## Terrain

| Terrain | Move cost | Cover | Passable | Blocks sight |
|---|---|---|---|---|
| open | 1 | — | yes | no |
| forest | 2 | +50% defense | yes | no |
| hill | 2 | +25% defense | yes | no |
| water | — | — | no | no |
| rock | — | — | no | yes |

Costs and sight lines are computed exactly ([src/battle/geometry.js](../../src/battle/geometry.js)): a
segment is walked cell by cell and the length it spends in each cell is measured,
not sampled.

## The eight modes

Set on the setup form: **Space** and **Time** are Arena's options; sequential vs
simultaneous is the engine's **Simultaneous turns** switch.

| | Discrete time (turns) | Continuous time (one clock) |
|---|---|---|
| **Discrete space** (cells, Chebyshev distance) | each unit: one move of up to `speed` points along an 8-neighbour path, and `rate` strikes, in either order | an idle unit is ordered; it hops cell by cell, each cell when its share of the cost is paid |
| **Continuous space** (points, Euclidean distance) | the move is a straight segment to any reachable point (a lattice is offered, any clicked point is legal) | the unit slides, crossing each cell at that cell's pace |

| | Sequential | Simultaneous |
|---|---|---|
| **Discrete time** | I-go-you-go | the engine's we-go: everyone plans a turn, `KineticResolver` plays the plans out together |
| **Continuous time** | at each instant, seats with idle units decide one after another (initiative rotates each instant), each seeing the orders before it | every seat with a decision is on move at once |

In continuous time an order is a **task** that takes time: a move takes
`cost / speed` of a turn window, a strike lands after a wind-up of `0.5 / rate`,
a `wait` lasts whatever length is named (any value from 0.01 to 8 windows, not a
menu). When no seat has a decision left, the clock runs to the next completion.
Everything completing at one instant happens together, so two units striking each
other at once both land. A strike fizzles if, when it lands, the target is out of
range: in continuous time you can dodge. Units in transit pass through one
another; a destination is claimed when ordered.

A turn in discrete time ends when **every** seat has ended it, whatever order
they end in. That is what makes the same rules work under the we-go resolver,
which re-checks every order against `getLegalActions` when it completes,
whoever is "active" then.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `elimination`: every other side wiped out |
| Draw | `mutual-destruction`, `standoff` (continuous time: 40 idle advances with nothing happening), or the engine's `max-turns` |

`getResult` reads the common-knowledge survivor counts (`gameSpecific.alive`),
never `units`, so a side hidden by fog is not mistaken for a dead one.

## Scenarios

| Id | Board |
|---|---|
| `skirmish` | 14×10: a river with two fords, woods, hills, a rock outcrop; five units a side |
| `open-field` | 12×8 of open ground |
| `real-time` | the skirmish in continuous space and time, simultaneous |

Every spec is a file in [specs/](specs/), `<id>.json`, and every file there is a
scenario: the Browser's **Specs** edits them, makes new ones and deletes them,
and a change is played by the next session started, without a restart. The
reference specs, none with names or art from another game:

| Id | Shows |
|---|---|
| `magic` | MP pools, statuses (haste, slow, poison, stop, regen, shell, blind), an area spell, heals, a cleanse, a teleport, a push; lose your knight (`royal`) and you lose |
| `scifi` | energy and absorbing shields, cloaking and a detector's sight, a scanner sweep, air units over water and rock, a ground-only gun, a siege-mode transform, high ground and concealing craters; the courier must `reach` the far edge, the defence must `survive` 20 turns |
| `hex` | a hex board with a two-level hill, facing with flank and rear arcs, bowmen with a 180° cone, horses that can't climb two levels; `hold` the summit for three turns |
| `regions` | twelve territories, armies as counts (`stacking: 'count'`) that merge; `points` after 12 turns, two a turn for each city held |
| `close-quarters` | a shape board: a building of walls, doors and windows, crates, rubble; vision cones, facing, and ammo that must be reloaded |
| `pieces` | a board game: pieces that move by patterns (`moves`: a slider, a leaper, a step that takes only diagonally) and take by moving, a promotion, one piece a turn (`turn.units`), a warden under the check rule (mate wins, stalemate draws), file and rank labels, shown as a board game (`display`) |

With the library loaded (the server does), four **mixed** scenarios put units of
several games on library maps: a square (`mixed-two-rivers`, civ1's), a hex
(`mixed-encounter`, Memoir '44's), a regions board (`mixed-world`, Risk's) and a
shape map (`mixed-dust2`, cs's). Every library map is offered as a scenario of
its own too (`library:<game>/<map>`), with its game's own units at its own
starts. A library map plays in its game's distances: a unit's range and move
convert into that game's cells (its pack's `scale`). It plays as its terrain,
not as its game; each pack's `pack.json` says what it leaves out.

## Hooks it implements for the generic AI

- `unitAttributes(state, unit)`: the unit's numbers as its statuses leave them,
  its facing and cone, a `worthBonus` for its pools and statuses, and in
  continuous time what it is in the middle of (`heading`, `striking`), so a
  position right after an order is judged by what the order will do.
- `unitPoint(state, unit)`: where it stands, on a plane where neighbouring cells
  are 1 apart (hex and regions boards).
- `nativelySimultaneous(state)`: true in continuous time, so the engine never
  wraps Arena's own clock in we-go planning.

Specs may name functions in [hooks.js](hooks.js) with `{ fn }`; none of the
reference scenarios needs one.
