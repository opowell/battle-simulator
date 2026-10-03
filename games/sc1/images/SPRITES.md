# SC1 map sprites

Two sets of the same 55 pictures — every unit type in `units.js` and every
building in `buildings.js` — which the `spriteSet` game option chooses between
(Sc1Game.js's toGrid, drawn by `games/starcraftSprite.js`):

- `map-original/` — the 1998 in-game sprites (the default). Small originals are blown
  up by a whole factor with hard pixel edges, so they keep their pixels.
- `map-remastered/` — the 2017 StarCraft: Remastered art.

All of it comes from the StarCraft fandom wiki (starcraft.fandom.com): each type's
`SC1` / `SCR` in-game image, cropped to the unit or building, scaled to at most 160 px
(units) / 200 px (buildings), with any background keyed out:

- **flat colour key** — pixels close to the border's colour, connected to the border;
- **textured-background key** — the same, but measuring distance against the colour
  spread of the border (Mahalanobis), for starfields, creep, dirt and stone;
- **UI frame** — some originals only exist as the in-game selection panel; the sprite
  is cropped out of the panel's black.

The art keeps whatever player colour its screenshot used; the map marks the owner with
a team-coloured ring (units) or plate (buildings) instead of recolouring.

| Type | Original file | Background | Remastered file | Background |
|---|---|---|---|---|
| **Units** | | | | |
| scv | SCV SC1 Game1.png | textured-background key | SCV SCR Game1.png | none (transparent) |
| marine | Marine SC1 Game1.jpg | flat colour key | Marine SCR Game1.png | none (transparent) |
| firebat | Firebat SC1 Game1.jpg | flat colour key | Firebat SCR Game1.png | none (transparent) |
| ghost | (repo) `images/units/ghost.png` | none (transparent) | SCR Ghost Game1.png | none (transparent) |
| vulture | Vulture SC1 Game1.png | textured-background key | Vulture SCR Game1.png | none (transparent) |
| siege-tank | SC1 Siege Tank.jpg | flat colour key | SCR SiegeTank Game1.png | none (transparent) |
| goliath | Goliath SC1 Game1.jpg | flat colour key, all pieces kept | Goliath SCR Game1.png | none (transparent) |
| wraith | Wraith SC1 Game1.jpg | flat colour key | Wraith SCR Game1.png | none (transparent) |
| battlecruiser | Battlecruiser SC1 Game1.jpg | flat colour key | (hashed file name — the image2 entry on the unit page) | none (transparent) |
| drone | Drone SC1 GameAnim1.gif | flat colour key | (hashed file name — the image2 entry on the unit page) | none (transparent) |
| zergling | Zergling SC1 Game1.gif | flat colour key | Zergling SCR Game1.png | none (transparent) |
| hydralisk | Hydralisk SC1 Game1.gif | flat colour key | Hydralisk SCR Game1.png | none (transparent) |
| lurker | SC1 Lurker.gif | cropped out of the UI frame, black keyed | Lurker SCR Game1.jpg | textured-background key |
| mutalisk | Mutalisk SC1 GameAnim1.gif | flat colour key | Mutalisk SCR Game1.png | none (transparent) |
| scourge | Scourge SC1 Game1.gif | flat colour key | Scourge SCR Game1.png | textured-background key |
| ultralisk | Ultralisk SC1 Game1.gif | flat colour key | Ultralisk SCR Game1.png | none (transparent) |
| overlord | Overlord SC1 Game1.gif | flat colour key | Overlord SCR Game1.png | none (transparent) |
| probe | Probe SC1 Game1.png | flat colour key | Probe SCR Game1.png | textured-background key |
| zealot | Zealot SC1 Game1.png | flat colour key | Zealot SCR Game1.jpg | textured-background key |
| dragoon | Dragoon SC1 Game1.png | flat colour key | Dragoon SCR Game1.png | flat colour key |
| high-templar | HighTemplar SC1 Game2.png | flat colour key | HighTemplar SCR Game1.png | textured-background key |
| dark-templar | DarkTemplar SC1 GameAnim1.gif | flat colour key | DarkTemplar SCR GameAnim1.gif | none (transparent) |
| archon | Archon SC1 Game1.png | flat colour key | Archon SCR Game1.jpg | textured-background key |
| corsair | Corsair SC1 Game1.png | flat colour key | Corsair SCR Game1.png | textured-background key |
| carrier | Carrier SC1 Game1.png | flat colour key | Carrier SCR Game1.jpg | flat colour key |
| arbiter | Arbiter SC1 Game1.png | textured-background key | Arbiter SCR Game1.png | textured-background key |
| **Buildings** | | | | |
| command-center | CommandCenter SC1 Game1.png | flat colour key | CommandCenter SCR Game1.png | none (transparent) |
| supply-depot | SupplyDepot SC1 Game1.png | flat colour key | SupplyDepot SCR Game1.png | none (transparent) |
| refinery | Refinery SC1 Game1.png | flat colour key | Refinery SCR Game1.png | none (transparent) |
| barracks | Barracks SC1 Game1.png | flat colour key | — (no Remastered image on the wiki: uses the original) | |
| factory | Factory SC1 Game1.png | flat colour key | — (no Remastered image on the wiki: uses the original) | |
| starport | Starport SC1 Game1.png | flat colour key | Starport SCR Game1.png | none (transparent) |
| engineering-bay | EngineeringBay SC1 Game1.png | flat colour key | EngineeringBay SCR Game1.png | none (transparent) |
| missile-turret | MissileTurret SC1 Game1.png | textured-background key | — (no Remastered image on the wiki: uses the original) | |
| bunker | Bunker SC1 Game1.png | flat colour key | Bunker SCR Game1.png | none (transparent) |
| hatchery | Hatchery SC1 Game1.png | flat colour key | Hatchery SCR Game1.png | none (transparent) |
| lair | SC1 Lair.gif | cropped out of the UI frame, black keyed | Lair SCR Game1.gif | none (transparent) |
| hive | SC1 Hive.gif | cropped out of the UI frame, black keyed | Hive SCR Game1.gif | none (transparent) |
| extractor | SC1 Extractor.gif | cropped out of the UI frame, black keyed | Extractor SCR GameAnim1.gif | none (transparent) |
| spawning-pool | SpawningPool SC1 Game1.jpg | flat colour key | SpawningPool SCR GameAnim1.gif | none (transparent) |
| hydralisk-den | SC1 Hydralisk Den.gif | cropped out of the UI frame, black keyed | HydraliskDen SCR Game1.png | textured-background key |
| spire | Spire SC1 Game1.png | flat colour key | Spire SCR Game1.png | textured-background key |
| sunken-colony | SunkenColony SC1 GameAnim1.gif | none (transparent) | SunkenColony SCR Game1.png | textured-background key |
| spore-colony | SC1 Spore Colony.gif | cropped out of the UI frame, black keyed | SporeColony SCR GameAnim1.gif | none (transparent) |
| ultralisk-cavern | SC1 Ultralisk Cavern.gif | cropped out of the UI frame, black keyed | UltraliskCavern SCR Game1.png | textured-background key |
| nexus | Nexus SC1 Game1.png | flat colour key | Nexus SCR Game1.jpg | textured-background key |
| pylon | Pylon SC1 Game1.png | flat colour key | Pylon SCR Game1.png | none (transparent) |
| assimilator | SC1 Assimilator.gif | cropped out of the UI frame, black keyed | Assimilator SCR Game1.png | textured-background key |
| gateway | Gateway SC1 Game1.png | flat colour key | Gateway SCR Game1.png | textured-background key |
| cybernetics-core | CyberneticsCore SC1 Game1.png | flat colour key | CyberneticsCore SCR Game1.png | textured-background key |
| forge | Forge SC1 Game1.png | flat colour key | Forge SCR Game1.png | textured-background key |
| photon-cannon | PhotonCannon SC1 Game1.png | flat colour key | PhotonCannon SCR Game1.png | textured-background key |
| templar-archives | SC1 Templar Archives.gif | cropped out of the UI frame, black keyed | TemplarArchive SCR Game1.png | textured-background key |
| stargate | Stargate SC1 Game1.png | flat colour key | Stargate SCR Game1.png | textured-background key |
| robotics-facility | SC1 Robotics Facility.gif | cropped out of the UI frame, black keyed | — (no Remastered image on the wiki: uses the original) | |

Notes:
- The wiki's "original" arbiter (`Arbiter SC1 Game1.png`) is in fact Remastered-style
  art; there is no other original arbiter image there.
- The wiki's only original ghost is a noisy screenshot, so the original set uses the
  repo's own original ghost sprite (the side-panel portrait) instead.

Fetching needs a real browser: the wiki's image CDN answers plain HTTP clients with a
Cloudflare challenge page and a 403. A `fetch()` from inside an open wiki page, in
headless Chrome with an ordinary user agent, gets the file (as WebP). The file names
come from the MediaWiki API (`list=allimages`, a unit page's `UnitBox` `image2`
gallery), which plain HTTP can read.
