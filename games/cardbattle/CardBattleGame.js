import { unitStrengthEval } from '../evalHelpers.js';
import { getCardBattleBelief } from './belief.js';
import { whole } from '../../engine/foreignUnits.js';
/**
 * Card Battle — demonstrates simultaneous multi-player turns.
 *
 * Both players are always in activePlayers. Each step, the engine gathers one
 * action from each player simultaneously, then resolves them together.
 *
 * Cards: attack (deal 8 dmg), heavy-attack (deal 14 dmg, skip next turn),
 *        block (halve incoming damage this step), heal (restore 6 hp).
 *
 * A side's heroes are its units. Its own is the standard one — 30 hp, hitting as
 * hard as its cards say, taking what they say — but a hero from another game
 * (engine/foreignUnits.js) hits `attack / 8` times as hard and takes `1 / defense`
 * of the damage. A side with several heroes plays each card with one of them, at
 * one of the other side's; it is beaten when it has none left standing.
 */

const STARTING_DECK = [
  'attack', 'attack', 'attack',
  'heavy-attack', 'heavy-attack',
  'block', 'block',
  'heal', 'heal',
];

const MAX_HP = 30;
const HAND_SIZE = 4;
const ATTACK = 8;     // a standard hero's punch: an attack card's damage, as dealt
const DEFENSE = 1;    // and its guard: it takes a card's damage as written

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
  return heroesOf(state, playerId)[0] ?? state.units.find(u => u.ownerId === playerId && u.type === 'hero');
}

/** A side's heroes still standing. */
function heroesOf(state, playerId) {
  return state.units.filter(u => u.ownerId === playerId && u.type === 'hero' && u.alive);
}

/** What `card` played by `by` does to `target`, blocking or not. */
function damageOf(baseDmg, by, target, blocking) {
  const dmg = baseDmg * ((by?.attack ?? ATTACK) / ATTACK) / (target.defense ?? DEFENSE) / (blocking ? 2 : 1);
  return Math.max(1, Math.ceil(dmg - 1e-9));
}

function makeHero(id, ownerId) {
  return { id, ownerId, type: 'hero', position: null, alive: true, hp: MAX_HP, maxHp: MAX_HP };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const CardBattleGame = {
  // Heuristic leaf value for the generic ObscuroAgent: own surviving strength
  // minus the enemy's. See games/evalHelpers.js.
  evaluateState: (state, playerId) => unitStrengthEval(state, playerId),
  name: 'CardBattle',
  scenarios: [
    { id: 'standard', name: 'Standard Duel', description: '30HP each, draw and play cards to win', config: {} },
  ],

  createInitialState(players, _config, rng = Math.random) {
    const units = players.map(p => makeHero(`${p.id}-hero`, p.id));

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

  createSetupUnit(_state, { id, ownerId, type }) {
    return type === 'hero' ? makeHero(id, ownerId) : null;
  },

  // Units from other games (engine/foreignUnits.js). The conversion factor is the
  // hero: 30 hp, hitting for an attack card's 8, taking a card's damage as written.
  // There is no board, so range and move are the hero's one square; every unit
  // from elsewhere plays as a hero, with its hp, punch and guard its own.
  foreignUnits: {
    scale: { hp: MAX_HP, attack: ATTACK, defense: DEFENSE, range: 1, move: 1 },
    profiles: () => ({ hero: { hp: MAX_HP, attack: ATTACK, defense: DEFENSE, range: 1, move: 1, domain: 'land' } }),
    adopt: (u, s) => ({ ...u, hp: whole(s.hp), maxHp: whole(s.hp), attack: s.attack, defense: s.defense }),
    realize: (_type, s) => ({ hp: whole(s.hp), attack: s.attack, defense: s.defense, range: 1, move: 1 }),
    art: () => ({ glyph: 'H', name: 'hero' }),
  },

  getLegalActions(state, playerId) {
    const hand = state.gameSpecific.hands[playerId];
    const hero = heroOf(state, playerId);
    const heroes = heroesOf(state, playerId);
    const targets = state.players.filter(p => p.id !== playerId).flatMap(p => heroesOf(state, p.id));
    const targetId = targets[0]?.id ?? state.units.find(u => u.ownerId !== playerId && u.type === 'hero')?.id;

    // If skipping this turn (heavy-attack penalty), only option is 'pass'
    if (state.gameSpecific.skipping[playerId]) {
      return [{ type: 'play-card', unitId: hero.id, payload: { card: 'pass', handIndex: -1, targetId } }];
    }

    // Every card, played by each of the side's heroes at each of the other side's.
    // With one hero a side (the game's own duel) that is just the hand.
    const actions = [];
    for (const by of heroes.length ? heroes : [hero]) {
      for (const at of targets.length > 1 ? targets : [{ id: targetId }]) {
        hand.forEach((card, handIndex) => actions.push({ type: 'play-card', unitId: by.id, payload: { card, handIndex, targetId: at.id } }));
      }
    }
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    // Collect each player's chosen card, and the hero playing it
    const chosen = {};
    const playedBy = {};
    for (const { playerId, action } of playerActions) {
      chosen[playerId] = action.payload;
      playedBy[playerId] = state.units.find(u => u.id === action.unitId) ?? heroOf(state, playerId);
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
        const dmg = damageOf(baseDmg, playedBy[pid], target, blocking[target.ownerId]);
        const newHp = Math.max(0, target.hp - dmg);
        units = units.map(u => u.id === targetId ? { ...u, hp: newHp, alive: newHp > 0 } : u);
        if (card === 'heavy-attack') skipping[pid] = true; // skip next turn
      }

      if (card === 'heal') {
        const hero = units.find(u => u.id === playedBy[pid]?.id) ?? units.find(u => u.ownerId === pid && u.type === 'hero');
        if (hero && hero.alive) {
          const newHp = Math.min(hero.maxHp ?? MAX_HP, hero.hp + 6);
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
    // A side is in it while any of its heroes stands.
    const standing = state.players.filter(p => heroesOf(state, p.id).length);
    if (standing.length === state.players.length) return null;
    if (standing.length === 0) return { outcome: 'draw', winnerId: null, reason: 'both-heroes-died' };
    if (standing.length > 1) return null;
    return { outcome: 'win', winnerId: standing[0].id, reason: 'last-hero-standing' };
  },

  renderState(state) {
    const heroes = state.players.map(p => {
      const heroes = state.units.filter(u => u.ownerId === p.id && u.type === 'hero');
      const hand = state.gameSpecific.hands[p.id];
      const skipNote = state.gameSpecific.skipping[p.id] ? ' [SKIP]' : '';
      return `${p.name}${skipNote}: ${heroes.map(h => `${h.hp}/${h.maxHp}`).join(' + ')} hp | hand: [${hand.join(', ')}]`;
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

  sampleWorlds(observation, playerId, n, rng = Math.random) {
    const opponentId = observation.players.map(p => p.id).find(id => id !== playerId);
    if (!opponentId) return [];
    const hand = observation.gameSpecific.hands[opponentId];
    const deck = observation.gameSpecific.decks[opponentId];
    if (!hand || !deck) return [];
    // Nothing hidden (e.g. fog off, or somehow already revealed) — no worlds to sample.
    if (!hand.some(c => c === '?') && !deck.some(c => c === '?')) return [];

    const belief = getCardBattleBelief(observation, playerId);
    belief.beginTurn(observation);
    const reconstructions = belief.sample(hand.length, deck.length, n, rng);

    return reconstructions.map(({ hand: h, deck: d }) => ({
      ...observation,
      gameSpecific: {
        ...observation.gameSpecific,
        hands: { ...observation.gameSpecific.hands, [opponentId]: h },
        decks: { ...observation.gameSpecific.decks, [opponentId]: d },
      },
    }));
  },
};
