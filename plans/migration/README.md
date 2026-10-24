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
| [aow](aow.md) | its own repo, wave 1 | |
| [arena](arena.md) | stays: becomes `BattleGame` | |
| [axisallies](axisallies.md) | its own repo, wave 3 | |
| [chess](chess.md) | its own repo, wave 6 | owns obscuro-chess and the Stockfish cache |
| [civ1](civ1.md) | its own repo, wave 5 | |
| [civ2](civ2.md) | its own repo, wave 5 | |
| [combatmission](combatmission.md) | its own repo, wave 2 | |
| [cs](cs.md) | its own repo, wave 2 | inherits csmini's gaps; sequential play stalls |
| [doom](doom.md) | its own repo, wave 2 | |
| [ffta](ffta.md) | its own repo, wave 4 | replaces tactical in the generic AI bench |
| [kdice](kdice.md) | its own repo, wave 3 | |
| [memoir44](memoir44.md) | its own repo, wave 1 | |
| [mudandblood](mudandblood.md) | its own repo, wave 2 | |
| [risk](risk.md) | its own repo, wave 3 | |
| [rogue](rogue.md) | open decision 4 | not registered |
| [sc1](sc1.md) | its own repo, wave 4 | shares StarCraft code with sc2 |
| [sc2](sc2.md) | its own repo, wave 4 | shares StarCraft code with sc1 |
| [simcity](simcity.md) | open decision 4 | not registered, not a battle |
| [surviv](surviv.md) | its own repo, wave 2 | |
| [warofdots](warofdots.md) | its own repo, wave 2 | |
| [xcom](xcom.md) | its own repo, wave 1 | |

tactical and csmini were dropped in phase 0, step 2. What csmini had that
nothing else does yet is recorded in [cs.md](cs.md).
