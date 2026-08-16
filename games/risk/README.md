# Risk

Classic Risk board game with 42 territories, 6 continents, and card-set bonuses.

## Players

2–6 players, IDs `p1`–`p6` (default: `p1`, `p2`).

## Board

42 territories organized in 6 continents:

| Continent | Territories | Bonus armies |
|---|---|---|
| North America | 9 | 5 |
| South America | 4 | 2 |
| Europe | 7 | 5 |
| Africa | 6 | 3 |
| Asia | 12 | 7 |
| Australia | 4 | 2 |

Territories are adjacent per the classic Risk map. Controlling an entire continent grants the bonus reinforcements each turn.

## Setup

Starting armies per player count: 2p=40, 3p=35, 4p=30, 5p=25, 6p=20. Territories distributed randomly in round-robin order, then remaining armies placed randomly across owned territories.

## Phases

Each turn cycles through three phases in order:

1. **reinforce** — turn in cards (optional/mandatory) then place reinforcement armies
2. **attack** — attack adjacent enemy territories (optional; end with `end-attack`)
3. **fortify** — move armies along one connected path of owned territories (one move per turn)

Reinforce ends **itself** once the last army is placed: with no armies left and no card
set in hand, `end-reinforce` would have been the only legal action, and a button whose
every press is forced is just a step between the player and the attack phase. A player
still holding a valid set keeps both the choice and the button, since turning it in
there yields more armies to place.

Which phase is in play decides what a click does, so the UI says so: the header carries
the phase (`ui.phases`) and the action panel the sentence explaining it
(`ui.phaseHints`), with the full rules behind the "?" beside the game's name
(`ui.help`).

## Actions

| Type | Phase | Notes |
|---|---|---|
| `place-armies` | reinforce | `territoryId`, `count` — place armies on owned territory |
| `turn-in-cards` | reinforce | `cardIndices` — indices of 3 cards; must turn in if hand ≥ 5 cards |
| `end-reinforce` | reinforce | Advance to attack phase |
| `attack` | attack | `from`, `to`, `attackerDice` (1–3) — roll dice combat |
| `end-attack` | attack | Advance to fortify phase (draws a card if territory captured this turn) |
| `fortify` | fortify | `from`, `to`, `armies` — move armies between connected owned territories |
| `end-turn` | fortify | End turn; advance to next player |

## Combat

Attacker rolls up to 3 dice (max `attackers`), defender rolls 1 or 2. Highest die of each side compared in descending order; defender wins ties. Losing side removes one army per comparison. Attacker needs at least 2 armies in the source territory to attack.

**Occupying what you take** — when the last defender falls, the attacker moves in
exactly `attackerDice` armies and the rest stay home. There is no separate "how many
move in?" decision: the dice you commit are the armies you commit, which is why
`getLegalActions` offers an `attack` per dice count and lists the biggest first — a
click on the map takes that one, so a capture normally moves 3 in (fewer when the
attacking territory can't spare them). If a player should be able to choose the
occupying force independently of the dice, that needs a new post-capture action; today
the choice is the dice.

## Reinforcements

`max(3, floor(ownedTerritories / 3)) + continentBonuses`

## Card sets

The deck has 42 territory cards (one per territory, type cycling through infantry/cavalry/artillery) plus 2 wild cards. A valid set is 3 matching types, one of each type, or any set containing a wild card. Card set bonuses: 4, 6, 8, 10, 12, 15, then +5 each subsequent set.

**Territory bonus** — if a turned-in card shows a territory you own, that territory gains +2 armies.

**Hand size limit** — a player with 5+ cards who can form a valid set *must* turn one in before placing armies.

**Elimination** — when a player is eliminated, their entire card hand transfers to the attacker.

## The board

`RiskLayout.js` draws the world map: every territory is a small blob of hexes in
roughly its real place, authored as ASCII art (one 3-letter code per hex) and
parsed into the hex cells `toGrid` colours in. `RiskMap.ADJACENCY` remains the
only authority on who can attack whom — the map just has to agree with it, and
`layout.test.js` checks both directions:

- two blobs may only share a border if those territories really are adjacent, and
- the adjacent pairs that *don't* touch are exactly `SEA_ROUTES` — the water
  crossings (Alaska↔Kamchatka and friends, plus the Mediterranean), drawn as
  dashed connection lines the way the printed board draws them. Alaska↔Kamchatka
  goes around the back of the globe, so it renders as a stub off each edge.

To move a territory, edit the ASCII map and run the tests; a border you opened or
closed by accident fails there rather than silently changing the game.

Playing it is all clicks: tap one of your territories to place a reinforcement —
one army per tap, and the territory blinks once so a tap that only moves a number
by one still visibly lands — or select it and click a neighbour to attack (fortify
works the same way in the fortify phase). Every hex is an HTML element that fields
its own clicks (apps/design/HtmlHexLayer.vue draws the whole board in divs, no SVG),
so a click acts on the hex it actually landed on and the open sea between two blobs
is a miss that clears the selection rather than a tap on the nearest territory.
Only what a click can't say stays in the action panel: card sets and ending a phase.
`place-armies` with a count above 1 remains a legal action for the AI to use, but
the panel doesn't offer it — placing is what tapping is for.

## Win conditions

| Outcome | Reason |
|---|---|
| Win | `victory` — last surviving player, or all territories controlled |
| Draw | `max-turns` |

## Run

```sh
npm run demo:risk           # interactive
npm run demo:risk:auto      # random vs random
npm run demo:risk:3p        # 3-player random game
```
