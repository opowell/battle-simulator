# Chess

Standard two-player chess with full rule support.

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
npm run demo:chess          # you play White vs random AI
npm run demo:chess:auto     # random vs random
```

## The game database (fog opening explorer)

[`fowDatabase.js`](fowDatabase.js) answers "what did recorded human players do
from here?" for the position on screen, out of a corpus of real Fog of War games
in [`vendor/`](vendor/README.md). It backs the **Fog of War games** panel, which
appears **only when reviewing a finished game** — an opening book open beside a
live game is an outside engine playing for you (the server refuses a live session
outright: `GET /sessions/:id/database?ply=`).

The interesting part is what "from here" can mean when nobody can see the board.
Grouping recorded games by the true position would answer a question the player
to move cannot ask, and the set of games reaching a given position is itself
information about where the enemy is. So games are indexed by the **mover's
information set** — which is the whole game they have watched, not the board in
front of them. A pawn of mine has been blocked on d4 since move 8 and I saw what
blocked it while my bishop still watched that square: I know it is their knight
and not their bishop, and every plan I have from here rests on that. The move
number is known to the player too, so it keys as well.

Three levels, finest first. Level 0 is the information set itself; the other two
are coarsenings of it, never refinements, so no level can see anything the mover
cannot:

| Level | Groups games by |
|---|---|
| `trail` | every view this seat has had this game, in order, and the moves they played between them — remembering sightings the fog has since swallowed |
| `view` | the current view alone, at the same move number: own pieces + the enemy pieces in sight + own castling rights + an available en-passant capture — exactly the board the app draws for that seat |
| `own` | own pieces alone, at the same move number, whatever the fog was hiding |

The coarser levels exist because an exact trail runs out of games fast; widening
is the honest way to have a sample at all, with the cost visible in the panel.
Results are reported from the **mover's** seat, not White's. `own` can list a
move that is not legal here (a capture of a piece that is not there in this
game); those rows are marked unplayable rather than hidden, because a fog player
always knows their own legal moves.

The index is built by replaying every corpus game with these same rules, on first
use, in chunks so the server keeps answering (~10 s, ~155 MB for 3k games). It
stores the first `FOW_DB_MAX_PLY` plies (default 30): measured on that corpus the
median number of games sharing one seat's trail is ~3000 at ply 0, ~28 by ply 4
and exactly 1 from ply 8 on (the view level runs a ply or two longer, own pieces
a few more), so deeper plies cost memory and answer nothing.

Because the trail is a history, a query needs the plies behind the position, not
just the position: `GET /sessions/:id/database?ply=` replays the prefix once and
hands the game's query `{ legalActions, priorStates }`.

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
