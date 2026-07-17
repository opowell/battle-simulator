import { Sc1Game } from './Sc1Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game sc1   (or --all)
installLearnedEval(Sc1Game, import.meta.url);

export { Sc1Game };
export { TERRAIN } from './terrain.js';
export { UNITS } from './units.js';
export { BUILDINGS } from './buildings.js';
export { resolveAttack, resolveAttackVsBuilding, inRange, chebyshev } from './combat.js';
export { generateMap, getReachableTiles, renderMap } from './map.js';
