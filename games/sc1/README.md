# StarCraft I

Turn-based adaptation of StarCraft: Brood War. Three races (Terran, Zerg, Protoss) compete across a resource map.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

Each player is randomly assigned a race at game start, or set via `config.p1Race` / `config.p2Race`.

## Races

### Terran

| Unit | Minerals | Gas | Supply | HP | ATK | DEF | Move | Range |
|---|---|---|---|---|---|---|---|---|
| `scv` | 50 | 0 | 1 | 60 | 5 | 0 | 3 | 1 |
| `marine` | 50 | 0 | 1 | 40 | 6 | 0 | 3 | 4 |
| `medic` | 50 | 25 | 1 | 60 | 0 | 0 | 3 | 0 |
| `firebat` | 75 | 25 | 1 | 50 | 16 | 1 | 3 | 2 |
| `ghost` | 25 | 75 | 1 | 45 | 10 | 0 | 3 | 7 |
| `vulture` | 75 | 0 | 2 | 80 | 20 | 0 | 5 | 5 |
| `siege-tank` | 150 | 100 | 2 | 150 | 15 | 1 | 2 | 7 |
| `goliath` | 100 | 50 | 2 | 125 | 12 | 1 | 3 | 5 |
| `wraith` | 150 | 100 | 2 | 120 | 8 | 0 | 5 | 5 |
| `battlecruiser` | 400 | 300 | 6 | 500 | 25 | 3 | 3 | 6 |

### Zerg

| Unit | Minerals | Gas | Supply | HP | ATK | DEF | Move | Range |
|---|---|---|---|---|---|---|---|---|
| `drone` | 50 | 0 | 1 | 40 | 5 | 0 | 3 | 1 |
| `zergling` | 25 | 0 | 0.5 | 35 | 5 | 0 | 4 | 1 |
| `hydralisk` | 75 | 25 | 1 | 80 | 10 | 0 | 3 | 4 |
| `lurker` | 125 | 125 | 2 | 125 | 20 | 2 | 3 | 6 |
| `mutalisk` | 100 | 100 | 2 | 120 | 9 | 0 | 5 | 3 |
| `guardian` | 150 | 200 | 2 | 150 | 20 | 2 | 2 | 8 |
| `ultralisk` | 200 | 200 | 4 | 400 | 20 | 3 | 4 | 1 |

### Protoss

| Unit | Minerals | Gas | Supply | HP | Shields | ATK | DEF | Move | Range |
|---|---|---|---|---|---|---|---|---|---|
| `probe` | 50 | 0 | 1 | 20 | 20 | 5 | 0 | 3 | 1 |
| `zealot` | 100 | 0 | 2 | 100 | 60 | 16 | 1 | 3 | 1 |
| `dragoon` | 125 | 50 | 2 | 100 | 80 | 20 | 2 | 3 | 4 |
| `dark-templar` | 125 | 100 | 2 | 80 | 40 | 40 | 1 | 3 | 1 |
| `archon` | 0 | 0 | 4 | 10 | 350 | 30 | 0 | 3 | 2 |
| `carrier` | 350 | 250 | 6 | 300 | 150 | 6 | 3 | 6 | 8 |

## Buildings

Each race has worker units (SCV / Drone / Probe) that construct structures, and a main building that must survive.

### Terran

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `command-center` | 400/0 | +20 | `scv` | — |
| `supply-depot` | 100/0 | +8 | — | — |
| `refinery` | 100/0 | — | — | on vespene |
| `barracks` | 150/0 | — | `marine`, `firebat`, `ghost` | — |
| `factory` | 200/100 | — | `vulture`, `siege-tank`, `goliath` | `barracks` |
| `starport` | 150/100 | — | `wraith`, `battlecruiser` | `factory` |
| `engineering-bay` | 125/0 | — | — | — |
| `bunker` | 100/0 | — | — (garrison) | `barracks` |
| `missile-turret` | 75/0 | — | — (detector, anti-air) | `engineering-bay` |

### Zerg

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `hatchery` | 300/0 | +10 | `drone`, `zergling`, `hydralisk`, `overlord` | — |
| `lair` | 150/100 | +2 | + `mutalisk`, `scourge`, `lurker` | `hatchery` + `spawning-pool` |
| `hive` | 200/150 | +2 | + `ultralisk`, `queen`, `defiler` | `lair` |
| `extractor` | 50/0 | — | — | on vespene |
| `spawning-pool` | 200/0 | — | — | — |
| `hydralisk-den` | 100/50 | — | — | `spawning-pool` |
| `spire` | 200/150 | — | — | `lair` |
| `sunken-colony` | 75/0 | — | — (ATK 40, range 7, anti-ground) | `spawning-pool` |
| `spore-colony` | 75/0 | — | — (ATK 15, range 7, detector) | `spawning-pool` |
| `ultralisk-cavern` | 150/200 | — | — | `hive` |

### Protoss

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `nexus` | 400/0 | +9 | `probe` | — |
| `pylon` | 100/0 | +8 | — | — |
| `assimilator` | 100/0 | — | — | on vespene |
| `gateway` | 150/0 | — | `zealot`, `dragoon` | — |
| `cybernetics-core` | 200/0 | — | — | `gateway` |
| `forge` | 150/0 | — | — | — |
| `photon-cannon` | 150/0 | — | — (ATK 20, range 7, detector) | `forge` |
| `templar-archives` | 150/200 | — | — | `cybernetics-core` |
| `stargate` | 150/150 | — | `scout`, `carrier`, `corsair`, `arbiter` | `cybernetics-core` |
| `robotics-facility` | 200/200 | — | — | `cybernetics-core` |

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit within movement range |
| `attack` | Attack `targetId` within range |
| `gather` | Worker gathers minerals or gas from adjacent resource |
| `build` | Worker begins constructing a building at `{x, y}` |
| `train` | Building trains a unit (`unitType`) |
| `skip-unit` | Skip this unit |
| `end-turn` | End player's turn |

## Special mechanics

- **Resources** — minerals and gas gathered by worker units; spent to train units and build structures
- **Supply** — each unit costs supply; cap set by supply buildings (Supply Depot / Overlord / Pylon)
- **Tech requirements** — buildings must be constructed before dependent units can be trained
- **Protoss shields** — absorb damage before HP; regenerate 1 per turn
- **Siege mode** (`siege-tank`) — toggle siege mode: ATK becomes 70, range becomes 8, unit becomes immobile
- **Armor** — each unit has an armor value that reduces incoming damage (minimum 1 HP damage per hit)
- **High-ground advantage** — ranged units on low ground attacking a unit on `elevated` terrain have a 30% miss chance
- **Fog of war** — vision radius 3

## Terrain

| Type | Symbol | Ground passable | Air passable | Def bonus | Notes |
|---|---|---|---|---|---|
| `open` | `.` | Yes | Yes | 0% | Standard ground |
| `elevated` | `'` | Yes | Yes | +25% | High ground; ranged attackers from low ground have 30% miss |
| `ramp` | `/` | Yes | Yes | 0% | Connects open and elevated; not buildable |
| `minerals` | `*` | No | Yes | — | Resource node |
| `vespene` | `%` | No | Yes | — | Gas geyser; build extractor/refinery/assimilator here |
| `obstacle` | `#` | No | No | — | Impassable cliff / terrain |

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `base-destroyed` — opponent's main building destroyed and no units remain |
| Draw | `max-turns` |

## Run

```sh
npm run demo:sc1   # (no interactive demo; use api-server or write a script)
```
