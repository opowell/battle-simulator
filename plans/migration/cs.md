# cs: capability checklist

## Inherited from csmini (dropped 2026-10-24)

csmini was dropped in phase 0 because cs has everything it had and more. Its
modes were checked against cs and Arena before it went:

| csmini mode | Counterpart | Facing, vision cones, reloading? |
|---|---|---|
| discrete space, discrete time, sequential and we-go | Arena | no |
| discrete space, continuous time, sequential and we-go | Arena | no |
| continuous space, discrete time, sequential and we-go | **cs** | yes |
| continuous space, continuous time, sequential and we-go | Arena | no |

Every mode has a counterpart, but only one quadrant still has csmini's
mechanics in it. **Missing:** facing, a 90° vision cone, an explicit `rotate`
and a one-round gun with a `reload`, in discrete space or in continuous time.
cs runs only in continuous space and discrete time, and Arena has no facing.
Phase 2 restores them in the core: orientation (step 2), an `ammo` pool with a
reload (steps 3 and 4), and the close-quarters reference scenario (step 8),
which also takes over csmini's job as the generic AI's measured weak spot.

Also from csmini, kept but now without a game that uses them:

- `uiDefaults.config` (gameDefaults.js `initGameOpts`): csmini used it to start
  its setup form with observers and simultaneous turns on. No other game sets it.
- `replayPaceMultiplier` above 1 (csmini's was 2, to slow its watch-pace down).
  civ1 still uses the hook, below 1.
- A grid board with a positioned unit channel (`field.positioned` on a square
  grid, in both discrete and continuous space). Arena now carries this.
