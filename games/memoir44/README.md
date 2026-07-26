# Memoir '44

A turn-based adaptation of Days of Wonder's **Memoir '44** — WWII squad combat on a
13×9 hex board, driven by a hand of **command cards** and buckets of **battle dice**.

## Board & sections

The battlefield is 13 columns wide by 9 rows deep, split into three **sections** —
left flank, center, right flank. The two dividing lines run **through** the boundary
columns, so a hex on a line belongs to both adjacent sections and may be ordered from
either ([hex.js](hex.js) `sectionsOf`). Hexes use offset coordinates `{ col, row }`;
[hex.js](hex.js) does the axial/cube conversion for distance and line of sight.

## A turn

The turn is a phase machine that mirrors the rulebook's *play → order → move all →
battle all → draw* sequence:

1. **Play a command card** (`play-card`). It grants a number of *orders* in one
   section (or, for *General Advance*, in every section). Cards, [cards.js](cards.js):

   | Card | Orders |
   |---|---|
   | Recon 1 | 1 (in a section you choose) |
   | Probe (L/C/R) | 2 |
   | Attack (L/C/R) | 3 |
   | Assault (L/C/R) | 4 |
   | General Advance | 2 in **each** section |

2. **Move phase** — move ordered units (`move`), then `end-move` to advance to battle.
3. **Battle phase** — battle with ordered units one at a time (`attack`), resolving
   each unit's combats (including Take Ground / Overrun) before the next.
4. **End turn** (`end-turn`) — draw back up to your hand size and pass.

The first time a unit moves or battles it consumes one order from a section it sits in.
A unit adjacent to an enemy **must close-assault** it — it may not fire past it.

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
  can't be honored (blocked or off-board) becomes a casualty instead. Terrain such as
  sandbags/bunkers lets the defender **ignore the first flag**.
- **Star** has no effect in the base rules.

The last figure removed from a unit scores a **victory medal** for the attacker.

### Take Ground & Armor Overrun

After a close assault empties the target hex (enemy eliminated or forced to retreat),
the attacker may advance into it (`take-ground`) or hold (`decline-advance`). Infantry
and armor may take ground; artillery may not. An **armor** unit that takes ground may
then make **one overrun combat** — a second battle from the hex it just seized — and
may take ground again after it (but only one overrun per turn).

## Terrain ([terrain.js](terrain.js))

Terrain reduces the dice rolled against a unit standing on it (e.g. forest/town **−1
infantry, −2 armor**), and most cover forces a moving unit to **stop on entry** and
forbids it from battling that turn ("no battle on entry", all unit types — but it may
still take ground). **Hills** block line of sight and give −1/−1, but only against an
attacker on lower ground. Forest/town/hedgerow/hills block LOS. Rivers are impassable
except at bridges; **beaches** cap a move at 2 hexes. Artillery ignores all terrain
dice reductions and line of sight entirely.

## Scenarios ([scenarios.js](scenarios.js))

- **Encounter** (default) — an open, rotationally-symmetric field. First to **5 medals**.
- **Pegasus Bridge** — British airborne rush two bridges over a canal against dug-in
  Germans; **holding a bridge hex scores a medal**. First to 5.

## Victory

First side to the scenario's medal count wins (`getResult`); wiping out the enemy army
also ends it.

## Scope

The full base-game **core rules** are implemented: the command-card order phase, strict
move-then-battle sequencing, line of sight, range/terrain dice, flags & retreats (with
ignore-first-flag terrain), Take Ground, and Armor Overrun.

Not included (these are expansions / card-specific content beyond the base combat core):
the **tactic cards** (Ambush, Air Power, Barrage, Dig In, Their Finest Hour, …) — the
deck here is the section-card core; **nation-specific command rules** (Russian Commissar,
Japanese Banzai, US Gung-Ho!, …); **Overlord/air/naval** rules; **Special Forces** unit
types (snipers, engineers, tanks-with-quirks); and the expansion **terrain catalog**
(the base-game terrain set is modeled). Objective hexes use the permanent
capture-on-enter rule; the majority/temporary variants aren't modeled.

## Run it

```sh
node demo/memoir44-demo.js                          # you (Allies) vs random AI
node demo/memoir44-demo.js --auto                   # random vs random
node demo/memoir44-demo.js --auto --scenario pegasus-bridge
node --test games/memoir44/index.test.js
```
