import { sidesEval } from '../evalHelpers.js';
import { TERRITORY_IDS, TERRITORY_NAMES, ADJACENCY, CONTINENTS, CONTINENT_OF, getConnectedOwned } from './RiskMap.js';
import { resolveCombat } from './RiskCombat.js';
import { getRiskBelief } from './belief.js';
import { LAYOUT, SEA_ROUTES, HEX_SIZE, routeKey } from './RiskLayout.js';
import { hexLayoutBounds, territoryBorders } from '../mapTypes/hexagon.js';

// ── Cards ─────────────────────────────────────────────────────────────────────

export const CARD_TYPES = ['infantry', 'cavalry', 'artillery'];
// Short forms for anywhere a card has to fit in a chip or a button.
export const CARD_LABELS = { infantry: 'INF', cavalry: 'CAV', artillery: 'ART', wild: 'WILD' };

// The full card pool is deterministic (one card per territory, cycling type by
// index, plus 2 wilds) — only the deal *order* is random. belief.js reuses this
// to reconstruct "every card that exists" without needing any RNG or history.
export function allCardsInGame() {
  const cards = TERRITORY_IDS.map((tid, i) => ({ type: CARD_TYPES[i % 3], territory: tid }));
  cards.push({ type: 'wild', territory: null });
  cards.push({ type: 'wild', territory: null });
  return cards;
}

function createDeck(rng) {
  return shuffle(allCardsInGame(), rng);
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
// Fixed-value sets (the `cardSetValues: 'fixed'` option, and the default): every set is
// worth the same, so holding cards never becomes the game's dominant clock the way the
// escalating table does once the fifth or sixth set is turned in. 6 is the escalating
// table's second step — an early set is worth slightly more than it would be, a late
// one far less.
const CARD_SET_FIXED = 6;
function cardSetBonus(count, escalating) {
  if (!escalating) return CARD_SET_FIXED;
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
      pendingOccupy: state.gameSpecific.pendingOccupy ? { ...state.gameSpecific.pendingOccupy } : null,
      options: { ...(state.gameSpecific.options ?? {}) },
    },
  };
}

// ── Game definition ───────────────────────────────────────────────────────────

// The rule variants a session can pick (see gameOptions below). Resolved once, at
// setup, and carried in gameSpecific so every later rule reads the same answer — and so
// a saved game keeps the rules it was started with.
function resolveOptions(config = {}) {
  return {
    cardSetValues:     config.cardSetValues === 'increasing' ? 'increasing' : 'fixed',
    fortifyMoves:      config.fortifyMoves === 'unlimited' ? 'unlimited' : 'one',
    reinforcePlacement: config.reinforcePlacement === 'random' ? 'random' : 'selected',
    // Classic Risk: after taking a territory you may push more of the attacking stack
    // in behind the dice. On by default; off keeps the earlier behaviour where exactly
    // as many armies as dice rolled move in and the turn goes straight on.
    postCaptureFortify: config.postCaptureFortify !== false,
  };
}

// Random placement (the `reinforcePlacement: 'random'` option): the armies land on
// their own, spread one at a time over the territories you hold, so the reinforce phase
// is something that happens to you rather than something you do. Returns the number
// actually placed (0 when you hold nothing, which can't happen while you're still in).
function autoPlaceReinforcements(gs, territories, playerId, rng) {
  const owned = Object.values(territories).filter(t => t.owner === playerId);
  if (!owned.length) { gs.reinforcementsLeft = 0; return 0; }
  const placed = gs.reinforcementsLeft;
  for (let i = 0; i < placed; i++) {
    const t = owned[Math.floor(rng() * owned.length)];
    territories[t.id] = { ...territories[t.id], armies: territories[t.id].armies + 1 };
  }
  gs.reinforcementsLeft = 0;
  return placed;
}

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
  const options = resolveOptions(config);
  const gameSpecific = {
    currentPlayerIndex: 0,
    reinforcementsLeft: calcReinforcements(firstId, territories),
    conqueredThisTurn: false,
    hasFortified: false,
    cards,
    deck: createDeck(rng),
    cardSetCount: 0,
    eliminatedPlayers: [],
    lastCombat: null,
    // Set while a capture is waiting for its occupying force (postCaptureFortify):
    // { from, to, max } — how many MORE armies may follow the dice in.
    pendingOccupy: null,
    options,
  };

  let currentPhase = 'reinforce';
  if (options.reinforcePlacement === 'random') {
    autoPlaceReinforcements(gameSpecific, territories, firstId, rng);
    currentPhase = 'attack';
  }

  return {
    gameName: 'Risk',
    turnNumber: 1,
    activePlayers: [firstId],
    currentPhase,
    players: players.map(p => ({ ...p })),
    units: [],
    board: { territories },
    lastActions: [],
    gameSpecific,
  };
}

function getLegalActions(state, playerId) {
  const { currentPhase, board, gameSpecific } = state;
  const { territories } = board;
  const { reinforcementsLeft, cards, hasFortified, pendingOccupy } = gameSpecific;
  const options = gameSpecific.options ?? resolveOptions();
  const actions = [];

  // A capture waiting for its occupying force blocks everything else: how many armies
  // follow the dice in is the only question on the table until it's answered.
  if (pendingOccupy) {
    for (let extra = 0; extra <= pendingOccupy.max; extra++) {
      actions.push({ type: 'occupy', from: pendingOccupy.from, to: pendingOccupy.to, armies: extra });
    }
    return actions;
  }

  if (currentPhase === 'reinforce') {
    const hand = cards[playerId] ?? [];
    const sets = validSetsInHand(hand);
    const mustTurnIn = hand.length >= 5 && sets.length > 0;

    // "turn-in-cards [0,2,3]" says nothing to a player who can't see the hand those
    // indices point into: name the three cards and what they're worth. The bonus is
    // this set's, so two different sets in one hand can be told apart by value as well
    // as by card. (The panel prefers an action's own `label` — see fmtAction.)
    const bonus = cardSetBonus(gameSpecific.cardSetCount, options.cardSetValues === 'increasing');
    const setLabel = (indices) => {
      const named = indices.map(i => {
        const c = hand[i];
        const type = CARD_LABELS[c.type] ?? c.type;
        return c.territory ? `${type} ${TERRITORY_NAMES[c.territory] ?? c.territory}` : type;
      });
      const owned = indices.filter(i => hand[i].territory && territories[hand[i].territory]?.owner === playerId);
      const extra = owned.length ? ` (+2 each on ${owned.length} you hold)` : '';
      return `Turn in ${named.join(' · ')} → +${bonus} armies${extra}`;
    };

    if (mustTurnIn) {
      return sets.map(indices => ({ type: 'turn-in-cards', cardIndices: indices, label: `${setLabel(indices)} — required, you hold 5+ cards` }));
    }

    for (const indices of sets) {
      actions.push({ type: 'turn-in-cards', cardIndices: indices, label: setLabel(indices) });
    }

    // Under random placement the armies have already landed by themselves (see
    // autoPlaceReinforcements), so there is never anything left to place here.
    if (reinforcementsLeft > 0 && options.reinforcePlacement === 'selected') {
      const ownedTerritories = Object.values(territories).filter(t => t.owner === playerId);
      for (const t of ownedTerritories) {
        actions.push({ type: 'place-armies', territoryId: t.id, count: 1 });
        if (reinforcementsLeft > 1) {
          actions.push({ type: 'place-armies', territoryId: t.id, count: reinforcementsLeft });
        }
      }
    } else {
      // Reinforcements all placed and cards still in hand: the phase only stays open so
      // a set can be turned in (which would hand out more armies to place), and
      // end-reinforce is how you decline. With nothing left to decide, applyActions has
      // already moved the game to the attack phase — see the auto-advance there.
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
          // Strongest attack first: clicking a target on the map submits the first
          // matching attack action (see Battlefield's territory-click flow), and
          // rolling every die you're entitled to is what a player means by "attack".
          const maxDice = Math.min(3, t.armies - 1);
          for (let dice = maxDice; dice >= 1; dice--) {
            actions.push({ type: 'attack', from: t.id, to: adjId, attackerDice: dice });
          }
        }
      }
    }
    actions.push({ type: 'end-attack' });
    return actions;
  }

  if (currentPhase === 'fortify') {
    // One move per turn, unless the session chose `fortifyMoves: 'unlimited'` — where
    // the phase is instead a free reshuffle of your own armies, ended by end-turn.
    if (!hasFortified || options.fortifyMoves === 'unlimited') {
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

// The last army placed ends the reinforce phase by itself: with no armies left and no
// card set to turn in, "end reinforce" would be the only legal action, and a button
// whose every press is forced is just a step between the player and the attack phase. A
// player still holding a valid set keeps the choice (and the button): turning it in
// there yields more armies to place.
function endReinforceIfSettled(newState, gs, playerId) {
  if (newState.currentPhase !== 'reinforce') return;
  if (gs.reinforcementsLeft > 0) return;
  if (validSetsInHand(gs.cards[playerId] ?? []).length > 0) return;
  newState.currentPhase = 'attack';
  gs.conqueredThisTurn = false;
  gs.lastCombat = null;
}

function applyActions(state, playerActions, rng = Math.random) {
  const { playerId, action } = playerActions[0];
  const newState = cloneState(state);
  const gs = newState.gameSpecific;
  const territories = newState.board.territories;

  const options = gs.options ?? resolveOptions();

  if (action.type === 'turn-in-cards') {
    const hand = gs.cards[playerId];
    const bonus = cardSetBonus(gs.cardSetCount, options.cardSetValues === 'increasing');
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
    // The set's armies land the same way the turn's own reinforcements did.
    if (options.reinforcePlacement === 'random') {
      autoPlaceReinforcements(gs, territories, playerId, rng);
      endReinforceIfSettled(newState, gs, playerId);
    }
  }

  else if (action.type === 'place-armies') {
    const t = territories[action.territoryId];
    territories[action.territoryId] = { ...t, armies: t.armies + action.count };
    gs.reinforcementsLeft = Math.max(0, gs.reinforcementsLeft - action.count);
    endReinforceIfSettled(newState, gs, playerId);
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
      // With postCaptureFortify on, the dice are only the minimum: whatever the
      // attacking territory can spare (everything above the one army that must hold it)
      // may follow them in, and nothing else happens until that's decided.
      const spare = territories[action.from].armies - 1;
      if (options.postCaptureFortify && spare > 0) {
        gs.pendingOccupy = { from: action.from, to: action.to, max: spare };
        // A phase of its own while it lasts: nothing else is legal, and the header and
        // the action panel both say what the game is waiting for (ui.phaseHints). It is
        // deliberately not in ui.phases — it isn't a step of every turn, it's an
        // interruption of the attack phase, which resumes as soon as it's answered.
        newState.currentPhase = 'occupy';
      }

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

  else if (action.type === 'occupy') {
    const from = territories[action.from];
    const to = territories[action.to];
    if (action.armies > 0) {
      territories[action.from] = { ...from, armies: from.armies - action.armies };
      territories[action.to] = { ...to, armies: to.armies + action.armies };
    }
    gs.pendingOccupy = null;
    newState.currentPhase = 'attack';   // the interrupted phase resumes
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
    gs.pendingOccupy = null;
    if (options.reinforcePlacement === 'random') {
      autoPlaceReinforcements(gs, territories, nextId, rng);
      endReinforceIfSettled(newState, gs, nextId);
    }
  }

  newState.lastActions = playerActions;
  return newState;
}

function getResult(state) {
  const { players, board, gameSpecific } = state;
  const { eliminatedPlayers } = gameSpecific;
  const active = players.filter(p => !eliminatedPlayers.includes(p.id));

  if (active.length === 1) {
    return { outcome: 'win', winnerId: active[0].id, reason: `${active[0].name} conquered the world!` };
  }

  const territories = Object.values(board.territories);
  for (const p of active) {
    if (territories.every(t => t.owner === p.id)) {
      return { outcome: 'win', winnerId: p.id, reason: `${p.name} conquered the world!` };
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

// Fog belief sampler for the generic ObscuroAgent: reconstructs plausible
// opponent card hands (see belief.js) from a single observation, stateful
// across turns so multi-opponent hand SIZES can be tracked. Returns [] when
// there's nothing hidden (no opponent holds any card) — the observation is
// then treated as the single world.
function sampleWorlds(observation, playerId, n, rng = Math.random) {
  const belief = getRiskBelief(observation, playerId);
  belief.update(observation);
  const worlds = belief.reconstructHands(observation, n, rng);
  if (worlds.length === 0) return [];

  return worlds.map(handsByOpponent => {
    const cards = { ...observation.gameSpecific.cards };
    for (const [oid, hand] of handsByOpponent) cards[oid] = hand;
    return { ...observation, gameSpecific: { ...observation.gameSpecific, cards } };
  });
}

// The world map: each territory is a blob of hexes in its real-world place (see
// RiskLayout.js), painted its CONTINENT's colour, with its army count on one
// "capital" hex. Everything about the drawing lives in RiskLayout — this only
// colours it in for the current state.
//
// The fill is the continent's and never the owner's, so the six bonus regions are
// readable off the board at a glance — which continent you are one territory short
// of is the question a Risk player asks most, and it is not one a board coloured by
// seat can answer. Ownership moves onto the things drawn OVER the fill: the blob's
// outline and its army token, both in the owner's seat colour (see HtmlHexLayer,
// which brightens an outline when the fill it surrounds isn't the owner's).
function toGrid(state) {
  const { hexIdsByTerritory, capitalHexByTerritory, hexCells, territoryOfHex, shoreHexesBySeaRoute } = LAYOUT;
  const territories = state.board.territories;

  const pidIdx = {};
  state.players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

  const allHexIds = Object.keys(hexCells);
  const { pixels, minX, minY, width, height } = hexLayoutBounds(allHexIds, hexCells, HEX_SIZE);
  const pad = HEX_SIZE * 2;
  const at = (hexId) => [pixels[hexId].x - minX + pad, pixels[hexId].y - minY + pad];

  const cells = [];
  for (const [tid, hexes] of Object.entries(hexIdsByTerritory)) {
    const t = territories[tid];
    // A territory with no owner is one fog is hiding (getVisibleState) — it keeps its
    // continent colour (which continent a territory is in was never secret) and simply
    // has no token, rather than showing a blob whose count reads "null".
    const hidden = !t || t.owner == null;
    const cont = CONTINENTS[CONTINENT_OF[tid]];
    const capital = capitalHexByTerritory[tid];
    for (const hexId of hexes) {
      const [x, y] = at(hexId);
      const isCapital = hexId === capital;
      cells.push({
        x, y,
        color: cont.color,
        owner: hidden ? 0 : (pidIdx[t.owner] ?? 0),
        territoryId: tid,
        // The token is the army count, not a piece: `label` is what gets drawn on it,
        // while the name behind it stays the territory's, so the action panel and the
        // log can talk about "Ontario" rather than about "4".
        glyph: isCapital && !hidden ? String(t.armies) : '',
        label: isCapital && !hidden ? String(t.armies) : '',
        unitId: isCapital ? tid : undefined,
        unitName: isCapital && !hidden ? TERRITORY_NAMES[tid] : '',
        // Selecting a territory names its continent in the side panel, in the same
        // colour the map just painted it — the fill is now a fact about the board that
        // a player is entitled to read back, along with what holding it all is worth.
        tags: isCapital
          ? [{ label: cont.name, color: cont.color,
               title: `${cont.name} — ${cont.territories.length} territories, +${cont.bonus} armies a turn for holding them all` }]
          : undefined,
      });
    }
  }

  const ownerIdx = (tid) => {
    const t = territories[tid];
    return !t || t.owner == null ? 0 : (pidIdx[t.owner] ?? 0);
  };
  const shift = ([x, y]) => [x - minX + pad, y - minY + pad];
  const borders = territoryBorders(allHexIds, territoryOfHex, hexCells, HEX_SIZE)
    .map(seg => ({
      p1: shift(seg.p1), p2: shift(seg.p2),
      aId: seg.a, aOwner: ownerIdx(seg.a),
      bId: seg.b, bOwner: ownerIdx(seg.b),
    }));

  // The board's connection lines: pairs that can attack each other across water,
  // so the crossing is visible even though the blobs don't touch. Each line runs
  // between the two coasts facing each other (RiskLayout picks the shore hexes),
  // pulled back to the hex's edge so it spans only the water — a line between the
  // capitals would start inland and cross its own territory to get out to sea.
  //
  // A route between opposite edges of the map (Alaska–Kamchatka, around the back of
  // the globe) is drawn as two stubs running off either side rather than one line
  // dragged across every other continent — the same thing the printed board does.
  // Both stubs carry the same pair of ids, so selecting either end lights up both.
  const w = width + pad * 2;
  const shore = HEX_SIZE * Math.sqrt(3) / 2;   // hex centre → middle of an edge
  const toEdge = (from, toward) => {
    const [dx, dy] = [toward[0] - from[0], toward[1] - from[1]];
    const len = Math.hypot(dx, dy) || 1;
    return [from[0] + dx / len * shore, from[1] + dy / len * shore];
  };
  const links = [];
  for (const [a, b] of SEA_ROUTES) {
    const [ha, hb] = shoreHexesBySeaRoute[routeKey(a, b)];
    const p1 = at(ha);
    const p2 = at(hb);
    const ends = { a, b, aOwner: ownerIdx(a), bOwner: ownerIdx(b) };
    if (Math.abs(p2[0] - p1[0]) > w / 2) {
      const [west, east] = p1[0] < p2[0] ? [p1, p2] : [p2, p1];
      links.push({ ...ends, p1: toEdge(west, [west[0] - 1, west[1]]), p2: [0, west[1]] });
      links.push({ ...ends, p1: toEdge(east, [east[0] + 1, east[1]]), p2: [w, east[1]] });
    } else {
      links.push({ ...ends, p1: toEdge(p1, p2), p2: toEdge(p2, p1) });
    }
  }

  // What a player needs to know that isn't drawn on the map: the armies still waiting
  // to be placed, and the hand they're holding. The header's status strip renders these
  // (apps/design/battlefield/StatusChips.vue is domain-agnostic — it shows what it's
  // given), which is why a card is spelled out as its type and territory rather than
  // left as an index into a hand nobody can see.
  const { reinforcementsLeft, cards } = state.gameSpecific;
  const activeId = state.activePlayers?.[0];
  const statusChips = {};
  for (const p of state.players) {
    const chips = [];
    if (p.id === activeId && state.currentPhase === 'reinforce' && reinforcementsLeft > 0) {
      chips.push({ icon: 'plus', value: `${reinforcementsLeft} to place`, title: 'Reinforcements left to place', warn: true });
    }
    const hand = cards?.[p.id] ?? [];
    // Fog hides other players' hands (see getVisibleState), so an empty hand here is
    // either an empty hand or a hidden one — say how many are hidden, not "no cards".
    for (const c of hand) {
      chips.push({
        value: CARD_LABELS[c.type] ?? c.type,
        title: c.territory ? `Card: ${c.type} — ${TERRITORY_NAMES[c.territory] ?? c.territory}` : `Card: ${c.type}`,
      });
    }
    if (hand.length >= 3) chips.push({ value: 'set?', title: 'Three cards: a set may be turnable in during your reinforce phase' });
    statusChips[p.id] = chips;
  }

  return {
    width: width + pad * 2, height: height + pad * 2,
    grid: 'hexagon', hexSize: HEX_SIZE,
    cells,
    territoryBorders: borders,
    links,
    statusChips,
  };
}

function getActionDuration(_state, action) {
  // Abstract game — all phases take time proportional to their complexity
  if (action.type === 'attack')   return 0.5;
  if (action.type === 'fortify')  return 2;
  return 1;
}

export const RiskGame = {
  // Territory control: each owned territory plus its armies, minus opponents'.
  // Heuristic leaf for the generic ObscuroAgent; see games/evalHelpers.js.
  evaluateState: (state, playerId) =>
    sidesEval(Object.values(state.board.territories), playerId, t => 10 + (t.armies ?? 0), t => t.owner),
  name: 'Risk',
  // A territory map, like KDice: the "units" are the territories themselves, showing
  // their army count as the marker label, so there's no facing arrow, roster or HP bar
  // to draw. The map is driven by clicks — pick one of your territories, then click a
  // neighbour to attack it (or, in the fortify phase, to move armies there); a click on
  // a single territory places one reinforcement. Card sets and ending a phase stay in
  // the action panel, since they aren't about any one territory.
  ui: {
    showUnitInfo: false, showFacing: false, showRoster: false, showHpBars: false,
    showRuler: false, hideGridLines: true, territoryClick: true, clearSelectedAtEndOfTurn: true,
    territoryPairTypes: ['attack', 'fortify'],
    territoryTapType: 'place-armies',
    combatFx: true,
    // The map is the game; the log, the roster and the AI's reasoning are not what a
    // player is here for. Both are still a keypress away in the menu.
    showRightSidebar: false, showAiAnalysis: false,
    // Several attacks can match one click on a neighbour, differing only in how many
    // dice are committed — and the dice are also the armies that occupy what you take.
    // The panel offers the choice; a click uses it, shift-click always uses the most.
    territoryPairVariant: { field: 'attackerDice', label: 'Dice', types: ['attack'] },
    // What to call a row of same-action-different-number buttons (the panel groups those
    // on its own; only the game knows what the number counts).
    actionGroupLabels: { occupy: 'Armies to move in' },
    // Three phases inside one turn, and which one you're in decides what a click does —
    // so the header names the phase (ui.phases, in order) and the action panel explains
    // it (ui.phaseHints). The attack hint carries the one rule a player can't read off
    // the board: how many armies occupy a territory they take.
    phases: ['reinforce', 'attack', 'fortify'],
    // The "?" beside the game's name in the header opens this.
    help: {
      title: 'Risk',
      sections: [
        {
          heading: 'Objective',
          text: 'Conquer the world: hold every territory, or be the last player left.',
        },
        {
          heading: 'A turn, in three phases',
          text: 'REINFORCE: you get one army per three territories you hold (never fewer than 3), plus a bonus for every continent you hold whole. Tap your territories to place them, one army per tap; the phase ends itself when the last one is down. ATTACK: click one of your territories, then an adjacent enemy one. FORTIFY: move armies once along a chain of your own territories, then end your turn.',
        },
        {
          heading: 'Combat',
          text: 'The attacker rolls up to 3 dice (never more than armies − 1), the defender up to 2. The highest die of each side is compared, then the next; the defender wins ties. Each comparison costs the loser one army.',
        },
        {
          heading: 'Taking a territory',
          text: 'When the last defender falls you occupy the territory with exactly as many armies as you rolled dice — the rest stay behind. Clicking a neighbour always attacks with the most dice you are entitled to, so a capture normally moves 3 armies in; attacking from a territory holding only 2 or 3 armies rolls (and so moves) fewer.',
        },
        {
          heading: 'Cards',
          text: 'Capture at least one territory in a turn and you draw a card. Three cards of one type, or one of each, or any set with a wild, can be turned in during your reinforce phase for a growing army bonus (4, 6, 8, 10, 12, 15, then +5 each time). Holding 5 cards with a valid set forces you to turn one in. A card showing a territory you own is worth 2 extra armies there.',
        },
      ],
    },
    phaseHints: {
      reinforce: 'Tap your territories to place armies — one per tap. The phase ends itself once the last one is down.',
      attack: 'Click one of your territories, then a neighbour to attack it. The dice you commit are also the armies that move in if you take it — shift-click to always roll the most you can.',
      occupy: 'Territory taken. Choose how many more armies follow the dice in — everything above the one army that has to hold the territory you attacked from.',
      fortify: 'Click one of your territories, then a connected one to move armies there. Or end your turn.',
    },
  },
  // Rule variants, offered in the lobby and resolved once at setup (resolveOptions).
  // Each default is the classic-but-quieter reading: sets worth a flat amount rather
  // than an escalating one, a single fortify move, armies placed by hand — and the
  // occupying force after a capture left to the player, which is the real rule.
  gameOptions: [
    {
      id: 'cardSetValues',
      label: 'Card set values',
      description: 'Fixed: every set of three cards is worth 6 armies. Increasing: sets are worth 4, 6, 8, 10, 12, 15, then +5 each — the classic escalation, which makes holding cards the game\'s clock.',
      type: 'select',
      options: [
        { value: 'fixed', label: 'Fixed (6 each)' },
        { value: 'increasing', label: 'Increasing (4, 6, 8, …)' },
      ],
      default: 'fixed',
    },
    {
      id: 'fortifyMoves',
      label: 'Fortify moves',
      description: 'One: a single move of armies along one connected path per turn (classic). Unlimited: reshuffle your armies as much as you like before ending the turn.',
      type: 'select',
      options: [
        { value: 'one', label: 'One per turn' },
        { value: 'unlimited', label: 'Unlimited' },
      ],
      default: 'one',
    },
    {
      id: 'reinforcePlacement',
      label: 'Reinforcements',
      description: 'Selected: you tap your territories to place each army. Random: they scatter across your territories on their own and the turn starts at the attack phase.',
      type: 'select',
      options: [
        { value: 'selected', label: 'Placed by you' },
        { value: 'random', label: 'Placed at random' },
      ],
      default: 'selected',
    },
    {
      id: 'postCaptureFortify',
      label: 'Choose occupying force',
      description: 'After taking a territory, choose how many more armies follow the dice in (leaving at least one behind). Off: exactly as many armies as dice rolled move in.',
      type: 'boolean',
      default: true,
    },
  ],
  scenarios: [
    {
      id: 'world-domination',
      name: 'World Domination',
      description: 'Classic 42-territory world map — conquer all to win: you against five AI rivals',
      config: {}
    },
  ],
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  toGrid,
  getVisibleState,
  sampleWorlds,
  getActionDuration,
};
