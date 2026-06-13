# Doom

One marine vs a horde of demons on a 20×14 map. Marine wins by eliminating all demons or surviving 80 turns.

## Players

| ID | Name |
|---|---|
| `marine` | Marine |
| `demons` | Demons |

## Units

### Marine

| Stat | Value |
|---|---|
| HP | 100 |
| Armor | 50 |
| AP per turn | 2 |
| Move range | 4 tiles |
| Starting weapon | `shotgun` |
| Starting ammo | 100 bullets, 30 shells |

### Demons

Each attack rolls per pellet: `[min, max]` damage range, accuracy%, count of pellets. AP=2 for zombiemen/shotgunners/imps; AP=1 for demons/cacodemons/barons.

| Type | HP | Damage | Range | Accuracy | Pellets | Move | Notes |
|---|---|---|---|---|---|---|---|
| `zombieman` | 20 | 5–10 | 6 | 55% | 1 | 3 | Ranged |
| `shotgunner` | 30 | 4–8 | 5 | 55% | 3 | 3 | Spread shot |
| `imp` | 60 | 10–20 | 8 | 60% | 1 | 3 | Fireball |
| `demon` | 100 | 40–60 | 1 | 80% | 1 | 4 | Melee brute |
| `cacodemon` | 200 | 20–35 | 8 | 60% | 1 | 3 | Floats; ranged |
| `baron` | 400 | 30–60 | 10 | 70% | 1 | 2 | Boss; high HP |

## Weapons

| Weapon | Ammo | Damage | Range | Accuracy | Pellets | Notes |
|---|---|---|---|---|---|---|
| `pistol` | bullet (1/shot) | 7–13 | 10 | 75% | 1 | |
| `shotgun` | shell (1/shot) | 5–10 | 6 | 65% | 5 | 5 pellets, each rolls independently |
| `chaingun` | bullet (3/shot) | 7–13 | 10 | 70% | 3 | 3-burst |
| `rocketlauncher` | rocket (1/shot) | 40–80 | 12 | 90% | 1 | Splash: half damage to adjacent units |
| `plasma` | cell (1/shot) | 20–30 | 12 | 85% | 1 | |

Ammo caps: bullets 200, shells 50, rockets 10, cells 200. Weapons auto-upgrade on pickup (higher rank replaces lower).

## Actions

| Type | Available to | Notes |
|---|---|---|
| `move` | Both | Move to `{x, y}` within movement range; LOS not required |
| `shoot` | Both | Shoot `targetId`; requires LOS within weapon range |
| `skip-unit` | Both | Pass this unit |
| `end-turn` | Both | End player's turn |

## Special mechanics

- **Armor** — marine's armor absorbs a portion of incoming damage; tracked as `unit.attrs.armor` (integer, starting at 50)
- **Splash damage** — rocket launcher deals half damage to all units adjacent to the target
- **Pellet system** — each pellet rolls hit/miss and damage independently; total damage is the sum of successful pellet hits
- **Item pickups** — map contains pickups: medkits (+25 HP), health/armor bonuses, ammo packs, and weapons; marine collects by moving onto the tile
- **Line of sight** — Bresenham ray cast; walls block shots
- **AP system** — marine has 2 AP per turn (move=1 AP, shoot=1 AP); each demon type has its own AP count

## Map layout

Fixed 20×14 map with 5 rooms connected by corridors:

| Room | Location | Notes |
|---|---|---|
| A | x=1–5, y=1–4 | Marine start (top-left) |
| B | x=9–18, y=1–5 | Upper-right; connected to A via corridor y=2 |
| C | x=1–18, y=6–7 | Mid horizontal corridor |
| D | x=1–7, y=8–12 | Bottom-left |
| E | x=9–18, y=8–12 | Bottom-right; boss area |

- **Turn limit** — game ends after 80 turns; marine wins on timeout

## Win conditions

| Outcome | Reason |
|---|---|
| Win (`marine`) | `demons-eliminated` — all demon units destroyed |
| Win (`marine`) | `survived` — 80 turns elapsed |
| Win (`demons`) | `marine-eliminated` — marine reaches 0 HP |

## Run

```sh
npm run demo:doom        # interactive
npm run demo:doom:auto   # random vs random
```
