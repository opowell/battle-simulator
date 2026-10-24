// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { greedyChecks, rolloutChecks } from '#core/agents/agentChecks.js';
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { Sc2Game } from './index.js';

greedyChecks('sc2', Sc2Game);
rolloutChecks('sc2', Sc2Game);
rosterChecks('sc2', Sc2Game);
