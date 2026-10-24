// The core's checks of this game: its generic agents play it (src/agents/agentChecks.js)
// and its opening roster can be edited (src/engine/rosterChecks.js).
import { rosterChecks } from '#core/engine/rosterChecks.js';
import { ArenaGame } from './index.js';

rosterChecks('arena', ArenaGame);
