import { CardBattleGame } from './CardBattleGame.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node agents/learned/train.mjs --game cardbattle   (or --all)
installLearnedEval(CardBattleGame, import.meta.url);

export { CardBattleGame };
