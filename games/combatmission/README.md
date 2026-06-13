# Combat Mission

Squad-level WWII infantry and armor combat on a 20×16 grid with line-of-sight and suppression.

## Players

| ID | Name |
|---|---|
| `p1` | Allies |
| `p2` | Axis |

## Units

Each unit has 2 AP per turn. Moving costs 1 AP; attacking costs 1 AP.

| ID | Type | Side | HP | ATK | Move | Range | Notes |
|---|---|---|---|---|---|---|---|
| `allies-rifle-1/2` | `rifle-squad` | Allies | 10 | 5 | 2 | 5 | Standard infantry |
| `allies-mg-1` | `mg-team` | Allies | 5 | 8 | 1 | 7 | High damage, long range |
| `allies-tank-1` | `sherman` | Allies | 20 | 12 | 3 | 7 | Armored |
| `axis-rifle-1/2` | `volks-squad` | Axis | 10 | 5 | 2 | 5 | |
| `axis-mg-1` | `mg42-team` | Axis | 5 | 9 | 1 | 8 | |
| `axis-tank-1` | `tiger` | Axis | 25 | 15 | 2 | 8 | Heavy armor |

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit to target `{x, y}`; blocked by walls and other units |
| `attack` | Fire at `targetId`; requires LOS |
| `skip-unit` | Pass for this unit this turn |
| `end-turn` | End player's turn |

## Terrain

| Symbol | Type | Passable | Blocks LOS | Cover (hit-chance reduction) |
|---|---|---|---|---|
| `.` | Floor | Yes | No | 0% |
| `r` | Road | Yes | No | 0% |
| `w` | Hedge | Yes | No | −30% |
| `T` | Trees | Yes | Yes | −20% |
| `#` | Wall / building | No | Yes | — |

## Map layout

Fixed 20×16 map:
- **Village** (Allied side): wall cluster x=3–6, y=3–5
- **Farmhouse** (Axis side): wall cluster x=13–16, y=10–12
- **Allied treeline**: scattered trees around x=8–11, y=2–3
- **Axis treeline**: scattered trees around x=8–11, y=12–13
- **Hedgerows**: scattered around edges and mid-field (not on road row)
- **Road**: horizontal at y=7 (x=1–18)

## Special mechanics

- **Action Points (AP)** — each unit has 2 AP per turn; `move` costs 1 AP, `attack` costs 1 AP
- **Line of sight** — Bresenham ray cast; blocked by walls (`#`) and trees (`T`); hedges (`w`) do not block LOS
- **Terrain cover** — hedge: −30% hit chance; trees: −20% hit chance; open ground: 0%
- **Hit chance** — base 65%, −3% per tile of range, −cover%, −15% per suppression stack
- **Suppression** — units that take fire accumulate suppression (max 2 stacks); each stack reduces accuracy by 15%; recovers 1 per turn
- **Armor** — armor value reduces raw damage by a flat amount; cannot reduce damage below 1

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `elimination` — all enemy units reach 0 HP |
| Draw | `max-turns` |

## Run

```sh
npm run demo:combatmission        # interactive
npm run demo:combatmission:auto   # random vs random
```
