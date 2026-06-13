# Civilization II

Turn-based 4X strategy with an expanded unit roster, terrain resources, and veteran units.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Units

Units have a `firepower` value (1, 2, or 3) that sets damage dealt per combat hit. Combat continues round-by-round until one side reaches 0 HP.

### Terrain Improvement, Diplomacy & Espionage

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `settlers` | 0 | 1 | 1 | 20 | 1 | 40 | `found-city`, `build-road`, `irrigate`, `mine`, `transform` |
| `workers` | 0 | 1 | 1 | 10 | 1 | 30 | `build-road`, `irrigate`, `mine`, `transform` |
| `engineers` | 0 | 2 | 2 | 20 | 1 | 50 | `build-road`, `irrigate`, `mine`, `transform`, `build-fortress`, `build-railroad`, `double-work` |
| `diplomat` | 0 | 0 | 2 | 10 | 1 | 30 | `diplomacy`, `bribe`, `sabotage` |
| `spy` | 0 | 0 | 3 | 10 | 1 | 30 | `espionage`, `bribe`, `sabotage`, `steal-tech`, `incite-revolt` |
| `explorer` | 0 | 1 | 1 | 10 | 1 | 30 | `explore` |

### Ancient Land

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `warriors` | 1 | 1 | 1 | 10 | 1 | 10 | |
| `phalanx` | 1 | 2 | 1 | 10 | 1 | 25 | |
| `archers` | 3 | 2 | 1 | 10 | 1 | 30 | |
| `legion` | 3 | 3 | 1 | 10 | 1 | 30 | |
| `catapult` | 6 | 4 | 1 | 10 | 1 | 60 | `bombard` |
| `horsemen` | 2 | 1 | 2 | 10 | 1 | 20 | `mounted` |
| `chariot` | 3 | 1 | 2 | 10 | 1 | 40 | `mounted` |

### Medieval Land

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `pikemen` | 1 | 2 | 1 | 10 | 1 | 25 | `anti-mounted` (+50% DEF vs mounted) |
| `knights` | 5 | 2 | 2 | 10 | 1 | 40 | `mounted` |
| `crusaders` | 5 | 1 | 2 | 10 | 1 | 40 | `mounted` |

### Renaissance & Industrial Land

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `musketeers` | 2 | 3 | 1 | 20 | 1 | 50 | |
| `cannon` | 7 | 2 | 1 | 20 | 1 | 40 | `bombard` |
| `dragoons` | 5 | 2 | 2 | 20 | 1 | 50 | `mounted` |
| `riflemen` | 3 | 5 | 1 | 20 | 1 | 60 | |
| `cavalry` | 8 | 3 | 3 | 20 | 1 | 60 | `mounted` |
| `artillery` | 12 | 2 | 2 | 20 | 1 | 60 | `bombard` |

### Modern Land

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `infantry` | 5 | 5 | 1 | 20 | 1 | 50 | |
| `mech-infantry` | 6 | 6 | 3 | 30 | 1 | 50 | |
| `armor` | 10 | 5 | 3 | 30 | 1 | 80 | `blitz` |
| `howitzer` | 12 | 2 | 2 | 30 | 1 | 70 | `bombard`, `ignore-walls` |
| `partisans` | 4 | 4 | 1 | 20 | 1 | 50 | `guerrilla` |
| `fanatics` | 5 | 5 | 1 | 20 | 1 | 20 | `fundamentalism-only` |
| `marines` | 8 | 5 | 1 | 30 | 1 | 50 | `amphibious` |
| `paratroopers` | 6 | 4 | 1 | 30 | 1 | 60 | `paradrop` |
| `alpine-troops` | 6 | 6 | 1 | 30 | 1 | 60 | `mountain-bonus` |

### Air

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `fighter` | 4 | 2 | 10 | 20 | 2 | 60 | `intercept`, `escort` |
| `bomber` | 12 | 1 | 8 | 20 | 2 | 120 | `strategic-bomb` |
| `helicopter` | 6 | 3 | 6 | 20 | 2 | 60 | `hover` |
| `stealth-fighter` | 8 | 4 | 14 | 20 | 2 | 80 | `stealth`, `intercept`, `escort` |
| `stealth-bomber` | 14 | 3 | 12 | 20 | 2 | 160 | `stealth`, `strategic-bomb` |
| `awacs` | 0 | 1 | 11 | 20 | 1 | 80 | `radar` |
| `cruise-missile` | 18 | 0 | 12 | 10 | 3 | 60 | `one-use`, `missile` |
| `nuclear-missile` | 99 | 0 | 16 | 10 | 1 | 160 | `one-use`, `nuclear`, `missile` |

### Sea

| Type | ATK | DEF | Move | HP | FP | Cost | Specials |
|---|---|---|---|---|---|---|---|
| `trireme` | 1 | 1 | 3 | 10 | 1 | 40 | `coastal-only`, `transport-1` |
| `caravel` | 2 | 1 | 3 | 10 | 1 | 40 | `transport-3` |
| `galleon` | 0 | 2 | 4 | 20 | 1 | 40 | `transport-4` |
| `frigate` | 4 | 2 | 3 | 20 | 1 | 50 | `bombard` |
| `ironclad` | 4 | 4 | 4 | 20 | 1 | 60 | |
| `destroyer` | 4 | 4 | 6 | 30 | 1 | 60 | `submarine-attack` |
| `cruiser` | 6 | 6 | 6 | 30 | 2 | 80 | `bombard` |
| `battleship` | 12 | 12 | 4 | 40 | 2 | 160 | `bombard` |
| `carrier` | 1 | 12 | 5 | 40 | 2 | 160 | `carries-air-8` |
| `submarine` | 8 | 2 | 3 | 20 | 2 | 50 | `stealth`, `anti-ship` |
| `transport` | 0 | 3 | 4 | 20 | 1 | 50 | `transport-8` |
| `aegis-cruiser` | 8 | 8 | 6 | 30 | 2 | 100 | `bombard`, `anti-air`, `anti-missile` |

## Terrain

| Type | Move cost | Defense bonus | Yield (food/shields/trade) | Special resources |
|---|---|---|---|---|
| `ocean` | 1 (sea only) | 0% | 1/0/2 | fish, whales |
| `arctic` | 2 | 0% | 0/0/0 | ivory, oil |
| `tundra` | 1 | 0% | 1/0/0 | game, furs |
| `desert` | 1 | 0% | 0/1/0 | oasis, oil |
| `plains` | 1 | 0% | 1/1/1 | horse, wheat |
| `grassland` | 1 | 0% | 2/0/0 | shield (extra production) |
| `forest` | 2 | +50% | 1/2/0 | pheasant, silk |
| `hills` | 3 | +100% | 1/2/0 | coal, wine |
| `mountains` | 3 | +200% | 0/1/0 | gold, iron |
| `swamp` | 2 | 0% | 1/0/0 | oil, peat |
| `jungle` | 2 | +50% | 1/0/0 | gems, ivory |

Roads halve movement cost. Railroads remove movement cost entirely.

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit up to its range |
| `attack` | Probabilistic combat; veteran units get 1.5× bonus |
| `found-city` | Settler founds a city |
| `build-road` | Settler builds road (or railroad) |
| `skip-unit` | Pass for this unit |
| `end-turn` | End player turn |

## Special mechanics

- **Cities** — accumulate shields each turn; produce units when accumulated shields reach unit cost
- **Veteran status** — units that win combat may gain veteran status (+50% ATK and DEF)
- **City defense** — units in a city tile get +50% DEF
- **Fortress** — units on a fortress tile get +100% DEF
- **River crossing** — attacking across a river gives the defender an additional +50% DEF
- **Anti-mounted** — units with `anti-mounted` (e.g. `pikemen`) get +50% DEF vs mounted attackers
- **Firepower** — damage per hit varies by unit type: land=1, sea=1–2, air=2, missiles=3; a fight ends when HP reaches 0
- **Fog of war** — vision radius 2 per unit
- **Combat** — round-by-round: `P(attacker wins round) = ATK / (ATK + DEF × terrainBonus)`; loser takes `firepower` HP damage per round

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `conquest` — all opponent cities and units destroyed |
| Draw | `max-turns` |

## Run

```sh
npm run demo:civ2           # interactive
npm run demo:civ2:auto      # random vs random
npm run demo:civ2:greedy    # greedy AI vs random
```
