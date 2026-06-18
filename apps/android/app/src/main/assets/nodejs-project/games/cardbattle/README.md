# Card Battle

Simultaneous card-based combat. Both players act every step.

## Players

| ID | Name |
|---|---|
| `p1` | Player 1 |
| `p2` | Player 2 |

## Units

Each side has one hero unit:

| Stat | Value |
|---|---|
| HP | 30 |
| Max HP | 30 |

## Cards

| Card | Effect |
|---|---|
| `attack` | Deal 8 damage |
| `heavy-attack` | Deal 14 damage; player skips their next turn |
| `block` | Halve all incoming damage this turn |
| `heal` | Restore 6 HP (capped at max HP) |

Starting deck per player (9 cards): 3×`attack`, 2×`heavy-attack`, 2×`block`, 2×`heal`

- Hand size: 4 cards; replacement cards are drawn immediately after each play
- Deck reshuffles from the original 9-card composition when exhausted (not from a discard pile)
- Actions resolved simultaneously — both players' cards apply at the same time

## Actions

| Type | Payload fields | Notes |
|---|---|---|
| `play-card` | `card`, `handIndex` | Play the card at the given hand index |
| `play-card` | `card: 'pass'`, `handIndex: -1` | Forced pass during skip penalty — no card consumed |

## Special mechanics

- **Simultaneous resolution** — both players are always in `activePlayers`; `applyActions` handles both at once
- **Skip penalty** — playing `heavy-attack` sets a `skipping` flag; next turn the engine auto-issues a `pass` play (no card consumed, skip clears)
- **Block timing** — `block` is checked against the opponent's action in the same step; halves damage dealt to the blocking hero

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `last-hero-standing` — opponent's hero reaches 0 HP |
| Draw | `both-heroes-died` — both heroes reach 0 HP in the same step |

## Run

```sh
npm run demo:cardbattle        # interactive
npm run demo:cardbattle:auto   # random vs random
```
