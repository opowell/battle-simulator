# Project conventions

This project is in alpha stages:
- All commits can go directly to the main branch (no feature branches / PRs required).
- There can be multiple agents working simultaneously on the code. Do not be surprised about other changes popping up. Start your own server on a new port to test changes.
- Because of the above, every agent must do its work in its own git worktree (e.g. via the `EnterWorktree` tool) instead of editing the shared checkout directly — including for exploratory edits like temporarily reverting a file to test something. Merge/rebase back onto main when done. This avoids races where one agent's `git stash`/revert collides with another agent's concurrent edits to the same file.

## The AI lives in submodules under vendor/

Two separate repositories are vendored here, and the second contains the first:

- `vendor/obscuro` — the **generic** Obscuro search
  ([opowell/obscuro-ai](https://github.com/opowell/obscuro-ai)). No game
  knowledge at all. `agents/ObscuroAgent.js` re-exports it.
- `vendor/obscuro-chess` — the **fog-chess AI**
  ([opowell/obscuro-chess](https://github.com/opowell/obscuro-chess)): board and
  move generation, the Stockfish leaf evaluator (engine binaries included), the
  exact belief tracker P, the fitted move prior. It carries its own
  `vendor/obscuro` checkout, and that inner one is the search the chess AI
  actually runs on.

Each worktree needs its own checkout of both, so the repo runs `git submodule
update --init --recursive` automatically after merge, checkout and rebase via the
tracked hooks in `.githooks/` (wired up by `core.hooksPath`, which a fresh clone
must set once — see README). If either directory is ever empty, that's what
didn't run:

```sh
git config core.hooksPath .githooks   # once per clone
git submodule update --init --recursive
```

Don't edit files under `vendor/` from this repo — a change to the search or to
the chess AI belongs upstream, in a clone of that repo, with its own tests. Then:

```sh
git submodule update --remote vendor/obscuro-chess   # pull latest upstream
git add vendor/obscuro-chess && git commit           # pin the new commit here
```

When bumping, keep the two `obscuro-ai` pins in step: the top-level
`vendor/obscuro` and `vendor/obscuro-chess/vendor/obscuro` are two checkouts of
the same repo, and a chess bug can hide in a version skew between them.

The dividing line: anything game-agnostic (the search, the difficulty dial,
belief handling) is in obscuro-ai. Anything that knows about **chess** — the
Stockfish evaluator, the belief trackers, the move prior — is in obscuro-chess.
What stays here is this engine's own game definitions: `games/chess/ChessGame.js`
(rules + renderer + fog markers + difficulty menu, handed to the vendored agent
via `setGame`), and the civ1 and CS subclasses.

The chess Stockfish evaluation cache (`games/chess/vendor/sf-cache.*`, ~50 MB of
derived data) deliberately stayed here rather than going into a public package;
`games/chess/stockfish.js` is the shim that points the vendored engine at it.

