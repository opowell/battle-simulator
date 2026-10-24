import { AowGame } from './AowGame.js';
import { installLearnedEval } from '#core/agents/learned/leafEval.js';

// Learned leaf evaluation (src/agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node src/agents/learned/train.mjs --game aow   (or --all)
installLearnedEval(AowGame, import.meta.url);

export { AowGame };
