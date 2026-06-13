# StarCraft II

Turn-based adaptation of StarCraft II. Three races (Terran, Zerg, Protoss) with unit abilities, tech trees, and resource management.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

Each player is randomly assigned a race at game start, or set via `config.p1Race` / `config.p2Race`.

## Races

### Terran

| Unit | Minerals | Gas | Supply | HP | ATK | DEF | Move | Range | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `scv` | 50 | 0 | 1 | 60 | 5 | 0 | 3 | 1 | Worker |
| `marine` | 50 | 0 | 1 | 45 | 6 | 0 | 3 | 4 | Stim available |
| `marauder` | 100 | 25 | 2 | 125 | 10 | 1 | 3 | 4 | Bonus vs armored |
| `reaper` | 50 | 50 | 1 | 60 | 4 | 0 | 5 | 4 | Regen 5 HP/turn |
| `ghost` | 150 | 150 | 2 | 100 | 10 | 0 | 3 | 6 | Cloak, EMP |
| `hellion` | 100 | 0 | 2 | 90 | 8 | 0 | 5 | 5 | Bonus vs light |
| `tank` | 150 | 125 | 3 | 175 | 15 | 1 | 3 | 7 | Siege mode |
| `thor` | 300 | 200 | 6 | 400 | 30 | 2 | 2 | 7 | |
| `viking` | 150 | 75 | 2 | 125 | 12 | 0 | 5 | 6 | Air unit |
| `medivac` | 100 | 100 | 2 | 150 | 0 | 1 | 4 | 0 | Heals adjacent bio |
| `banshee` | 150 | 100 | 3 | 140 | 12 | 0 | 4 | 5 | Cloak |
| `battlecruiser` | 400 | 300 | 6 | 550 | 25 | 3 | 3 | 6 | Yamato cannon |

### Zerg

| Unit | Minerals | Gas | Supply | HP | ATK | DEF | Move | Range | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `drone` | 50 | 0 | 1 | 40 | 5 | 0 | 3 | 1 | Worker |
| `zergling` | 25 | 0 | 0.5 | 35 | 5 | 0 | 4 | 1 | |
| `baneling` | 25 | 25 | 0.5 | 30 | 20 | 0 | 3 | 1 | Splash on death |
| `roach` | 75 | 25 | 2 | 145 | 8 | 1 | 3 | 3 | Regen 3 HP/turn |
| `hydralisk` | 100 | 50 | 2 | 90 | 12 | 0 | 3 | 5 | |
| `lurker` | 150 | 150 | 3 | 200 | 20 | 2 | 3 | 6 | Burrow to activate |
| `infestor` | 100 | 150 | 2 | 90 | 0 | 0 | 3 | 0 | Fungal Growth |
| `swarm-host` | 200 | 100 | 3 | 160 | 0 | 1 | 2 | 0 | Spawns locusts |
| `mutalisk` | 100 | 100 | 2 | 120 | 9 | 0 | 5 | 3 | |
| `corruptor` | 150 | 100 | 2 | 200 | 14 | 2 | 4 | 6 | Bonus vs massive |
| `brood-lord` | 150 | 150 | 4 | 225 | 20 | 1 | 2 | 9 | Spawns broodlings |
| `ultralisk` | 300 | 200 | 6 | 500 | 35 | 5 | 4 | 1 | |

### Protoss

| Unit | Minerals | Gas | Supply | HP | Shields | ATK | DEF | Move | Range | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `probe` | 50 | 0 | 1 | 20 | 20 | 5 | 0 | 3 | 1 | Worker |
| `zealot` | 100 | 0 | 2 | 100 | 50 | 8 | 1 | 3 | 1 | Charge ability |
| `stalker` | 125 | 50 | 2 | 80 | 80 | 13 | 1 | 4 | 6 | Blink teleport |
| `sentry` | 50 | 100 | 2 | 40 | 40 | 6 | 1 | 3 | 5 | Force Field |
| `high-templar` | 50 | 150 | 2 | 40 | 40 | 4 | 0 | 3 | 6 | Psi Storm |
| `dark-templar` | 125 | 125 | 2 | 40 | 80 | 45 | 1 | 3 | 1 | Permanent cloak |
| `immortal` | 250 | 100 | 4 | 200 | 100 | 20 | 3 | 3 | 6 | Hardened shield |
| `colossus` | 300 | 200 | 6 | 200 | 150 | 20 | 2 | 3 | 7 | Splash damage |
| `phoenix` | 150 | 100 | 2 | 120 | 60 | 5 | 0 | 5 | 5 | Overload AoE |
| `void-ray` | 250 | 150 | 4 | 150 | 100 | 6 | 2 | 4 | 6 | Prismatic alignment |
| `carrier` | 350 | 250 | 6 | 300 | 150 | 5 | 0 | 3 | 8 | Launches interceptors |

## Buildings

Workers construct race-specific buildings that unlock units and provide supply.

### Terran

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `command-center` | 400/0 | +10 | `scv` | — |
| `supply-depot` | 100/0 | +8 | — | — |
| `refinery` | 75/0 | — | — | on vespene |
| `barracks` | 150/0 | — | `marine`, `marauder`, `reaper`, `ghost` | — |
| `factory` | 150/100 | — | `hellion`, `siege-tank`, `thor` | `barracks` |
| `starport` | 150/100 | — | `medivac`, `viking`, `banshee`, `battlecruiser` | `factory` |
| `engineering-bay` | 125/0 | — | — | — |
| `armory` | 150/100 | — | — | `factory` |
| `ghost-academy` | 150/50 | — | — | `barracks` |
| `fusion-core` | 150/150 | — | — | `starport` |
| `bunker` | 100/0 | — | — (garrison) | `barracks` |
| `missile-turret` | 100/0 | — | — (detector, anti-air) | `engineering-bay` |

### Zerg

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `hatchery` | 300/0 | +6 | `drone`, `zergling`, `roach`, `hydralisk`, `overlord` | — |
| `lair` | 150/100 | +2 | + `mutalisk`, `corruptor`, `lurker` | `hatchery` |
| `hive` | 200/150 | +2 | + `brood-lord`, `ultralisk` | `lair` |
| `extractor` | 25/0 | — | — | on vespene |
| `spawning-pool` | 200/0 | — | — | — |
| `roach-warren` | 150/0 | — | — | `spawning-pool` |
| `hydralisk-den` | 100/100 | — | — | `lair` |
| `spire` | 200/200 | — | — | `lair` |
| `infestation-pit` | 100/100 | — | — | `lair` |
| `ultralisk-cavern` | 150/200 | — | — | `hive` |
| `spine-crawler` | 100/0 | — | — (ATK 25, range 7, anti-ground) | `spawning-pool` |
| `spore-crawler` | 75/0 | — | — (ATK 15, range 7, detector) | `spawning-pool` |

### Protoss

| Building | Cost (M/G) | Supply | Produces | Requires |
|---|---|---|---|---|
| `nexus` | 400/0 | +9 | `probe` | — |
| `pylon` | 100/0 | +8 | — | — |
| `assimilator` | 75/0 | — | — | on vespene |
| `gateway` | 150/0 | — | `zealot`, `stalker`, `sentry` | — |
| `cybernetics-core` | 150/0 | — | — | `gateway` |
| `twilight-council` | 150/100 | — | — | `cybernetics-core` |
| `templar-archives` | 150/200 | — | — | `twilight-council` |
| `dark-shrine` | 100/250 | — | — | `twilight-council` |
| `robotics-facility` | 200/100 | — | `immortal`, `colossus` | `cybernetics-core` |
| `robotics-bay` | 150/150 | — | — | `robotics-facility` |
| `stargate` | 150/150 | — | `phoenix`, `void-ray`, `carrier` | `cybernetics-core` |
| `fleet-beacon` | 300/200 | — | — | `stargate` |
| `forge` | 150/0 | — | — | — |
| `photon-cannon` | 150/0 | — | — (ATK 20, range 7, detector) | `forge` |

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit within movement range |
| `attack` | Attack `targetId` within range |
| `gather` | Worker collects minerals or gas from adjacent resource |
| `build` | Worker builds a structure at `{x, y}` |
| `train` | Building produces a unit (`unitType`) |
| `ability` | Unit-specific ability (stim, blink, siege, burrow, etc.) |
| `skip-unit` | Skip this unit |
| `end-turn` | End player's turn |

## Unit abilities

| Unit | Ability | Effect |
|---|---|---|
| Marine | `stim` | +3 ATK, +1 move, −10 HP; lasts 2 turns |
| Stalker | `blink` | Teleport up to 8 tiles |
| Siege Tank | `siege` | Toggle siege mode: ATK 15→40, range 7→9, immobile |
| Ghost | `emp` | Remove shields from all units in radius 2 |
| Medivac | passive | Heals adjacent biological units 1 HP/turn |
| Infestor | `fungal-growth` | Root + 30 damage AoE |
| Swarm Host | passive | Spawns 2 locust units each turn |
| Lurker | `burrow` | Toggle burrow; burrowed lurkers are invisible and deal splash |
| Roach | passive | Regenerates 3 HP per turn |
| Protoss units | passive | Shields regenerate 1 per turn |
| Colossus | passive | Attacks deal splash damage in a line |

## Special mechanics

- **Resources** — minerals and gas gathered by workers; required for all unit and building production
- **Supply** — each unit costs supply; cap set by supply buildings (Supply Depot / Overlord / Pylon)
- **Tech requirements** — buildings must be constructed before dependent units can be trained
- **Armor** — each unit has an armor value that reduces incoming damage (minimum 1 per hit); shields do not benefit from armor
- **Protoss shields** — secondary HP pool; absorbs damage before HP; regenerates 1 per turn
- **Immortal hardened shield** — incoming damage to shields is capped at 10 per hit
- **High-ground advantage** — ranged units on low ground attacking a unit on `elevated` terrain have a 30% miss chance
- **Viking assault mode** — toggle between air mode (range 6) and assault/ground mode (melee, range 1)
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
| Win | `base-destroyed` — opponent's main building destroyed and all units eliminated |
| Draw | `max-turns` |

## Run

```sh
npm run demo:sc2           # interactive
npm run demo:sc2:auto      # random vs random
npm run demo:sc2:greedy    # greedy AI vs random
```
