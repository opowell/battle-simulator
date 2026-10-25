# Capability checklists

One file per game: what it can do now, so that "migrated with its current
capabilities" can be checked rather than argued (phase 0, step 3 of
[the plan](../generic-core-and-game-repos.md)). Each is checked in phase 3,
step 5, when the game leaves for its own repo.

Every checklist has the same sections: registry, setup options, scenarios,
modes (space, time, turns, fog), AIs, engine hooks, UI (`ui` flags, `toGrid`
fields, and the play-UI plugins to move out with it), demos and benches,
tests, what its README documents, its art, and what it imports from outside
its folder. Those were generated from the game definitions, the READMEs, the
tests and `toGrid` on 2026-10-24. **Notes** at the end of each is written by
hand: findings, and what the generated part can't see.

Alongside the checklists, each game's **golden replays**
(`games/<game>/golden.json`, see `engine/golden.js`) pin down its rules: a
moved game must reproduce them exactly. Re-record a game's goldens only for a
change that is meant to alter what it does: `node scripts/golden.mjs <game>`.

| Game | Leaves for | Notes |
|---|---|---|
| [aow](aow.md) | [opowell/battle-aow](https://github.com/opowell/battle-aow) | |
| [arena](arena.md) | stays: becomes `BattleGame` | |
| [axisallies](axisallies.md) | [opowell/battle-axisallies](https://github.com/opowell/battle-axisallies) | |
| [chess](chess.md) | its own repo, wave 6 | owns obscuro-chess and the Stockfish cache |
| [civ1](civ1.md) | [opowell/battle-civ1](https://github.com/opowell/battle-civ1) | |
| [civ2](civ2.md) | [opowell/battle-civ2](https://github.com/opowell/battle-civ2) | |
| [combatmission](combatmission.md) | its own repo, wave 2 | |
| [cs](cs.md) | its own repo, wave 2 | inherits csmini's gaps; sequential play stalls |
| [doom](doom.md) | its own repo, wave 2 | |
| [ffta](ffta.md) | [opowell/battle-ffta](https://github.com/opowell/battle-ffta) | replaces tactical in the generic AI bench |
| [kdice](kdice.md) | [opowell/battle-kdice](https://github.com/opowell/battle-kdice) | |
| [memoir44](memoir44.md) | [opowell/battle-memoir44](https://github.com/opowell/battle-memoir44) | |
| [mudandblood](mudandblood.md) | [opowell/battle-mudandblood](https://github.com/opowell/battle-mudandblood) | |
| [risk](risk.md) | [opowell/battle-risk](https://github.com/opowell/battle-risk) | |
| [rogue](rogue.md) | [opowell/battle-rogue](https://github.com/opowell/battle-rogue) | not registered |
| [sc1](sc1.md) | [opowell/battle-sc1](https://github.com/opowell/battle-sc1) | shares StarCraft code with sc2 |
| [sc2](sc2.md) | [opowell/battle-sc2](https://github.com/opowell/battle-sc2) | shares StarCraft code with sc1 |
| [simcity](simcity.md) | [opowell/battle-simcity](https://github.com/opowell/battle-simcity) | not registered, not a battle |
| [surviv](surviv.md) | its own repo, wave 2 | |
| [warofdots](warofdots.md) | [opowell/battle-warofdots](https://github.com/opowell/battle-warofdots) | |
| [xcom](xcom.md) | [opowell/battle-xcom](https://github.com/opowell/battle-xcom) | |

tactical and csmini were dropped in phase 0, step 2. What csmini had that
nothing else does yet is recorded in [cs.md](cs.md).
