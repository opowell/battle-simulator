// ── Entity ids ────────────────────────────────────────────────────────────────
//
// Units and cities are named `u<n>` / `city-<n>` off one counter in
// `gameSpecific.nextId`. In the real game that counter is authoritative and
// nothing else can hold the name it hands out.
//
// An agent reasoning under fog is a different matter. It applies actions to its
// own OBSERVATION, whose counter is deliberately not the true one — publishing
// the true count would tell it how much every rival has ever built (see
// getVisibleState). And the belief sampler fills its worlds with remembered
// enemies under their REAL ids, which can sit anywhere above the counter the
// observation carries. Minting blind would then hand a freshly built unit the
// name of one already standing in that world, and `units.find(u => u.id === …)`
// would start answering with the wrong one.
//
// So minting skips what is taken. On the true state nothing ever is, and the
// counter behaves exactly as it did; inside a sampled world it steps over the
// phantom and the game stays consistent either way.
export function mintId(prefix, counter, taken) {
  let n = counter;
  while (taken.has(`${prefix}${n}`)) n++;
  return { id: `${prefix}${n}`, next: n + 1 };
}

// The names already spoken for in a world — every unit and city, dead ones
// included: a fallen unit stays in `units` with `alive: false` and its id is
// still the one the log and the belief tracker know it by.
export function takenIds(units = [], cities = []) {
  const taken = new Set();
  for (const u of units) taken.add(u.id);
  for (const c of cities) taken.add(c.id);
  return taken;
}
