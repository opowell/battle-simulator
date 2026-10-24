// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { greedyChecks, rolloutChecks } from '#core/agents/agentChecks.js';
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { CsGame } from './index.js';

greedyChecks('cs', CsGame, ['ct', 't']);
rolloutChecks('cs', CsGame);
rosterChecks('cs', CsGame, ['ct', 't']);
