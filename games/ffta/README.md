# Final Fantasy Tactics Advance

Clone of Final Fantasy Tactics: Advance. RPG with a job system, MP-limited abilities, status effects, and a speed-based turn queue.

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

## Starting lineup

| Player | Units |
|---|---|
| P1 (top-left) | soldier, whiteMage, archer, thief |
| P2 (bottom-right) | fighter, blackMage, archer, soldier |

## Actions

| Type | Notes |
|---|---|
| `move` | Move to `{x, y}` within `moveRange`; pathfinding cost includes +1 per height level gained; cannot end on occupied tile |
| `ability` | Use `abilityName` on `targetId`; target must be within ability's Manhattan range; costs MP if applicable |
| `end-turn` | End this unit's activation |

A unit may move and use an ability in the same turn (in either order, each once).

## Abilities

Ability range uses **Manhattan distance**.

**Damage formula** — `max(1, floor(STAT × power × heightMult − RESIST × 0.5))`, then ×rand(0.85–1.15). Physical uses ATK/DEF; magic uses MAG/RES. Height multiplier: `1 + 0.2 × (attackerHeight − targetHeight)` (minimum 1).

**Heal formula** — `floor(MAG × power)`, then ×rand(0.90–1.10).

| Ability | Job | Type | Range | MP | Effect |
|---|---|---|---|---|---|
| `attack` | all | physical | 1 | 0 | `ATK × 1.0` damage |
| `shieldbearer` | soldier | support | self | 0 | Apply `protect` status to self |
| `rend-armor` | soldier | physical | 1 | 0 | `ATK × 0.7` damage + apply `armor-break` |
| `cure` | whiteMage | magic | 2 | 6 | Restore `MAG × 1.2` HP to ally |
| `protect` | whiteMage | magic | 2 | 8 | Apply `protect` status to ally |
| `fire` | blackMage | magic | 3 | 8 | `MAG × 1.3` damage |
| `thunder` | blackMage | magic | 3 | 8 | `MAG × 1.3` damage |
| `blizzard` | blackMage | magic | 3 | 8 | `MAG × 1.3` damage |
| `aim` | archer | physical | 4 | 0 | `ATK × 0.9` damage (ranged) |
| `blind` | archer | magic | 3 | 6 | Apply `blind` status to enemy |
| `steal` | thief | physical | 1 | 0 | Steal up to 8 MP from target |
| `mug` | thief | physical | 1 | 0 | `ATK × 0.8` damage + steal up to 8 MP |
| `powerbreak` | fighter | physical | 1 | 0 | `ATK × 0.6` damage + apply `atk-break` |
| `shatter` | fighter | physical | 1 | 0 | `ATK × 1.5` damage |

## Special mechanics

- **Turn queue** — at the start of each round, units are sorted by SPD (highest first) and activate in that order. When the queue empties a new round begins and the queue is rebuilt.
- **Height bonus** — +20% damage per tile of elevation above target (terrain height: grass=0 `.`, elevated=1 `1`, high=2 `2`)
- **Uphill movement cost** — moving to a higher tile costs +1 extra movement per height level gained
- **Status effects** — `protect` (+25% DEF), `atk-break` (ATK ×0.75), `armor-break` (DEF ×0.75), `blind` (ATK ×0.70)
- **Fog of war** — vision radius 2 (Chebyshev/square distance)

## Map

Fixed 12×10 grid. `#` = wall, `.` = grass (height 0), `1` = elevated (height 1), `2` = high ground (height 2). P1 deploys top-left, P2 deploys bottom-right.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `elimination` — all enemy units at 0 HP |
| Draw | `max-turns` |

## Not implemented (vs original FFTA)

| Feature | Notes |
|---|---|
| **Law system** | FFTA's signature mechanic — a Judge enforces per-battle laws (no bladed weapons, no fire magic, etc.); violations give yellow/red cards and can eject units |
| **CT turn queue** | The original uses a Charge Time system where every unit's CT ticks up by Speed each step and acts at CT=100; this implementation speed-sorts at round start instead |
| **Equipment** | Abilities are learned from equipped weapons/armor in the original; no equipment system here |
| **AoE abilities** | Many spells hit multiple tiles (cross, diamond, line patterns); everything here targets a single unit |
| **Elemental weaknesses** | Fire/Ice/Thunder should interact with per-unit elemental resistances; all three Black Mage spells are identical here |
| **KO vs death** | Units go KO in the original and can be revived (Raise, Phoenix Down); `alive: false` is permanent here |
| **Items** | No Potions, Ethers, or Phoenix Down — no item actions at all |
| **Statuses: Slow/Haste/Stop/Doom/Poison/Sleep** | Only a small subset of FFTA's status effects is implemented |
| **Knockback** | Some abilities push units into adjacent tiles; not implemented |

## Run

```sh
npm run demo:ffta           # interactive
npm run demo:ffta:auto      # random vs random
npm run demo:ffta:greedy    # greedy AI vs random
```
