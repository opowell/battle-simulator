// Civ1 difficulty presets, offered as a game mode.
//
// A difficulty is a *symmetric* preset: it sets the same world rules for every
// civilization, so it changes how hard the game is to play without ever handing the
// AI a bonus. (The AI's strength is purely how much it is allowed to think — the
// separate "AI difficulty" option — never privileged information or free resources.)
//
// The lever is `contentBaseline`: how many citizens in a city are content before the
// rest turn unhappy. Easier levels keep more citizens content; on Deity almost every
// citizen past the first needs a temple, luxuries, or a wonder to stay in order.
// Individual rule values can still be overridden directly in the game options; a blank
// override falls back to the selected preset (see resolveRules).

export const DIFFICULTIES = {
  chieftain: { name: 'Chieftain', contentBaseline: 6 },
  warlord:   { name: 'Warlord',   contentBaseline: 5 },
  prince:    { name: 'Prince',    contentBaseline: 4 },
  king:      { name: 'King',      contentBaseline: 3 },
  emperor:   { name: 'Emperor',   contentBaseline: 2 },
  deity:     { name: 'Deity',     contentBaseline: 1 },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
export const DEFAULT_DIFFICULTY = 'prince';

// Resolve the effective rule values from a game config: start from the selected
// difficulty preset, then let any explicit per-rule override win. These rules are
// stored once in gameSpecific.rules and read by both civilizations identically.
export function resolveRules(config = {}) {
  const preset = DIFFICULTIES[config.difficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  const override = config.contentBaseline;
  const hasOverride = override !== undefined && override !== null && override !== '' && Number.isFinite(Number(override));
  const contentBaseline = hasOverride
    ? Math.max(0, Math.min(12, Math.round(Number(override))))
    : preset.contentBaseline;
  return {
    difficulty: DIFFICULTIES[config.difficulty] ? config.difficulty : DEFAULT_DIFFICULTY,
    contentBaseline,
  };
}
