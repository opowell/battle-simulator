import { TacticalGame } from './TacticalGame.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game tactical   (or --all)
installLearnedEval(TacticalGame, import.meta.url);

export { TacticalGame };
