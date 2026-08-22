import { Civ1Game } from './Civ1Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';
import { civ1SearchActions } from './searchActions.js';
import { Civ1ObscuroAgent } from './Civ1ObscuroAgent.js';
import { makeCiv1Agent } from './ai.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game civ1   (or --all)
installLearnedEval(Civ1Game, import.meta.url);

// Search hooks are installed here rather than declared inside Civ1Game.js so the
// game module stays free of any dependency on the agents (searchActions.js reaches
// into ai.js, which imports Civ1Game.js — declaring them inline would close that
// cycle). Same pattern as installLearnedEval above.

// The pruned, canonically-ordered action set the search reasons over. Wired as
// getSearchActions because that is the hook consulted for the root AND every
// interior node (vendor/obscuro/src/search.js makeHooks); see searchActions.js.
Civ1Game.getSearchActions = (state, playerId) => civ1SearchActions(Civ1Game, state, playerId);

// Stable identity for an action, so the search can compare moves across worlds and
// carry a solved tree from one turn to the next. The generic default keys on
// from/to/targetId and would collapse every set-production or set-research onto one.
Civ1Game.actionKey = a => JSON.stringify([
  a.type ?? null, a.unitId ?? null, a.to ?? null, a.targetId ?? null,
  a.cityId ?? null, a.item ?? null, a.tech ?? null,
  a.taxRate ?? null, a.luxRate ?? null, a.government ?? null,
]);

// Roster entries hold ready-made agent instances (same as chess's), and a single
// instance may be handed both seats — Civ1ObscuroAgent keys its carryover and its
// turn budget per side for exactly that reason.
Civ1Game.agents = [
  { id: 'obscuro', name: 'Obscuro (CFR)', agent: new Civ1ObscuroAgent(Civ1Game) },
  { id: 'civ1-heuristic', name: 'Heuristic', agent: makeCiv1Agent() },
];

export { Civ1Game, Civ1ObscuroAgent };
export { TERRAIN } from './terrain.js';
export { UNITS } from './units.js';
export { resolveCombat, getCombatStrengths } from './combat.js';
export { generateMap, getReachableTiles, renderMap } from './map.js';
export { BARBARIAN_ID, BARBARIAN_LEVELS, BARBARIAN_LEVEL_IDS, DEFAULT_BARBARIAN_LEVEL } from './barbarians.js';
