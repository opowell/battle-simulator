import { freeze } from './StateManager.js';
import { validate } from './ActionValidator.js';
import { EventQueue } from './EventQueue.js';
import { resolveTimeline } from './KineticResolver.js';

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
   * @param {number} [config.maxTurns]
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
  }

  get state() { return this._state; }
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

  _init() {
    this._state = freeze(this.game.createInitialState(this.players, this.config));
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
      const action = await player.agent.chooseAction(visibleState, legalActions, this.game);
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

    // While planning, every seat is active.
    this._state = freeze({ ...turnStart, activePlayers: seatOrder });
    this._planStates = new Map();
    const plans = await Promise.all(seatOrder.map(playerId => this._collectOrders(playerId, turnStart)));
    this._planStates = null;

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
      const action = await player.agent.chooseAction(visibleState, legalActions, this.game);
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

    // Collect orders from all active players and schedule them as future events.
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
      const action = await player.agent.chooseAction(visibleState, legalActions, this.game);
      validate(action, legalActions, this.game, this._state, playerId);
      const duration = this.game.getActionDuration
        ? this.game.getActionDuration(this._state, action)
        : 1;
      this._eventQueue.push({ time: this._clock + duration, playerId, action });
    }

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
      ?? (this.config.maxTurns ?? 500) * turnDuration;
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
    const maxTurns = this.config.maxTurns ?? 500;
    const stepLimit = this.config.stepLimit ?? (this.timeType === 'continuous'
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
