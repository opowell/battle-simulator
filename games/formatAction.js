function pos(p) {
  if (p && typeof p === 'object' && 'x' in p) return `(${p.x},${p.y})`;
  return String(p);
}

export function formatAction(a) {
  if (a.type === 'move' && a.from && a.to) {
    const cap = a.isCapture ? ` x${a.targetId}` : '';
    const promo = a.payload?.promote ? `=${a.payload.promote[0].toUpperCase()}` : '';
    return `${a.unitId}: ${pos(a.from)}→${pos(a.to)}${cap}${promo}`;
  }
  if (a.type === 'castle') return `Castle ${a.side}`;
  if (a.type === 'attack')     return `${a.unitId} attacks ${a.targetId}`;
  if (a.type === 'found-city') return `${a.unitId}: Found city here`;
  if (a.type === 'build-road') return `${a.unitId}: Build road`;
  if (a.type === 'skip-unit')  return `${a.unitId}: Skip (no action)`;
  if (a.type === 'play-card')  return `Play ${a.payload?.card} (hand[${a.payload?.handIndex}])`;
  if (a.type === 'ability')    return `${a.unitId}: ${a.abilityName} → ${a.targetId}`;
  if (a.type === 'end-turn')   return 'End turn';
  return JSON.stringify(a);
}
