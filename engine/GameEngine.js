import { freeze } from './StateManager.js';
import { validate } from './ActionValidator.js';

/**
 * Orchestrates a turn-based game.
 *
 * Multiple players can be active in a single step (state.activePlayers).
 * The engine gathers one action from each active player's agent, then calls
 * game.applyActions with all of them. The game returns the next state with
 * updated activePlayers — the engine never decides whose turn it is.
 */
export class GameEngine {
  /**
   * @param {import('../interfaces/types.js').GameDefinition} game
   * @param {import('../interfaces/types.js').Player[]} players
   * @param {object} [config]
   * @param {number} [config.maxTurns]
   * @param {() => number} [config.rng]
   */
  constructor(game, players, config = {}) {
    this.game = game;
    this.players = players;
    this.config = config;
    this._rng = config.rng ?? Math.random.bind(Math);
    this._state = null;
    this._log = [];
    this._result = null;
  }

  get state() { return this._state; }
  get log() { return this._log; }
  get result() { return this._result; }

  _playerById(id) {
    return this.players.find(p => p.id === id);
  }

  _init() {
    this._state = freeze(this.game.createInitialState(this.players, this.config));
    this._log = [];
    this._result = null;
  }

  /**
   * Execute one step: gather one action per active player, apply them.
   * Returns { done, result }.
   * Async to support HumanAgent (readline).
   */
  async step() {
    if (!this._state) this._init();
    if (this._result) return { done: true, result: this._result };

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

    this._state = freeze(
      this.game.applyActions(this._state, playerActions, this._rng)
    );
    this._log.push({ turnNumber, phase: currentPhase, playerActions });

    this._result = this.game.getResult(this._state);
    if (this._result) return { done: true, result: this._result };

    if (this.config.maxTurns && this._state.turnNumber > this.config.maxTurns) {
      this._result = { outcome: 'draw', winnerId: null, reason: 'max-turns' };
      return { done: true, result: this._result };
    }

    return { done: false, result: null };
  }

  /**
   * Run to completion. Returns { result, log, finalState }.
   */
  async run() {
    this._init();
    const maxTurns = this.config.maxTurns ?? 500;
    // Upper bound on steps: turns × players × phases — avoids infinite loops in buggy games
    const stepLimit = maxTurns * Math.max(this.players.length, 2) * 20;
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
