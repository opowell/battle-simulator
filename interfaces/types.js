/**
 * @typedef {Object} GameDefinition
 * Plugin interface every game must implement.
 *
 * @property {string} name
 *
 * @property {(players: Player[], config?: object) => GameState} createInitialState
 *   Pure factory. Returns the canonical starting state.
 *
 * @property {(state: GameState, playerId: string) => Action[]} getLegalActions
 *   Returns every legal action the given player may take. Must be pure.
 *   Always include an 'end-turn' action when the player can pass.
 *
 * @property {(state: GameState, playerActions: PlayerAction[], rng?: () => number) => GameState} applyActions
 *   Apply all actions for this step (one per active player). Returns a NEW state.
 *   The returned state must set activePlayers for the next step.
 *   Never mutate the input state.
 *
 * @property {(state: GameState) => GameResult | null} getResult
 *   Returns null while the game is ongoing; otherwise the final outcome.
 *
 * @property {(state: GameState) => string} renderState
 *   Returns a human-readable string representation.
 *
 * @property {(state: GameState, playerId: string) => GameState} [getVisibleState]
 *   Optional. Returns a filtered view of state for the given player's perspective.
 *   Called instead of full state when config.fogOfWar is true.
 */

/**
 * @typedef {Object} GameState
 * @property {string}          gameName
 * @property {number}          turnNumber      Incremented when a full round of all players completes.
 * @property {string[]}        activePlayers   IDs of players who act in this step (≥1).
 * @property {string}          currentPhase
 * @property {Player[]}        players
 * @property {Unit[]}          units           All units; alive:false means dead/captured.
 * @property {object}          board           Game-specific board (opaque to engine).
 * @property {PlayerAction[] | null} lastActions  Actions that produced this state.
 * @property {object}          gameSpecific    Catch-all for game data (e.g. castlingRights).
 */

/**
 * @typedef {Object} Unit
 * @property {string}   id
 * @property {string}   ownerId
 * @property {string}   type
 * @property {any}      position   Game-specific coordinate ("e4", {x,y}, etc.)
 * @property {boolean}  alive
 * @property {number}   [hp]
 * @property {number}   [maxHp]
 * @property {object}   [perTurn]  Flags reset each turn: { hasMoved, hasAttacked }
 * @property {object}   [attrs]    Extra game-specific attributes.
 */

/**
 * @typedef {Object} Action
 * @property {string}  type       'move', 'attack', 'castle', 'play-card', 'end-turn', etc.
 * @property {string}  unitId
 * @property {any}     [from]
 * @property {any}     [to]
 * @property {string}  [targetId]
 * @property {boolean} [isCapture]
 * @property {boolean} [isEnPassant]
 * @property {string}  [capturedSquare]
 * @property {object}  [payload]  Action-specific extras (e.g. { promote: 'queen' }).
 */

/**
 * @typedef {Object} PlayerAction
 * @property {string} playerId
 * @property {Action} action
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {Agent}  agent
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {(state: GameState, legalActions: Action[]) => Action | Promise<Action>} chooseAction
 */

/**
 * @typedef {Object} GameResult
 * @property {'win' | 'draw'} outcome
 * @property {string | null}  winnerId
 * @property {string}         reason
 */
