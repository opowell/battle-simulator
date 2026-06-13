# Final Fantasy Tactics Advance

Tactical RPG with a job system, MP-limited abilities, status effects, and a speed-based turn queue.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Jobs & units

Each side starts with 4 units in a mix of jobs. Available jobs (FP = firepower/`mag`, RES = magic resistance, SPD governs turn order):

| Job | Race | HP | MP | ATK | DEF | MAG | RES | SPD | Move | Abilities |
|---|---|---|---|---|---|---|---|---|---|---|
| `soldier` | human | 28 | 10 | 10 | 8 | 4 | 4 | 7 | 3 | `attack`, `shieldbearer`, `rend-armor` |
| `whiteMage` | human | 20 | 30 | 5 | 5 | 9 | 10 | 6 | 3 | `attack`, `cure`, `protect` |
| `blackMage` | nu-mou | 16 | 40 | 4 | 4 | 12 | 8 | 5 | 3 | `attack`, `fire`, `thunder`, `blizzard` |
| `archer` | viera | 22 | 12 | 9 | 5 | 6 | 6 | 9 | 4 | `attack`, `aim`, `blind` |
| `thief` | human | 20 | 16 | 8 | 5 | 5 | 5 | 11 | 4 | `attack`, `steal`, `mug` |
| `fighter` | bangaa | 32 | 8 | 13 | 9 | 3 | 3 | 6 | 3 | `attack`, `powerbreak`, `shatter` |

## Actions

| Type | Notes |
|---|---|
| `move` | Move to `{x, y}` within `moveRange`; pathfinding cost includes +1 per height level gained; cannot end on occupied tile |
| `ability` | Use `abilityName` on `targetId`; target must be within ability's Manhattan range; costs MP if applicable |
| `end-turn` | End this unit's activation |

A unit may move and use an ability in the same turn (in either order, each once).

## Abilities

Ability range uses **Manhattan distance**. Physical damage = `ATK × power − DEF`; magic damage = `MAG × power`.

| Ability | Job | Type | Range | MP | Effect |
|---|---|---|---|---|---|
| `attack` | all | physical | 1 | 0 | `ATK × 1.0 − DEF` damage |
| `shieldbearer` | soldier | support | 0 (self) | 0 | Apply `protect` status to self |
| `rend-armor` | soldier | physical | 1 | 0 | `ATK × 0.7 − DEF` damage + apply `armor-break` status |
| `cure` | whiteMage | magic | 2 | 6 | Restore `MAG × 1.2` HP to ally |
| `protect` | whiteMage | magic | 2 | 8 | Apply `protect` status to ally |
| `fire` | blackMage | magic | 3 | 8 | `MAG × 1.3` magic damage |
| `thunder` | blackMage | magic | 3 | 8 | `MAG × 1.3` magic damage |
| `blizzard` | blackMage | magic | 3 | 8 | `MAG × 1.3` magic damage |
| `aim` | archer | physical | 4 | 0 | `ATK × 0.9 − DEF` damage (ranged) |
| `blind` | archer | magic | 3 | 6 | Apply `blind` status to enemy |
| `steal` | thief | physical | 1 | 0 | Steal MP from target |
| `mug` | thief | physical | 1 | 0 | `ATK × 0.8 − DEF` damage + steal MP |
| `powerbreak` | fighter | physical | 1 | 0 | `ATK × 0.6 − DEF` damage + apply `atk-break` status |
| `shatter` | fighter | physical | 1 | 0 | `ATK × 1.5 − DEF` damage |

## Special mechanics

- **Turn queue** — units activate in ascending order of a `ct` counter; each step the unit with the lowest `ct` acts, then its `ct` resets to `speed`
- **Height bonus** — +20% ATK per tile of elevation above target (terrain height: grass=0 `.`, elevated=1 `1`, high=2 `2`)
- **Uphill movement cost** — moving to a higher tile costs +1 extra movement per height level gained
- **Status effects** — `protect` (+50% DEF), `atk-break` (reduced ATK), `armor-break` (reduced DEF), `blind` (reduced accuracy), `stunned` (skips next turn)
- **Fog of war** — vision radius 2

## Map

Fixed 12×10 grid. `#` = wall, `.` = grass (height 0), `1` = elevated (height 1), `2` = high ground (height 2). P1 deploys top-left, P2 deploys bottom-right.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `elimination` — all enemy units at 0 HP |
| Draw | `max-turns` |

## Run

```sh
npm run demo:ffta           # interactive
npm run demo:ffta:auto      # random vs random
npm run demo:ffta:greedy    # greedy AI vs random
```
