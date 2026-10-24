// The core ruleset's scenarios, each a battle spec (src/battle/spec.js) in a
// JSON file of its own. A scenario's config names its spec by id.
export const SPECS = {};

export const SPEC_SCENARIOS = Object.values(SPECS).map(s => ({
  id: s.id, name: s.name, description: s.description ?? '', config: { spec: s.id, ...(s.modes ?? {}) },
}));
