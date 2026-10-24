// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { greedyChecks, rolloutChecks } from '#core/agents/agentChecks.js';
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { FFTAGame } from './index.js';

greedyChecks('ffta', FFTAGame);
rolloutChecks('ffta', FFTAGame);
rosterChecks('ffta', FFTAGame);
