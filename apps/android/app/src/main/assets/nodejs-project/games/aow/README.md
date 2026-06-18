# Age of Wonders
Clone of Ancient Art of War  (1984).
Ancient armies battle on a procedurally generated 22×12 map. Capture the opponent's camp to win.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Units

Each side fields up to 7 units placed around the camp (some may be omitted if terrain is impassable):

| Type | Count | HP | ATK | DEF | Move | Range | Notes |
|---|---|---|---|---|---|---|---|
| `warrior` | 3 | 10 | 3 | 3 | 3 | 1 | Melee; advances into killed enemy's tile |
| `archer` | 2 | 10 | 5 | 2 | 2 | 2 | Ranged |
| `cavalry` | 2 | 10 | 4 | 2 | 5 | 1 | Fast melee; also advances on kill |

## Terrain

| Type | Passable | Defense bonus |
|---|---|---|
| `plains` | Yes | 0% |
| `forest` | Yes | +50% |
| `hills` | Yes | +75% |
| `mountains` | No | — |

## Actions

| Type | Notes |
|---|---|
| `move` | Move to `{x, y}` within movement range |
| `attack` | Attack `targetId` within range; requires Chebyshev distance ≤ `range` |
| `skip-unit` | Skip this unit's activation |
| `end-turn` | End player's turn |

## Special mechanics

- **Melee advance** — range-1 units that kill an enemy automatically step into the vacated tile
- **Terrain defense** — `defenderStrength = DEF × (1 + terrainDefBonus)`
- **Camp defense** — defending a camp tile doubles the defender's DEF (`DEF × 2`)
- **Combat probability** — `P(attacker wins round) = ATK / (ATK + defenderStrength)`; loser takes 1 HP per round until one side reaches 0 HP
- **Camp capture** — each side has a camp tile; occupying the enemy camp wins the game
- **Fog of war** — vision radius 2 (Chebyshev); enemies outside vision are hidden
- **Movement** — Dijkstra pathfinding, 8-directional; terrain move cost applied; cannot pass through or stack with other units
- **Map generation** — multi-scale value noise; border tiles are always mountains; camp surroundings (Chebyshev radius 3) are guaranteed plains

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `camp-captured` — a unit occupies the opponent's camp tile |
| Win | `army-destroyed` — all enemy units destroyed |
| Draw | `max-turns` |

## Run

```sh
npm run demo:aow           # interactive
npm run demo:aow:auto      # random vs random
npm run demo:aow:greedy    # greedy AI vs random
```
