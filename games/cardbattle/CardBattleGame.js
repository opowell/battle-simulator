/**
 * Card Battle — demonstrates simultaneous multi-player turns.
 *
 * Both players are always in activePlayers. Each step, the engine gathers one
 * action from each player simultaneously, then resolves them together.
 *
 * Cards: attack (deal 8 dmg), heavy-attack (deal 14 dmg, skip next turn),
 *        block (halve incoming damage this step), heal (restore 6 hp).
 */

const STARTING_DECK = [
  'attack', 'attack', 'attack',
  'heavy-attack', 'heavy-attack',
  'block', 'block',
  'heal', 'heal',
];

const MAX_HP = 30;
const HAND_SIZE = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCards(deck, hand, n, rng) {
  let d = [...deck], h = [...hand];
  for (let i = 0; i < n; i++) {
    if (d.length === 0) d = shuffle(STARTING_DECK, rng); // reshuffle discard
    h.push(d.shift());
  }
  return { deck: d, hand: h };
}

function heroOf(state, playerId) {
  return state.units.find(u => u.ownerId === playerId && u.type === 'hero');
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const CardBattleGame = {
  name: 'CardBattle',

  createInitialState(players, _config, rng = Math.random) {
    const units = players.map(p => ({
      id: `${p.id}-hero`,
      ownerId: p.id,
      type: 'hero',
      position: null,
      alive: true,
      hp: MAX_HP,
      maxHp: MAX_HP,
    }));

    const hands = {};
    const decks = {};
    for (const p of players) {
      const deck = shuffle(STARTING_DECK, rng);
      const drawn = drawCards(deck, [], HAND_SIZE, rng);
      hands[p.id] = drawn.hand;
      decks[p.id] = drawn.deck;
    }

    return {
      gameName: 'CardBattle',
      turnNumber: 1,
      activePlayers: players.map(p => p.id),   // all players act simultaneously
      currentPhase: 'play',
      players,
      board: {},
      units,
      lastActions: null,
      gameSpecific: { hands, decks, skipping: {} },
    };
  },

  getLegalActions(state, playerId) {
    const hand = state.gameSpecific.hands[playerId];
    const hero = heroOf(state, playerId);
    const targetId = state.units.find(u => u.ownerId !== playerId && u.type === 'hero')?.id;

    // If skipping this turn (heavy-attack penalty), only option is 'pass'
    if (state.gameSpecific.skipping[playerId]) {
      return [{ type: 'play-card', unitId: hero.id, payload: { card: 'pass', handIndex: -1, targetId } }];
    }

    return hand.map((card, handIndex) => ({
      type: 'play-card',
      unitId: hero.id,
      payload: { card, handIndex, targetId },
    }));
  },

  applyActions(state, playerActions, rng = Math.random) {
    // Collect each player's chosen card
    const chosen = {};
    for (const { playerId, action } of playerActions) {
      chosen[playerId] = action.payload;
    }

    let units = [...state.units];
    let hands = { ...state.gameSpecific.hands };
    let decks = { ...state.gameSpecific.decks };
    const skipping = { ...state.gameSpecific.skipping };

    // Determine blocking status before applying damage
    const blocking = {};
    for (const [pid, payload] of Object.entries(chosen)) {
      blocking[pid] = payload.card === 'block';
    }

    // Resolve each player's card effect
    for (const [pid, payload] of Object.entries(chosen)) {
      const { card, handIndex } = payload;

      if (card === 'pass') {
        // Skip turn (heavy-attack penalty): do nothing, clear skip flag
        skipping[pid] = false;
        continue;
      }

      // Remove played card from hand
      if (handIndex >= 0) {
        hands[pid] = hands[pid].filter((_, i) => i !== handIndex);
      }

      const targetId = payload.targetId;
      const target = units.find(u => u.id === targetId);

      if ((card === 'attack' || card === 'heavy-attack') && target) {
        const baseDmg = card === 'heavy-attack' ? 14 : 8;
        const dmg = blocking[target.ownerId] ? Math.ceil(baseDmg / 2) : baseDmg;
        const newHp = Math.max(0, target.hp - dmg);
        units = units.map(u => u.id === targetId ? { ...u, hp: newHp, alive: newHp > 0 } : u);
        if (card === 'heavy-attack') skipping[pid] = true; // skip next turn
      }

      if (card === 'heal') {
        const hero = units.find(u => u.ownerId === pid && u.type === 'hero');
        if (hero) {
          const newHp = Math.min(MAX_HP, hero.hp + 6);
          units = units.map(u => u.id === hero.id ? { ...u, hp: newHp } : u);
        }
      }
      // 'block' is handled above via blocking[]; no other effect
    }

    // Draw replacement cards for all players
    for (const p of state.players) {
      const needed = HAND_SIZE - hands[p.id].length;
      if (needed > 0) {
        const drawn = drawCards(decks[p.id], hands[p.id], needed, rng);
        hands[p.id] = drawn.hand;
        decks[p.id] = drawn.deck;
      }
    }

    return {
      ...state,
      units,
      turnNumber: state.turnNumber + 1,
      lastActions: playerActions,
      gameSpecific: { hands, decks, skipping },
    };
  },

  getResult(state) {
    const dead = state.units.filter(u => u.type === 'hero' && !u.alive);
    if (dead.length === 0) return null;
    if (dead.length >= 2) return { outcome: 'draw', winnerId: null, reason: 'both-heroes-died' };
    const winner = state.units.find(u => u.type === 'hero' && u.alive);
    return { outcome: 'win', winnerId: winner.ownerId, reason: 'last-hero-standing' };
  },

  renderState(state) {
    const heroes = state.players.map(p => {
      const hero = heroOf(state, p.id);
      const hand = state.gameSpecific.hands[p.id];
      const skipNote = state.gameSpecific.skipping[p.id] ? ' [SKIP]' : '';
      return `${p.name}${skipNote}: ${hero.hp}/${hero.maxHp} hp | hand: [${hand.join(', ')}]`;
    });
    return `Turn ${state.turnNumber}\n` + heroes.join('\n');
  },

  getActionDuration(_state, action) {
    if (action.type === 'play-card') {
      const card = action.payload?.card;
      if (card === 'heavy-attack') return 2;
      if (card === 'heal')         return 1.5;
      if (card === 'block')        return 0.5;
      if (card === 'attack')       return 1;
    }
    return 1;
  },

  getVisibleState(state, playerId) {
    const hands = {};
    const decks  = {};
    for (const [pid, hand] of Object.entries(state.gameSpecific.hands)) {
      hands[pid] = pid === playerId ? hand : hand.map(() => '?');
    }
    for (const [pid, deck] of Object.entries(state.gameSpecific.decks)) {
      decks[pid]  = pid === playerId ? deck : deck.map(() => '?');
    }
    return { ...state, gameSpecific: { ...state.gameSpecific, hands, decks } };
  },
};
