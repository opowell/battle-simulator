# Memoir '44

A turn-based adaptation of Days of Wonder's **Memoir '44** — WWII squad combat on a
13×9 hex board, driven by a hand of **command cards** and buckets of **battle dice**.

## Board & sections

The battlefield is 13 columns wide by 9 rows deep, split into three **sections** —
left flank (cols 0–3), center (4–8), right flank (9–12). Command cards order units
within a section. Hexes use offset coordinates `{ col, row }`; [hex.js](hex.js) does
the axial/cube conversion for distance and line of sight.

## A turn

1. **Play a command card** (`play-card`). It grants a number of *orders* in one
   section (or, for *General Advance*, in every section). Cards, [cards.js](cards.js):

   | Card | Orders |
   |---|---|
   | Recon in Force | 1 (in a section you choose) |
   | Probe (L/C/R) | 2 |
   | Attack (L/C/R) | 3 |
   | Assault (L/C/R) | 4 |
   | General Advance | 2 in **each** section |

2. **Order units** — each ordered unit may **move** then **battle** (`move`, `attack`).
   The first time a unit moves or battles it consumes one order from its section.
3. **End turn** (`end-turn`) — draw back up to your hand size and pass.

## Units ([units.js](units.js))

| Type | Figures | Move | Range (dice) | Notes |
|---|---|---|---|---|
| Infantry | 4 | 1 & fight, or 2 | 1→3, 2→2, 3→1 | needs line of sight |
| Armor | 3 | 3 & fight | 3 at any range 1–3 | needs LOS |
| Artillery | 2 | move **or** fight | 3/3/2/2/1/1 (range 1–6) | ignores LOS **and** terrain |

## Battle dice ([combat.js](combat.js))

Each die is the classic six-face die: **2 Infantry, 1 Armor, 1 Grenade, 1 Star, 1 Flag**.
Roll one die per attack die granted (minus terrain protection):

- **Infantry / Grenade** kill infantry & artillery figures; **Armor / Grenade** kill armor.
- **Flag** forces the defender to retreat one hex toward its home edge; a flag that
  can't be honored (blocked or off-board) becomes a casualty instead.
- **Star** has no effect in the base rules.

The last figure removed from a unit scores a **victory medal** for the attacker.

## Terrain ([terrain.js](terrain.js))

Forest, town, hills and hedgerows subtract dice from attacks against a unit standing
there, make a moving unit stop on entry, and block line of sight. Rivers are impassable
except at bridges; artillery ignores all terrain effects.

## Scenarios ([scenarios.js](scenarios.js))

- **Encounter** (default) — an open, rotationally-symmetric field. First to **5 medals**.
- **Pegasus Bridge** — British airborne rush two bridges over a canal against dug-in
  Germans; **holding a bridge hex scores a medal**. First to 5.

## Victory

First side to the scenario's medal count wins (`getResult`); wiping out the enemy army
also ends it.

## Simplifications

This is a faithful core, not the full rulebook. Omitted for now: tactic/special cards
(Ambush, Air Power, …), *take ground* / armor *overrun* follow-up battles, star-symbol
effects, and the wider terrain/nation/expansion catalog. The `move → battle` order within
a turn is relaxed (units may interleave) rather than strict all-move-then-all-battle.

## Run it

```sh
node demo/memoir44-demo.js                          # you (Allies) vs random AI
node demo/memoir44-demo.js --auto                   # random vs random
node demo/memoir44-demo.js --auto --scenario pegasus-bridge
node --test games/memoir44/index.test.js
```
