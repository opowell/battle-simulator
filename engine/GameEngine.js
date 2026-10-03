import { freeze } from './StateManager.js';
import { validate } from './ActionValidator.js';
import { EventQueue } from './EventQueue.js';
import { resolveTimeline } from './KineticResolver.js';
import { buildInitialState } from './startingSetup.js';

/**
 * Thrown out of step() when the game was reconfigured while an agent was still
 * deciding (see GameEngine.reconfigure): the move it came back with was chosen
 * for a position — or under settings — that no longer exist, so it is dropped
 * rather than applied, and the caller simply steps again.
 */
export class EngineReconfigured extends Error {
  constructor() {
    super('The game was reconfigured while this move was being chosen');
    this.name = 'EngineReconfigured';
  }
}

/**
 * Orchestrates a game in either discrete or continuous time.
 *
 * Discrete mode (default): each step() gathers one action per active player,
 * applies it immediately, and advances turnNumber once per full round.
 *
 * Simultaneous mode (config.simultaneousTurns, discrete time only): each step()
 * runs one full "we-go" round. Every player plans a whole turn of orders at
 * once, each against a private copy of the turn-start state with only their OWN
 * orders applied (opponents' queues stay hidden — see planState()). Once every
 * player has ended their turn, the queues resolve by exact event-driven
 * kinetics (KineticResolver.js): moving units and projectiles are analytic
 * straight-line motions, the next interaction between any two objects (bullet
 * intercepts target, unit reaches destination, disks touch) is found by
 * solving that pair's distance equation in closed form, and the globally
 * earliest solved event is processed — adjusting positions/velocities and
 * re-solving only the affected pairs — until the round drains. An order that
 * is illegal by its completion time fizzles: it consumes its time but changes
 * nothing. Each resolved order gets its own log entry (stamped t0/t1), and
 * the round is sampled into 61 evenly spaced position frames (see playback)
 * so clients can replay the turn — units gliding along their exact paths —
 * as often as they like.
 *
 * Continuous mode (config.timeType === 'continuous'): each step() runs one
 * full turn window. Players queue orders at the window start; each order is
 * scheduled as a future event at clock + getActionDuration(). The engine
 * advances the clock to each event time in order, resolving actions via the
 * same applyActions() interface. The window closes at clock === turnEndTime.
 *
 * Multiple players can be active in a single step (state.activePlayers).
 * The engine gathers one action from each active player's agent, then calls
 * game.applyActions with all of them. The game returns the next state with
 * updated activePlayers — the engine never decides whose turn it is.
 */
export class GameEngine {
  /**
   * @param {import('../games/types.js').GameDefinition} game
   * @param {import('../games/types.js').Player[]} players
   * @param {object} [config]
   * @param {number} [config.maxTurns]  Draw after this many turns. Optional — omit (or 0/null) and the game runs until it ends on its own.
   * @param {() => number} [config.rng]
   * @param {boolean} [config.fogOfWar]
   * @param {boolean} [config.simultaneousTurns]  All players plan a full turn at once, then orders resolve together (discrete time only).
   * @param {'discrete'|'continuous'} [config.timeType]
   * @param {number} [config.turnDuration]   Sim-time per turn window (continuous mode, default 60).
   * @param {number} [config.maxSimTime]     Upper bound on clock (continuous mode).
   */
  constructor(game, players, config = {}) {
    this.game = game;
    this.players = players;
    this.config = config;
    this._rng = config.rng ?? Math.random.bind(Math);
    this._state = null;
    this._log = [];
    this._result = null;
    this._clock = 0;
    this._eventQueue = new EventQueue();
    this._planStates = null;
    this._playback = null;
    this._playbackFrameAt = null;
    // Mid-game reconfiguration (see reconfigure). `_epoch` counts reconfigurations,
    // so a move chosen before one can be recognised and dropped. The rest is what
    // a replay needs to reproduce the game as it was really played: the config the
    // current segment STARTED under (patches move `config` on, not this), the exact
    // position a rebuilt segment started from, and every settings patch with the
    // ply it landed at.
    this._epoch = 0;
    this._startConfig = config;
    this._start = null;
    this._patches = [];
    this._roundStart = null;
  }

  get state() { return this._state; }
  /** How many times the game has been reconfigured; a step that spans a change is void. */
  get epoch() { return this._epoch; }
  /** Settings patches applied mid-game: [{ ply, gameSpecific }]. */
  get patches() { return this._patches; }
  /** The exact position this segment of the game started from, when it was rebuilt mid-game. */
  get startState() { return this._start; }
  /** Sampled position frames of the last resolved simultaneous round (or null). */
  get playback() { return this._playback; }
  /**
   * Exact resolved state at fraction `f` (0..1) of the last simultaneous round —
   * computed analytically from the motion segments, NOT interpolated between the
   * sampled `playback.frames`. Returns { t, units:[{id,x,y,alive}], projectiles? } or
   * null when there's no live playback model. Backs the mid-turn scrub's off-sample
   * requests (api-server GET /sessions/:id/playback-frame).
   */
  playbackFrameAt(f) {
    if (!this._playbackFrameAt || !this._playback) return null;
    const frac = Math.min(Math.max(Number(f) || 0, 0), 1);
    return this._playbackFrameAt(frac * this._playback.duration);
  }
  get log() { return this._log; }
  get result() { return this._result; }
  get timeType() { return this.config.timeType ?? 'discrete'; }
  get clock() { return this._clock; }

  /** True when we-go (simultaneous) planning is requested via either spelling. */
  _isSimultaneous() {
    return this.config.play === 'simultaneous' || !!this.config.simultaneousTurns;
  }

  /**
   * Replace the authoritative state with a patched version, bypassing turn/action
   * validation. For out-of-band UI metadata (e.g. fog-of-war markers a player has
   * manually placed) that isn't part of game rules and shouldn't consume a turn.
   * @param {(state: object) => object} updater
   */
  patchState(updater) {
    if (!this._state) return;
    this._state = freeze(updater(this._state));
  }

  /**
   * Take moves back: drop everything after `ply` and put the game where it stood
   * then, ready to be played on from there.
   *
   * Done by REPLAYING the kept log from the initial state rather than by trying to
   * invert the moves. A game definition knows how to advance a position and
   * nothing more — captures, promotions, spent resources and rolled dice are not
   * generally recoverable from the position they produced — so the only honest
   * "before" is the one the same moves reproduce. That also means the result and
   * the clock come back as they were, not as something patched up.
   *
   * Nothing about turn order or legality is bypassed: the kept moves were legal
   * when they were played, and they are replayed through the same applyActions.
   * Callers decide WHO may do this — the engine only offers the mechanism (see
   * api-server.js, which allows it on analysis boards and nowhere else).
   *
   * CAVEAT for games with randomness: an unseeded `config.rng` cannot be rewound,
   * so re-resolving the kept moves re-rolls anything they rolled. The history is
   * the same moves, but a dice game's outcomes along it may differ from what was
   * first played. Deterministic games (chess, the one that has a use for this so
   * far) come back exactly.
   *
   * @param {number} ply how many logged turns to keep.
   * @returns {number} how many were dropped.
   */
  rewindTo(ply) {
    const keep = Math.max(0, Math.min(Math.floor(ply), this._log.length));
    const dropped = this._log.length - keep;
    if (dropped <= 0) return 0;

    const kept = this._log.slice(0, keep);
    const patches = this._patches.filter(p => p.ply <= keep);
    this._init();
    this._patches = patches;
    this._state = freeze(this._patchedAt(this._state, 0));
    for (const [i, entry] of kept.entries()) {
      this._state = freeze(this._patchedAt(this.game.applyActions(this._state, entry.playerActions, this._rng), i + 1));
      this._log.push(entry);
    }
    // A game that had ended may be un-ended by this (taking back the mate), and a
    // game that had not may now be over if the rewind target was itself terminal.
    this._result = this.game.getResult?.(this._state) ?? null;
    return dropped;
  }

  _playerById(id) {
    return this.players.find(p => p.id === id);
  }

  /**
   * Simultaneous mode only: the given player's private planning state (turn-start
   * state + their own queued orders applied). Null outside a planning window.
   * Observers (the API server) render this to a player instead of the authoritative
   * state so they see their own queued orders — and nobody else's.
   * @param {string} playerId
   */
  planState(playerId) {
    return this._planStates?.get(playerId) ?? null;
  }

  /**
   * Where this segment of the game starts. Not createInitialState directly: a
   * session may have customised the opening roster (config.startingUnits — see
   * startingSetup.js), and every path that builds this game's starting position
   * has to apply it the same way. A segment rebuilt mid-game (reconfigure) starts
   * from the exact position it was rebuilt to instead.
   *
   * Every call hands back a FRESH `players` array: belief-tracking agents key on
   * its object identity, and a replay must never advance the live game's belief.
   */
  _initialState() {
    if (this._start) return { ...this._start, players: (this._start.players ?? []).map(p => ({ ...p })) };
    return buildInitialState(this.game, this.players.map(p => ({ ...p })), this._startConfig);
  }

  /** `state` with every settings patch recorded at `ply` applied, in order. */
  _patchedAt(state, ply) {
    let out = state;
    for (const p of this._patches) {
      if (p.ply === ply) out = { ...out, gameSpecific: { ...out.gameSpecific, ...p.gameSpecific } };
    }
    return out;
  }

  /**
   * Every position of this segment from its start up to and including `ply`, by
   * replaying the log (and the settings patches, each at the ply it landed) —
   * never touching the live game. What analysis, the scrub bar and a fork read
   * history from, so a game whose settings changed part way through is replayed
   * the way it was actually played.
   */
  replayStates(ply = this._log.length) {
    const n = Math.max(0, Math.min(Math.floor(ply), this._log.length));
    let state = this._patchedAt(this._initialState(), 0);
    const states = [state];
    for (let i = 0; i < n; i++) {
      state = this._patchedAt(this.game.applyActions(state, this._log[i].playerActions), i + 1);
      states.push(state);
    }
    return states;
  }

  /**
   * Change the game's settings under a game in progress. One of:
   *
   *   • `gameSpecific` — settings the game had copied into its state when it was
   *     created (fog, AI difficulty, …): those keys are patched into the live
   *     position and recorded at this ply, and everything else stands.
   *   • `restartFrom` — a position rebuilt under the new settings (a different
   *     space or time model, map, or set of units): the game goes on from there as
   *     a new segment, with an empty log of its own.
   *   • neither — only the engine's own reading of `config` (simultaneous turns,
   *     fog filtering) or the seats' agents changed.
   *
   * Whatever an agent is still deciding belongs to the position before the change,
   * so it is cancelled: the epoch moves on, the decision is dropped when it
   * arrives (EngineReconfigured, out of step()), and the caller steps again. A
   * simultaneous round in planning is unwound to the position it started from.
   */
  reconfigure({ config, players, gameSpecific, restartFrom } = {}) {
    this._epoch++;
    if (this._roundStart) this._state = this._roundStart;
    this._roundStart = null;
    this._planStates = null;
    if (config) this.config = config;
    if (players) this.players = players;
    if (restartFrom) {
      this._start = freeze(restartFrom);
      this._startConfig = this.config;
      this._state = this._start;
      this._log = [];
      this._patches = [];
      this._result = null;
      this._clock = restartFrom.clock ?? 0;
      this._eventQueue = new EventQueue();
      this._playback = null;
      this._playbackFrameAt = null;
    } else if (gameSpecific && Object.keys(gameSpecific).length && this._state) {
      this._patches.push({ ply: this._log.length, gameSpecific });
      this._state = freeze(this._patchedAt(this._state, this._log.length));
      // _patchedAt applies every patch at this ply, earlier ones included; they
      // are already in the state, and re-setting a key to its value changes nothing.
    }
  }

  /** An agent's move, unless the game was reconfigured while it was being chosen. */
  async _ask(player, visibleState, legalActions) {
    const epoch = this._epoch;
    const action = await player.agent.chooseAction(visibleState, legalActions, this.game);
    if (epoch !== this._epoch) throw new EngineReconfigured();
    return action;
  }

  _init() {
    this._state = freeze(this._initialState());
    this._log = [];
    this._result = null;
    this._clock = 0;
    this._eventQueue = new EventQueue();
    this._planStates = null;
    this._playback = null;
    this._playbackFrameAt = null;
  }

  /**
   * Discrete mode: gather one action per active player, apply immediately.
   * Simultaneous mode: run one full we-go round (plan all, then resolve).
   * Continuous mode: run one full turn window — collect orders, schedule events,
   * advance clock to each event time, resolve via applyActions.
   * Returns { done, result }.
   */
  async step() {
    if (!this._state) this._init();
    if (this._result) return { done: true, result: this._result };

    // Optional per-turn boundary hook: a game can run its once-per-turn upkeep and
    // roll a finished sub-round (e.g. CS respawning into a new buy phase) here,
    // before anyone plans. It also normalises turn-start invariants (e.g. a
    // length-1 activePlayers, which the simultaneous-mode guard below relies on).
    // If the hook ends the match, stop before collecting any orders.
    if (this.game.beginTurn) {
      this._state = freeze(this.game.beginTurn(this._state));
      this._result = this.game.getResult(this._state);
      if (this._result) return { done: true, result: this._result };
    }

    if (this.timeType === 'continuous') return this._stepContinuous();
    // Simultaneous planning only makes sense for sequential games (exactly one
    // active player at the turn start); games that already activate several
    // players per step (cardbattle) are natively simultaneous — leave them be.
    // `play: 'simultaneous'` is the unified spelling of `simultaneousTurns: true`
    // (see games/spacetime.js resolveSpaceTime); both select we-go planning.
    if (this._isSimultaneous() && this._state.activePlayers.length === 1)
      return this._stepSimultaneous();
    return this._stepDiscrete();
  }

  async _stepDiscrete() {
    const { activePlayers, turnNumber, currentPhase } = this._state;
    const playerActions = [];

    for (const playerId of activePlayers) {
      const legalActions = this.game.getLegalActions(this._state, playerId);
      if (legalActions.length === 0) {
        this._result = this.game.getResult(this._state) ??
          { outcome: 'draw', winnerId: null, reason: 'no-legal-actions' };
        return { done: true, result: this._result };
      }
      const player = this._playerById(playerId);
      const visibleState = (this.config.fogOfWar && this.game.getVisibleState)
        ? this.game.getVisibleState(this._state, playerId)
        : this._state;
      const action = await this._ask(player, visibleState, legalActions);
      validate(action, legalActions, this.game, this._state, playerId);
      playerActions.push({ playerId, action });
    }

    const prevState = this._state;
    this._state = freeze(
      this.game.applyActions(prevState, playerActions, this._rng)
    );
    const events = this._diffEvents(prevState, this._state);
    this._log.push({ turnNumber, phase: currentPhase, playerActions, events });

    this._result = this.game.getResult(this._state);
    if (this._result) return { done: true, result: this._result };

    if (this.config.maxTurns && this._state.turnNumber > this.config.maxTurns) {
      this._result = { outcome: 'draw', winnerId: null, reason: 'max-turns' };
      return { done: true, result: this._result };
    }

    return { done: false, result: null };
  }

  /**
   * One full simultaneous ("we-go") round: every seat plans a whole turn of
   * orders concurrently, then the queues resolve in seat order against the
   * authoritative state.
   */
  async _stepSimultaneous() {
    const turnStart = this._state;
    const { turnNumber, currentPhase } = turnStart;
    const seatOrder = turnStart.players.map(p => p.id);

    // Same "no legal actions ends the game" contract as discrete mode, checked
    // up front for every seat since all of them are about to plan.
    for (const playerId of seatOrder) {
      const legal = this.game.getLegalActions({ ...turnStart, activePlayers: [playerId] }, playerId);
      if (legal.length === 0) {
        this._result = this.game.getResult(turnStart) ??
          { outcome: 'draw', winnerId: null, reason: 'no-legal-actions' };
        return { done: true, result: this._result };
      }
    }

    // While planning, every seat is active. `_roundStart` is what a reconfigure
    // mid-planning unwinds to — the all-seats-active planning state is not a
    // position the next step() can start from.
    this._roundStart = turnStart;
    this._state = freeze({ ...turnStart, activePlayers: seatOrder });
    this._planStates = new Map();
    const plans = await Promise.all(seatOrder.map(playerId => this._collectOrders(playerId, turnStart)));
    this._planStates = null;
    this._roundStart = null;

    // Exact event-driven kinetic resolution — see KineticResolver.js.
    const res = resolveTimeline({
      game: this.game,
      turnStart,
      plans,
      rng: this._rng,
      orderKey: (a) => this._orderKey(a),
      diffEvents: (before, after) => this._diffEvents(before, after),
    });
    this._state = res.state;
    this._playback = res.playback;
    this._playbackFrameAt = res.frameAt;
    for (const e of res.entries) {
      this._log.push({ turnNumber, phase: currentPhase, simultaneous: true, ...e });
    }
    this._result = res.result;
    if (this._result) return { done: true, result: this._result };

    if (this.config.maxTurns && this._state.turnNumber > this.config.maxTurns) {
      this._result = { outcome: 'draw', winnerId: null, reason: 'max-turns' };
      return { done: true, result: this._result };
    }
    return { done: false, result: null };
  }

  /**
   * Planning loop for one seat: keep asking its agent for orders against a
   * private plan state (turn-start + that player's own orders) until the player
   * ends the turn, the game itself rotates the turn off them (games with no
   * explicit end-turn action, e.g. chess), or no legal actions remain.
   */
  async _collectOrders(playerId, turnStart) {
    const player = this._playerById(playerId);
    let plan = freeze({ ...turnStart, activePlayers: [playerId] });
    this._planStates.set(playerId, plan);
    const orders = [];
    const orderCap = this.config.maxOrdersPerTurn ?? 500;
    while (orders.length < orderCap) {
      const legalActions = this.game.getLegalActions(plan, playerId);
      if (legalActions.length === 0) break;
      const visibleState = (this.config.fogOfWar && this.game.getVisibleState)
        ? this.game.getVisibleState(plan, playerId)
        : plan;
      const action = await this._ask(player, visibleState, legalActions);
      validate(action, legalActions, this.game, plan, playerId);
      orders.push(action);
      // A game may have more than one turn-terminating action (e.g. CS ends its
      // buy phase with 'end-buy', not 'end-turn'); stop collecting on either.
      if (action.type === 'end-turn' || this.game.isTurnEnder?.(action)) break;
      const next = this.game.applyActions(plan, [{ playerId, action }], this._rng);
      const rotated = !(next.activePlayers ?? []).includes(playerId);
      plan = freeze({ ...next, activePlayers: [playerId] });
      if (!this._planStates) break;
      this._planStates.set(playerId, plan);
      if (rotated) break;
    }
    return { playerId, orders };
  }

  /**
   * Canonical identity for matching a queued order against resolution-time legal
   * actions. Only the essential fields — applyActions may stamp extras (e.g.
   * kdice's action.result) onto an action object during planning.
   */
  _orderKey(action) {
    if (this.game.actionKey) return this.game.actionKey(action);
    const { type, unitId, from, to, targetId } = action;
    return JSON.stringify([type, unitId, from ?? null, to ?? null, targetId ?? null]);
  }

  async _stepContinuous() {
    const turnDuration = this.config.turnDuration ?? 60;
    const turnEndTime = this._clock + turnDuration;
    const { activePlayers, turnNumber, currentPhase } = this._state;

    // Collect orders from all active players, then schedule them as future events.
    // Scheduled only once every order is in, so a reconfigure that cancels the
    // collection part way leaves the queue exactly as it was.
    const orders = [];
    for (const playerId of activePlayers) {
      const legalActions = this.game.getLegalActions(this._state, playerId);
      if (legalActions.length === 0) {
        this._result = this.game.getResult(this._state) ??
          { outcome: 'draw', winnerId: null, reason: 'no-legal-actions' };
        return { done: true, result: this._result };
      }
      const player = this._playerById(playerId);
      const visibleState = (this.config.fogOfWar && this.game.getVisibleState)
        ? this.game.getVisibleState(this._state, playerId)
        : this._state;
      const action = await this._ask(player, visibleState, legalActions);
      validate(action, legalActions, this.game, this._state, playerId);
      const duration = this.game.getActionDuration
        ? this.game.getActionDuration(this._state, action)
        : 1;
      orders.push({ time: this._clock + duration, playerId, action });
    }
    for (const order of orders) this._eventQueue.push(order);

    // Run event loop until the turn window closes.
    const windowOrders = [];
    while (this._eventQueue.size > 0 && this._eventQueue.peek().time <= turnEndTime) {
      // Group all events at the same sim-time into one applyActions call.
      const eventTime = this._eventQueue.peek().time;
      const batch = [];
      while (this._eventQueue.size > 0 && this._eventQueue.peek().time === eventTime) {
        batch.push(this._eventQueue.pop());
      }

      this._clock = eventTime;

      // Skip events whose action is no longer legal (e.g. target died earlier).
      const validBatch = batch.filter(({ playerId, action }) => {
        const legal = this.game.getLegalActions(this._state, playerId);
        return legal.some(a => a.type === action.type && a.unitId === action.unitId);
      });

      if (validBatch.length > 0) {
        const playerActions = validBatch.map(({ playerId, action }) => ({ playerId, action }));
        this._state = freeze(
          this.game.applyActions(this._state, playerActions, this._rng)
        );
        windowOrders.push(...playerActions);

        this._result = this.game.getResult(this._state);
        if (this._result) return { done: true, result: this._result };
      }
    }

    // Advance clock to end of window and open next turn.
    this._clock = turnEndTime;
    // Patch clock/turnEndTime into state for observers.
    this._state = freeze({
      ...this._state,
      clock: this._clock,
      turnEndTime: this._clock + turnDuration,
      turnNumber: this._state.turnNumber + 1,
    });
    this._log.push({ turnNumber, phase: currentPhase, playerActions: windowOrders, clock: turnEndTime });

    const maxSimTime = this.config.maxSimTime
      ?? (this.config.maxTurns ? this.config.maxTurns * turnDuration : Infinity);
    if (this._clock > maxSimTime) {
      this._result = { outcome: 'draw', winnerId: null, reason: 'max-turns' };
      return { done: true, result: this._result };
    }

    return { done: false, result: null };
  }

  _diffEvents(before, after) {
    const events = [];
    const prevUnits = before.units ?? [];
    const nextUnits = after.units ?? [];
    for (const next of nextUnits) {
      const prev = prevUnits.find(u => u.id === next.id);
      if (!prev) continue;
      const hpDiff = (next.hp ?? 0) - (prev.hp ?? 0);
      if (hpDiff < 0) events.push({ type: 'damage', targetId: next.id, amount: -hpDiff, died: !!(prev.alive && !next.alive) });
      else if (hpDiff > 0) events.push({ type: 'heal', targetId: next.id, amount: hpDiff });
      else if (prev.alive && !next.alive) events.push({ type: 'died', targetId: next.id });
    }
    return events;
  }

  /**
   * Run to completion. Returns { result, log, finalState }.
   */
  async run() {
    this._init();
    const maxTurns = this.config.maxTurns;
    // No turn limit means no step budget either: run() goes until the game ends
    // itself. Pass an explicit `stepLimit` to bound such a run.
    const stepLimit = this.config.stepLimit ?? (!maxTurns ? Infinity
      : this.timeType === 'continuous'
        ? maxTurns
        : maxTurns * Math.max(this.players.length, 2) * 20);
    let steps = 0;
    while (steps++ < stepLimit) {
      const { done } = await this.step();
      if (done) break;
    }
    if (!this._result) {
      this._result = { outcome: 'draw', winnerId: null, reason: 'step-limit' };
    }
    return { result: this._result, log: this._log, finalState: this._state };
  }
}
