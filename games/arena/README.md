# Arena

The generic battle: a board of terrain cells and armies of units that are
nothing but numbers. It runs in every corner of (space × time × play), and it is
played by the generic AI ([src/agents/generic/](../../agents/generic/README.md)) —
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

Costs and sight lines are computed exactly ([geometry.js](geometry.js)): a
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

## Hooks it implements for the generic AI

- `unitAttributes(state, unit)`: the unit's numbers, plus in continuous time what
  it is in the middle of (`heading`, `striking`), so a position right after an
  order is judged by what the order will do.
- `nativelySimultaneous(state)`: true in continuous time, so the engine never
  wraps Arena's own clock in we-go planning.
