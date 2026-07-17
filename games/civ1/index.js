import { Civ1Game } from './Civ1Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game civ1   (or --all)
installLearnedEval(Civ1Game, import.meta.url);

export { Civ1Game };
export { TERRAIN } from './terrain.js';
export { UNITS } from './units.js';
export { resolveCombat, getCombatStrengths } from './combat.js';
export { generateMap, getReachableTiles, renderMap } from './map.js';
