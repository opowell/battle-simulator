# BattleGame

The core's battle: one `GameDefinition` for every battle the core can describe,
driven by a **battle spec**, which is JSON. A scenario is a spec. Arena
([games/arena](../../games/arena/README.md)) is the core's own BattleGame, and a
game repo can make one of its own:

```js
import { makeBattleGame } from '#core/battle/BattleGame.js';

export const MyGame = makeBattleGame({
  name: 'My game',            // state.gameName; keys its hooks
  spec: { … },                // its default spec, over the base (Arena's)
  specs: { siege: { … } },    // named specs: config.spec = 'siege'
  scenarios: [{ id: 'siege', name: 'Siege', config: { spec: 'siege' } }],
  hooks: { psionicStorm },    // the functions its specs may name with { fn }
  specsDir,                   // optional: where its named specs are kept as files
});
```

With a `specsDir` (one `<id>.json` per named spec), its specs can be edited
while the server runs: the Browser's **Specs** reads and writes them through
`game.specBook` (`ids`, `get`, `check`, `put`, `drop`; the files are
[src/server/specEditor.js](../server/specEditor.js)'s). A saved spec is played by
the next session started; a running one keeps the rules it started with. A game
whose scenarios should follow the edits lists them from `specBook` rather than
from a fixed list, as Arena does.

A session picks its spec with `config.spec`: an id, or a whole spec inline. The
resolved spec travels in the state (`gameSpecific.rules`), so a saved or
replayed session needs nothing else. A session without one plays the game's
default, and its state carries no rules at all, which is how Arena's own
scenarios replay exactly as they did before BattleGame existed.

| Module | What it holds |
|---|---|
| [spec.js](spec.js) | the spec format, the base ruleset (Arena's), `resolveSpec`, `checkSpec` |
| [BattleGame.js](BattleGame.js) | movement, time, turns, fog, drawing; `makeBattleGame` |
| [board.js](board.js) | the four topologies behind one interface |
| [units.js](units.js) | declared attributes: numbers, pools, tags, statuses |
| [abilities.js](abilities.js) | abilities and the effect vocabulary |
| [victory.js](victory.js) | objectives |
| [world.js](world.js) | what every rule asks of a state: rules, distance, stats, sight, damage |
| [exact.js](exact.js) | formulas, evaluated in exact rationals |
| [library.js](library.js) | the library's maps as specs |
| [strike.js](strike.js) | one blow from rules that are data, for a game whose combat alone is the core's |

Every axis of the plan is covered in every combination its board allows: space
(discrete cells, or exact points on square and shape boards), time (turns, or
one clock), turns (sequential, or simultaneous) and fog (off, on, or on with
last-seen memory). Hex and regions boards have no plane under them, so a session
asking for continuous space on one plays in discrete space.

## The spec

Every key is optional; what a spec leaves out is the base's. `terrain` merges
with the base table, and every other key replaces the base's.

```js
{
  id, name, description,
  terrain:    { forest: { cost: { land: 2, air: 1 }, passable: { sea: false }, cover: 50,
                          blocksSight: false, concealment: 2, elevation: 0, color, name,
                          extrude } },                // drawn height on an isometric board
  attributes: { mp: { kind: 'pool', max: 20, regen: 4 }, … },
  abilities:  { fira: { … } },
  unitTypes:  { mage: { hp, attack, defense, range, speed, rate, vision, domain,
                        facing: { fov, arcs, turnCost }, attrs, pools, tags, resist,
                        abilities: ['fira'], strike: false | { …attack overrides },
                        jump, count, points, glyph, name, imagePath } },
  strike:     { …attack overrides },     // every type's attack, unless it has its own
  turn:       { actionPoints: 2, move: 1 }   // action points instead of move + rate budgets
            | { order: 'charge', charge: 100, initiative: 'spd' | { fn } },  // a unit at a time, by speed
  formulas:   { damage: 'expression' | { fn: 'name' } },
  board:      { topology, width, height, … },
  armies:     [['knight', 'mage'], …]    // per seat, along its edge
  units:      [{ type, seat, at: [x, y] | 'regionId', facing, hp, count, game }],
  victory:    [{ type: 'eliminate' }, …],
  orientation:{ fov, arcs, turnCost,     // facing for every type without its own
                ties, awareness, strikeCone },
  modes:      { space, time, play },     // where the setup form starts
  fog:        'off' | 'on' | 'remembered',
  map:        'civ1/two-rivers',         // play on a library map (its board, terrain, distances)
}
```

`{ fn: 'name' }` is the escape hatch anywhere an effect, a formula or a victory
test is expected: it calls the BattleGame's hook of that name, and the spec
stays serialisable. `checkSpec(resolveSpec(spec), hooks)` lists what is wrong
with a spec, and a session refuses to start on one that has anything.

### Units

The core numbers (`hp`/`maxHp` on the unit; attack, defense, range, speed, rate
and vision in `unit.stats`) need no declaration. A unit carries only the fields
its ruleset uses, so a spec that declares nothing plays as Arena always has.

| Kind | Declared as | On the unit | What the core does |
|---|---|---|---|
| `number` | `{ kind: 'number', default }` | `attrs[id]` | readable in formulas (`d.armor`) and modifiers |
| `pool` | `{ kind: 'pool', max, regen, start, absorbs, value }` | `pools[id] = { value, max }` | regenerates each window; abilities spend it; `absorbs` takes damage before hp |
| `tag` | `{ kind: 'tag' }` | its type's `tags` | target filters, objectives |
| `status` | `{ kind: 'status', turns, stack, max, mods, tick, blocks, tags, harmful, value }` | `statuses = [{ id, left, stacks }]` | modifiers while it lasts (`speed: '*3/2'`), effects each window, stops `move`/`act`, grants tags |

Built in: the tags `royal`, `cloaked`, `detector` and every movement class
(`land`, `sea`, `air`); the statuses `revealed` and `cloaked`. Modifiers are
exact and the result is floored, so every stat stays a whole number. A
status's `stack` is `refresh`, `extend`, `stack` (up to `max`) or `ignore`.

### Facing

A unit with facing has `facing` in degrees (0 is +x, 90 is +y: screen
coordinates, y down). A move leaves it facing the way it went, and a strike turns
it to its target. `fov` is its cone: it sees beyond arm's length (1) only inside
it, and strikes only inside it. `arcs` are its defense modifiers in percent, by
the side struck: within 60° of its facing is the front, beyond 120° the rear,
between them the flank. Turning is a `face` action: once a turn in discrete time,
`turnCost` movement points for each facing step (45° on squares and planes, 60°
on hexes); in continuous time it is a task that takes that cost's share of a
window.

### Abilities

`attack` is the default ability, and every other is declared and given to unit
types by id:

```js
fira: { cost: { mp: 12 }, cooldown: 0, range: 4, minRange: 0,
        targets: 'enemy' | 'ally' | 'self' | 'any' | 'ground',
        filter: { not: 'air' }, area: { radius: 1 }, affects: 'enemy' | 'ally' | 'all',
        los: true | false | 'missile', windup: 0.5,
        effects: [{ damage: { power: 1.1, type: 'fire' } }, { status: { id: 'blind', turns: 2 } }] }
```

Each use spends one of the unit's strikes for the window (`rate`), its cost, and
starts its cooldown. Where the ruleset counts action points instead (`turn:
{ actionPoints, move }`), a unit's turn is that many points: a move costs
`move` of them (default 1) and may go up to its `speed` each time, and a use
costs its `ap` (default 1; `'all'` spends whatever is left, so nothing follows
it).

An ability may throw dice. `hit` is a percent formula: a d100 is rolled for
each target, and the use lands where the roll is at most the chance. `crit` is a
percent formula on the same roll (it may read `hit`, the chance), and a crit
multiplies the damage by `critPower` (default 2). A target missed takes nothing
from the use — no damage, no other effect. A damage formula may throw more dice
with `roll(n)`. All of them come from the engine's seeded rng, so a replay
throws the same, and what they showed rides on the action: `hitChance`, `roll`,
`hit`, `crit` and `damage` for one target, or a `rolls` list for several. A
ruleset without either stays exactly as deterministic as before.

`targets: 'fallen'` aims at a fallen unit of the caster's side, for a revival
(its effect is usually a hook). An area is every cell within its `radius` of the
point aimed at, or with `area.shape: 'line'` the `radius` cells running straight
out from the caster (aimed at a neighbouring cell). A ground-aimed ability is
offered where the units it could hit stand, or with `aim: 'cells'` at every cell
in range whose area would hit someone the caster's side can see. An effect hook
is handed `before` as well: the battle as it was when the ability was used.

### The charge order

`turn: { order: 'charge', charge: 100, initiative }` gives each unit its own
turn, as a tactics RPG does. Every living unit gains its `initiative` (a stat or
declared number, its speed by default, or a hook) in charge until one holds
`charge`; the ready ones act most charge first (then most initiative, then id),
one activation each: a move and an act in either order, the move taken back
with `undo-move` until it acts, then `end-turn` (with a `facing`, where units
face). The activation is the unit's window: its statuses tick and run down at
its end, and its charge drops by `charge`. A side may queue a waiting unit's
next move (`queue-move`, `queue-pop`); it is made as that unit's activation
begins. `turnNumber` counts activations. The charge order is discrete time, one
side at a time.

In continuous time a use lands after its `windup` (an attack's
is `0.5 / rate` windows), when range, line and sight are checked again. Effects:
`damage` (`power`, `type` against the target's `resist`, or a fixed `amount`),
`heal`, `modify` (a pool's value, or a stat for `turns` or for good), `status`,
`cleanse`, `move` (`push`, `pull`, `teleport`), `spawn`, `transform`, `reveal`,
`conceal`, and `fn`. Filters are a tag, `{ tag }`, `{ not }`, `{ any }`, `{ all }`
or `{ type }`.

### Formulas

The damage formula is an expression over `a.*` (the attacker's stats, numbers,
pools, `hp`, `count`), `d.*` (the defender's), `power`, `cover` (the defender's
terrain, percent), `height` (attacker's elevation minus the defender's) and `arc`
(the defense modifier of the side struck) and `dist` (how far apart the two
are, in the board's measure). The base is Arena's strike:

```
max(1, floor(power * a.attack^2 / (a.attack + d.defense * (1 + (cover + 25 * max(0, -height)) / 100) * (1 + arc / 100))))
```

It is worked out in exact rationals ([exact.js](exact.js)); a written `0.1` is a
tenth. The language has `+ - * / ^`, comparisons, `&& || !`, and `floor ceil
round abs min max clamp if`, and `roll(n)`, a die from 0 to n−1 thrown from
the battle's dice (only in a formula evaluated during an action; `if` evaluates
just the branch it takes).

### Boards

| Topology | Cells | Distance | Sight |
|---|---|---|---|
| `square` | `{x, y}`; `neighbours: 8` or `4`; `wrap` joins left and right | Chebyshev, or Manhattan | the exact cells a segment crosses |
| `hex` | `{x, y}` in odd-r offset (odd rows half a hex right) | hex distance | the hex line |
| `regions` | each region a blob of layout cells; a unit stands on its `anchor` | hops on `adjacency` (or touching cells) | never blocked |
| `shapes` | a plane of convex `shapes` (rects, convex polygons) over a `ground`, `walls` and windows; discrete space plays on its unit cells | Euclidean / Chebyshev | segment against shapes and walls (windows let it through) |

A square board's terrain is `terrain: { 'x,y': id }`, or `rows` with a
`legend` (`.` open, `f` forest, `h` hill, `~` water, `#` rock by default).
Terrain is priced per movement class: `cost` and `passable` may be per class,
with missing classes reading as `land`'s. `elevation` (per cell, per region, or a
terrain's own) adds `climb` (default 1) a level to a step up, refuses a step
taller than a type's `jump`, and gives a defender above its attacker 25% cover a
level. Sight runs straight from one end's height to the other's, and ground
blocks it where it rises above the line (a sight-blocker standing a level above
its ground). `concealment` hides a unit from anyone farther than it.

A square board may also say `sightLine: 'bresenham'` (sight runs along the
Bresenham line between the two cells, blocked by a sight-blocker on it other
than its ends), `visionMetric: 'chebyshev'` or `'manhattan'` (how far a unit
sees, measured apart from how it moves), and `passFriends: false` (a unit can't
walk through its own side, as well as the enemy).

A status may be `permanent` (it never runs down; something must remove it),
`expire` effects happen when one runs out (Doom: `[{ damage: { formula: 'hp' } }]`),
and a `tick` damage may be a `formula` of the unit's numbers
(`max(1, floor(maxHp / 10))`). `orientation` may say `ties: 'horizontal'` (a
bearing exactly between two facings takes the one nearer the horizontal, as a
4-way grid game turns), `awareness` (how near a unit senses another whichever
way it faces; 1 by default) and `strikeCone: false` (the cone limits sight, not
what a unit can strike). A square board's `sightLine: 'none'` blocks no sight
at all.

`stacking`: `one` (a unit a cell), `stack` (friends share; a blow lands on the
stack's best defender, and with `stackDeath` the stack dies with it) or `count`
(a unit is a group of `count` members, merging with its own type where they
meet, striking once per member). A placement's own `count` overrides its
type's, and a library unit's member is that unit, whatever its chassis.

### Victory

`eliminate` (always true in the end); `royal` (a side whose `tag` units are all
dead is out); `hold` (alone on all of `cells` or `regions` for `windows` windows
running, optionally only `side`); `reach` (a unit of `side`, with `tag`, on one
of them); `survive` (`side` standing after `windows`); `points` (after
`windows`: a point each surviving unit, its type's `points`, plus `hold.per` a
window for each held cell); `{ fn }`. A window is a turn in discrete time and
one unit of the clock in continuous time. The verdict is worked out on the full
state and kept in `gameSpecific`, so fog never hides it.

## The generic AI

`unitAttributes` gives [the generic AI](../agents/generic/README.md) each unit's
numbers as its statuses leave them, its facing and cone, and a `worthBonus`: its
pools by how full they are (a declared `value`; else, for an absorbing pool, what
it soaks as hit points would; else only a tie-breaker) and its statuses by their
declared `value`, their ticks, or how long they stop it.
