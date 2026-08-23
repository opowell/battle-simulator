// gameDefaults.js — shared helpers for building default session config from a
// game definition (used to seed the session form in GameSetupFields).

function defaultCpuAgent(g) {
  const ids = (g?.agents ?? []).map(a => a.id);
  return ids.includes('obscuro') ? 'obscuro' : (ids[0] ?? 'random');
}

function makeSlots(g, n, players) {
  // A game may prefer specific per-slot agents (g.uiDefaults.players) — e.g. csmini
  // defaults to two AIs watched by an observer, rather than "you vs one CPU". A
  // chosen scenario may override that again with its own `config.players`, which
  // is what `players` carries in; either way each entry only has to name the parts
  // it cares about (name, agent), and the rest falls back to the generic seating.
  const pref = players ?? g?.uiDefaults?.players;
  const count = n || pref?.length || (g?.defaultPlayers?.length ?? 2);
  // One colour per seat, however many seats there are — teamPalette generates
  // them, so nothing here caps the table at the length of a colour list.
  const palette = teamPalette.seatColors(g, count);
  return Array.from({ length: count }, (_, i) => ({
    id:    'slot' + i,
    name:  pref?.[i]?.name ?? (i === 0 ? 'You' : `CPU ${i}`),
    agent: pref?.[i]?.agent ?? (i === 0 ? 'human' : defaultCpuAgent(g)),
    color: palette[i],
  }));
}

function initGameOpts(g) {
  const opts = {};
  for (const opt of g?.gameOptions ?? []) {
    if (opt.type === 'ai-difficulty') {
      // Two exclusive values: a power level and a time limit. Default to power
      // mode with the time value null (so only `difficulty` is sent).
      opts[opt.id] = opt.default ?? 25;
      opts[opt.timeKey ?? 'aiTimeMs'] = null;
      opts[opt.id + 'Mode'] = 'power';
    } else {
      opts[opt.id] = opt.default ?? (opt.type === 'boolean' ? false : opt.type === 'range' ? (opt.min ?? 0) : opt.type === 'integer' ? '' : opt.options?.[0]?.value ?? '');
    }
  }
  // A game may override specific engine/game option defaults (g.uiDefaults.config) —
  // e.g. csmini turns on observers and simultaneous turns by default.
  Object.assign(opts, g?.uiDefaults?.config ?? {});
  return opts;
}

// A scenario's config, split into the layers the form applies it to. `maxTurns`
// and `players` are fields of their own; EVERYTHING else is a game or engine
// option (map size, a map id, `allowObservers`, …) and is merged over the game's
// plain option defaults — so a scenario can set up any session the Configure
// screen itself could, and the observer still sees each value in its own control.
function scenarioOverrides(sc) {
  if (!sc) return { maxTurns: null, players: null, config: {} };
  const { players = null, maxTurns, fog, fogOfWar, ...rest } = sc.config ?? {};
  // `fog` and `fogOfWar` are the same switch under two names (create() sends both).
  const f = fog ?? fogOfWar;
  return {
    // Null = no turn limit; only a scenario that asks for one gets one.
    maxTurns: maxTurns ?? null,
    players,
    config: { ...rest, ...(f != null ? { fogOfWar: f } : {}) },
  };
}

window.gameDefaults = { defaultCpuAgent, makeSlots, initGameOpts, scenarioOverrides };
