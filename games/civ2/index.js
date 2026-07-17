import { Civ2Game } from './Civ2Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game civ2   (or --all)
installLearnedEval(Civ2Game, import.meta.url);

export { Civ2Game };
export { TERRAIN, TERRAIN_SPECIALS, SPECIAL_BONUSES } from './terrain.js';
export { UNITS } from './units.js';
export { resolveCombat, getCombatStrengths } from './combat.js';
export { generateMap, getReachableTiles, renderMap } from './map.js';
