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
 * --- Imperfect-information ("fog of war") interface -------------------------
 * These four optional hooks make fog of war a first-class part of a game and
 * let the generic ObscuroAgent (agents/ObscuroAgent.js) reason about hidden
 * state for ANY game. A game may implement none, some, or all of them; the
 * agent degrades gracefully:
 *   • none                       → best-response / minimax-lite over the
 *                                  observed state (the information set is a
 *                                  single world).
 *   • evaluateState only         → a non-random opponent for any game.
 *   • evaluateState + sampleWorlds → full CFR equilibrium over the belief
 *                                  cloud — the paper's mixed/bluffing play.
 *
 * @property {(state: GameState, playerId: string) => GameState} [getVisibleState]
 *   Optional. The OBSERVATION function: returns a filtered view of state for the
 *   given player's perspective (hidden units removed, etc.). Called instead of
 *   the full state when config.fogOfWar is true.
 *
 * @property {(observation: GameState, playerId: string, n: number, rng?: () => number) => GameState[]} [sampleWorlds]
 *   Optional. The BELIEF sampler: given what `playerId` can observe, return up
 *   to `n` concrete full states ("particles") consistent with that observation
 *   — the information set. Return [] (or omit) when there is nothing hidden, in
 *   which case the observation itself is treated as the single world. This is
 *   the only inherently game-specific piece of fog reasoning (it encodes how
 *   hidden state could have evolved); chess implements it via belief.js.
 *
 * @property {(state: GameState, playerId: string) => number} [evaluateState]
 *   Optional. Heuristic leaf value of a state to `playerId` (higher = better for
 *   that player). Used to score search leaves. Omitting it makes the agent rely
 *   solely on getResult terminals (so it only distinguishes win/draw/loss).
 *
 * @property {(action: Action) => string} [actionKey]
 *   Optional. Canonical identity for an action, so the SAME opponent reply seen
 *   across different sampled worlds maps to the same payoff-matrix column.
 *   Defaults to a structural key over {type, unitId, from, to, targetId}.
 *
 * @property {(observation: GameState, playerId: string, action: Action) => void} [onActionCommitted]
 *   Optional. Notified after the agent commits to `action` from `observation`,
 *   so a stateful belief tracker can record the move (e.g. to detect its own
 *   captured units next turn). Pure-stateless games can omit it.
 *
 * @property {(state: GameState, action: Action) => number} [getActionDuration]
 *   Optional. Continuous-time mode only. Returns the sim-time (in seconds) for
 *   this action to complete — e.g. travelTime for a move, reloadTime for an attack.
 *   Games that omit this default to duration 1 for every action (uniform spacing).
 */

/**
 * @typedef {Object} GameState
 * @property {string}          gameName
 * @property {number}          turnNumber      Incremented once per turn window (discrete: per round, continuous: per window).
 * @property {string[]}        activePlayers   IDs of players who act in this step (≥1).
 * @property {string}          currentPhase
 * @property {Player[]}        players
 * @property {Unit[]}          units           All units; alive:false means dead/captured.
 * @property {object}          board           Game-specific board (opaque to engine).
 * @property {PlayerAction[] | null} lastActions  Actions that produced this state.
 * @property {object}          gameSpecific    Catch-all for game data (e.g. castlingRights).
 * @property {number}          [clock]         Current simulation time (continuous-time mode only).
 * @property {number}          [turnEndTime]   Sim-time when the current turn window closes (continuous-time mode only).
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
