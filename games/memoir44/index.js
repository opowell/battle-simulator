import { Memoir44Game } from './Memoir44Game.js';
import { installLearnedEval } from '../../agents/learned/leafEval.js';

// Learned leaf evaluation (agents/LEARNED-EVAL-PLAN.md): a no-op unless a
// gate-passing model.json sits next to this file.
installLearnedEval(Memoir44Game, import.meta.url);

export { Memoir44Game };
