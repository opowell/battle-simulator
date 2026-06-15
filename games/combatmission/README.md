# Combat Mission
Clone of Combat Mission: Beyond Overload.

Squad-level WWII infantry and armor combat on a 20×16 grid with line-of-sight and suppression.

## Players

| ID | Name |
|---|---|
| `p1` | Allies |
| `p2` | Axis |

## Units

Each unit has 2 AP per turn. Moving costs 1 AP; attacking costs 1 AP.

| Type | Side | HP | ATK | Armor | Move | Range | Notes |
|---|---|---|---|---|---|---|---|
| `rifle-squad` | Allies | 10 | 5 | 0 | 2 | 5 | Standard infantry |
| `mg-team` | Allies | 5 | 8 | 0 | 1 | 7 | High damage, long range |
| `sniper` | Allies | 3 | 12 | 0 | 1 | 12 | Very long range, fragile |
| `bazooka-team` | Allies | 4 | 20 | 0 | 1 | 3 | Anti-tank; short range |
| `mortar-team` | Allies | 5 | 8 | 0 | 1 | 10 | Indirect fire |
| `sherman` | Allies | 20 | 12 | 4 | 3 | 7 | Medium armor |
| `stuart` | Allies | 12 | 7 | 2 | 4 | 5 | Light fast tank |
| `volks-squad` | Axis | 10 | 5 | 0 | 2 | 5 | |
| `mg42-team` | Axis | 5 | 9 | 0 | 1 | 8 | |
| `german-sniper` | Axis | 3 | 13 | 0 | 1 | 13 | Slightly longer range than Allied sniper |
| `panzerschreck` | Axis | 4 | 22 | 0 | 1 | 3 | Anti-tank; short range |
| `mortar-ger` | Axis | 5 | 9 | 0 | 1 | 10 | |
| `panzer-iv` | Axis | 18 | 11 | 3 | 3 | 7 | Medium tank |
| `tiger` | Axis | 25 | 15 | 7 | 2 | 8 | Heavy armor |

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit to target `{x, y}`; blocked by walls and other units |
| `fire` | Fire at `targetId`; requires LOS |
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

- **Action Points (AP)** — each unit has 2 AP per turn; `move` costs 1 AP, `fire` costs 1 AP
- **Line of sight** — Bresenham ray cast; blocked by walls (`#`) and trees (`T`); hedges (`w`) do not block LOS
- **Terrain cover** — hedge: −30% hit chance; trees: −20% hit chance; open ground: 0%
- **Hit chance** — base 65%, −5% per tile of range beyond 1, −cover%, −5% per suppression stack on shooter; clamped to [10%, 90%]
- **Damage** — `round(attack × variance) − armor`, minimum 1; variance is uniform [0.8, 1.2]
- **Suppression** — any fire suppresses the target: a hit adds 2 stacks, a miss adds 1; each stack reduces shooter accuracy by 5%; recovers 1 stack per turn
- **Armor** — armor value reduces raw damage by a flat amount; cannot reduce damage below 1
- **Fog of war** — each player sees only units within 5 tiles (Chebyshev) of one of their own units, and only if LOS exists to that enemy

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
