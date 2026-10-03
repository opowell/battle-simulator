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
 * let the generic ObscuroAgent reason about hidden state for ANY game. That
 * agent now lives upstream, in vendor/obscuro; its own copy of this contract
 * (vendor/obscuro/src/types.js) is the authority on what the SEARCH reads, and
 * vendor/obscuro/docs/GAME-INTERFACE.md is the guide to implementing it. What
 * follows is the engine's view of the same interface.
 *
 * A game may implement none, some, or all of them; the agent degrades
 * gracefully:
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
 * @property {(state: GameState, mover: string, childActions: Action[], ctx?: object) => number[] | Promise<number[]>} [evaluateLeaves]
 *   Optional. BATCHED node heuristic (the paper's "evaluate all children of a
 *   node in one call"): the value to `mover` of each child reached by playing the
 *   corresponding `childActions` from `state`. Returns an array aligned to
 *   `childActions`. This is the ObscuroAgent's single game-specific search input;
 *   chess implements it as one Stockfish MultiPV call. Omit it and the agent
 *   evaluates each child individually via evaluateState (`ctx.childStates` carries
 *   the already-applied child states so a batched evaluator need not re-apply).
 *
 * @property {(state: GameState, action: Action) => {state: GameState, prob: number}[]} [getChanceOutcomes]
 *   Optional. For a STOCHASTIC transition, the possible resulting states and their
 *   probabilities (must sum to 1). When present and returning >1 outcome, the
 *   ObscuroAgent inserts a chance node into its search tree instead of a single
 *   deterministic child, so games with mid-game randomness (dice, card draws) are
 *   modelled exactly rather than via belief resampling. Omit it (the default) for
 *   deterministic games like chess — the search is unchanged.
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
 * --- Customised starting units ----------------------------------------------
 * A session may replace the roster a game opens with — which units each side has
 * and where they stand (engine/startingSetup.js, `config.startingUnits`). That
 * works for EVERY game off the universal Unit contract above, so these three are
 * only for games the generic layer can't fully serve.
 *
 * @property {(state: GameState, config?: object, opts?: {midGame?: boolean}) => GameState} [applyStartingUnits]
 *   Optional. Called with the opening state once its `units` have been replaced by
 *   the customised roster; returns it with everything the game DERIVES from its
 *   opening units brought back into step. Chess rebuilds `board` (there the board,
 *   not the units array, is the position) and re-derives castling; civ1 re-seeds
 *   which tiles each seat has explored. Games that keep no such copy omit it —
 *   `gameSpecific.startRoster`, which nearly all of them keep for fog belief, is
 *   rebuilt generically and needs no hook.
 *   `opts.midGame` is set when the units were edited on a game IN PROGRESS
 *   (engine/reconfigure.js) rather than at setup: build on what the game has
 *   accumulated instead of starting it over — civ1 keeps the explored map, chess
 *   keeps castling rights already lost. Positions may also arrive in another board
 *   model's form (a square from a discrete board, a point from a continuous one)
 *   when a game is rebuilt under a different space setting; a game whose position
 *   form depends on that setting puts them in its own.
 *
 * @property {(state: GameState) => string[]} [setupUnitTypes]
 *   Optional. Unit types a customised roster may ask for beyond the ones the game
 *   happens to open with (civ1 offers its whole units table). Without it the
 *   choice is limited to the types already on the board, since those are the only
 *   ones a new unit can be cloned from.
 *
 * @property {(state: GameState, spec: {id: string, ownerId: string, type: string, position: any}) => Unit|null} [createSetupUnit]
 *   Optional. Mint one unit of `type` for a customised roster — the game's own
 *   factory, with its stats table applied. Asked first for every ADDED unit;
 *   returning null (or omitting it) falls back to cloning a same-type unit
 *   already in the opening position.
 *
 * @property {object} [foreignUnits]
 *   Optional. Units from OTHER games in this one's sessions, and this game's units
 *   in theirs (engine/foreignUnits.js has the whole story). A roster entry then
 *   names its game beside its type — { ownerId, type: 'marine', game: 'sc1', position }
 *   — and the unit plays under the session's rules as the nearest of this game's
 *   own types (its chassis), with its stats converted, drawn as itself. Fields:
 *     scale       the CONVERSION FACTOR: what one point of each common stat (hp,
 *                 attack, defense, range, move) is worth in this game's own numbers —
 *                 in practice, its standard line infantryman. A stat converts as
 *                 value × host.scale / source.scale.
 *     profiles()  { type: { hp, attack, defense, range, move, domain, chassis?, owners? } }
 *                 every type it lends out or can carry a foreign unit as, in its own
 *                 numbers; `chassis: false` keeps a type back (a settler's specials
 *                 would come with it), `owners` limits it to the sides that can play it.
 *     art(type, seat)   { imagePath, glyph, name } — how its unit looks on another board.
 *     table + write(entry, stats)   for rules that read stats from a type table: the
 *                 foreign type is registered there (non-enumerably) as the chassis's
 *                 entry with the converted stats written in. tableUnits() builds all
 *                 of the above from the table and a read/write pair.
 *     adopt(unit, stats)   for rules that read stats off the unit (attrs): writes them.
 *     realize(chassis, stats)   what a unit given `stats` really ends up with, for
 *                 showing (tableUnits derives it).
 *   A game without it neither lends units nor takes them.
 *
 * @property {(config: object) => object} [resolveSetupConfig]
 *   Optional. The session config with anything the game would otherwise roll fresh
 *   on each createInitialState call pinned down (civ1/civ2: a blank map seed).
 *   Called when a setup screen asks for the opening position to lay units out on,
 *   so the session that is finally created gets the same world.
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
