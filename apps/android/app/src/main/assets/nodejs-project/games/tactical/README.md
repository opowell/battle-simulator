# Tactical

Grid-based tactical RPG combat on an 8×8 map.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Units

Each side fields 3 units — 1 of each class:

| Type | HP | ATK | DEF | Range | Move |
|---|---|---|---|---|---|
| `warrior` | 30 | 8 | 4 | 1 | 2 |
| `archer` | 20 | 10 | 2 | 3 | 2 |
| `mage` | 15 | 15 | 1 | 2 | 2 |

## Actions

| Type | Fields | Notes |
|---|---|---|
| `move` | `unitId`, `from`, `to` | Up to `move` tiles (Chebyshev distance) |
| `attack` | `unitId`, `targetId` | Must be within `range` tiles; unit must not have already attacked |
| `end-turn` | — | End the active player's turn |

A unit may move and attack in the same turn, in either order, but each only once.

## Special mechanics

- **Terrain** — `water` tiles are impassable; `forest` tiles are passable (no combat effect)
- **Movement** — 8-directional BFS; units cannot pass through or stack with other units
- **Fog of war** — each unit has vision radius 2 (Chebyshev); `getVisibleState` filters unseen enemies
- **Damage variance** — final damage is multiplied by a random factor in `[0.8, 1.2]`
- **Combat formula** — `damage = max(1, attacker.atk − defender.def) × variance`

## Map

Default 8×8 grid. Terrain is set via `config.terrain` (a map of `"x,y"` → `"water"|"forest"`); the default scenario has an empty board. Width/height are also configurable.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `elimination` — all enemy units reduced to 0 HP |
| Draw | `max-turns` / `step-limit` |

## Run

```sh
npm run demo:tactical        # interactive
npm run demo:tactical:auto   # random vs random
```
