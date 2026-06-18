# Counter-Strike
Round-based tactical shooter on a 20×12 grid based on the real Counter-strike game. First team to 8 round wins takes the match (max 15 rounds).

## Players

| ID | Name |
|---|---|
| `ct` | Counter-Terrorists |
| `t` | Terrorists |

## Units

Each side fields 5 agents (e.g. `ct-0` through `ct-4`). Each agent has **100 HP**.

## Weapons

All agents start each round with a `pistol`. Maximum money: 16,000$.

### Pistols

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `pistol` | 0 (starting) | 30 | 6 | both |
| `p250` | 300 | 38 | 7 | both |
| `cz75` | 500 | 31 | 7 | both |
| `tec9` | 500 | 40 | 7 | T |
| `fiveseven` | 500 | 38 | 8 | CT |
| `r8` | 600 | 60 | 8 | both |
| `deagle` | 700 | 55 | 8 | both |

### SMGs

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `mac10` | 1,050 | 22 | 7 | T |
| `mp9` | 1,250 | 23 | 7 | CT |
| `ump45` | 1,200 | 27 | 8 | both |
| `bizon` | 1,400 | 24 | 8 | both |
| `mp5` | 1,500 | 26 | 8 | both |
| `mp7` | 1,700 | 26 | 8 | both |
| `p90` | 2,350 | 26 | 9 | both |

### Shotguns

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `nova` | 1,050 | 52 | 3 | both |
| `sawedoff` | 1,100 | 60 | 3 | T |
| `mag7` | 1,300 | 52 | 4 | CT |
| `xm1014` | 2,000 | 40 | 4 | both |

### Heavy

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `negev` | 1,700 | 35 | 10 | both |
| `m249` | 5,200 | 32 | 10 | both |

### Rifles

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `galil` | 1,800 | 30 | 9 | T |
| `famas` | 2,250 | 30 | 9 | CT |
| `ak47` | 2,700 | 35 | 9 | T |
| `m4a1s` | 2,900 | 33 | 10 | CT |
| `sg553` | 3,000 | 33 | 10 | T |
| `m4a4` | 3,100 | 33 | 9 | CT |
| `aug` | 3,300 | 32 | 10 | CT |

### Snipers

| Weapon | Cost | Damage | Range | Teams |
|---|---|---|---|---|
| `ssg08` | 1,700 | 88 | 12 | both |
| `awp` | 4,750 | 110 | 14 | both |
| `g3sg1` | 5,000 | 80 | 13 | T |
| `scar20` | 5,000 | 80 | 13 | CT |

## Grenades

Grenades are thrown with a `throw` action to any walkable tile within 8 tiles (no LOS required). Each grenade type has a per-unit carry limit.

| Grenade | Cost | Limit | Effect | Teams |
|---|---|---|---|---|
| `he` | 300 | 1 | 50 raw damage to all units within radius 2 | both |
| `flash` | 200 | 2 | Blinds enemy units within radius 3 with LOS to target for 1 turn (can't shoot) | both |
| `smoke` | 300 | 1 | Blocks LOS through a 3×3 area for 5 turns | both |
| `molotov` | 400 | 1 | 10 damage/turn in a 3×3 area for 3 turns | T |
| `incendiary` | 600 | 1 | 10 damage/turn in a 3×3 area for 3 turns | CT |
| `decoy` | 50 | 1 | No mechanical effect | both |

## Equipment

| Item | Cost | Effect | Teams |
|---|---|---|---|
| `armor` | 650 | Kevlar — reduces incoming damage by 40% | both |
| `helmet` | 350 | Requires armor; adds 10% more damage reduction (50% total) | both |
| `defusekit` | 400 | Reduces defuse from 2 actions to 1 action | CT |

## Actions

| Type | Phase | Notes |
|---|---|---|
| `buy` | buy | `item` key (weapon id, `armor`, `helmet`, `defusekit`, or grenade id); deducted from `$money` |
| `move` | action | `{x, y}` within movement range (4 tiles) |
| `shoot` | action | `targetId`; requires LOS, in range, and not blinded |
| `throw` | action | `grenade` + `target {x,y}`; range 8, no LOS required |
| `plant` | action | Terrorists only; plant at bombsite A or B |
| `defuse` | action | CTs only; defuse active bomb (2 sequential actions, or 1 with kit) |
| `skip-unit` | action | Skip all remaining actions for this agent |
| `end-buy` | buy | End team's buy phase |
| `end-turn` | action | End current team's action phase |

## Special mechanics

- **Buy phase** — both teams alternate buying before the round's main phase
- **Economy** — start at 800$; round win: +3,250$; round loss: +1,400$ base, +500$ per consecutive loss (max +3,400$); kill reward: +300$; max money: 16,000$
- **Bomb** — planted by T at bombsite A or B; explodes after 8 turns; CTs need 2 sequential `defuse` actions (or 1 with defuse kit) on the bomb tile
- **Armor** — reduces incoming damage by 40%; helmet adds another 10% (50% total)
- **Smoke** — blocks line-of-sight for shooting; thrown grenades pass through
- **Fire** — molotov/incendiary creates a burning zone; units standing in it take 10 damage per turn tick
- **Blind** — flashbanged units cannot shoot for 1 turn; they can still move and throw grenades

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

Map legend: `T`=Terrorist `C`=Counter-Terrorist `A`=Bombsite-A `B`=Bombsite-B `c`=CT-spawn `t`=T-spawn `!`=bomb `@`=smoke `*`=fire

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
