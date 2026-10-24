import { KDiceGame } from './KDiceGame.js';
import { installLearnedEval } from '#core/agents/learned/leafEval.js';

// Learned leaf evaluation (src/agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node src/agents/learned/train.mjs --game kdice   (or --all)
installLearnedEval(KDiceGame, import.meta.url, { deferred: true });

export { KDiceGame };
export { generateMap, getLargestConnectedRegion } from './map.js';
