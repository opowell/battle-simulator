# civ1 unit icons

One PNG per unit type in [`units.js`](../../units.js), named exactly after the
key — `Civ1Game.js` resolves a sprite as `` `${BASE}/units/${u.type}` `` with no
lookup table in between. Add a unit to `units.js` and you must drop a same-named
PNG in here.

## Conventions

A 15×15 canvas (a few of the originals are 16×16), drawn from a 13-colour
palette. Three frames are in use:

| frame | example | shape |
| --- | --- | --- |
| land | `militia` | full bevelled square — white edge left/bottom, dark-green edge top/right, brown ground row at y13 |
| air  | `fighter` | green ellipse, unit seen from above |
| sea  | `ironclad` | green band over a cyan/blue waterline, transparent above and below |

**The green is not decoration.** `apps/design/teamSprite.js` re-hues every
strongly-green pixel to the owning player's colour at render time (civ1 sets
`ui.recolorTeamSprites`), so the green field *is* the team flag. A sprite drawn
without one renders identically for both players.

These are the 28 icons of the original 1991 roster, one per unit — the roster is
the original's and nothing else (see `units.js`).

`combat_1`–`combat_8` are the original explosion animation frames, kept as
source art; they are not units.
