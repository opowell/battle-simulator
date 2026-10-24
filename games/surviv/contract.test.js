// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { greedyChecks } from '#core/agents/agentChecks.js';
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { SurvivGame } from './index.js';

greedyChecks('surviv', SurvivGame, ['blue', 'red']);
rosterChecks('surviv', SurvivGame, ['blue', 'red']);
