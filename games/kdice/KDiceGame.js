import { generateMap, getLargestConnectedRegion } from './map.js';
import { getKDiceBelief, visibleTerritoryIds } from './belief.js';
import { hexLayoutBounds, territoryBorders } from '../mapTypes/hexagon.js';
import { MAX_DICE, DEFAULT_STOCK_MAX, winProbability } from './odds.js';
import { KDiceAgent, evaluatePosition } from './agent.js';

// The most dice a player may keep in reserve (KDice's 32 — see odds.js and stockMaxOf).
export { DEFAULT_STOCK_MAX };

/**
 * The reserve cap a session plays with: the `stockMax` game option when it is a
 * usable number, else KDice's own 32. Stored on the state (gameSpecific.stockMax)
 * so the rules, the AI and the leaderboard all read one value.
 */
function stockMaxOf(config = {}) {
  const v = config.stockMax;
  if (v === '' || v == null) return DEFAULT_STOCK_MAX;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STOCK_MAX;
}

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
      stock: { ...(state.gameSpecific.stock ?? {}) },
    },
  };
}

/**
 * A battle with its outcome already decided: the state after `action` either took
 * the territory (`won`) or failed. The dice themselves are rolled by applyActions;
 * this is the part both it and getChanceOutcomes (the search's view of the same
 * attack, one branch per outcome) share, so the two can never disagree about what
 * winning or losing does to the board.
 */
function resolveAttack(state, playerId, action, won) {
  const newState = cloneState(state);
  const gs = newState.gameSpecific;
  const { territories } = newState.board;
  const from = territories[action.from];
  const to = territories[action.to];
  const defenderId = to.owner;
  if (won) {
    // Attacker's dice - 1 move into the captured territory; attacker territory drops to 1
    territories[action.to] = { ...to, owner: playerId, dice: Math.max(1, from.dice - 1) };
    territories[action.from] = { ...from, dice: 1 };
    const defStillHasTerr = Object.values(territories).some(t => t.owner === defenderId);
    if (!defStillHasTerr && defenderId != null) {
      gs.eliminatedPlayers = [...gs.eliminatedPlayers, defenderId];
    }
  } else {
    // Attacker loses all but one die; defender unchanged
    territories[action.from] = { ...from, dice: 1 };
  }
  newState.lastActions = [{ playerId, action }];
  return newState;
}

// Whether an attack can be resolved at all on this state. Under fog, ObscuroAgent
// applies legal actions (derived from the TRUE state) to belief-sampled worlds during
// search; a sampled world can disagree with the acting territory (it no longer
// belongs to playerId, or the target vanished), and such an attack is a no-op rather
// than a crash — mirroring aow/civ1's attack-handler guards.
function attackIsLive(state, playerId, action) {
  const from = state.board.territories[action.from];
  const to = state.board.territories[action.to];
  return !!from && !!to && from.owner === playerId && to.owner !== playerId && from.dice >= 2;
}

/**
 * Reinforcement at the end of a turn, as DICE WARS deals it (gamedesign.jp's
 * game.js, start_supply / do_supply): the turn's income — the size of the largest
 * connected region — is added to the player's stored dice, the total is capped at
 * the reserve maximum, and then dice are taken from that pool ONE AT A TIME onto a
 * territory picked uniformly from those still under MAX_DICE, until the pool is
 * empty or every territory is full. Whatever could not be placed stays stored for
 * the next turn. Mutates `territories` and returns { placed: {id: n}, stock }.
 */
function supplyDice(territories, playerId, income, stock, stockMax, rng) {
  let pool = Math.min(stockMax, stock + income);
  const placed = {};
  const open = Object.values(territories)
    .filter(t => t.owner === playerId && t.dice < MAX_DICE).map(t => t.id);
  while (pool > 0 && open.length) {
    const k = Math.floor(rng() * open.length);
    const tid = open[k];
    const t = territories[tid];
    territories[tid] = { ...t, dice: t.dice + 1 };
    placed[tid] = (placed[tid] ?? 0) + 1;
    pool--;
    if (territories[tid].dice >= MAX_DICE) open.splice(k, 1);
  }
  return { placed, stock: pool };
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
      // Dice earned but not yet placed, per player (see supplyDice), and the most a
      // player may hold back.
      stock: Object.fromEntries(players.map(p => [p.id, 0])),
      stockMax: stockMaxOf(config),
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
    if (!attackIsLive(state, playerId, action)) {
      newState.lastActions = playerActions;
      return newState;
    }
    const from = territories[action.from];
    const to = territories[action.to];

    const attackerRolls = rollDice(from.dice, rng);
    const defenderRolls = rollDice(to.dice, rng);
    const attackerSum = attackerRolls.reduce((a, b) => a + b, 0);
    const defenderSum = defenderRolls.reduce((a, b) => a + b, 0);
    const won = attackerSum > defenderSum;

    const resolved = resolveAttack(state, playerId, action, won);
    resolved.gameSpecific.lastBattle = {
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
    // The client plays the roll back from here too, before the territory changes
    // colour (see SessionView's dice-roll beat).
    action.result = {
      attackerRolls, defenderRolls, attackerSum, defenderSum, won,
      territories: territoryLooks(resolved, [action.from, action.to]),
    };
    resolved.lastActions = playerActions;
    return resolved;
  }

  else if (action.type === 'end-turn') {
    // Income = the largest connected region; it joins the reserve, and the reserve is
    // dealt out at random (supplyDice — DICE WARS' rule, which KDice kept).
    const region = getLargestConnectedRegion(playerId, territories, adjacency);
    const stockMax = gs.stockMax ?? DEFAULT_STOCK_MAX;
    const { placed, stock } = supplyDice(
      territories, playerId, region.length, gs.stock?.[playerId] ?? 0, stockMax, rng);
    gs.stock = { ...(gs.stock ?? {}), [playerId]: stock };

    // Stamp which territories got a bonus die onto the action (same trick as the
    // attack branch's action.result — see its comment) so the client can flash
    // them once, in one place, without re-deriving the diff from board state.
    action.result = {
      reinforced: Object.keys(placed), income: region.length, stock,
      territories: territoryLooks(newState, Object.keys(placed)),
    };

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
    return { outcome: 'win', winnerId: active[0].id, reason: `${active[0].name} conquered the map!` };
  }

  const allTerritories = Object.values(board.territories);
  for (const p of active) {
    if (allTerritories.every(t => t.owner === p.id)) {
      return { outcome: 'win', winnerId: p.id, reason: `${p.name} conquered the map!` };
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
    const stored = gameSpecific.stock?.[p.id] ?? 0;
    const mark = p.id === activeId ? ' ◄' : '';
    lines.push(`  ${playerLabel(p.id)} ${p.name}: ${owned.length} territories, ${totalDice} dice${stored ? `, ${stored} stored` : ''}${mark}`);
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

// Which part of a state makes two states the same information set. Only owner
// and dice vary and only they are hidden, so everything else is noise in the
// key: `adjacency` and each territory's `neighbors` are fixed map topology,
// identical in every state of every game on this map, and `id` is the key it is
// already filed under. Keying on the whole board — which is what the legacy
// `board` field fallback did — paid for that constant topology in every infoset
// lookup without it ever distinguishing two states.
//
// Territories carry no `type` or `ownerId` field, so Obscuro stringifies these
// values whole rather than treating them as entities to strip ids from. That is
// what we want here: `dice` is identity-bearing and must survive.
function identityOf(state) {
  const out = {};
  for (const [id, t] of Object.entries(state.board.territories)) {
    out[id] = `${t.owner ?? '?'}:${t.dice ?? '?'}`;
  }
  return out;
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

/**
 * The leaderboard: every player's territories, dice on the board, dice stored, and
 * largest connected region (what their next reinforcement is), best first — the
 * players still in by territories then dice, then the eliminated, most recently out
 * first. Read from whatever state it is given, so under fog (a viewer's filtered
 * state) the counts are of the territories that viewer can see, and say so.
 */
export function standings(state) {
  const { players, board, gameSpecific } = state;
  const { territories, adjacency } = board;
  const out = gameSpecific.eliminatedPlayers ?? [];
  const partial = Object.values(territories).some(t => t.owner == null);
  const rows = players.map((p, seat) => {
    const owned = Object.values(territories).filter(t => t.owner === p.id);
    return {
      playerId: p.id,
      seat,
      out: out.includes(p.id),
      values: {
        territories: owned.length,
        dice: owned.reduce((n, t) => n + (t.dice ?? 0), 0),
        stock: gameSpecific.stock?.[p.id] ?? 0,
        region: getLargestConnectedRegion(p.id, territories, adjacency).length,
      },
    };
  });
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    if (a.out) return out.indexOf(b.playerId) - out.indexOf(a.playerId);
    return (b.values.territories - a.values.territories)
      || (b.values.dice + b.values.stock - a.values.dice - a.values.stock)
      || (a.seat - b.seat);
  });
  return {
    title: 'Leaderboard',
    columns: [
      { key: 'territories', label: 'Land', title: 'Territories held' },
      { key: 'dice', label: 'Dice', title: 'Dice on the board' },
      { key: 'stock', label: 'Stored', title: `Dice in reserve, placed when there is room (at most ${gameSpecific.stockMax ?? DEFAULT_STOCK_MAX})` },
      { key: 'region', label: 'Region', title: 'Largest connected region: the dice earned at the end of the turn' },
    ],
    rows: rows.map(({ seat, ...r }) => r),
    note: partial ? 'Counts are of the territories you can see.' : null,
  };
}

// How a territory's token is drawn for a stack of `dice` (see toGrid's comments).
function tokenLook(dice) {
  return { label: String(dice), pips: dice, sizeFrac: 1.35 + 1.15 * ((dice - 1) / (MAX_DICE - 1)) };
}

// What each of `ids` looks like right after an action: its owner and its token. Stamped
// on the action's result so a client playing a bundle of actions back can show each
// territory as it was at THAT point, not jump to the bundle's final board (see
// SessionView's colour holds) — a territory taken twice in one AI round would
// otherwise show its last owner before the battle that gave it to them.
function territoryLooks(state, ids) {
  const out = {};
  for (const id of ids) {
    const t = state.board.territories[id];
    if (t) out[id] = { owner: t.owner, token: tokenLook(t.dice) };
  }
  return out;
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
        // The count as the token's text (what a colour hold keeps showing — see
        // SessionView's holdToken), the same as Risk's army count.
        label: isCapital && !hidden ? String(t.dice) : '',
        hp: isCapital && !hidden ? t.dice : undefined,
        maxHp: MAX_DICE,
        // The stack, drawn rather than spelled: a dot per die under the token, and a
        // token that grows with it. Which territory can take which is the whole game,
        // and reading two numbers off two hexes is a slower way to see it than
        // comparing two blobs.
        //
        // sizeFrac is measured against ONE hex (HtmlHexLayer's tokenBaseR is
        // 0.55 * hexSize), but a kdice territory is a blob of ~8 of them, so a
        // token sized like a single-hex piece comes out a ~12px badge with a 6px
        // digit in a 90px blob — the army count, the thing the whole game is
        // read off, is the least legible thing on the board. These fractions put
        // a 1-die token at roughly a hex and a half across and an 8-die one at
        // about half its blob, so the count is readable and the stack still
        // grows visibly with it.
        pips: isCapital && !hidden ? t.dice : undefined,
        sizeFrac: isCapital && !hidden ? tokenLook(t.dice).sizeFrac : undefined,
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
    // The leaderboard panel (apps/console/play/battlefield/StandingsPanel.vue).
    standings: standings(state),
  };
}

// The search's view of an attack (ObscuroAgent's optional chance nodes): one branch
// per outcome, at its exact probability, instead of the single roll applyActions
// would sample — so a search weighs a 3-on-4 attack at the 19% it wins, not by
// whichever way one throw happened to land. End-turn's random dealing stays a
// single sampled outcome (no entry here).
function getChanceOutcomes(state, action) {
  if (action?.type !== 'attack') return null;
  const playerId = state.activePlayers?.[0];
  if (!attackIsLive(state, playerId, action)) return null;
  const { territories } = state.board;
  const p = winProbability(territories[action.from].dice, territories[action.to].dice);
  return [
    { state: resolveAttack(state, playerId, action, true), prob: p },
    { state: resolveAttack(state, playerId, action, false), prob: 1 - p },
  ].filter(o => o.prob > 0);
}

export const KDiceGame = {
  // The KDice AI's own position value (agent.js evaluatePosition: income, dice, the
  // reserve, and what the neighbours can take back), as the leaf for the generic
  // Obscuro/greedy agents too.
  evaluateState: (state, playerId) => evaluatePosition(state, playerId),
  name: 'KDice',
  // A dedicated KDice AI (agent.js): exact battle odds, an eye on the counter-attack,
  // and dice kept in reserve. The default CPU seat (uiDefaults below).
  agents: [
    { id: 'kdice', name: 'AI (KDice)', agent: KDiceAgent },
  ],
  // Seven seats, as a KDice table has (and DICE WARS' default): you and six AIs.
  uiDefaults: {
    players: [{ agent: 'human' }, ...Array.from({ length: 6 }, () => ({ agent: 'kdice' }))],
  },
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
    // The map is the game: the log, the roster and the AI's reasoning start hidden, and
    // are a menu toggle away for anyone who wants them.
    showRightSidebar: false, showAiAnalysis: false,
  },
  gameOptions: [
    { id: 'fogOfWar', label: 'Fog of War', description: 'Distant territories are hidden until you border them', type: 'boolean', default: false },
    { id: 'stockMax', label: 'Dice reserve', description: 'Dice that cannot be placed because every territory is full are stored, up to this many, and placed in later turns (KDice: 32; DICE WARS: 64)', type: 'integer', default: DEFAULT_STOCK_MAX },
  ],
  createInitialState,
  getLegalActions,
  applyActions,
  getResult,
  renderState,
  toGrid,
  getVisibleState,
  identityOf,
  sampleWorlds,
  getChanceOutcomes,
  getActionDuration,
};
