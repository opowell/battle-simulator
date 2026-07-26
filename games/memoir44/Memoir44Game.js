import { HTML_RENDERER_OPTION, MAP_ZOOM_OPTION } from '../renderOptions.js';
import {
  BOARD_COLS, BOARD_ROWS, key, neighbors, distance, sectionOf, SECTIONS,
  retreatNeighbors, toAxial, hexesBetween,
} from './hex.js';
import { hexToPixel, hexLayoutBounds } from '../mapTypes/hexagon.js';
import { unitStats, baseDice, maxRange, UNIT_TYPES } from './units.js';
import { TERRAIN, terrainAt, terrainInfo, defenseReduction, passable, blocksLOS, mustStopOn } from './terrain.js';
import { rollBattle } from './combat.js';
import { buildDeck, shuffle } from './cards.js';
import { SCENARIOS, getScenario } from './scenarios.js';

const HEX_SIZE = 34;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function makeUnit(id, ownerId, type, col, row) {
  const stats = UNIT_TYPES[type];
  return {
    id, ownerId, type,
    position: { col, row },
    figures: stats.figures,
    maxFigures: stats.figures,
    alive: true,
    perTurn: { ordered: false, moved: false, battled: false, battleAllowed: true },
  };
}

function occupiedSet(units, exceptId = null) {
  const set = new Set();
  for (const u of units) if (u.alive && u.id !== exceptId) set.add(key(u.position.col, u.position.row));
  return set;
}

function unitAt(units, col, row) {
  return units.find(u => u.alive && u.position.col === col && u.position.row === row) ?? null;
}

// Line of sight between two hexes: blocked by intervening blocking terrain or any
// unit. Adjacent hexes always see each other.
function hasLOS(from, to, board, units) {
  if (distance(from, to) <= 1) return true;
  for (const h of hexesBetween(from, to)) {
    if (blocksLOS(terrainAt(board, h.col, h.row))) return false;
    if (unitAt(units, h.col, h.row)) return false;
  }
  return true;
}

// All hexes a unit may move to, each tagged with whether it may still battle from
// there. BFS over passable, unoccupied hexes; terrain that "must stop" ends
// movement on entry.
function reachable(unit, board, occ) {
  const stats = unitStats(unit.type);
  const out = new Map();
  const bestSteps = new Map([[key(unit.position.col, unit.position.row), 0]]);
  let frontier = [{ pos: unit.position, steps: 0 }];
  while (frontier.length) {
    const next = [];
    for (const { pos, steps } of frontier) {
      if (steps >= stats.moveMax) continue;
      for (const nb of neighbors(pos.col, pos.row)) {
        const k = key(nb.col, nb.row);
        const tt = terrainAt(board, nb.col, nb.row);
        if (!passable(tt, unit.type)) continue;
        if (occ.has(k)) continue;
        const nsteps = steps + 1;
        if (bestSteps.has(k) && bestSteps.get(k) <= nsteps) continue;
        bestSteps.set(k, nsteps);
        const stop = mustStopOn(tt);
        let battleAllowed;
        if (unit.type === 'artillery') battleAllowed = false;      // move OR battle
        else if (unit.type === 'armor') battleAllowed = true;      // may battle after moving
        else battleAllowed = nsteps === 1 && !stop;                // infantry: move 1 into open
        out.set(k, { col: nb.col, row: nb.row, steps: nsteps, battleAllowed });
        if (!stop) next.push({ pos: nb, steps: nsteps });
      }
    }
    frontier = next;
  }
  return [...out.values()];
}

function canBattleNow(u) {
  if (u.type === 'artillery' && u.perTurn.moved) return false;
  return !u.perTurn.battled && (!u.perTurn.moved || u.perTurn.battleAllowed);
}

function eligibleToOrder(u, ordersLeft) {
  return u.perTurn.ordered || (ordersLeft[sectionOf(u.position.col)] ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Objectives & medals
// ---------------------------------------------------------------------------

// Claim any unclaimed objective hex currently occupied — permanent, one medal.
function claimObjectives(gs, units, players) {
  for (const obj of gs.objectives) {
    if (obj.claimedBy) continue;
    const u = unitAt(units, obj.col, obj.row);
    if (!u) continue;
    const idx = players.findIndex(p => p.id === u.ownerId);
    if (obj.medalFor === 'either' || obj.medalFor === idx) {
      obj.claimedBy = u.ownerId;
      gs.medals[u.ownerId] = (gs.medals[u.ownerId] ?? 0) + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const Memoir44Game = {
  name: 'Memoir 44',

  scenarios: SCENARIOS.map(s => ({ id: s.id, name: s.name, description: s.description, config: { scenario: s.id } })),

  colors: Object.fromEntries(Object.entries(TERRAIN).map(([k, v]) => [k, v.color])),

  gameOptions: [HTML_RENDERER_OPTION, MAP_ZOOM_OPTION],

  ui: { showFacing: false, showHpBars: true, showRoster: true },

  createInitialState(players, config = {}) {
    const scenario = getScenario(config.scenario);
    const [p0, p1] = players;
    const pid = i => (i === 0 ? p0.id : p1.id);

    const units = scenario.units.map((u, i) =>
      makeUnit(`${pid(u.player)}-${u.type}-${i}`, pid(u.player), u.type, u.col, u.row));

    const rng = config.rng ?? Math.random;
    const deck = shuffle(buildDeck(), rng);
    const hands = { [p0.id]: [], [p1.id]: [] };
    for (let i = 0; i < scenario.hands[0]; i++) hands[p0.id].push(deck.pop());
    for (let i = 0; i < scenario.hands[1]; i++) hands[p1.id].push(deck.pop());

    const first = scenario.firstPlayer;
    const gameSpecific = {
      scenarioId: scenario.id,
      medals: { [p0.id]: 0, [p1.id]: 0 },
      medalTarget: scenario.medals,
      baselines: { [p0.id]: scenario.baselines[0], [p1.id]: scenario.baselines[1] },
      deck, discard: [], hands,
      objectives: scenario.objectives.map(o => ({ ...o, claimedBy: null })),
      phase: 'command',
      currentCard: null,
      ordersLeft: { left: 0, center: 0, right: 0 },
      lastBattle: null,
    };
    claimObjectives(gameSpecific, units, players); // units starting on an objective

    return {
      gameName: 'Memoir 44',
      turnNumber: 1,
      activePlayers: [pid(first)],
      currentPhase: 'command',
      players,
      board: { cols: BOARD_COLS, rows: BOARD_ROWS, terrain: scenario.terrain },
      units,
      lastActions: null,
      gameSpecific,
    };
  },

  getLegalActions(state, playerId) {
    const gs = state.gameSpecific;

    if (gs.phase === 'command') {
      const hand = gs.hands[playerId] ?? [];
      if (hand.length === 0) return [{ type: 'end-turn', unitId: '__player__' }];
      const actions = [];
      for (const c of hand) {
        if (c.section === 'any') {
          for (const sec of SECTIONS) actions.push({ type: 'play-card', cardId: c.id, section: sec });
        } else {
          actions.push({ type: 'play-card', cardId: c.id, section: c.section });
        }
      }
      return actions;
    }

    // Orders phase
    const { board, units } = state;
    const myUnits = units.filter(u => u.alive && u.ownerId === playerId);
    const actions = [];
    for (const u of myUnits) {
      if (!eligibleToOrder(u, gs.ordersLeft)) continue;
      // Move
      if (!u.perTurn.moved && !u.perTurn.battled) {
        const occ = occupiedSet(units, u.id);
        for (const dest of reachable(u, board, occ)) {
          actions.push({ type: 'move', unitId: u.id, from: { ...u.position }, to: { col: dest.col, row: dest.row } });
        }
      }
      // Battle
      if (canBattleNow(u)) {
        const stats = unitStats(u.type);
        for (const e of units) {
          if (!e.alive || e.ownerId === playerId) continue;
          const range = distance(u.position, e.position);
          if (range > maxRange(u.type)) continue;
          if (stats.needsLOS && !hasLOS(u.position, e.position, board, units)) continue;
          actions.push({ type: 'attack', unitId: u.id, targetId: e.id });
        }
      }
    }
    actions.push({ type: 'end-turn', unitId: '__player__' });
    return actions;
  },

  applyActions(state, playerActions, rng = Math.random) {
    const { playerId, action } = playerActions[0];
    const players = state.players;
    const playerIds = players.map(p => p.id);
    let units = state.units.map(u => ({ ...u, position: { ...u.position }, perTurn: { ...u.perTurn } }));
    const gs = structuredCloneGS(state.gameSpecific);
    const board = state.board;

    if (action.type === 'play-card') {
      const hand = gs.hands[playerId];
      const idx = hand.findIndex(c => c.id === action.cardId);
      const card = hand[idx];
      hand.splice(idx, 1);
      gs.discard.push(card);
      gs.currentCard = { ...card, playedSection: action.section };
      gs.ordersLeft = { left: 0, center: 0, right: 0 };
      if (card.section === 'all') {
        for (const s of SECTIONS) gs.ordersLeft[s] = card.orders;
      } else {
        gs.ordersLeft[action.section] = card.orders;
      }
      gs.phase = 'orders';
      // fresh activation flags for this player's units
      units = units.map(u => u.ownerId === playerId
        ? { ...u, perTurn: { ordered: false, moved: false, battled: false, battleAllowed: true } }
        : u);
      return { ...state, units, currentPhase: 'orders', gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'move') {
      const u = units.find(x => x.id === action.unitId);
      consumeOrder(gs, u);
      const dest = reachable(u, board, occupiedSet(units, u.id))
        .find(d => d.col === action.to.col && d.row === action.to.row);
      u.position = { col: action.to.col, row: action.to.row };
      u.perTurn.moved = true;
      u.perTurn.battleAllowed = dest ? dest.battleAllowed : false;
      claimObjectives(gs, units, players);
      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'attack') {
      const attacker = units.find(x => x.id === action.unitId);
      const defender = units.find(x => x.id === action.targetId);
      consumeOrder(gs, attacker);
      attacker.perTurn.battled = true;

      const range = distance(attacker.position, defender.position);
      let dice = baseDice(attacker.type, range);
      if (!unitStats(attacker.type).ignoresTerrain) {
        dice = Math.max(0, dice - defenseReduction(terrainAt(board, defender.position.col, defender.position.row), defender.type));
      }
      const { rolls, hits, flags } = rollBattle(dice, defender.type, rng);

      let figuresLost = Math.min(hits, defender.figures);
      // Retreats: one hex per flag toward the defender's baseline; each flag that
      // can't be honored (no legal hex) becomes an extra casualty instead.
      let pos = { ...defender.position };
      const defBaseline = gs.baselines[defender.ownerId];
      let extraHits = 0;
      if (defender.figures - figuresLost > 0) {
        for (let f = 0; f < flags; f++) {
          const opts = retreatNeighbors(pos, defBaseline)
            .filter(n => passable(terrainAt(board, n.col, n.row), defender.type) && !unitAt(units, n.col, n.row));
          if (opts.length === 0) { extraHits++; continue; }
          pos = { col: opts[0].col, row: opts[0].row };
        }
      }
      figuresLost = Math.min(defender.figures, figuresLost + extraHits);

      defender.position = pos;
      defender.figures -= figuresLost;
      if (defender.figures <= 0) {
        defender.alive = false;
        gs.medals[attacker.ownerId] = (gs.medals[attacker.ownerId] ?? 0) + 1;
      }
      gs.lastBattle = { attacker: attacker.id, defender: defender.id, dice, rolls, hits: figuresLost, flags, range };
      claimObjectives(gs, units, players);
      return { ...state, units, gameSpecific: gs, lastActions: playerActions };
    }

    if (action.type === 'end-turn') {
      // Draw back up to hand: one card (you played one this turn). Reshuffle the
      // discard into the deck if the deck runs dry.
      const hand = gs.hands[playerId];
      // Draw back up to the scenario's command-card hand size.
      const want = handSizeFor(state, playerId);
      while (hand.length < want) {
        if (gs.deck.length === 0) {
          if (gs.discard.length === 0) break;
          gs.deck = shuffle(gs.discard, rng);
          gs.discard = [];
        }
        hand.push(gs.deck.pop());
      }

      units = units.map(u => u.ownerId === playerId
        ? { ...u, perTurn: { ordered: false, moved: false, battled: false, battleAllowed: true } }
        : u);

      const curIdx = playerIds.indexOf(playerId);
      const nextIdx = (curIdx + 1) % playerIds.length;
      const nextPlayer = playerIds[nextIdx];
      const newTurn = nextIdx === firstPlayerIdx(state) ? state.turnNumber + 1 : state.turnNumber;

      gs.phase = 'command';
      gs.currentCard = null;
      gs.ordersLeft = { left: 0, center: 0, right: 0 };
      claimObjectives(gs, units, players);
      return { ...state, units, activePlayers: [nextPlayer], currentPhase: 'command', turnNumber: newTurn, gameSpecific: gs, lastActions: playerActions };
    }

    return state;
  },

  getResult(state) {
    const gs = state.gameSpecific;
    const players = state.players;
    for (const p of players) {
      if ((gs.medals[p.id] ?? 0) >= gs.medalTarget) {
        return { outcome: 'win', winnerId: p.id, reason: `${gs.medalTarget} medals` };
      }
    }
    // A side wiped out loses even short of the medal target.
    for (const p of players) {
      const hasUnits = state.units.some(u => u.ownerId === p.id && u.alive);
      if (!hasUnits) {
        const other = players.find(q => q.id !== p.id);
        return { outcome: 'win', winnerId: other.id, reason: 'army eliminated' };
      }
    }
    return null;
  },

  evaluateState(state, playerId) {
    const gs = state.gameSpecific;
    const opp = state.players.find(p => p.id !== playerId)?.id;
    let score = ((gs.medals[playerId] ?? 0) - (gs.medals[opp] ?? 0)) * 100;
    for (const u of state.units) {
      if (!u.alive) continue;
      score += (u.ownerId === playerId ? 1 : -1) * (u.figures * 8 + 6);
    }
    return score;
  },

  renderState(state) {
    return renderText(state);
  },

  toGrid(state) {
    return toGrid(state);
  },

  getActionDuration(state, action) {
    if (action.type === 'move') {
      return Math.max(1, distance(action.from, action.to));
    }
    if (action.type === 'attack') return 1;
    return 0.5;
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function structuredCloneGS(gs) {
  return {
    ...gs,
    medals: { ...gs.medals },
    baselines: { ...gs.baselines },
    ordersLeft: { ...gs.ordersLeft },
    hands: Object.fromEntries(Object.entries(gs.hands).map(([k, v]) => [k, [...v]])),
    deck: [...gs.deck],
    discard: [...gs.discard],
    objectives: gs.objectives.map(o => ({ ...o })),
    currentCard: gs.currentCard ? { ...gs.currentCard } : null,
  };
}

function consumeOrder(gs, unit) {
  if (unit.perTurn.ordered) return;
  const sec = sectionOf(unit.position.col);
  if ((gs.ordersLeft[sec] ?? 0) > 0) gs.ordersLeft[sec]--;
  unit.perTurn.ordered = true;
}

function firstPlayerIdx(state) {
  return getScenario(state.gameSpecific.scenarioId).firstPlayer;
}

function handSizeFor(state, playerId) {
  const sc = getScenario(state.gameSpecific.scenarioId);
  const idx = state.players.findIndex(p => p.id === playerId);
  return sc.hands[idx] ?? sc.hands[0];
}

// ---------------------------------------------------------------------------
// Text render
// ---------------------------------------------------------------------------

const TERRAIN_CHAR = {
  grass: '.', forest: 'f', town: 't', hill: 'h', hedgerow: 'H',
  river: '~', bridge: '=', beach: ',', sandbags: 's', ocean: '≈',
};

function renderText(state) {
  const { board, units, players, gameSpecific: gs } = state;
  const p0 = players[0].id;
  const rows = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    let line = row % 2 === 1 ? ' ' : '';
    for (let col = 0; col < BOARD_COLS; col++) {
      const u = unitAt(units, col, row);
      if (u) {
        const g = UNIT_TYPES[u.type].glyph;
        line += (u.ownerId === p0 ? g : g.toLowerCase()) + ' ';
      } else {
        line += (TERRAIN_CHAR[terrainAt(board, col, row)] ?? '.') + ' ';
      }
    }
    rows.push(line.trimEnd());
  }
  const medals = players.map(p => `${p.name}: ${gs.medals[p.id]}/${gs.medalTarget}`).join('  |  ');
  const active = state.activePlayers[0];
  const phase = gs.phase === 'command'
    ? `${active} to play a command card`
    : `${active} orders (L${gs.ordersLeft.left} C${gs.ordersLeft.center} R${gs.ordersLeft.right})` +
      (gs.currentCard ? ` — ${gs.currentCard.name}` : '');
  return [
    `Turn ${state.turnNumber} — ${phase}`,
    rows.join('\n'),
    medals,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Grid render (hex board for the web UI — see games/mapTypes/hexagon.js)
// ---------------------------------------------------------------------------

function toGrid(state) {
  const { board, units, players, gameSpecific: gs } = state;
  const pidIdx = {};
  players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

  // Build axial cell map for every board hex so the shared hex layout can place
  // pixel centers.
  const cellsAxial = {};
  const ids = [];
  const idOf = {};
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const { q, r } = toAxial(col, row);
      const id = `${q},${r}`;
      cellsAxial[id] = { q, r };
      ids.push(id);
      idOf[key(col, row)] = id;
    }
  }
  const { pixels, minX, minY, width, height } = hexLayoutBounds(ids, cellsAxial, HEX_SIZE);
  const pad = HEX_SIZE * 1.5;

  const objSet = new Set(gs.objectives.map(o => key(o.col, o.row)));
  const cells = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const id = idOf[key(col, row)];
      const p = pixels[id];
      const tt = terrainAt(board, col, row);
      const u = unitAt(units, col, row);
      const info = terrainInfo(tt);
      cells.push({
        x: p.x - minX + pad,
        y: p.y - minY + pad,
        col, row,
        color: info.color,
        owner: u ? (pidIdx[u.ownerId] ?? 0) : 0,
        glyph: u ? UNIT_TYPES[u.type].glyph : (objSet.has(key(col, row)) ? '✪' : ''),
        unitId: u ? u.id : undefined,
        unitName: u ? `${UNIT_TYPES[u.type].name} (${u.figures})` : undefined,
        hp: u ? u.figures : undefined,
        maxHp: u ? u.maxFigures : undefined,
        terrain: { name: info.name + (objSet.has(key(col, row)) ? ' — Objective' : ''), description: '' },
        objective: objSet.has(key(col, row)),
      });
    }
  }

  return {
    width: width + pad * 2,
    height: height + pad * 2,
    grid: 'hexagon',
    hexSize: HEX_SIZE,
    cells,
  };
}
