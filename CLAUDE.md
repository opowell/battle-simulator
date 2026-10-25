# Project conventions

This project is in alpha stages:
- All commits can go directly to the main branch (no feature branches / PRs required).
- There can be multiple agents working simultaneously on the code. Do not be surprised about other changes popping up. Start your own server on a new port to test changes.
- Because of the above, every agent must do its work in its own git worktree (e.g. via the `EnterWorktree` tool) instead of editing the shared checkout directly — including for exploratory edits like temporarily reverting a file to test something. Merge/rebase back onto main when done. This avoids races where one agent's `git stash`/revert collides with another agent's concurrent edits to the same file.

## This repo is the core, and knows no game

battle-simulator is a generic battle core: the engine (`src/engine/`), the
generic AIs (`src/agents/`), the board, time and turn machinery (`src/kit/`),
its own ruleset `BattleGame` (`src/battle/`), the server (`src/server/`) and the
Browser (`apps/browser/`). Run on its own it is the battle sandbox: Arena
(`games/arena/`), whose scenarios are battle specs, one JSON file each in
`games/arena/specs/`, edited in the Browser's **Specs**.

Every other game is a standalone app in a repo of its own, `opowell/battle-<game>`
(cloned at `/Users/op/repos/battle-<game>`), which vendors this repo as
`vendor/battle-simulator` and imports it as `#core/*`. So:

- **No game code here.** `src/gate.test.js` fails if anything under `src/` or
  `apps/` imports a game or names one in code (comments may use one as an
  example). What a game needs from the core it asks for through its game
  definition — `ui.*` flags, `uiPlugins`, the hooks in `src/kit/types.js` —
  never by the core knowing its name. A fix for one game goes in that game's repo.
- **A core change reaches a game only when the game bumps its pin**, so check a
  change to anything a game builds on (`createBattleServer`, the
  `GameDefinition` contract, the spec format, `#core/*` paths) against the games:
  check it out in a game repo's `vendor/battle-simulator` and run its
  `npm test` (golden replays included).
- **Releases are tags** (`v1.0.0`, …), and game repos pin tags, not commits. Bump
  `package.json`'s version with the tag; a major is a change a game repo must
  adapt to.
- **The library** (`library/<game>/`) is every game's units, terrain and maps as
  data, which only the sandbox mixes. A pack is rewritten from its game's repo
  (`npm run export-pack -- --out <core>/library`), through this repo's
  `scripts/export-pack.mjs` and the game's mapping in `scripts/export/<game>.mjs`.
  This repo is public, and the packs carry original game art (an open decision
  in [plans/generic-core-and-game-repos.md](plans/generic-core-and-game-repos.md)).

A battle the spec format can describe needs no code: write a spec. What the
format can't say yet belongs in `src/battle/` as a generic feature, with
reference scenarios in `games/arena/specs/` that use it and no names or art
from another game (see `src/battle/README.md`).

## The AI lives in a submodule under vendor/

`vendor/obscuro` is the **generic** Obscuro search
([opowell/obscuro-ai](https://github.com/opowell/obscuro-ai)). No game
knowledge at all. `src/agents/ObscuroAgent.js` re-exports it. The fog-chess AI
built on it, [opowell/obscuro-chess](https://github.com/opowell/obscuro-chess),
is battle-chess's, not this repo's.

Each worktree needs its own checkout of every submodule, so the repo runs
`git submodule update --init --recursive` automatically after merge, checkout
and rebase via the tracked hooks in `.githooks/` (wired up by `core.hooksPath`,
which a fresh clone must set once — see README). If a submodule directory is
ever empty, that's what didn't run:

```sh
git config core.hooksPath .githooks   # once per clone
git submodule update --init --recursive
```

Don't edit files under `vendor/` from this repo — a change to the search belongs
upstream, in a clone of that repo, with its own tests. Then:

```sh
git submodule update --remote vendor/obscuro   # pull latest upstream
git add vendor/obscuro && git commit           # pin the new commit here
```

## The Browser's UI framework is a submodule too

`vendor/appfr` is [opowell/appfr](https://github.com/opowell/appfr), the
framework `apps/browser` is built on (DataShell, WindowFrame). Its `dist/` is
committed upstream and served as-is at `/appfr/`; the Browser imports it through
an import map, with a Vue 3.5 runtime vendored in `apps/browser/vendor/`. Same
rule as the AI submodule: change appfr upstream, then bump the pin here.

appfr's releases are on its **`main`** branch; GitHub's default branch there is a
stale `master` (0.10.0), which a plain clone lands on. `.gitmodules` sets
`branch = main`, so `git submodule update --remote vendor/appfr` follows the
releases — pin a release tag (`v0.41.0`, …), and read its minors as breaking.
