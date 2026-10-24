// actionLabels.js — a game's own words for its own action types (ui.actionLabels),
// for the Orders buttons and the log. Each type's entry is either
//
//   'Revolution → {government}'                         a template over the action's fields
//   { side: { kingside: 'O-O', queenside: 'O-O-O' } }    by the value of one field
//
// An action's own `label` still comes first; a type with no entry falls back to the
// generic wording of whoever asks.
export function gameActionLabel(action, ui) {
  let spec = ui?.actionLabels?.[action.type];
  if (spec && typeof spec === 'object') {
    const [field, byValue] = Object.entries(spec)[0] ?? [];
    spec = byValue?.[action[field]];
  }
  if (typeof spec !== 'string') return null;
  return spec.replace(/\{(\w+)\}/g, (_, k) => action[k] ?? '');
}
