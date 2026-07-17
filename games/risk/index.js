import { RiskGame } from './RiskGame.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game risk   (or --all)
installLearnedEval(RiskGame, import.meta.url);

export { RiskGame };
export { TERRITORY_IDS, TERRITORY_NAMES, ADJACENCY, CONTINENTS } from './RiskMap.js';
export { resolveCombat } from './RiskCombat.js';
