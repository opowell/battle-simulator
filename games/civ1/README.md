# Civilization I

Turn-based 4X strategy on a tile map. Build cities, produce units, and conquer your opponent.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

(3 and 4 player games are supported too. `barbarian` is **not** in this table and never
is — see [Barbarians](#barbarians).)

## Units

All units have `firepower: 1` (damage per combat hit). Combat continues round-by-round until one side reaches 0 HP.

### Terrain Improvement & Diplomacy

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `settlers` | 0 | 1 | 1 | 20 | 40 | `found-city`, `build-road`, `irrigate`, `mine` |
| `diplomat` | 0 | 0 | 2 | 10 | 30 | `diplomacy`, `bribe`, `sabotage` |

### Ancient Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `militia` | 1 | 1 | 1 | 10 | 10 | |
| `phalanx` | 1 | 2 | 1 | 10 | 20 | |
| `archers` | 3 | 2 | 1 | 10 | 30 | |
| `legion` | 3 | 3 | 1 | 10 | 30 | |
| `catapult` | 6 | 1 | 1 | 10 | 60 | `bombard` |
| `cavalry` | 2 | 1 | 2 | 10 | 20 | `mounted` |
| `chariot` | 4 | 1 | 2 | 10 | 40 | `mounted` |

### Medieval Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `knights` | 5 | 2 | 2 | 10 | 40 | `mounted` |
| `crusaders` | 5 | 1 | 2 | 10 | 40 | `mounted` |

### Renaissance & Industrial Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `musketeers` | 2 | 3 | 1 | 20 | 30 | |
| `cannon` | 8 | 5 | 1 | 20 | 40 | `bombard` |
| `riflemen` | 3 | 5 | 1 | 20 | 30 | |
| `cav-modern` | 8 | 3 | 2 | 20 | 60 | `mounted` |
| `artillery` | 12 | 2 | 2 | 20 | 60 | `bombard` |

### Modern Land

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `infantry` | 5 | 6 | 1 | 20 | 30 | |
| `armor` | 10 | 5 | 3 | 30 | 80 | |
| `mech-inf` | 6 | 6 | 3 | 30 | 50 | |
| `paratroopers` | 6 | 4 | 1 | 20 | 60 | `paradrop` |
| `marines` | 8 | 5 | 1 | 20 | 60 | `amphibious` |

### Missile & Air

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `nuclear` | 99 | 0 | 16 | 10 | 160 | `nuclear` — needs the Manhattan Project; detonates over its target |
| `fighter` | 4 | 2 | 10 | 20 | 60 | `intercept` |
| `bomber` | 12 | 1 | 8 | 20 | 120 | `strategic-bomb` |
| `helicopter` | 6 | 3 | 6 | 20 | 60 | `hover` |

### Sea

| Type | ATK | DEF | Move | HP | Cost | Specials |
|---|---|---|---|---|---|---|
| `trireme` | 1 | 1 | 3 | 10 | 40 | `coastal-only`, `transport-2` |
| `sail` | 1 | 1 | 3 | 10 | 40 | `transport-3` |
| `frigate` | 2 | 2 | 3 | 10 | 40 | `bombard` |
| `ironclad` | 4 | 4 | 4 | 20 | 60 | |
| `destroyer` | 4 | 4 | 6 | 20 | 60 | |
| `submarine` | 8 | 2 | 3 | 20 | 50 | `stealth` |
| `transport` | 0 | 3 | 4 | 20 | 50 | `transport-8` |
| `cruiser` | 6 | 6 | 6 | 20 | 80 | `bombard` |
| `battleship` | 18 | 17 | 4 | 40 | 160 | `bombard` |
| `carrier` | 1 | 12 | 5 | 40 | 160 | `carries-air-8` |

## Terrain

| Type | Move cost | Defense bonus |
|---|---|---|
| `grassland` | 1 | 0% |
| `plains` | 1 | 0% |
| `desert` | 2 | 0% |
| `tundra` | 2 | 0% |
| `hills` | 2 | +50% |
| `mountains` | 3 | +100% |
| `forest` | 2 | +50% |
| `jungle` | 3 | +50% |
| `swamp` | 3 | 0% |
| `ocean` | 1 (sea only) | 0% |

Roads halve movement cost on the tile.

Roads add trade on desert/plains/grassland; irrigation adds +1 food; mines add shields on hills/mountains.

## Actions

| Type | Notes |
|---|---|
| `move` | Move unit up to its movement range |
| `attack` | Attack adjacent enemy unit; combat is probabilistic |
| `found-city` | Settler founds a city at current position (first city gets the Palace) |
| `build-road` / `irrigate` / `build-mine` / `clear-terrain` | Settler terrain improvements |
| `set-production` | Set a city to build a unit, improvement, or wonder (tech-gated) |
| `set-research` | Choose the advance to research next |
| `set-tax` | Set the tax/science split (rest of trade goes to science) |
| `change-government` | Start a revolution toward a new government (2-turn Anarchy) |
| `launch-spaceship` | Launch a spaceship that has the minimum parts toward Alpha Centauri |
| `skip-unit` | Pass for this unit |
| `end-turn` | Run the economy, then end the player's turn |

## Economy & growth systems

Data lives in `tech.js`, `improvements.js`, `governments.js`; the per-turn maths in
`city.js` (single city) and `economy.js` (whole civilization).

- **Population** — a city works its centre plus one tile per citizen from the 21-square "fat cross". Food feeds citizens (2 each); surplus fills a box of `(size+1)×10`, and filling it grows the city (a Granary keeps half; growth past size 8 needs an Aqueduct). A food deficit starves a citizen.
- **Trade** — split into tax (gold), luxuries, and science by the government's rates, after corruption (worse far from the capital). Marketplace/Bank boost tax & luxury; Library/University and the science wonders boost science.
- **Technology** — the full 68-advance tree with prerequisites; accumulated science buys the current research target, whose cost rises with advances known.
- **City improvements** — 21 buildings (Temple → Mfg. Plant) plus 22 Wonders of the World, each gated by an advance and (for buildings) a gold upkeep. Wonders are one per world with civ-wide or one-shot effects. A city that finishes one is pointed back at Militia rather than left aimed at what it just built — the same list that makes a finished improvement unbuildable does not reach into `production`, so a city left alone would otherwise build a second Temple, and a ninth, each charging its own upkeep.
- **Happiness** — citizens beyond a baseline turn unhappy; temples, colosseums, cathedrals, luxuries, martial law and wonders pacify them. If unhappy outnumber happy the city falls into **civil disorder** and produces nothing.
- **Governments** — Despotism → Monarchy / Communism / Republic / Democracy, each with its own tax cap, corruption, trade bonus, and martial-law/unhappiness rules. Despotism/Anarchy dock 1 from any tile yielding 3+ (the Pyramids cancel this).
- **Combat** — round-by-round; attacker wins each round with `P = ATK / (ATK + DEF × terrainBonus)`; loser takes 1 HP per round; fight ends at 0 HP. Defending a city gives +50% DEF; City Walls / Great Wall add more.
- **Nuclear weapons** — once the Manhattan Project exists, any civ can build the Nuclear missile. A strike wipes out every unit on the target tile and the eight around it and halves the target city; SDI Defense in the blast intercepts it. The missile is single-use.
- **Space race** — after the Apollo Program is built, cities produce spaceship parts (Structural / Component / Module) that accumulate on the civ's ship. With the minimum parts it can be launched; it reaches Alpha Centauri after a travel time (shorter with more parts) and its owner wins on arrival — unless the capital is lost first, which destroys the ship.
- **Fog of war** — vision radius 2; `getVisibleState` hides unseen tiles and enemy units.
- **Barbarians** — periodic uprisings that raid the world's cities. See below.

## Barbarians

The **Barbarian activity** option is the original's setup-screen menu — Villages only,
Roving bands, Restless tribes, Raging hordes. It is **off by default** (Villages only):
the original means "out of tribal huts and nowhere else" by that setting, and this
engine has no huts, so it raises nobody. Leaving it off by default also keeps the agent
measurements, which replay civ1 with nothing but the two seats, reading what they always
have. See `barbarians.js`.

Barbarians are **not a civilization**. They hold no seat, no agent is ever asked for
their orders, they research nothing, build nothing and own no treasury, and `getResult`
never counts them among the surviving civs — a world where only barbarians are left
standing is still a world where the last real civ won. They exist purely as units owned
by `barbarian`, which every `ownerId !== playerId` test already treats as hostile to
everyone: they have no allies.

Each level sets when the first uprising comes, how often they come after that, how many
raiders rise up, and a cap on how many can be alive at once. A band appears 2–4 squares
from one of the world's cities (bigger cities are likelier targets, so raids land on
whoever is doing well) armed with the best unit the civ it is raiding could field. On
each new turn every raider takes a move: it attacks what is adjacent, walks into a city
left undefended, and otherwise marches at the nearest one. Cities they take are held —
they can be taken back.

The turn numbers are calibrated to this engine's clock, not the original's: a civ here
is still one small city at turn 20, so uprisings start at turn 28 even at the most
violent setting. (Measured: a band of 4 arriving at turn 20 ended every greedy-vs-greedy
game within two turns.)

Raiders and the cities they hold are drawn in the faction's own violet. Picking that
colour is constrained, not decorative: civ1 sets `ui.recolorTeamSprites`, so a team
colour reaches a unit sprite through `apps/design/teamSprite.js`, which repaints the
sprite's green-ramp flag with the colour's **hue and saturation only** and clamps
saturation up to 0.75. A near-grey therefore can't be used (it comes out as a vivid
version of whatever hue its tiny channel imbalance happens to have), and factions are
told apart by hue alone. See the note on `BARBARIAN_TEAM` in `barbarians.js`.

## Difficulty (game modes)

The **Difficulty** option is a preset — Chieftain, Warlord, Prince (default), King,
Emperor, Deity — applied **equally to every civilization**. It sets how many citizens
in a city stay content before the rest turn unhappy (`contentBaseline`): 6 on Chieftain
down to 1 on Deity, so higher levels tip cities into civil disorder far sooner. The
baseline can be overridden directly with the "Content citizens" option (blank = use the
preset). See `difficulty.js`.

Difficulty **never buffs the AI** — it changes the world rules symmetrically for both
sides. The AI's strength comes only from how much it is allowed to think (the separate
AI-difficulty option); it is given no privileged information. In fogged games
`getVisibleState` even redacts each rival's private ledger (advances, treasury,
research, spaceship) so an agent choosing a move cannot read it.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `civilization-destroyed` — all opponent cities and units destroyed |
| Win | `space-race` — your spaceship reaches Alpha Centauri |
| Draw | `max-turns` |

## Scenarios

**Standard** generates a random world at whatever size the options ask for, and each
hand-built fixed map (`fixedMaps.js`) is a scenario of its own.

**AI Exhibition** is not a game you play — it seats Obscuro against the greedy baseline
on a 30×20 world and leaves you no seat at all, which is what puts the session into the
server's observer lock-step: one turn is computed, played back to you, and only then is
the next one computed, so a match that would otherwise finish in a couple of minutes
unfolds at watching speed. It starts paused; Resume plays it out, and "pause after
playback" (on by default) stops it after every turn until you click Next. Fog stays on,
so the perspective switcher is meaningful — watch the whole world, or drop into either
civ's own fogged view and see what it is actually deciding from. Civ1 hides the right
sidebar, so that switcher is in the menu (the grid button beside the turn counter).

Because there is no seat to give orders from, the left panel drops its order controls
and keeps only the overview screens — Cities, Military, Rates, Science, which report on
whichever civ you are watching through (Everyone falls back to the first seat).

Seat 1 has a real advantage here (see `AI-DESIGN.md`), so a single exhibition run
shows you how the AIs play; it does not measure which is better.

## Run

```sh
npm run demo:civ1           # interactive
npm run demo:civ1:auto      # random vs random
npm run demo:civ1:greedy    # greedy AI vs random
npm run demo:civ1:obscuro   # Obscuro vs greedy, headless (the AI Exhibition matchup)
```
