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
