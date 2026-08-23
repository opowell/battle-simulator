// civs.js — the original game's fourteen civilizations.
//
// Names, leaders, colours and city lists are the 1991 game's own data, taken from
// CivOne (github.com/SWY1985/CivOne, released CC0), a faithful reimplementation
// that carries the original tables verbatim. They are reproduced verbatim here
// too, the original's own spellings included ("Ninevah", "Hyderbad", "Dortmond",
// "Isandhlwala", "Atrakhan") — these are the names the game prints, and correcting
// them would make the city list something other than the one being copied.
//
// Each civ founds cities from its own list of sixteen, in order. The 32 SPARE_CITIES
// are the original's shared reserve, drawn on once a civ has used its own list up
// (in the real game's data file they sit right after the fourteen lists, which is
// exactly where nextCityName goes looking for them).
//
// COLOURS: the original has seven player colours but fourteen civs, so the civs come
// in colour pairs — Romans/Russians, Babylonians/Zulus, and so on down the list, each
// civ pairing with the one seven places after it. A single game never contains both
// halves of a pair, which is the rule pickCivs keeps below. Red belongs to nobody: it
// is the barbarians' colour (see barbarians.js, and ui.teamColors in Civ1Game.js).
// Note that seat colour in THIS engine comes from the seat, not from the civ — the
// palette is a static list indexed by seat (apps/design/teamPalette.js) — so `color`
// here is the original's assignment, recorded to keep the pairing rule meaningful.

export const CIVS = [
  {
    id: 'romans', name: 'Romans', adjective: 'Roman', leader: 'Caesar', color: 'white',
    cities: ['Rome', 'Caesarea', 'Carthage', 'Nicopolis', 'Byzantium', 'Brundisium', 'Syracuse', 'Antioch',
      'Palmyra', 'Cyrene', 'Gordion', 'Tyrus', 'Jerusalem', 'Seleucia', 'Ravenna', 'Artaxata'],
  },
  {
    id: 'babylonians', name: 'Babylonians', adjective: 'Babylonian', leader: 'Hammurabi', color: 'green',
    cities: ['Babylon', 'Sumer', 'Uruk', 'Ninevah', 'Ashur', 'Ellipi', 'Akkad', 'Eridu',
      'Kish', 'Nippur', 'Shuruppak', 'Zariqum', 'Izibia', 'Nimrud', 'Arbela', 'Zamua'],
  },
  {
    id: 'germans', name: 'Germans', adjective: 'German', leader: 'Frederick', color: 'blue',
    cities: ['Berlin', 'Leipzig', 'Hamburg', 'Bremen', 'Frankfurt', 'Bonn', 'Nuremberg', 'Cologne',
      'Hannover', 'Munich', 'Stuttgart', 'Heidelberg', 'Salzburg', 'Konigsberg', 'Dortmond', 'Brandenburg'],
  },
  {
    id: 'egyptians', name: 'Egyptians', adjective: 'Egyptian', leader: 'Ramesses', color: 'yellow',
    cities: ['Thebes', 'Memphis', 'Oryx', 'Heliopolis', 'Gaza', 'Alexandria', 'Byblos', 'Cairo',
      'Coptos', 'Edfu', 'Pithom', 'Busirus', 'Athribus', 'Mendes', 'Tanis', 'Abydos'],
  },
  {
    id: 'americans', name: 'Americans', adjective: 'American', leader: 'Abe Lincoln', color: 'cyan',
    cities: ['Washington', 'New York', 'Boston', 'Philadelphia', 'Atlanta', 'Chicago', 'Buffalo', 'St. Louis',
      'Detroit', 'New Orleans', 'Baltimore', 'Denver', 'Cincinnati', 'Dallas', 'Los Angeles', 'Las Vegas'],
  },
  {
    id: 'greeks', name: 'Greeks', adjective: 'Greek', leader: 'Alexander', color: 'purple',
    cities: ['Athens', 'Sparta', 'Corinth', 'Delphi', 'Eretria', 'Pharsalos', 'Argos', 'Mycenae',
      'Herakleia', 'Antioch', 'Ephesos', 'Rhodes', 'Knossos', 'Troy', 'Pergamon', 'Miletos'],
  },
  {
    id: 'indians', name: 'Indians', adjective: 'Indian', leader: 'M.Gandhi', color: 'grey',
    cities: ['Delhi', 'Bombay', 'Madras', 'Bangalore', 'Calcutta', 'Lahore', 'Karachi', 'Kolhapur',
      'Jaipur', 'Hyderbad', 'Bengal', 'Chittagong', 'Punjab', 'Dacca', 'Indus', 'Ganges'],
  },
  {
    id: 'russians', name: 'Russians', adjective: 'Russian', leader: 'Stalin', color: 'white',
    cities: ['Moscow', 'Leningrad', 'Kiev', 'Minsk', 'Smolensk', 'Odessa', 'Sevastopol', 'Tblisi',
      'Sverdlovsk', 'Yakutsk', 'Vladivostok', 'Novograd', 'Krasnoyarsk', 'Riga', 'Rostov', 'Atrakhan'],
  },
  {
    id: 'zulus', name: 'Zulus', adjective: 'Zulu', leader: 'Shaka', color: 'green',
    cities: ['Zimbabwe', 'Ulundi', 'Bapedi', 'Hlobane', 'Isandhlwala', 'Intombe', 'Mpondo', 'Ngome',
      'Swazi', 'Tugela', 'Umtata', 'Umfolozi', 'Ibabanago', 'Isipezi', 'Amatikulu', 'Zunquin'],
  },
  {
    id: 'french', name: 'French', adjective: 'French', leader: 'Napoleon', color: 'blue',
    cities: ['Paris', 'Orleans', 'Lyons', 'Tours', 'Chartres', 'Bordeaux', 'Rouen', 'Avignon',
      'Marseilles', 'Grenoble', 'Dijon', 'Amiens', 'Cherbourg', 'Poitiers', 'Toulouse', 'Bayonne'],
  },
  {
    id: 'aztecs', name: 'Aztecs', adjective: 'Aztec', leader: 'Montezuma', color: 'yellow',
    cities: ['Tenochtitlan', 'Chiauhtia', 'Chapultapec', 'Coatepec', 'Ayontzinco', 'Itzapalapa', 'Itzapam', 'Mitxcoac',
      'Tucubaya', 'Tecamac', 'Tepezinco', 'Ticoman', 'Tlaxcala', 'Xaltocan', 'Xicalango', 'Zumpanco'],
  },
  {
    id: 'chinese', name: 'Chinese', adjective: 'Chinese', leader: 'Mao Tse Tung', color: 'cyan',
    cities: ['Peking', 'Shanghai', 'Canton', 'Nanking', 'Tsingtao', 'Hangchow', 'Tientsin', 'Tatung',
      'Macao', 'Anyang', 'Shantung', 'Chinan', 'Kaifeng', 'Ningpo', 'Paoting', 'Yangchow'],
  },
  {
    id: 'english', name: 'English', adjective: 'English', leader: 'Elizabeth I', color: 'purple',
    cities: ['London', 'Coventry', 'Birmingham', 'Dover', 'Nottingham', 'York', 'Liverpool', 'Brighton',
      'Oxford', 'Reading', 'Exeter', 'Cambridge', 'Hastings', 'Canterbury', 'Banbury', 'Newcastle'],
  },
  {
    id: 'mongols', name: 'Mongols', adjective: 'Mongol', leader: 'Genghis Khan', color: 'grey',
    cities: ['Samarkand', 'Bokhara', 'Nishapur', 'Karakorum', 'Kashgar', 'Tabriz', 'Aleppo', 'Kabul',
      'Ormuz', 'Basra', 'Khanbaryk', 'Khorasan', 'Shangtu', 'Kazan', 'Qyinsay', 'Kerman'],
  },
];

// The shared reserve, drawn on after a civ has founded its sixteenth city.
export const SPARE_CITIES = [
  'Mecca', 'Naples', 'Sidon', 'Tyre', 'Tarsus', 'Issus', 'Cunaxa', 'Cremona',
  'Cannae', 'Capua', 'Turin', 'Genoa', 'Utica', 'Crete', 'Damascus', 'Verona',
  'Salamis', 'Lisbon', 'Hamburg', 'Prague', 'Salzburg', 'Bergen', 'Venice', 'Milan',
  'Ghent', 'Pisa', 'Cordoba', 'Seville', 'Dublin', 'Toronto', 'Melbourne', 'Sydney',
];

export const CIV_IDS = CIVS.map(c => c.id);

const BY_ID = new Map(CIVS.map(c => [c.id, c]));

// The civ with this id, or the Romans — a state written before civs existed, or by a
// scenario that never named one, still has to found cities under some flag.
export function getCiv(id) {
  return BY_ID.get(id) ?? CIVS[0];
}

// Every name in the world, in the original's own order: the fourteen lists in turn,
// then the spares. This is the last resort of nextCityName — a civ that has exhausted
// its own list and the spares starts founding cities under rivals' names, exactly as
// the original does.
const ALL_CITY_NAMES = [...CIVS.flatMap(c => c.cities), ...SPARE_CITIES];

/**
 * The name a civ's next city takes: the first name free in its own list, else the
 * first free spare, else the first free name anywhere.
 *
 * `usedNames` is every city name already on the map — the whole world's, not just
 * this civ's, because two cities never share a name. (Names do repeat ACROSS the
 * original's lists — Hamburg, Salzburg and Prague are German and spare both — so
 * matching by name rather than by list position also stops a duplicate arising that
 * way.) All 256 taken is not reachable with this engine's city counts, but the
 * numbered fallback keeps a name coming if it ever were.
 */
export function nextCityName(civId, usedNames) {
  const used = usedNames instanceof Set ? usedNames : new Set(usedNames);
  const free = list => list.find(n => !used.has(n));
  return free(getCiv(civId).cities) ?? free(SPARE_CITIES) ?? free(ALL_CITY_NAMES) ?? `City ${used.size + 1}`;
}

/**
 * Which civ each seat plays. `preferredId` is the first seat's pick (the human's, from
 * the setup menu); the rest are drawn at random, or taken in the original's own civ
 * order when there is no rng — a fixed scenario wants the same civs every time.
 *
 * No two seats share a colour, as in the original, so a game never holds both halves
 * of a colour pair (never Romans AND Russians). With more seats than the seven colours
 * that rule has to give way — it lets any unused civ in rather than leaving a seat
 * civ-less.
 */
export function pickCivs(count, rng = null, preferredId = null) {
  const chosen = [];
  const takenIds = new Set();
  const takenColors = new Set();
  const take = (civ) => { chosen.push(civ.id); takenIds.add(civ.id); takenColors.add(civ.color); };

  const preferred = BY_ID.get(preferredId);
  if (preferred && count > 0) take(preferred);

  while (chosen.length < count) {
    const free = CIVS.filter(c => !takenIds.has(c.id));
    const pool = free.filter(c => !takenColors.has(c.color));
    const from = pool.length ? pool : free;
    if (!from.length) break;
    take(rng ? from[Math.floor(rng() * from.length)] : from[0]);
  }
  return chosen;
}
