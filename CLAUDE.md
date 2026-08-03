# Project conventions

This project is in alpha stages:
- All commits can go directly to the main branch (no feature branches / PRs required).
- There can be multiple agents working simultaneously on the code. Do not be surprised about other changes popping up. Start your own server on a new port to test changes.
- Because of the above, every agent must do its work in its own git worktree (e.g. via the `EnterWorktree` tool) instead of editing the shared checkout directly — including for exploratory edits like temporarily reverting a file to test something. Merge/rebase back onto main when done. This avoids races where one agent's `git stash`/revert collides with another agent's concurrent edits to the same file.

## vendor/obscuro is a submodule

The generic Obscuro AI is a separate repository
([opowell/obscuro-ai](https://github.com/opowell/obscuro-ai)) vendored at
`vendor/obscuro`. Don't edit files under it from this repo — a change to the
search belongs upstream, in a clone of that repo, with its own tests. Then:

```sh
git submodule update --remote vendor/obscuro   # pull latest upstream
git add vendor/obscuro && git commit           # pin the new commit here
```

The dividing line: anything game-agnostic (the search, the difficulty dial,
belief handling) is upstream. Anything that knows about a specific game — the
fog-chess Stockfish evaluator and belief trackers in `games/chess/`, the civ1 and
CS subclasses — stays here.

