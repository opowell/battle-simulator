// Command card deck. Each turn a player plays one card, which grants a number of
// "orders" — the units they may activate this turn — in one or more sections.
//
// A card is { id, name, section, orders } where `section` is:
//   'left' | 'center' | 'right'  — order units in that fixed section
//   'any'                        — player chooses one section on play
//   'all'                        — order `orders` units in EACH section (General Advance)
//
// Base tactic cards (Ambush, Their Finest Hour, …) are omitted; the deck is the
// section-card core, which is enough for full play.

let nextId = 0;
function card(name, section, orders) {
  return { id: `c${nextId++}`, name, section, orders };
}

// A base-game-flavored spread: the center is busier than the flanks, big-order
// cards (Attack/Assault) are rarer than small ones (Recon/Probe).
export function buildDeck() {
  nextId = 0;
  const deck = [];
  const add = (n, fn) => { for (let i = 0; i < n; i++) deck.push(fn()); };

  add(4, () => card('Recon 1', 'any', 1));
  add(3, () => card('Probe Center', 'center', 2));
  add(2, () => card('Probe Left', 'left', 2));
  add(2, () => card('Probe Right', 'right', 2));
  add(3, () => card('Attack Center', 'center', 3));
  add(2, () => card('Attack Left', 'left', 3));
  add(2, () => card('Attack Right', 'right', 3));
  add(2, () => card('Assault Center', 'center', 4));
  add(1, () => card('Assault Left', 'left', 4));
  add(1, () => card('Assault Right', 'right', 4));
  add(2, () => card('General Advance', 'all', 2));

  return deck;
}

// In-place Fisher–Yates using the engine rng (deterministic replays).
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
