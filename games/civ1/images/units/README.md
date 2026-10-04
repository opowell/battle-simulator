# civ1 unit icons

One PNG per unit type in [`units.js`](../../units.js), named exactly after the
key — `Civ1Game.js` resolves a sprite as `` `${BASE}/units/${u.type}` `` with no
lookup table in between. Add a unit to `units.js` and you must drop a same-named
PNG in here.

## Conventions

A 15×15 canvas, drawn from a 13-colour palette — every icon, with no exceptions:
a fortified unit has the original's wall (`../map/fortify.png`, also 15×15) painted
over its icon at the same scale, and the two only line up pixel for pixel on a shared
canvas (`units.test.js` holds this). The original sheet's cells are 16×16, but their
16th column and row are the sheet's cyan grid line, not art — crop it off when adding
an icon. Three frames are in use:

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

`combat_1`–`combat_8` are the original explosion animation frames (SP257.PIC), not
units: the board plays them over the loser of a fight (`ui.battleAnimation`).
