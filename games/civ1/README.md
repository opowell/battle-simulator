# Civilization I

Turn-based 4X strategy on a tile map. Build cities, produce units, and conquer your opponent.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Units

All units have `firepower: 1` (damage per combat hit). Combat continues round-by-round until one side reaches 0 HP.

### Terrain Improvement & Diplomacy

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `settlers` | 0 | 1 | 1 | 20 | 40 | `found-city`, `build-road`, `irrigate`, `mine` |
| `diplomat` | 0 | 0 | 2 | 10 | 30 | `diplomacy`, `bribe`, `sabotage` |

### Ancient Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `militia` | 1 | 1 | 1 | 10 | 10 | |
| `phalanx` | 1 | 2 | 1 | 10 | 20 | |
| `archers` | 3 | 2 | 1 | 10 | 30 | |
| `legion` | 3 | 3 | 1 | 10 | 30 | |
| `catapult` | 6 | 1 | 1 | 10 | 60 | `bombard` |
| `cavalry` | 2 | 1 | 2 | 10 | 20 | `mounted` |
| `chariot` | 4 | 1 | 2 | 10 | 40 | `mounted` |

### Medieval Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `knights` | 5 | 2 | 2 | 10 | 40 | `mounted` |
| `crusaders` | 5 | 1 | 2 | 10 | 40 | `mounted` |

### Renaissance & Industrial Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `musketeers` | 2 | 3 | 1 | 20 | 30 | |
| `cannon` | 8 | 5 | 1 | 20 | 40 | `bombard` |
| `riflemen` | 3 | 5 | 1 | 20 | 30 | |
| `cav-modern` | 8 | 3 | 2 | 20 | 60 | `mounted` |
| `artillery` | 12 | 2 | 2 | 20 | 60 | `bombard` |

### Modern Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `infantry` | 5 | 6 | 1 | 20 | 30 | |
| `armor` | 10 | 5 | 3 | 30 | 80 | |
| `mech-inf` | 6 | 6 | 3 | 30 | 50 | |
| `paratroopers` | 6 | 4 | 1 | 20 | 60 | `paradrop` |
| `marines` | 8 | 5 | 1 | 20 | 60 | `amphibious` |

### Air

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `fighter` | 4 | 2 | 10 | 20 | 60 | `intercept` |
| `bomber` | 12 | 1 | 8 | 20 | 120 | `strategic-bomb` |
| `helicopter` | 6 | 3 | 6 | 20 | 60 | `hover` |

### Sea

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `trireme` | 1 | 1 | 3 | 10 | 40 | `coastal-only`, `transport-2` |
| `sail` | 1 | 1 | 3 | 10 | 40 | `transport-3` |
| `frigate` | 2 | 2 | 3 | 10 | 40 | `bombard` |
| `ironclad` | 4 | 4 | 4 | 20 | 60 | |
| `destroyer` | 4 | 4 | 6 | 20 | 60 | |
| `submarine` | 8 | 2 | 3 | 20 | 50 | `stealth` |
| `transport` | 0 | 3 | 4 | 20 | 50 | `transport-8` |
| `cruiser` | 6 | 6 | 6 | 20 | 80 | `bombard` |
| `battleship` | 18 | 17 | 4 | 40 | 160 | `bombard` |
| `carrier` | 1 | 12 | 5 | 40 | 160 | `carries-air-8` |

## Terrain

| Type | Move cost | Defense bonus |
|---|---|---|
| `grassland` | 1 | 0% |
| `plains` | 1 | 0% |
| `desert` | 2 | 0% |
| `tundra` | 2 | 0% |
| `hills` | 2 | +50% |
| `mountains` | 3 | +100% |
| `forest` | 2 | +50% |
| `jungle` | 3 | +50% |
| `swamp` | 3 | 0% |
| `ocean` | 1 (sea only) | 0% |

Roads halve movement cost on the tile.

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit up to its movement range |
| `attack` | Attack adjacent enemy unit; combat is probabilistic |
| `found-city` | Settler founds a city at current position |
| `build-road` | Settler builds a road on current tile |
| `skip-unit` | Pass for this unit |
| `end-turn` | End the player's turn; all units reset |

## Special mechanics

- **Cities** — produce shields each turn; when accumulated shields reach a unit's cost, the unit spawns at the city
- **Combat** — round-by-round; attacker wins each round with `P = ATK / (ATK + DEF × terrainBonus)`; loser takes 1 HP damage per round (firepower=1 for all Civ1 units); fight ends when either side reaches 0 HP
- **City defense** — units defending a city tile gain +50% DEF
- **Veteran status** — units that win combat may gain veteran status, granting +50% ATK and DEF
- **Fog of war** — vision radius 2; `getVisibleState` hides unseen tiles and enemy units

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `conquest` — all opponent cities and units destroyed |
| Draw | `max-turns` |

## Run

```sh
npm run demo:civ1           # interactive
npm run demo:civ1:auto      # random vs random
npm run demo:civ1:greedy    # greedy AI vs random
```
