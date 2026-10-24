// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { greedyChecks, rolloutChecks } from '#core/agents/agentChecks.js';
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { Civ2Game } from './index.js';

greedyChecks('civ2', Civ2Game);
rolloutChecks('civ2', Civ2Game);
rosterChecks('civ2', Civ2Game);
