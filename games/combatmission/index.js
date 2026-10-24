import { CombatMissionGame } from './CombatMissionGame.js';
import { installLearnedEval } from '#core/agents/learned/leafEval.js';

// Learned leaf evaluation (src/agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file. Regenerate models any time:
//   node src/agents/learned/train.mjs --game combatmission   (or --all)
installLearnedEval(CombatMissionGame, import.meta.url);

export { CombatMissionGame };
