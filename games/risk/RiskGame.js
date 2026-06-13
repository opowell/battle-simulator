import { TERRITORY_IDS, TERRITORY_NAMES, ADJACENCY, CONTINENTS, getConnectedOwned } from './RiskMap.js';
import { resolveCombat } from './RiskCombat.js';

// ── Cards ─────────────────────────────────────────────────────────────────────

const CARD_TYPES = ['infantry', 'cavalry', 'artillery'];

function createDeck(rng) {
  const cards = TERRITORY_IDS.map((tid, i) => ({ type: CARD_TYPES[i % 3], territory: tid }));
  cards.push({ type: 'wild', territory: null });
  cards.push({ type: 'wild', territory: null });
  return shuffle(cards, rng);
}

function isValidSet(trio) {
  const types = trio.map(c => c.type);
  const wilds = types.filter(t => t === 'wild').length;
  if (wilds >= 2) return true;
  if (wilds === 1) return true;
  const unique = new Set(types);
  return unique.size === 1 || unique.size === 3;
}

function validSetsInHand(hand) {
  const sets = [];
  for (let i = 0; i < hand.length - 2; i++) {
    for (let j = i + 1; j < hand.length - 1; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        if (isValidSet([hand[i], hand[j], hand[k]])) {
          sets.push([i, j, k]);
        }
      }
    }
  }
  return sets;
}

const CARD_SET_BONUSES = [4, 6, 8, 10, 12, 15];
function cardSetBonus(count) {
  return count < CARD_SET_BONUSES.length ? CARD_SET_BONUSES[count] : 15 + (count - 5) * 5;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const INITIAL_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };

function calcReinforcements(playerId, territories) {
  const owned = Object.values(territories).filter(t => t.owner === playerId);
  let armies = Math.max(3, Math.floor(owned.length / 3));
  for (const cont of Object.values(CONTINENTS)) {
    if (cont.territories.every(tid => territories[tid]?.owner === playerId)) {
      armies += cont.bonus;
    }
  }
  return armies;
}

function cloneState(state) {
  const territories = {};
  for (const [id, t] of Object.entries(state.board.territories)) {
    territories[id] = { ...t };
  }
  const cards = {};
  for (const [pid, hand] of Object.entries(state.gameSpecific.cards)) {
    cards[pid] = [...hand];
  }
  return {
    ...state,
    players: state.players.map(p => ({ ...p })),
    board: { ...state.board, territories },
    gameSpecific: {
      ...state.gameSpecific,
      cards,
      deck: [...state.gameSpecific.deck],
      eliminatedPlayers: [...state.gameSpecific.eliminatedPlayers],
      lastCombat: state.gameSpecific.lastCombat
        ? { ...state.gameSpecific.lastCombat, attackerRolls: [...state.gameSpecific.lastCombat.attackerRolls], defenderRolls: [...state.gameSpecific.lastCombat.defenderRolls] }
        : null,
    },
  };
}

// ── Game definition ───────────────────────────────────────────────────────────

function createInitialState(players, config = {}) {
  const rng = config.rng ?? Math.random;
  const numPlayers = players.length;

  const territories = {};
  for (const tid of TERRITORY_IDS) {
    territories[tid] = { id: tid, owner: null, armies: 0 };
  }

  // Distribute territories round-robin after shuffling
  const shuffled = shuffle(TERRITORY_IDS, rng);
  shuffled.forEach((tid, i) => {
    territories[tid].owner = players[i % numPlayers].id;
    territories[tid].armies = 1;
  });

  // Distribute remaining starting armies randomly across owned territories
  const startArmies = INITIAL_ARMIES[numPlayers] ?? 20;
  for (const p of players) {
    const owned = Object.keys(territories).filter(tid => territories[tid].owner === p.id);
    const remaining = startArmies - owned.length;
    for (let i = 0; i < remaining; i++) {
      const tid = owned[Math.floor(rng() * owned.length)];
      territories[tid].armies++;
    }
  }

  const cards = {};
  for (const p of players) cards[p.id] = [];

  const firstId = players[0].id;
  return {
    gameName: 'Risk',
    turnNumber: 1,
    activePlayers: [firstId],
    currentPhase: 'reinforce',
    players: players.map(p => ({ ...p })),
    units: [],
    board: { territories },
    lastActions: [],
    gameSpecific: {
      currentPlayerIndex: 0,
      reinforcementsLeft: calcReinforcements(firstId, territories),
      conqueredThisTurn: false,
      hasFortified: false,
      cards,
      deck: createDeck(rng),
      cardSetCount: 0,
      eliminatedPlayers: [],
      lastCombat: null,
    },
  };
}

function getLegalActions(state, playerId) {
  const { currentPhase, board, gameSpecific } = state;
  const { territories } = board;
  const { reinforcementsLeft, cards, cardSetCount, hasFortified } = gameSpecific;
  const actions = [];

  if (currentPhase === 'reinforce') {
    const hand = cards[playerId] ?? [];
    const sets = validSetsInHand(hand);
    const mustTurnIn = hand.length >= 5 && sets.length > 0;

    if (mustTurnIn) {
      return sets.map(indices => ({ type: 'turn-in-cards', cardIndices: indices }));
    }

    for (const indices of sets) {
      actions.push({ type: 'turn-in-cards', cardIndices: indices });
    }

    if (reinforcementsLeft > 0) {
      const ownedTerritories = Object.values(territories).filter(t => t.owner === playerId);
      for (const t of ownedTerritories) {
        actions.push({ type: 'place-armies', territoryId: t.id, count: 1 });
        if (reinforcementsLeft > 1) {
          actions.push({ type: 'place-armies', territoryId: t.id, count: reinforcementsLeft });
        }
      }
    } else {
      actions.push({ type: 'end-reinforce' });
    }

    return actions;
  }

  if (currentPhase === 'attack') {
    const myTerritories = Object.values(territories).filter(t => t.owner === playerId && t.armies >= 2);
    for (const t of myTerritories) {
      for (const adjId of ADJACENCY[t.id] ?? []) {
        const adj = territories[adjId];
        if (adj && adj.owner !== playerId) {
          const maxDice = Math.min(3, t.armies - 1);
          for (let dice = 1; dice <= maxDice; dice++) {
            actions.push({ type: 'attack', from: t.id, to: adjId, attackerDice: dice });
          }
        }
      }
    }
    actions.push({ type: 'end-attack' });
    return actions;
  }

  if (currentPhase === 'fortify') {
    if (!hasFortified) {
      const myTerritories = Object.values(territories).filter(t => t.owner === playerId && t.armies >= 2);
      for (const t of myTerritories) {
        const reachable = getConnectedOwned(t.id, playerId, territories);
        for (const toId of reachable) {
          actions.push({ type: 'fortify', from: t.id, to: toId, armies: t.armies - 1 });
        }
      }
    }
    actions.push({ type: 'end-turn' });
    return actions;
  }

  return actions;
}

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  const newState = cloneState(state);
  const gs = newState.gameSpecific;
  const territories = newState.board.territories;

  if (action.type === 'turn-in-cards') {
    const hand = gs.cards[playerId];
    const bonus = cardSetBonus(gs.cardSetCount);
    const sortedIdx = [...action.cardIndices].sort((a, b) => b - a);

    // Territory bonus: +2 armies on any matching territory you own
    for (const idx of action.cardIndices) {
      const card = hand[idx];
      if (card.territory && territories[card.territory]?.owner === playerId) {
        territories[card.territory] = { ...territories[card.territory], armies: territories[card.territory].armies + 2 };
      }
    }

    for (const idx of sortedIdx) hand.splice(idx, 1);
    gs.cardSetCount++;
    gs.reinforcementsLeft += bonus;
  }

  else if (action.type === 'place-armies') {
    const t = territories[action.territoryId];
    territories[action.territoryId] = { ...t, armies: t.armies + action.count };
    gs.reinforcementsLeft = Math.max(0, gs.reinforcementsLeft - action.count);
  }

  else if (action.type === 'end-reinforce') {
    newState.currentPhase = 'attack';
    gs.conqueredThisTurn = false;
    gs.lastCombat = null;
  }

  else if (action.type === 'attack') {
    const attTerr = territories[action.from];
    const defTerr = territories[action.to];
    const defenderId = defTerr.owner;

    const result = resolveCombat(attTerr.armies, defTerr.armies, action.attackerDice, rng);
    const newAttArmies = attTerr.armies - result.attackerLosses;
    const newDefArmies = defTerr.armies - result.defenderLosses;

    if (newDefArmies <= 0) {
      // Captured: attacker moves in exactly attackerDice armies (provably safe — attacker never loses when capturing)
      const moveIn = action.attackerDice;
      territories[action.from] = { ...attTerr, armies: newAttArmies - moveIn };
      territories[action.to] = { ...defTerr, armies: moveIn, owner: playerId };
      gs.conqueredThisTurn = true;

      gs.lastCombat = {
        from: action.from, to: action.to,
        attackerRolls: result.attackerRolls, defenderRolls: result.defenderRolls,
        attackerLosses: result.attackerLosses, defenderLosses: result.defenderLosses,
        captured: true,
      };

      // Check if defender eliminated
      const defHasTerr = Object.values(territories).some(t => t.owner === defenderId);
      if (!defHasTerr) {
        gs.eliminatedPlayers = [...gs.eliminatedPlayers, defenderId];
        // Transfer defender's cards to attacker
        gs.cards[playerId] = [...(gs.cards[playerId] ?? []), ...(gs.cards[defenderId] ?? [])];
        gs.cards[defenderId] = [];
      }
    } else {
      territories[action.from] = { ...attTerr, armies: newAttArmies };
      territories[action.to] = { ...defTerr, armies: newDefArmies };
      gs.lastCombat = {
        from: action.from, to: action.to,
        attackerRolls: result.attackerRolls, defenderRolls: result.defenderRolls,
        attackerLosses: result.attackerLosses, defenderLosses: result.defenderLosses,
        captured: false,
      };
    }
  }

  else if (action.type === 'end-attack') {
    newState.currentPhase = 'fortify';
    gs.hasFortified = false;

    // Draw a card if conquered at least one territory this turn
    if (gs.conqueredThisTurn && gs.deck.length > 0) {
      const [drawn, ...rest] = gs.deck;
      gs.deck = rest;
      gs.cards[playerId] = [...(gs.cards[playerId] ?? []), drawn];
    }
  }

  else if (action.type === 'fortify') {
    const from = territories[action.from];
    const to = territories[action.to];
    territories[action.from] = { ...from, armies: from.armies - action.armies };
    territories[action.to] = { ...to, armies: to.armies + action.armies };
    gs.hasFortified = true;
  }

  else if (action.type === 'end-turn') {
    const activePlayers = newState.players
      .filter(p => !gs.eliminatedPlayers.includes(p.id))
      .map(p => p.id);

    const currIdx = activePlayers.indexOf(playerId);
    const nextIdx = (currIdx + 1) % activePlayers.length;
    const nextId = activePlayers[nextIdx];

    if (nextIdx === 0) newState.turnNumber++;
    newState.activePlayers = [nextId];
    newState.currentPhase = 'reinforce';
    gs.reinforcementsLeft = calcReinforcements(nextId, territories);
    gs.conqueredThisTurn = false;
    gs.hasFortified = false;
    gs.lastCombat = null;
  }

  newState.lastActions = playerActions;
  return newState;
}

function getResult(state) {
  const { players, board, gameSpecific } = state;
  const { eliminatedPlayers } = gameSpecific;
  const active = players.filter(p => !eliminatedPlayers.includes(p.id));

  if (active.length === 1) {
    return { outcome: 'victory', winnerId: active[0].id, reason: `${active[0].name} conquered the world!` };
  }

  const territories = Object.values(board.territories);
  for (const p of active) {
    if (territories.every(t => t.owner === p.id)) {
      return { outcome: 'victory', winnerId: p.id, reason: `${p.name} conquered the world!` };
    }
  }

  return null;
}

function renderState(state) {
  const { players, board, gameSpecific, currentPhase, turnNumber } = state;
  const { territories } = board;
  const { eliminatedPlayers, reinforcementsLeft, cards, lastCombat } = gameSpecific;

  const activeId = state.activePlayers[0];
  const activeName = players.find(p => p.id === activeId)?.name ?? activeId;

  const playerLabel = (id) => {
    const idx = players.findIndex(p => p.id === id);
    return `P${idx + 1}`;
  };

  const lines = [];
  lines.push('═'.repeat(62));
  lines.push(`  RISK  ·  Turn ${turnNumber}  ·  ${activeName}  ·  Phase: ${currentPhase.toUpperCase()}`);
  lines.push('═'.repeat(62));

  // Player summary
  for (const p of players) {
    if (eliminatedPlayers.includes(p.id)) {
      lines.push(`  ${playerLabel(p.id)} ${p.name}: ELIMINATED`);
      continue;
    }
    const owned = Object.values(territories).filter(t => t.owner === p.id);
    const totalArmies = owned.reduce((s, t) => s + t.armies, 0);
    const hand = cards[p.id] ?? [];
    const cardStr = hand.length > 0
      ? hand.map(c => c.type[0].toUpperCase()).join('')
      : '-';
    const extra = p.id === activeId && currentPhase === 'reinforce'
      ? `  [+${reinforcementsLeft} to place]`
      : '';
    lines.push(`  ${playerLabel(p.id)} ${p.name}: ${owned.length} territories, ${totalArmies} armies  cards:[${cardStr}]${extra}`);
  }

  // Continent bonuses
  lines.push('');
  lines.push('  Continents:');
  for (const [, cont] of Object.entries(CONTINENTS)) {
    const owners = {};
    for (const tid of cont.territories) {
      const owner = territories[tid]?.owner;
      if (owner) owners[owner] = (owners[owner] ?? 0) + 1;
    }
    const total = cont.territories.length;
    const holder = Object.entries(owners).find(([, n]) => n === total);
    const summary = Object.entries(owners)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${playerLabel(id)}:${n}/${total}`)
      .join('  ');
    const bonus = holder ? ` ★ ${players.find(p => p.id === holder[0])?.name}` : '';
    lines.push(`    ${cont.name.padEnd(16)} (+${cont.bonus})  ${summary}${bonus}`);
  }

  // Last combat
  if (lastCombat) {
    lines.push('');
    const fromName = TERRITORY_NAMES[lastCombat.from];
    const toName = TERRITORY_NAMES[lastCombat.to];
    const attDice = `[${lastCombat.attackerRolls.join(',')}]`;
    const defDice = `[${lastCombat.defenderRolls.join(',')}]`;
    const outcome = lastCombat.captured ? 'CAPTURED' : `Att lost ${lastCombat.attackerLosses}, Def lost ${lastCombat.defenderLosses}`;
    lines.push(`  Last battle: ${fromName} → ${toName}  Att:${attDice} Def:${defDice}  ${outcome}`);
  }

  // Territories by continent
  lines.push('');
  for (const [, cont] of Object.entries(CONTINENTS)) {
    lines.push(`  ─ ${cont.name} ─`);
    const terrPairs = [];
    for (let i = 0; i < cont.territories.length; i += 2) {
      const left = cont.territories[i];
      const right = cont.territories[i + 1];
      const fmt = (tid) => {
        const t = territories[tid];
        const label = `${playerLabel(t.owner)}:${String(t.armies).padStart(2)}`;
        return `${TERRITORY_NAMES[tid].padEnd(16)} ${label}`;
      };
      const leftStr = fmt(left);
      const rightStr = right ? fmt(right) : '';
      terrPairs.push(`    ${leftStr}    ${rightStr}`);
    }
    lines.push(...terrPairs);
  }

  lines.push('═'.repeat(62));
  return lines.join('\n');
}

function getVisibleState(state, playerId) {
  const cards = {};
  for (const [pid, hand] of Object.entries(state.gameSpecific.cards)) {
    cards[pid] = pid === playerId ? hand : [];
  }
  return { ...state, gameSpecific: { ...state.gameSpecific, cards } };
}

function getActionDuration(_state, action) {
  // Abstract game — all phases take time proportional to their complexity
  if (action.type === 'attack')   return 0.5;
  if (action.type === 'fortify')  return 2;
  return 1;
}

export const RiskGame = {
  name: 'Risk',
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  getVisibleState,
  getActionDuration,
};
