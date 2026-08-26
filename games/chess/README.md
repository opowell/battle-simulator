# Chess

Standard two-player chess with full rule support — and four other games made of
the same pieces, chosen on the **Scenario** picker (see
[Scenarios](#scenarios-the-five-ways-to-play) below).

## Players

| ID | Name |
|---|---|
| `white` | White |
| `black` | Black |

## Units

| Type | Count | Notes |
|---|---|---|
| `king` | 1 | Must not be left in check |
| `queen` | 1 | |
| `rook` | 2 | Required for castling |
| `bishop` | 2 | |
| `knight` | 2 | |
| `pawn` | 8 | Promotes on back rank |

## Actions

| Type | Fields | Notes |
|---|---|---|
| `move` | `unitId`, `from`, `to`, `isCapture`, `isEnPassant`, `capturedSquare`, `payload.promote` | Standard move; `promote` is `queen\|rook\|bishop\|knight` |
| `castle` | `side`, `rookId`, `rookFrom`, `rookTo` | `side` is `kingside` or `queenside`; `rookFrom`/`rookTo` describe the rook's simultaneous move |
| `end-turn` | — | Not used; turns advance automatically |

The three non-standard scenarios replace all of that with journeys — see
[Scenarios](#scenarios-the-five-ways-to-play):

| Type | Fields | Notes |
|---|---|---|
| `order` | `unitId`, `from`, `to`, `path`, `pathId` | Continuous time: commit a piece to a destination and a route. Free — costs no clock |
| `cancel` | `unitId` | Continuous time: call a committed piece off |
| `wait` | — | Continuous time: done ordering this instant; once both sides wait, the clock runs |
| `move` | `unitId`, `from`, `to`, `path`, `pathId` | Discrete time, continuous space: one slide, resolved to a standstill |

## Special mechanics

- **Castling** — kingside and queenside; rights tracked in `gameSpecific.castlingRights`; king must not be in check and must not pass through an attacked square
- **En passant** — double-push sets `gameSpecific.enPassantTarget`; capturing pawn moves to that square and removes the double-pushed pawn from its current square (`capturedSquare`)
- **Promotion** — pawn reaching rank 8 (white) or rank 1 (black) must promote; `payload.promote` selects `queen|rook|bishop|knight`
- **Check detection** — pseudo-legal moves are filtered: any move leaving the active king in check is removed
- **50-move rule** — `gameSpecific.halfMoveClock` increments each half-move (reset on pawn move or capture); draw triggers at ≥ 100 half-moves (50 full moves)

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `checkmate` — active player has no legal moves and is in check |
| Draw | `stalemate` — active player has no legal moves and is not in check |
| Draw | `fifty-move-rule` |

## Run

```sh
npm run demo:chess           # you play White vs random AI
npm run demo:chess:auto      # random vs random
npm run demo:chess:fog       # random vs random, fog of war
npm run demo:chess:clockwork # greedy vs greedy, continuous time
npm run demo:chess:melee     # greedy vs greedy, continuous time and space
npm run demo:chess:sliding   # greedy vs greedy, sliding moves
```

Any scenario runs from the demo with `--scenario=<id>`, with or without `--auto`.

## Scenarios: the five ways to play

The Scenario picker offers one human seat against one AI in each of five games.
The first two are chess as described above. The other three take the same pieces
into another quadrant of the (space × time) plane — the axes
[games/spacetime.js](../spacetime.js) already names for every game in this repo —
and are implemented in [games/chess/spacetime.js](spacetime.js), which
`ChessGame` delegates to whenever the quadrant isn't discrete/discrete.

| Scenario | Space | Time | What a move is | AI |
|---|---|---|---|---|
| **Standard** | discrete | discrete | one move, sequential | Chess AI |
| **Fog of War** | discrete | discrete | one move, sequential; you see only what your pieces can reach | Obscuro |
| **Clockwork** | discrete | **continuous** | a destination; the piece HOPS toward it one square per cooldown | greedy |
| **Melee** | **continuous** | **continuous** | a destination; the piece SLIDES toward it, everyone at once | greedy |
| **Sliding** | **continuous** | discrete | a destination; the piece slides the whole way, then the turn passes | greedy |

The quadrant is also two ordinary game options (`space`, `time`), so any
combination can be picked on the Configure screen without using a scenario.

### What the three new quadrants have in common

A move stops being a relocation and becomes a **journey**: it has a path, a speed
(`PIECE_SPEED` — queen 5, rook/bishop 4, knight 3, king 2, pawn 1, in squares per
turn window) and a duration. That one change forces the rest:

- **Destinations are geometric.** They are every square the piece's move shape
  reaches *on an empty board*, because the board will have changed by the time it
  gets there. A rook may be aimed down a file that is currently full; a pawn may
  be aimed at its capture diagonals with nothing on them yet. The one order the
  legal list withholds is one whose *first* square is occupied by your own side —
  that isn't an order, it's a bounce.
- **A knight walks its L.** No jumping: the leap is three orthogonal single
  squares, and which of the three orders it walks them in is part of the order
  (`pathId`, shown in the log as "g1 → f3 via g2-f2"). The routes pass over
  different squares, so they run into different things.
- **No check, no checkmate, no stalemate, no castling, no en passant.** All of
  them assume a move is atomic and that the opponent must answer it. The game is
  won by **destroying the king**, as fog chess already is.
- **No fog.** Fog needs a board of squares to walk and atomic alternating moves to
  keep a belief in step with. These quadrants force `fogOfWar` off.

### Clockwork — continuous time, discrete space

Give a piece a destination and it hops there one square at a time, resting
`stepLength / speed` between hops, so a queen crosses the board five times faster
than a pawn and the two sides' moves interleave by speed rather than by turns.

- Hopping onto an **enemy** takes it, and the journey continues — a rook aimed
  down a file eats what stands in it, one hop at a time.
- Hopping onto a **friend** calls the order off. The piece stays where it is and
  still pays the cooldown, so a bounce costs the same time a hop would have.
- A piece already under way can only be **called off**, not re-aimed.

### Melee — continuous time and space

The same, but pieces are **bodies**: a disk of radius 0.4 squares sliding along
its route, drawn wherever it actually is. Two enemy disks that overlap grind each
other down at a rate set by the attacker's power (a piece's hit points and its
damage are both its classic material value), until one dies or they come apart.
Contact and death times are solved in closed form, so a fast piece can never
tunnel through a slow one between frames.

The exchange keeps chess's material ordering: a pawn that walks into a queen dies
in about 0.11 time units having taken roughly one point off her. Equal pieces
that meet destroy each other — a trade is always mutual here. A sliding piece
that touches a **friendly** body stops there and the order is called off.

### Sliding — discrete time, continuous space

Ordinary alternating turns; the difference is that a move is played out rather
than applied. Order one piece and it slides the whole way, hurting every enemy
body it passes through, and the turn does not pass until everything has come to
rest — which means a piece that ends its slide still overlapping an enemy keeps
grinding until one of them is destroyed.

### How real-time play fits a turn-based interface

The two continuous-time scenarios are real-time games driven through a turn-based
client, so the clock is explicit:

| Action | Meaning |
|---|---|
| `order` | commit a piece to a destination and a route. Free — costs no clock |
| `cancel` | call a committed piece off |
| `wait` | you are done ordering at this instant |

Both sides order into the same instant and neither sees the other's orders before
committing its own. Once both have played `wait`, the clock runs on to the next
thing that actually happens — a hop coming due, a piece arriving, a contact, a
death — and the instant reopens. Each piece gets **one decision per instant**,
which is what guarantees the clock can always move: ordering and un-ordering are
both free, so without that cap a player could fiddle for ever and time would
never pass.

## The game database (fog opening explorer)

[`fowDatabase.js`](fowDatabase.js) answers "what did recorded human players do
from here?" for the position on screen, out of a corpus of real Fog of War games
in [`vendor/`](vendor/README.md). It backs the **Fog of War games** panel, which
appears when **reviewing a finished game** and on an **analysis board** — never
beside a live match, where an opening book is an outside engine playing for you.
The server enforces that itself, so no client can ask.

The interesting part is what "from here" can mean when nobody can see the board.
Grouping recorded games by the true position would answer a question the player
to move cannot ask, and the set of games reaching a given position is itself
information about where the enemy is. So games are indexed by the **mover's
information set** — which is the whole game that seat has watched, not the board
in front of it. A pawn of mine has been blocked on d4 since move 8 and I saw what
blocked it while my bishop still watched that square: I know it is their knight
and not their bishop, and every plan I have from here rests on that.

One grouping, the **trail**: at each of that seat's turns, in order,

- the move number,
- **which squares were visible** and what stood on the occupied ones, plus own
  castling rights and an en-passant capture if one is available,
- then the move that seat played, as from/to squares.

The visible *squares* matter separately from the visible *pieces*, and a blocked
pawn is why: a pawn cannot see through what stands in front of it, so a hidden
blocker and an empty square both show "no piece" — but only one of them leaves
you a push. Encoding pieces alone would pool two positions their owner can tell
apart at a glance.

Wider groupings (current view only; own pieces only) were tried and dropped: they
buy a bigger sample of somebody else's question, from players who knew different
things, and a plausible number computed from the wrong games is worse than no
number. An exact trail turns unique within a handful of moves on a corpus this
size, and the panel says so rather than papering over it.

Results are reported from the **mover's** seat, not White's, and each row carries
the real action, so rows hover as board arrows and click into the fork sandbox.

The index is built by replaying every corpus game with these same rules, on first
use, in chunks so the server keeps answering (~9 s, ~40 MB for 3k games). It
stores the first `FOW_DB_MAX_PLY` plies (default 30): measured on that corpus the
median number of games sharing one seat's trail is ~3000 at ply 0, 17 by ply 4
and 1 from ply 8 on, so deeper plies cost memory and answer nothing.

Because the trail is a history, a query needs the plies behind the position, not
just the position: `GET /sessions/:id/database?ply=` replays the prefix once and
hands the game's query `{ legalActions, priorStates }`.

### Two ways to use it

**Reviewing a game.** Open a finished game, scrub to any ply, and the panel
answers for whoever was to move there. Pick a piece up and play something that
never happened and the board branches into a "what if" line — the panel follows
it, because `POST /sessions/:id/database { ply, line }` replays those invented
moves too. An invented move changes what the player would *know*, not just where
the pieces are, so the answer genuinely changes down the line.

**An analysis board** (engine option `analysisBoard`, or the lobby's *Analysis*
button). A study session with no opponent: you move both sides, the whole board
can be revealed while you work, moves can be taken back with **Undo**, and the
database and analysis panels stay open — none of which is a hole in the live-match
rule, because the server only honours the flag when **no seat is played by an
AI**. Fog stays on: the question the database answers only means something under
fog.

Undo is not the same as stepping back or forking. Stepping back changes what is
on screen; forking explores a line beside the game; Undo drops the move from the
game, so play continues from before it — which under fog also takes back what the
players had *seen* by then, and so changes what the database is asked.

## Where the AI is

Only the game is in this directory. The fog-of-war AI — move generation, the
Stockfish leaf evaluator, the exact belief tracker, the move prior — lives in
[github.com/opowell/obscuro-chess](https://github.com/opowell/obscuro-chess),
vendored as a submodule at
[vendor/obscuro-chess/](../../vendor/obscuro-chess/README.md); its parameters are
documented in
[vendor/obscuro-chess/docs/PARAMETERS.md](../../vendor/obscuro-chess/docs/PARAMETERS.md).
[ChessGame.js](ChessGame.js) hands that AI this engine's own definition
(`setGame`), so the search reasons with the rules, fog markers and difficulty
options the server will actually apply.

What remains here: `ChessGame.js` (rules + renderer + fog markers), `images/`,
`vendor/` (the Stockfish evaluation cache and the recorded-games corpus — both
derived/collected data, kept out of the public package), `stockfish.js` (a shim
that points the vendored engine at that cache), `fowDatabase.js` (the game
database above, which is a feature of this app rather than of the AI), and the
tests that cover this engine's side of the seam.
