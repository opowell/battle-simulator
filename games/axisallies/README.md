# Axis & Allies

WWII grand-strategy wargame. Allies capture Berlin; Axis capture Moscow.

## Players

| ID | Name |
|---|---|
| `allies` | Allies |
| `axis` | Axis |

## Units

Combat uses d6 dice: a unit hits on a roll ≤ its ATK (attacking) or ≤ its DEF (defending).

| Type | Cost (IPC) | ATK | DEF | Move | HP | Domain | Notes |
|---|---|---|---|---|---|---|---|
| `infantry` | 3 | 1 | 2 | 1 | 1 | land | Boosted to ATK 2 when paired with artillery |
| `artillery` | 4 | 2 | 2 | 1 | 1 | land | Boosts one adjacent infantry to ATK 2 per round |
| `tank` | 5 | 3 | 3 | 2 | 1 | land | |
| `fighter` | 10 | 3 | 4 | 4 | 1 | air | |
| `bomber` | 12 | 4 | 1 | 6 | 1 | air | |
| `battleship` | 20 | 4 | 4 | 2 | 2 | sea | Absorbs one hit before sinking |
| `carrier` | 14 | 1 | 2 | 2 | 2 | sea | Holds up to 2 fighters; absorbs one hit |
| `destroyer` | 8 | 3 | 3 | 2 | 1 | sea | |
| `submarine` | 6 | 2 | 1 | 2 | 1 | sea | |
| `transport` | 7 | 0 | 1 | 2 | 1 | sea | Holds 2 land units |

## Phases

Each player's turn runs through five phases in order:

1. **purchase** — spend IPC to buy units (placed at end of turn)
2. **combat-move** — move units to enemy territories for combat
3. **combat** — resolve battles in each contested territory
4. **non-combat-move** — move remaining units to friendly territories
5. **mobilize** — place purchased units in controlled territories with factories

## Actions

| Type | Phase | Notes |
|---|---|---|
| `buy` | purchase | `unitType`, `count` |
| `move` | combat-move / non-combat-move | `unitId`, `from`, `to` |
| `board-transport` | combat-move | `unitId`, `transportId` — load land unit onto transport |
| `unload-cargo` | combat-move | `transportId`, `territory` — unload all cargo for amphibious assault |
| `attack` | combat | `unitId`, `targetId` — fire in an ongoing battle |
| `skip-unit` | any | Skip this unit |
| `mobilize` | mobilize | `unitType`, `territory` — place bought unit |
| `end-turn` | any | Advance phase |

## Special mechanics

- **IPC economy** — territories generate IPC (income) each turn; used to buy units
- **Transports** — can carry 2 land units (1 infantry + 1 other, or 2 infantry); unload triggers amphibious assault
- **Artillery+infantry pairing** — each artillery unit boosts one infantry's ATK from 1 to 2 per combat round (pairs are matched cheapest-infantry-first)
- **Multi-HP ships** — battleships and carriers have 2 HP; a hit reduces HP by 1 (casualties removed cheapest-first)
- **Probabilistic combat** — each unit rolls a d6; hits on ≤ ATK (attack phase) or ≤ DEF (defense phase); casualties applied simultaneously each round

## Capitals

| Side | Capital | Territory ID |
|---|---|---|
| Axis | Berlin | `germany` |
| Allies | Moscow | `moscow` |

Capturing the enemy capital ends the game immediately.

## Territories

20 land territories and 6 sea zones. Key territories and their IPC values:

| Territory | IPC | Factory | Starting owner |
|---|---|---|---|
| `eastern-usa` | 12 | Yes | Allies |
| `western-usa` | 10 | Yes | Allies |
| `uk` | 8 | Yes | Allies |
| `germany` | 10 | Yes | Axis |
| `japan` | 8 | Yes | Axis |
| `moscow` | 6 | Yes | Allies |
| `caucasus` | 4 | Yes | Allies |
| `india` | 3 | Yes | Allies |
| `southern-europe` | 4 | Yes | Axis |
| `france` | 6 | No | Axis |

Sea zones (`sz-north-sea`, `sz-north-atlantic`, `sz-mediterranean`, `sz-north-pacific`, `sz-south-pacific`, `sz-indian-ocean`) have IPC 0 and no factory.

## Win conditions

| Outcome | Reason |
|---|---|
| Win (Allies) | `axis-capital-captured` — Berlin captured |
| Win (Axis) | `allied-capital-captured` — Moscow captured |
| Draw | `max-turns` |

## Run

```sh
npm run demo:axisallies        # interactive
npm run demo:axisallies:auto   # random vs random
```
