// ── Constants ─────────────────────────────────────────────────────────────────

const COSTS = {
  zone: 100,
  road: 50,
  'power-plant': 5000,
  'water-pump': 2000,
  demolish: 25,
};

const POWER_RADIUS = 5;
const WATER_RADIUS = 4;
const STARTING_FUNDS = 20000;

// ── Grid utilities ────────────────────────────────────────────────────────────

function createGrid(width, height) {
  const tiles = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[`${x},${y}`] = { type: 'empty', zone: null, density: 0 };
    }
  }
  return tiles;
}

function adjacent4(x, y, width, height) {
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([ax, ay]) => ax >= 0 && ax < width && ay >= 0 && ay < height);
}

function computeCoverage(tiles, width, height) {
  const powerSources = [];
  const waterSources = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[`${x},${y}`];
      if (t.type === 'power-plant') powerSources.push({ x, y });
      if (t.type === 'water-pump')  waterSources.push({ x, y });
    }
  }

  const coverage = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const cheby = (p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
      coverage[k] = {
        hasPower:      powerSources.some(p => cheby(p) <= POWER_RADIUS),
        hasWater:      waterSources.some(p => cheby(p) <= WATER_RADIUS),
        hasRoadAccess: adjacent4(x, y, width, height)
                         .some(([ax, ay]) => tiles[`${ax},${ay}`].type === 'road'),
      };
    }
  }
  return coverage;
}

// ── Simulation tick ───────────────────────────────────────────────────────────

function simulateTick(state) {
  const { board: { width, height, tiles }, budget } = state;
  const coverage = computeCoverage(tiles, width, height);

  const newTiles = { ...tiles };
  let income = 0;
  let expenses = 0;
  let population = 0;

  const taxPenalty = budget.taxRate > 15 ? 2 : budget.taxRate > 10 ? 1 : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const tile = tiles[k];
      const cov = coverage[k];

      if (tile.type === 'zone') {
        // Neighbor interactions
        let neighborBonus = 0;
        for (const [ax, ay] of adjacent4(x, y, width, height)) {
          const n = tiles[`${ax},${ay}`];
          if (n.type !== 'zone') continue;
          if (tile.zone === 'R' && (n.zone === 'C' || n.zone === 'I')) neighborBonus++;
          if (tile.zone === 'C' && n.zone === 'R') neighborBonus++;
          if (tile.zone === 'R' && n.zone === 'I' && n.density >= 2) neighborBonus--; // pollution
        }

        const growthScore =
          (cov.hasRoadAccess ? 1 : 0) +
          (cov.hasPower ? 1 : 0) +
          (cov.hasWater ? 1 : 0) +
          Math.min(neighborBonus, 1) -
          taxPenalty;

        let { density } = tile;
        if (growthScore >= 2 && density < 3) density++;
        else if (growthScore < 1 && density > 0) density--;
        newTiles[k] = { ...tile, density };

        if (tile.zone === 'R') {
          population += density * 100;
          income += density * 100 * budget.taxRate * 0.5;
        } else if (tile.zone === 'C') {
          income += density * 200;
        } else if (tile.zone === 'I') {
          income += density * 150;
        }
      }

      if (tile.type === 'road')         expenses += 5;
      if (tile.type === 'power-plant')  expenses += 500;
      if (tile.type === 'water-pump')   expenses += 200;
    }
  }

  return {
    tiles: newTiles,
    budget: {
      ...budget,
      funds: Math.round(budget.funds + income - expenses),
      lastIncome: Math.round(income),
      lastExpenses: Math.round(expenses),
    },
    population,
  };
}

// ── Legal actions ─────────────────────────────────────────────────────────────

function getLegalActions(state, _playerId) {
  const { board: { width, height, tiles }, budget } = state;
  const { funds, taxRate } = budget;
  const actions = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[`${x},${y}`];
      if (tile.type === 'empty') {
        if (funds >= COSTS.zone) {
          actions.push({ type: 'zone', x, y, zoneType: 'R' });
          actions.push({ type: 'zone', x, y, zoneType: 'C' });
          actions.push({ type: 'zone', x, y, zoneType: 'I' });
        }
        if (funds >= COSTS.road)            actions.push({ type: 'build-road', x, y });
        if (funds >= COSTS['power-plant'])  actions.push({ type: 'build-power-plant', x, y });
        if (funds >= COSTS['water-pump'])   actions.push({ type: 'build-water-pump', x, y });
      } else if (funds >= COSTS.demolish) {
        actions.push({ type: 'demolish', x, y });
      }
    }
  }

  for (let rate = 0; rate <= 20; rate++) {
    if (rate !== taxRate) actions.push({ type: 'set-tax-rate', rate });
  }

  actions.push({ type: 'end-turn' });
  return actions;
}

// ── Apply actions ─────────────────────────────────────────────────────────────

function applyActions(state, playerActions) {
  const { action } = playerActions[0];
  let { board, budget, population, year } = state;
  let tiles = board.tiles;

  if (action.type === 'end-turn') {
    const tick = simulateTick(state);
    return {
      ...state,
      board: { ...board, tiles: tick.tiles },
      budget: tick.budget,
      population: tick.population,
      year: year + 1,
      turnNumber: state.turnNumber + 1,
      lastActions: playerActions,
    };
  }

  tiles = { ...tiles };

  if (action.type === 'zone') {
    tiles[`${action.x},${action.y}`] = { type: 'zone', zone: action.zoneType, density: 0 };
    budget = { ...budget, funds: budget.funds - COSTS.zone };
  } else if (action.type === 'build-road') {
    tiles[`${action.x},${action.y}`] = { type: 'road', zone: null, density: 0 };
    budget = { ...budget, funds: budget.funds - COSTS.road };
  } else if (action.type === 'build-power-plant') {
    tiles[`${action.x},${action.y}`] = { type: 'power-plant', zone: null, density: 0 };
    budget = { ...budget, funds: budget.funds - COSTS['power-plant'] };
  } else if (action.type === 'build-water-pump') {
    tiles[`${action.x},${action.y}`] = { type: 'water-pump', zone: null, density: 0 };
    budget = { ...budget, funds: budget.funds - COSTS['water-pump'] };
  } else if (action.type === 'demolish') {
    tiles[`${action.x},${action.y}`] = { type: 'empty', zone: null, density: 0 };
    budget = { ...budget, funds: budget.funds - COSTS.demolish };
  } else if (action.type === 'set-tax-rate') {
    budget = { ...budget, taxRate: action.rate };
  }

  return {
    ...state,
    board: { ...board, tiles },
    budget,
    population,
    lastActions: playerActions,
  };
}

// ── getResult ─────────────────────────────────────────────────────────────────

function getResult(_state) {
  return null;
}

// ── renderState ───────────────────────────────────────────────────────────────

function tileChar(tile) {
  if (tile.type === 'empty')       return '·';
  if (tile.type === 'road')        return '─';
  if (tile.type === 'power-plant') return 'P';
  if (tile.type === 'water-pump')  return 'W';
  if (tile.type === 'zone') {
    return { R: ['.', 'r', 'R', '#'], C: ['.', 'c', 'C', '$'], I: ['.', 'i', 'I', 'X'] }
      [tile.zone][tile.density];
  }
  return '?';
}

function renderState(state) {
  const { board: { width, height, tiles }, budget, population, year, turnNumber } = state;

  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      row += tileChar(tiles[`${x},${y}`]) + ' ';
    }
    rows.push(row.trimEnd());
  }

  return [
    `═══ SimCity — Year ${year} (Turn ${turnNumber}) ═══`,
    ...rows,
    '',
    `Pop: ${population.toLocaleString()}  |  Funds: $${budget.funds.toLocaleString()}  |  Tax: ${budget.taxRate}%`,
    `Last year: +$${(budget.lastIncome || 0).toLocaleString()} income  -$${(budget.lastExpenses || 0).toLocaleString()} expenses`,
    `Legend: · empty  ─ road  P power  W water  r/R/# res  c/C/$ com  i/I/X ind`,
  ].join('\n');
}

// ── createInitialState ────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const width     = config.width     ?? 20;
  const height    = config.height    ?? 14;
  const startYear = config.startYear ?? 1900;

  return {
    gameName: 'SimCity',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'action',
    players,
    board: { width, height, tiles: createGrid(width, height) },
    budget: { funds: STARTING_FUNDS, taxRate: 8, lastIncome: 0, lastExpenses: 0 },
    population: 0,
    year: startYear,
    lastActions: null,
    gameSpecific: {},
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const SimCityGame = {
  name: 'SimCity',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
};
