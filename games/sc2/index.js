import { Sc2Game } from './Sc2Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game sc2   (or --all)
installLearnedEval(Sc2Game, import.meta.url);

export { Sc2Game };
export { TERRAIN } from './terrain.js';
export { UNITS } from './units.js';
export { BUILDINGS, raceBuildings } from './buildings.js';
export { resolveAttack, resolveAttackVsBuilding, inRange, chebyshev, effectiveRange } from './combat.js';
export { generateMap, getReachableTiles, renderMap } from './map.js';
