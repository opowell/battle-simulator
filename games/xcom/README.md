# XCOM

Turn-based squad tactical combat — XCOM soldiers vs aliens. Requires line of sight to shoot.

## Players

| ID | Name | Acts first |
|---|---|---|
| `xcom` | XCOM | Yes |
| `aliens` | Aliens | No |

## Units

### XCOM squad

| Type | HP | Accuracy | Damage | Move | AP | Notes |
|---|---|---|---|---|---|---|
| `soldier` | 8 | 75 | 3–5 | 3 | 2 | Standard rifle |
| `heavy` | 12 | 65 | 5–8 | 2 | 2 | High HP and damage |
| `sniper` | 6 | 85 | 4–7 | 4 | 2 | Gains accuracy with range |
| `support` | 8 | 70 | 3–5 | 3 | 2 | |

### Aliens

| Type | HP | Accuracy | Damage | Move | AP |
|---|---|---|---|---|---|
| `sectoid` | 4 | 65 | 2–4 | 3 | 2 |
| `floater` | 6 | 60 | 3–5 | 4 | 2 |
| `muton` | 10 | 70 | 4–7 | 2 | 2 |

## Actions

| Type | AP cost | Notes |
|---|---|---|
| `move` | 1 | Move to target tile; must be within `moveRange` |
| `attack` | All remaining AP | Shoot `targetId`; requires LOS |
| `end-turn` | — | End this unit's turn / entire player turn |

## Special mechanics

- **Action Points** — each unit has 2 AP per turn; `move` costs 1, `attack` uses all remaining
- **Line of sight** — Bresenham ray cast; `#` and `C`/`c` tiles do not block LOS, only `#` walls do
- **Hit chance** — `accuracy − 4 × distance − cover`; sniper: `accuracy − distance − cover` (net +3/tile vs standard); clamped to [5, 95]
- **Cover** — `c` (low cover) gives −20 hit chance to attacker; `C` (high cover) gives −40
- **Critical hits** — hit roll ≤ `hitChance / 4`; crits deal 2× damage
- **Vision** — radius 5 tiles; fog of war hides unseen enemies
- **Turn order** — XCOM activates all units, then aliens

## Map

Fixed 14×12 grid. Two horizontal interior walls (rows 4 and 7) each with two corridors at x=3–4 and x=9–10. Low cover (`c`) and high cover (`C`) scattered throughout. XCOM deploys top-left (x=1–2, y=1–2); aliens deploy bottom-right (x=11–12, y=9–10).

## Win conditions

| Outcome | Reason |
|---|---|
| Win (`xcom`) | `aliens-eliminated` |
| Win (`aliens`) | `xcom-eliminated` |
| Draw | `max-turns` |

## Run

```sh
npm run demo:xcom           # interactive
npm run demo:xcom:auto      # random vs random
npm run demo:xcom:greedy    # greedy AI vs random
```
