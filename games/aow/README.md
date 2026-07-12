# The Ancient Art of War

A clone of Brøderbund's **The Ancient Art of War** (1984). Two ancient armies of **squads**
manoeuvre across a procedurally generated map of plains, forest, hills, rivers and impassable
mountains, foraging for supply and racing to storm the enemy's **fort and flag**. Movement is
**continuous** (squads march to any point) and units render as **circles** sized by their
strength.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Squads

A **squad** is the unit on the map — a body of **up to 14 men** in any mix of the four soldier
types. A squad marches at the pace of its **slowest** man (one knight slows the whole column),
and carries two condition properties:

- **supply** (0–100) — food & provisions. Foraged from the land and topped up by controlled
  villages/forts; marching and bad terrain drain it. Low supply saps fighting strength.
- **morale** (0–100) — fighting spirit. Won battles raise it; losses, routs and starvation sink
  it. A squad that hits zero supply *and* zero morale disbands.

## Soldiers (rock-paper-scissors)

| Type | Beats | Speed | Role |
|---|---|---|---|
| `knight` (K) | barbarian | slow | Armoured and strong |
| `barbarian` (B) | archer | fast | Swift, unarmoured |
| `archer` (A) | knight | medium | Deadly at range; lethal behind fort walls |
| `spy` (S) | — | fastest | Non-combatant; doubles the squad's sighting range |

Effective strength = men-power × condition (supply+morale) × terrain, plus a **counter bonus**
for men whose type beats the enemy's dominant type.

## Terrain

| Type | Speed | Defence | Forage / turn | Passable |
|---|---|---|---|---|
| `plains` | 1.00 | 0% | +3 | Yes |
| `forest` | 0.55 | +35% | +1 | Yes |
| `hills` | 0.65 | +60% | 0 | Yes |
| `water` (shallows) | 0.35 | −40% | −4 | Yes (perilous) |
| `mountains` | — | — | −6 | No |

## Map features

| Feature | Effect |
|---|---|
| **Fort** 🏰 | Trains **reinforcements** — a garrisoning squad it controls gains one man per turn (up to 14). Each side starts with a home fort; one neutral fort is contested in the centre. |
| **Village** 🏘️ | When occupied, **supplies** nearby friendly squads (+25/turn). Take villages to feed your army and cut the enemy's food. |
| **Flag** ⚑ | The **victory objective**. Each side's flag sits on its home fort — march a squad onto the enemy flag to capture it. |

Terrain is authored as smooth noise-driven shapes (ovals + a meandering river) rasterized onto a
tile grid for movement/combat; the border is always mountains and home safe-zones are forced to
plains so armies can form up.

## Actions

| Type | Notes |
|---|---|
| `move` | March squad `unitId` toward continuous point `{x, y}`; distance is clamped to the squad's speed and slowed by terrain. Reaching an enemy triggers an encounter. |
| `skip-unit` | Hold this squad in place for the turn |
| `end-turn` | End the turn — runs upkeep (forage, resupply, reinforcements, morale) for the acting side |

## Combat

When a marching squad comes within contact of an enemy squad they **encounter** and fight.
Attrition is rolled man-by-man against each side's effective strength (recomputed as casualties
mount) until a side is **wiped out** (captured) or its strength collapses and it **routs** (survivors
flee, morale shattered). Terrain defence and fort walls favour the defender.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `flags-captured` — you hold every enemy flag |
| Win | `army-destroyed` — all enemy squads destroyed or disbanded |
| Draw | `max-turns` |

## Options & scenarios

- **Fog of War** (option) — each side sees only enemy squads near its own; a spy in a squad
  doubles that range.
- **Race for the Flags** (default, 24×14) and **War in the Mountains** (34×20) scenarios.

## Run

```sh
npm run demo:aow           # interactive
npm run demo:aow:auto      # random vs random
npm run demo:aow:greedy    # greedy flag-racer AI vs random
```
