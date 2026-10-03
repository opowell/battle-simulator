# SC1 map sprites

One PNG per unit type, drawn on the map by `games/starcraftSprite.js`'s
`scImageSpriteLayers` (served at `/images/sc1/map/<type>`).

Each is the in-game sprite from that unit's page on the StarCraft fandom wiki
(starcraft.fandom.com), the `image2` gallery of its `UnitBox` infobox: the
Remastered (SCR) entry where there is one, the original (SC1) entry otherwise.
They were cropped to the unit, scaled to at most 160 px, and where the wiki's file
had a background, keyed out by flood-filling from the image border.

| Type | Wiki file | Background removal |
|---|---|---|
| scv | SCV SCR Game1.png | none (transparent) |
| marine | Marine SCR Game1.png | none |
| firebat | Firebat SCR Game1.png | none |
| ghost | SCR Ghost Game1.png | none |
| vulture | Vulture SCR Game1.png | none |
| siege-tank | SCR SiegeTank Game1.png | none |
| goliath | Goliath SCR Game1.gif | none |
| wraith | Wraith SCR Game1.png | none |
| battlecruiser | (SCR in-game, hashed file name on the Battlecruiser page) | none |
| drone | (SCR in-game, hashed file name on the Drone page) | none |
| zergling | Zergling SCR Game1.gif | none |
| hydralisk | Hydralisk SCR Game1.png | none |
| mutalisk | Mutalisk SCR Game1.png | none |
| ultralisk | Ultralisk SCR Game1.gif | none |
| overlord | Overlord SCR Game1.png | none |
| dark-templar | DarkTemplar SCR GameAnim1.gif | none |
| dragoon | Dragoon SCR Game1.png | black, colour key |
| carrier | Carrier SCR Game1.jpg | terrain, colour key |
| probe | Probe SCR Game1.png | starfield, Mahalanobis key |
| corsair | Corsair SCR Game1.png | starfield, Mahalanobis key |
| arbiter | Arbiter SCR Game1.png | starfield, Mahalanobis key |
| high-templar | HighTemplar SCR Game1.png | starfield, Mahalanobis key |
| lurker | Lurker SCR Game1.jpg | dirt, Mahalanobis key (roughest of the set) |
| zealot | Zealot SCR Game1.jpg | stone, Mahalanobis key |
| scourge | Scourge SCR Game1.png | dirt, Mahalanobis key |
| archon | Archon SC1 Game1.png | black, colour key (original sprite) |

The sprites keep whatever player colour the screenshot used; the map shows the
owner with a team-coloured ring under each unit rather than by recolouring.

Fetching them needs a real browser: the wiki's image CDN answers plain HTTP
clients (curl, Node's fetch) with a Cloudflare challenge page and a 403. A
`fetch()` made from inside an open wiki page, in Chrome with an ordinary user
agent, gets the file (as WebP).
