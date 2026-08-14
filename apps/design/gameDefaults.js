// gameDefaults.js — shared helpers for building default session config from a
// game definition (used both by Lobby's "Quick start" and GameConfigureModal).

const TEAM_COLORS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)', '#b48cff', '#ff9e64'];

// A game may bring its own player palette (ui.teamColors, a list of raw colors) when
// the generic one would misread — e.g. a game where a particular color already means
// something other than "a player". Everything else falls back to TEAM_COLORS.
function teamPalette(g) {
  const own = g?.ui?.teamColors;
  return Array.isArray(own) && own.length ? own : TEAM_COLORS;
}

function defaultCpuAgent(g) {
  const ids = (g?.agents ?? []).map(a => a.id);
  return ids.includes('obscuro') ? 'obscuro' : (ids[0] ?? 'random');
}

function makeSlots(g, n) {
  const count = n || (g?.defaultPlayers?.length ?? 2);
  // A game may prefer specific per-slot agents (g.uiDefaults.players) — e.g. csmini
  // defaults to two AIs watched by an observer, rather than "you vs one CPU".
  const pref = g?.uiDefaults?.players;
  const palette = teamPalette(g);
  return Array.from({ length: count }, (_, i) => ({
    id:    'slot' + i,
    name:  pref?.[i]?.name ?? (i === 0 ? 'You' : `CPU ${i}`),
    agent: pref?.[i]?.agent ?? (i === 0 ? 'human' : defaultCpuAgent(g)),
    color: palette[i % palette.length],
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

// Overrides a scenario's config layers on top of a game's plain defaults.
function scenarioOverrides(sc) {
  if (!sc) return { maxTurns: 300 };
  const fog = sc.config?.fog ?? sc.config?.fogOfWar;
  return {
    maxTurns: sc.config?.maxTurns ?? 300,
    ...(fog != null ? { fogOfWar: fog } : {}),
  };
}

window.gameDefaults = { TEAM_COLORS, teamPalette, defaultCpuAgent, makeSlots, initGameOpts, scenarioOverrides };
