# Counter-Strike

Round-based tactical shooter on a 20×12 grid. First team to 8 round wins takes the match (max 15 rounds).

## Players

| ID | Name |
|---|---|
| `ct` | Counter-Terrorists |
| `t` | Terrorists |

## Units

Each side fields 10 agents (e.g. `ct-0` through `ct-9`). Each agent has **100 HP**. Armor (650$) sets HP to 100 and reduces incoming damage by 40%.

## Weapons

| Weapon | Cost | Damage | Range (tiles) |
|---|---|---|---|
| `pistol` | 0 (starting) | 30 | 6 |
| `deagle` | 700 | 55 | 7 |
| `mp5` | 1500 | 26 | 8 |
| `ak47` | 2700 | 35 | 9 |
| `m4a4` | 3100 | 33 | 9 |
| `awp` | 4750 | 110 | 14 |

All agents start each round with a pistol. Maximum money: 16,000$.

## Actions

| Type | Phase | Notes |
|---|---|---|
| `buy-weapon` | buy | `weapon` key; deducted from `$money` |
| `buy-armor` | buy | 650$; `agent.attrs.armor = true` |
| `move` | main | `{x, y}` within movement range (3 tiles) |
| `shoot` | main | `targetId`; requires LOS and range ≤ weapon range |
| `plant-bomb` | main | Terrorists only; plant at bombsite A or B |
| `defuse-bomb` | main | CTs only; defuse active bomb (takes 2 actions) |
| `skip` | main | Pass this agent's action |
| `end-turn` | any | End current player's turn |

## Special mechanics

- **Buy phase** — both teams alternate buying before the round's main phase
- **Economy** — start at 800$; round win: +3,250$; round loss: +1,400$ base, +500$ per consecutive loss (max +3,400$); kill reward: +300$; max money: 16,000$
- **Bomb** — planted by T at bombsite A or B; explodes after 8 turns; CTs need 2 sequential `defuse-bomb` actions on the bomb tile to disarm
- **Armor** — sets HP to 100 and reduces incoming damage by 40%; costs 650$

## Map layout

Fixed 20×12 map with walls blocking movement and LOS:

| Zone | Position | Notes |
|---|---|---|
| CT spawn | x=1–2, y=4–7 | Left-center |
| T spawn | x=17–18, y=4–7 | Right-center |
| Bombsite A | x=2–4, y=8–10 | Upper-left |
| Bombsite B | x=2–4, y=1–3 | Lower-left |
| Mid-box | x=8–11, y=5–6 | Central cover |
| Upper-right wall | x=13–15, y=9 | Breaks T→A sightline |
| Lower-right wall | x=13–15, y=2 | Breaks T→B sightline |

## Win conditions per round

| Condition | Winner |
|---|---|
| All CTs eliminated | T |
| All Ts eliminated | CT |
| Bomb detonates | T |
| Bomb defused | CT |
| Time limit (no bomb planted) | CT |

First team to 8 round wins takes the match; the game ends at 15 rounds if neither reaches 8.

## Run

```sh
npm run demo:cs        # interactive
npm run demo:cs:auto   # random vs random
```
