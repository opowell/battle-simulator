# cs: capability checklist

What `cs` (CS) can do on 2026-10-24, before it moves to a repo of its own
(plans/generic-core-and-game-repos.md, phase 0 step 3). Phase 3 step 5 checks the
extracted game against it: its tests, its golden replays (`games/cs/golden.json`),
and every box below in the real UI. Generated from the game definition, its
README, its tests and its `toGrid`, then annotated by hand under **Notes**.

## Registry

- [ ] Seats 2–10; default table: `ct` (CT), `t` (T)
- [ ] Game module: `games/cs/index.js`, export `CsGame`
- [ ] Engine defaults it declares (`defaultConfig`): `{"simultaneousTurns":true}`

## Setup options

| | Option | Type | Default | Values |
|---|---|---|---|---|
| [ ] | `mapZoom` Zoom & pan controls | boolean | `true` |  |
| [ ] | `fogOfWar` Fog of War | boolean | `true` |  |
| [ ] | `showAnalysisPanel` Analysis Panel | boolean | `true` |  |

## Scenarios

| | Scenario | Name | Config |
|---|---|---|---|
| [ ] | `de_dust2` | Dust II | `{"mapId":"de_dust2"}` |
| [ ] | `dust2` | Dust II (classic) | `{"mapId":"dust2"}` |
| [ ] | `de_dust` | de_dust | `{"mapId":"de_dust"}` |
| [ ] | `cs_siege` | cs_siege | `{"mapId":"cs_siege"}` |
| [ ] | `cs_italy` | cs_italy | `{"mapId":"cs_italy"}` |
| [ ] | `de_forge` | de_forge | `{"mapId":"de_forge"}` |
| [ ] | `de_pond` | de_pond | `{"mapId":"de_pond"}` |
| [ ] | `de_plaza` | de_plaza | `{"mapId":"de_plaza"}` |

## Modes

- [ ] Space: continuous (native)
- [ ] Time: discrete (native)
- [ ] Turns: sequential and we-go offered (the engine's switch), default we-go. Random play, 30 steps from the default setup:
  sequential 30 plies in 30 steps, turn 1; we-go 1331 plies in 30 steps, turn 31
- [ ] Fog: switchable, default on; `getVisibleState`, belief sampling (`sampleWorlds`)

## AIs

- [ ] `obscuro` AI (Obscuro/CFR) (backs the analysis panel)
- [ ] Built in for every game: random, greedy (on its own `evaluateState`), obscuro, generic

## Engine hooks it implements

`getVisibleState`, `sampleWorlds`, `evaluateState`, `actionKey`, `applyStartingUnits`, `createSetupUnit`, `foreignUnits`, `beginTurn`, `isTurnEnder`, `getActionDuration`, `isActionLegal`, `getSearchActions`, `toGrid`

## UI

- [ ] `ui` flags: `aimedActionTypes`, `fovDegrees`, `hideGridLines`, `visionRange`
- [ ] `toGrid` fields: `cells`, `height`, `locationType`, `los`, `shapes`, `ui`, `units`, `width`
- UI plugins, moved out of the play UI in phase 1 (`uiPlugins`, `games/cs/ui/`):
  - [ ] `ui/sound.js` (slot `sound`): weapon, step, bomb, grenade and death sounds, on `onEntry` as the board plays a turn
  - [ ] `ui.actionLabels` (Done Buying, Crouch, Stand Up)

## Demos and benches

- [ ] `demo/cs-demo.js`
- [ ] `npm run demo:cs` (`node demo/cs-demo.js`)
- [ ] `npm run demo:cs:auto` (`node demo/cs-demo.js --auto`)

## Tests

- [ ] `fog.test.js`: 10 tests
- [ ] `golden.test.js`: 10 golden replays (default, scenario:de_dust2, scenario:dust2, scenario:de_dust, scenario:cs_siege, scenario:cs_italy, scenario:de_forge, scenario:de_pond, scenario:de_plaza, fog-off)
- [ ] `index.test.js`: 36 tests
- [ ] `obscuro.test.js`: 18 tests
- [ ] The core's checks of it, in its `contract.test.js` since phase 1 (roster editing; the greedy and, with `SLOW_TESTS=1`, rollout agents where it has them), and its pack in `library/` (`src/library.test.js`)

## README

What [its README](../../games/cs/README.md) documents, each still true after the move:

- [ ] Players
- [ ] Units
- [ ] Weapons
- [ ] Pistols
- [ ] SMGs
- [ ] Shotguns
- [ ] Heavy
- [ ] Rifles
- [ ] Snipers
- [ ] Grenades
- [ ] Equipment
- [ ] Actions
- [ ] Special mechanics
- [ ] Map layout
- [ ] Win conditions per round
- [ ] Run

## Art and other assets

- [ ] `images/`: 52 files, 4.0 MB
- [ ] `sounds/`: 12 files, 1.3 MB

## What it uses from outside its folder

Since phase 1 each is a `#core/…` import (or moved into the game).

- `src/agents/learned/leafEval.js`
- `src/agents/ObscuroAgent.js`
- `src/engine/foreignUnits.js`
- `src/kit/continuousMove.js`
- `src/kit/coord.js` (4 imports)
- `src/kit/renderOptions.js`
- `src/kit/terrainShapes.js` (2 imports)
- `src/kit/vision.js` (3 imports)
- `vendor/obscuro/src/search.js`

## Notes

### Sequential play stalls (found 2026-10-24)

cs defaults to we-go, but the engine's sequential switch is offered for it too,
and there it does not work: Greedy against Greedy, sequential, never got past
turn 1 (the engine's step limit stopped it at 12,000 plies), where the same
match we-go finishes 8–0 in 125 turns. Probably the zero-cost-action trap the
cs Obscuro AI hit (an action that costs no budget can be chosen forever). The
generic AI bench therefore plays cs we-go only. Decide before extraction
whether sequential cs is a capability to keep (then fix it) or one to remove
from its setup form.

### Inherited from csmini (dropped 2026-10-24)

csmini was dropped in phase 0 because cs has everything it had and more. Its
modes were checked against cs and Arena before it went:

| csmini mode | Counterpart | Facing, vision cones, reloading? |
|---|---|---|
| discrete space, discrete time, sequential and we-go | Arena | no |
| discrete space, continuous time, sequential and we-go | Arena | no |
| continuous space, discrete time, sequential and we-go | **cs** (sequential stalls with AI seats, see above) | yes |
| continuous space, continuous time, sequential and we-go | Arena | no |

Every mode has a counterpart, but only one quadrant still has csmini's
mechanics in it. **Missing:** facing, a 90° vision cone, an explicit `rotate`
and a one-round gun with a `reload`, in discrete space or in continuous time.
cs runs only in continuous space and discrete time, and Arena has no facing.
Phase 2 restores them in the core: orientation (step 2), an `ammo` pool with a
reload (steps 3 and 4), and the close-quarters reference scenario (step 8),
which also takes over csmini's job as the generic AI's measured weak spot.

Also from csmini, kept but now without a game that uses them:

- `uiDefaults.config` (gameDefaults.js `initGameOpts`): csmini used it to start
  its setup form with observers and simultaneous turns on. No other game sets it.
- `replayPaceMultiplier` above 1 (csmini's was 2, to slow its watch-pace down).
  civ1 still uses the hook, below 1.
- A grid board with a positioned unit channel (`field.positioned` on a square
  grid, in both discrete and continuous space). Arena now carries this.
