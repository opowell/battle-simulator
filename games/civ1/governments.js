// Civ1 governments. Switching government triggers a short Anarchy period (a
// "revolution") before the new one takes effect.
//
//   taxMax          — highest tax/luxury rate the slider allows (rest goes to science)
//   despotismPenalty— tiles yielding ≥3 of a resource lose 1 (the Despotism penalty)
//   tradeBonus      — +1 trade on every worked tile that already makes trade
//   martialLaw      — military units in a city each pacify this many unhappy citizens
//   militaryUnhappy — unhappy citizens created per aggressive government's own units
//   corruption      — base fraction of trade lost to corruption (scaled by distance)

export const GOVERNMENTS = {
  anarchy:    { name: 'Anarchy',    tech: null,           taxMax: 60, despotismPenalty: true,  tradeBonus: false, martialLaw: 0, militaryUnhappy: 0, corruption: 0.5 },
  despotism:  { name: 'Despotism',  tech: null,           taxMax: 60, despotismPenalty: true,  tradeBonus: false, martialLaw: 3, militaryUnhappy: 0, corruption: 0.4 },
  monarchy:   { name: 'Monarchy',   tech: 'monarchy',     taxMax: 70, despotismPenalty: false, tradeBonus: false, martialLaw: 3, militaryUnhappy: 0, corruption: 0.3 },
  communism:  { name: 'Communism',  tech: 'communism',    taxMax: 80, despotismPenalty: false, tradeBonus: false, martialLaw: 3, militaryUnhappy: 0, corruption: 0.1 },
  republic:   { name: 'Republic',   tech: 'the-republic', taxMax: 80, despotismPenalty: false, tradeBonus: true,  martialLaw: 0, militaryUnhappy: 1, corruption: 0.25 },
  democracy:  { name: 'Democracy',  tech: 'democracy',    taxMax: 90, despotismPenalty: false, tradeBonus: true,  martialLaw: 0, militaryUnhappy: 2, corruption: 0 },
};

export const GOVERNMENT_IDS = Object.keys(GOVERNMENTS);

// Governments a civ may switch to right now: Despotism is always available; the rest
// need their advance. Anarchy is only ever entered as the transition, not chosen.
export function availableGovernments(known) {
  return GOVERNMENT_IDS.filter(id => {
    if (id === 'anarchy') return false;
    const g = GOVERNMENTS[id];
    return g.tech === null || known.has(g.tech);
  });
}
