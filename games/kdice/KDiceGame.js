import { sidesEval } from '../evalHelpers.js';
import { generateMap, getLargestConnectedRegion } from './map.js';
import { getKDiceBelief, visibleTerritoryIds } from './belief.js';
import { hexLayoutBounds, territoryBorders } from '../mapTypes/hexagon.js';

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

  const {
    territoryIds, adjacency, hexIdsByTerritory, capitalHexByTerritory,
    hexCells, hexSize, cols, rows,
  } = generateMap(numPlayers, rng);

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
    board: {
      territories, adjacency, hexIdsByTerritory, capitalHexByTerritory,
      hexCells, hexSize, cols, rows,
    },
    lastActions: [],
    gameSpecific: {
      currentPlayerIndex: 0,
      lastBattle: null,
      eliminatedPlayers: [],
      fogOfWar: config.fogOfWar ?? false,
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
        actions.push({ type: 'attack', unitId: from.id, from: from.id, to: toId });
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
    // Defensive guard: under fog, ObscuroAgent applies legal actions (derived
    // from the TRUE state) to belief-sampled worlds during search. A sampled
    // world can occasionally disagree with the acting territory (e.g. it no
    // longer belongs to playerId, or the target vanished) — bail out rather
    // than crash or corrupt state, mirroring aow/civ1's attack-handler guards.
    if (!from || !to || from.owner !== playerId || to.owner === playerId) {
      newState.lastActions = playerActions;
      return newState;
    }
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

    // Stamp the dice-roll result directly onto the action object — the engine's
    // log stores this exact `action` reference (see engine/GameEngine.js
    // _stepDiscrete's `playerActions.push`), so mutating it here is how the
    // battle's outcome ends up visible in the game log after the fact rather
    // than only in the transient (next-turn-clearing) gameSpecific.lastBattle.
    action.result = { attackerRolls, defenderRolls, attackerSum, defenderSum, won };
  }

  else if (action.type === 'end-turn') {
    // Bonus dice count = largest connected region size - 1, but distributed
    // randomly across every territory the player owns (not just that region).
    const region = getLargestConnectedRegion(playerId, territories, adjacency);
    let bonusDice = Math.max(0, region.length - 1);

    const owned = Object.values(territories).filter(t => t.owner === playerId).map(t => t.id);
    const ownedShuffled = shuffle(owned, rng);
    const reinforced = new Set();
    let idx = 0;
    let passes = 0;
    while (bonusDice > 0 && passes < ownedShuffled.length) {
      const tid = ownedShuffled[idx % ownedShuffled.length];
      if (territories[tid].dice < MAX_DICE) {
        territories[tid] = { ...territories[tid], dice: territories[tid].dice + 1 };
        reinforced.add(tid);
        bonusDice--;
        passes = 0;
      } else {
        passes++;
      }
      idx++;
    }

    // Stamp which territories got a bonus die onto the action (same trick as the
    // attack branch's action.result — see its comment) so the client can flash
    // them once, in one place, without re-deriving the diff from board state.
    action.result = { reinforced: [...reinforced] };

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
  const { territories } = board;
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

  // Territory listing (the board is a multi-hex map — see toGrid for the
  // visual hex layout; this text view just lists each territory's state).
  lines.push('');
  for (const id of Object.keys(territories).sort()) {
    const t = territories[id];
    lines.push(`  ${id.padEnd(4)} ${playerLabel(t.owner)}:${t.dice}`);
  }

  lines.push('═'.repeat(56));
  return lines.join('\n');
}

// By default all information is public in KDice (matches the real board
// game). The optional fogOfWar gameOption ("hide part of the map") switches
// this to: a territory's owner/dice are visible only if it's ours or
// graph-adjacent (hop 1) to one of ours; everything else is concealed.
function getVisibleState(state, playerId) {
  if (!state.gameSpecific.fogOfWar) return state;

  const { territories, adjacency } = state.board;
  const vis = visibleTerritoryIds(territories, adjacency, playerId);

  const filtered = {};
  for (const [id, t] of Object.entries(territories)) {
    filtered[id] = vis.has(id) ? t : { ...t, owner: null, dice: null };
  }

  return { ...state, board: { ...state.board, territories: filtered } };
}

// Fog belief sampler for the generic ObscuroAgent: plausible full worlds with
// hidden territories' owner/dice filled in from the stateful KDiceBelief
// (belief.js). Returns [] when fog is off (agent uses the observation as the
// single world).
function sampleWorlds(observation, playerId, n, rng = Math.random) {
  if (!observation.gameSpecific.fogOfWar) return [];
  const belief = getKDiceBelief(observation, playerId);
  belief.beginTurn(observation);
  return belief.sample(observation, n, rng);
}

function getActionDuration(_state, action) {
  if (action.type === 'attack') return 0.3;
  return 1;
}

// Each territory renders as a blob of colored hexes (owner's team colour on
// every hex it owns — see SchematicLayer's 'team' tile-colour sentinel),
// with a single dice-count "unit" token anchored at the territory's capital
// hex (its most central cell — see games/mapTypes/hexagon.js territoryCapital).
// Non-capital hexes carry no unit, only a `territoryId` so the client can
// resolve a click anywhere in the blob to the territory as a whole.
function toGrid(state) {
  const { territories, hexIdsByTerritory, capitalHexByTerritory, hexCells, hexSize } = state.board;
  const pidIdx = {};
  state.players.forEach((p, i) => { pidIdx[p.id] = i + 1; });

  const allHexIds = Object.values(hexIdsByTerritory).flat();
  const { pixels, minX, minY, width, height } = hexLayoutBounds(allHexIds, hexCells, hexSize);
  const pad = hexSize * 2;
  const px = (id) => pixels[id].x - minX + pad;
  const py = (id) => pixels[id].y - minY + pad;

  const cells = [];
  const territoryOfHex = {};
  for (const t of Object.values(territories)) {
    for (const hexId of hexIdsByTerritory[t.id]) territoryOfHex[hexId] = t.id;
  }

  for (const t of Object.values(territories)) {
    // Fog-of-war hides owner/dice on distant territories (see getVisibleState) —
    // render those hexes as a neutral, unlabeled blob rather than a token
    // with a "null" label.
    const hidden = t.owner == null;
    const capitalId = capitalHexByTerritory[t.id];
    for (const hexId of hexIdsByTerritory[t.id]) {
      const isCapital = hexId === capitalId;
      cells.push({
        x: px(hexId), y: py(hexId),
        color: hidden ? '#2b2f38' : 'team',
        owner: hidden ? 0 : (pidIdx[t.owner] ?? 0),
        territoryId: t.id,
        glyph: isCapital && !hidden ? String(t.dice) : '',
        unitId: isCapital ? t.id : undefined,
        unitName: isCapital && !hidden ? String(t.dice) : '',
        hp: isCapital && !hidden ? t.dice : undefined,
        maxHp: MAX_DICE,
      });
    }
  }

  // One clean outline per territory (only the edges bordering a different
  // territory or the map edge — see games/mapTypes/hexagon.js) instead of a
  // full hex lattice, so the board reads as a blob map, not a honeycomb. Each
  // shared edge is emitted once (deduped in territoryBorders itself), tagged
  // with BOTH bordering territories, so the client can correctly recolor it
  // when either side is selected without a stale duplicate painting over it.
  const shift = ([x, y]) => [x - minX + pad, y - minY + pad];
  const ownerIdx = (tid) => {
    if (tid == null) return 0;
    const t = territories[tid];
    return t.owner == null ? 0 : (pidIdx[t.owner] ?? 0);
  };
  const territoryBorderList = territoryBorders(allHexIds, territoryOfHex, hexCells, hexSize)
    .map(seg => ({
      p1: shift(seg.p1), p2: shift(seg.p2),
      aId: seg.a, aOwner: ownerIdx(seg.a),
      bId: seg.b, bOwner: ownerIdx(seg.b),
    }));

  return {
    width: width + pad * 2, height: height + pad * 2,
    grid: 'hexagon', hexSize,
    cells,
    territoryBorders: territoryBorderList,
  };
}

export const KDiceGame = {
  // Territory control: each owned territory plus its dice, minus opponents'.
  // Heuristic leaf for the generic ObscuroAgent; see games/evalHelpers.js.
  evaluateState: (state, playerId) =>
    sidesEval(Object.values(state.board.territories), playerId, t => 10 + (t.dice ?? 0), t => t.owner),
  name: 'KDice',
  // Territories double as "units" showing their dice count as the marker letter (see
  // toGrid) — there's no unit heading to show, and the digit is essential info, so the
  // facing arrow (which would hide it behind a generic marker, see SchematicLayer) is off.
  // No roster/HP bars either — a territory's dice count *is* its "HP", already shown as
  // the hex label, so a roster card + bar would just be redundant chrome. And attacks are
  // driven entirely by clicking the map (select a territory, then click its target) — see
  // Battlefield.vue's territoryClick flow — so the action panel only needs "End turn".
  ui: {
    showUnitInfo: false, showFacing: false, showRoster: false, showHpBars: false,
    showRuler: false, hideGridLines: true, territoryClick: true, clearSelectedAtEndOfTurn: true,
    // Flashes attacker + defender white on each attack (see App.vue's action.to handling).
    combatFx: true,
  },
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Distant territories are hidden until you border them', type: 'boolean', default: false },
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
