// gameDefaults.js — shared helpers for building default session config from a
// game definition (used both by Lobby's "Quick start" and GameConfigureModal).

const TEAM_COLORS = ['var(--teamA)', 'var(--teamB)', 'var(--teamC)', 'var(--teamD)', '#b48cff', '#ff9e64'];

function defaultCpuAgent(g) {
  const ids = (g?.agents ?? []).map(a => a.id);
  return ids.includes('obscuro') ? 'obscuro' : (ids[0] ?? 'random');
}

function makeSlots(g, n) {
  const count = n || (g?.defaultPlayers?.length ?? 2);
  return Array.from({ length: count }, (_, i) => ({
    id:    'slot' + i,
    name:  i === 0 ? 'You' : `CPU ${i}`,
    agent: i === 0 ? 'human' : defaultCpuAgent(g),
    color: TEAM_COLORS[i % TEAM_COLORS.length],
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

window.gameDefaults = { TEAM_COLORS, defaultCpuAgent, makeSlots, initGameOpts, scenarioOverrides };
