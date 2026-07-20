# Project conventions

This project is in alpha stages:
- All commits can go directly to the main branch (no feature branches / PRs required).
- There can be multiple agents working simultaneously on the code. Do not be surprised about other changes popping up. Start your own server on a new port to test changes.
- Because of the above, every agent must do its work in its own git worktree (e.g. via the `EnterWorktree` tool) instead of editing the shared checkout directly — including for exploratory edits like temporarily reverting a file to test something. Merge/rebase back onto main when done. This avoids races where one agent's `git stash`/revert collides with another agent's concurrent edits to the same file.

