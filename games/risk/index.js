import { RiskGame } from './RiskGame.js';
import { installLearnedEval } from '#core/agents/learned/leafEval.js';

// Learned leaf evaluation (src/agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node src/agents/learned/train.mjs --game risk   (or --all)
installLearnedEval(RiskGame, import.meta.url, { deferred: true });

export { RiskGame };
export { TERRITORY_IDS, TERRITORY_NAMES, ADJACENCY, CONTINENTS } from './RiskMap.js';
export { resolveCombat } from './RiskCombat.js';
