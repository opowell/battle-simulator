import { generateMap, getLargestConnectedRegion } from './map.js';

const MAX_DICE = 8;

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDice(count, rng) {
  return Array.from({ length: count }, () => Math.floor(rng() * 6) + 1);
}

function cloneState(state) {
  const territories = {};
  for (const [id, t] of Object.entries(state.board.territories)) {
    territories[id] = { ...t, neighbors: [...t.neighbors] };
  }
  return {
    ...state,
    players: state.players.map(p => ({ ...p })),
    board: { ...state.board, territories },
    gameSpecific: {
      ...state.gameSpecific,
      eliminatedPlayers: [...state.gameSpecific.eliminatedPlayers],
    },
  };
}

// ── Game definition ───────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const rng = config.rng ?? Math.random;
  const numPlayers = players.length;

  const { territoryIds, adjacency, cols, rows } = generateMap(numPlayers, rng);

  // Distribute territories round-robin over a shuffled list
  const shuffledIds = shuffle([...territoryIds], rng);
  const territories = {};

  shuffledIds.forEach((id, i) => {
    territories[id] = {
      id,
      owner: players[i % numPlayers].id,
      dice: Math.max(1, Math.floor(rng() * 3) + 1), // 1-3 starting dice
      neighbors: adjacency[id],
    };
  });

  return {
    gameName: 'KDice',
    turnNumber: 1,
    activePlayers: [players[0].id],
    currentPhase: 'attack',
    players: players.map(p => ({ ...p })),
    units: [],
    board: { territories, adjacency, cols, rows },
    lastActions: [],
    gameSpecific: {
      currentPlayerIndex: 0,
      lastBattle: null,
      eliminatedPlayers: [],
    },
  };
}

function getLegalActions(state, playerId) {
  const { board } = state;
  const { territories, adjacency } = board;
  const actions = [];

  const myTerritories = Object.values(territories).filter(
    t => t.owner === playerId && t.dice >= 2,
  );

  for (const from of myTerritories) {
    for (const toId of (adjacency[from.id] ?? [])) {
      const to = territories[toId];
      if (to && to.owner !== playerId) {
        actions.push({ type: 'attack', from: from.id, to: toId });
      }
    }
  }

  actions.push({ type: 'end-turn' });
  return actions;
}

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  const newState = cloneState(state);
  const gs = newState.gameSpecific;
  const { territories, adjacency } = newState.board;

  if (action.type === 'attack') {
    const from = territories[action.from];
    const to = territories[action.to];
    const defenderId = to.owner;

    const attackerRolls = rollDice(from.dice, rng);
    const defenderRolls = rollDice(to.dice, rng);
    const attackerSum = attackerRolls.reduce((a, b) => a + b, 0);
    const defenderSum = defenderRolls.reduce((a, b) => a + b, 0);
    const won = attackerSum > defenderSum;

    if (won) {
      // Attacker's dice - 1 move into the captured territory; attacker territory drops to 1
      const moveIn = Math.max(1, from.dice - 1);
      territories[action.to] = { ...to, owner: playerId, dice: moveIn };
      territories[action.from] = { ...from, dice: 1 };

      const defStillHasTerr = Object.values(territories).some(t => t.owner === defenderId);
      if (!defStillHasTerr) {
        gs.eliminatedPlayers = [...gs.eliminatedPlayers, defenderId];
      }
    } else {
      // Attacker loses all but one die; defender unchanged
      territories[action.from] = { ...from, dice: 1 };
    }

    gs.lastBattle = {
      from: action.from,
      to: action.to,
      attackerRolls,
      defenderRolls,
      attackerSum,
      defenderSum,
      won,
    };
  }

  else if (action.type === 'end-turn') {
    // Bonus dice = largest connected region size - 1, distributed randomly within that region
    const region = getLargestConnectedRegion(playerId, territories, adjacency);
    let bonusDice = Math.max(0, region.length - 1);

    const regionShuffled = shuffle([...region], rng);
    let idx = 0;
    let passes = 0;
    while (bonusDice > 0 && passes < regionShuffled.length) {
      const tid = regionShuffled[idx % regionShuffled.length];
      if (territories[tid].dice < MAX_DICE) {
        territories[tid] = { ...territories[tid], dice: territories[tid].dice + 1 };
        bonusDice--;
        passes = 0;
      } else {
        passes++;
      }
      idx++;
    }

    // Advance to next active player
    const activePlayers = newState.players
      .filter(p => !gs.eliminatedPlayers.includes(p.id))
      .map(p => p.id);

    const currIdx = activePlayers.indexOf(playerId);
    const nextIdx = (currIdx + 1) % activePlayers.length;
    const nextId = activePlayers[nextIdx];

    if (nextIdx === 0) newState.turnNumber++;
    newState.activePlayers = [nextId];
    gs.currentPlayerIndex = newState.players.findIndex(p => p.id === nextId);
    gs.lastBattle = null;
  }

  newState.lastActions = playerActions;
  return newState;
}

function getResult(state) {
  const { players, board, gameSpecific } = state;
  const { eliminatedPlayers } = gameSpecific;
  const active = players.filter(p => !eliminatedPlayers.includes(p.id));

  if (active.length === 1) {
    return { outcome: 'victory', winnerId: active[0].id, reason: `${active[0].name} conquered the map!` };
  }

  const allTerritories = Object.values(board.territories);
  for (const p of active) {
    if (allTerritories.every(t => t.owner === p.id)) {
      return { outcome: 'victory', winnerId: p.id, reason: `${p.name} conquered the map!` };
    }
  }

  return null;
}

function renderState(state) {
  const { players, board, gameSpecific, turnNumber } = state;
  const { territories, adjacency, cols, rows } = board;
  const { eliminatedPlayers, lastBattle } = gameSpecific;

  const activeId = state.activePlayers[0];
  const activeName = players.find(p => p.id === activeId)?.name ?? activeId;

  const playerLabel = (id) => {
    const idx = players.findIndex(p => p.id === id);
    return `P${idx + 1}`;
  };

  const lines = [];
  lines.push('═'.repeat(56));
  lines.push(`  KDICE  ·  Turn ${turnNumber}  ·  ${activeName}'s turn`);
  lines.push('═'.repeat(56));

  // Player summary
  for (const p of players) {
    if (eliminatedPlayers.includes(p.id)) {
      lines.push(`  ${playerLabel(p.id)} ${p.name}: ELIMINATED`);
      continue;
    }
    const owned = Object.values(territories).filter(t => t.owner === p.id);
    const totalDice = owned.reduce((s, t) => s + t.dice, 0);
    const mark = p.id === activeId ? ' ◄' : '';
    lines.push(`  ${playerLabel(p.id)} ${p.name}: ${owned.length} territories, ${totalDice} dice${mark}`);
  }

  // Last battle
  if (lastBattle) {
    lines.push('');
    const outcome = lastBattle.won ? 'WON' : 'LOST';
    const aRolls = `[${lastBattle.attackerRolls.join(',')}]=${lastBattle.attackerSum}`;
    const dRolls = `[${lastBattle.defenderRolls.join(',')}]=${lastBattle.defenderSum}`;
    lines.push(`  Last battle: ${lastBattle.from} → ${lastBattle.to}  Att:${aRolls} Def:${dRolls}  ${outcome}`);
  }

  // Hex grid — parallelogram layout with row offset
  lines.push('');
  const cellW = 6; // "P1:8 " width
  for (let r = 0; r < rows; r++) {
    const indent = r % 2 === 1 ? '   ' : '';
    const cells = [];
    for (let q = 0; q < cols; q++) {
      const id = `${q},${r}`;
      const t = territories[id];
      if (t) {
        cells.push(`${playerLabel(t.owner)}:${t.dice}`.padEnd(cellW));
      }
    }
    lines.push(indent + cells.join(' '));
  }

  lines.push('═'.repeat(56));
  return lines.join('\n');
}

function getVisibleState(state, _playerId) {
  return state; // all information is public in KDice
}

function getActionDuration(_state, action) {
  if (action.type === 'attack') return 0.3;
  return 1;
}

export const KDiceGame = {
  name: 'KDice',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,
};
