import { freeze } from './StateManager.js';
import { validate } from './ActionValidator.js';
import { EventQueue } from './EventQueue.js';

/**
 * Orchestrates a game in either discrete or continuous time.
 *
 * Discrete mode (default): each step() gathers one action per active player,
 * applies it immediately, and advances turnNumber once per full round.
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
  }

  get state() { return this._state; }
  get log() { return this._log; }
  get result() { return this._result; }
  get timeType() { return this.config.timeType ?? 'discrete'; }
  get clock() { return this._clock; }

  _playerById(id) {
    return this.players.find(p => p.id === id);
  }

  _init() {
    this._state = freeze(this.game.createInitialState(this.players, this.config));
    this._log = [];
    this._result = null;
    this._clock = 0;
    this._eventQueue = new EventQueue();
  }

  /**
   * Discrete mode: gather one action per active player, apply immediately.
   * Continuous mode: run one full turn window — collect orders, schedule events,
   * advance clock to each event time, resolve via applyActions.
   * Returns { done, result }.
   */
  async step() {
    if (!this._state) this._init();
    if (this._result) return { done: true, result: this._result };

    return this.timeType === 'continuous'
      ? this._stepContinuous()
      : this._stepDiscrete();
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
      const action = await player.agent.chooseAction(visibleState, legalActions);
      validate(action, legalActions);
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
      const action = await player.agent.chooseAction(visibleState, legalActions);
      validate(action, legalActions);
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
