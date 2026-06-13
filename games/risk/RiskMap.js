export const TERRITORY_IDS = [
  // North America (9)
  'alaska', 'northwest_territory', 'greenland', 'alberta', 'ontario',
  'quebec', 'western_us', 'eastern_us', 'central_america',
  // South America (4)
  'venezuela', 'peru', 'brazil', 'argentina',
  // Europe (7)
  'iceland', 'great_britain', 'western_europe', 'northern_europe',
  'scandinavia', 'ukraine', 'southern_europe',
  // Africa (6)
  'north_africa', 'egypt', 'east_africa', 'congo', 'south_africa', 'madagascar',
  // Asia (12)
  'middle_east', 'afghanistan', 'ural', 'siberia', 'yakutsk', 'kamchatka',
  'irkutsk', 'mongolia', 'china', 'india', 'southeast_asia', 'japan',
  // Australia (4)
  'indonesia', 'new_guinea', 'western_australia', 'eastern_australia',
];

export const TERRITORY_NAMES = {
  alaska:             'Alaska',
  northwest_territory:'NW Territory',
  greenland:          'Greenland',
  alberta:            'Alberta',
  ontario:            'Ontario',
  quebec:             'Quebec',
  western_us:         'Western US',
  eastern_us:         'Eastern US',
  central_america:    'Central America',
  venezuela:          'Venezuela',
  peru:               'Peru',
  brazil:             'Brazil',
  argentina:          'Argentina',
  iceland:            'Iceland',
  great_britain:      'Great Britain',
  western_europe:     'W. Europe',
  northern_europe:    'N. Europe',
  scandinavia:        'Scandinavia',
  ukraine:            'Ukraine',
  southern_europe:    'S. Europe',
  north_africa:       'N. Africa',
  egypt:              'Egypt',
  east_africa:        'E. Africa',
  congo:              'Congo',
  south_africa:       'S. Africa',
  madagascar:         'Madagascar',
  middle_east:        'Middle East',
  afghanistan:        'Afghanistan',
  ural:               'Ural',
  siberia:            'Siberia',
  yakutsk:            'Yakutsk',
  kamchatka:          'Kamchatka',
  irkutsk:            'Irkutsk',
  mongolia:           'Mongolia',
  china:              'China',
  india:              'India',
  southeast_asia:     'SE Asia',
  japan:              'Japan',
  indonesia:          'Indonesia',
  new_guinea:         'New Guinea',
  western_australia:  'W. Australia',
  eastern_australia:  'E. Australia',
};

export const ADJACENCY = {
  alaska:             ['northwest_territory', 'alberta', 'kamchatka'],
  northwest_territory:['alaska', 'greenland', 'alberta', 'ontario'],
  greenland:          ['northwest_territory', 'ontario', 'quebec', 'iceland'],
  alberta:            ['alaska', 'northwest_territory', 'ontario', 'western_us'],
  ontario:            ['northwest_territory', 'greenland', 'alberta', 'quebec', 'western_us', 'eastern_us'],
  quebec:             ['greenland', 'ontario', 'eastern_us'],
  western_us:         ['alberta', 'ontario', 'eastern_us', 'central_america'],
  eastern_us:         ['ontario', 'quebec', 'western_us', 'central_america'],
  central_america:    ['western_us', 'eastern_us', 'venezuela'],
  venezuela:          ['central_america', 'peru', 'brazil'],
  peru:               ['venezuela', 'brazil', 'argentina'],
  brazil:             ['venezuela', 'peru', 'argentina', 'north_africa'],
  argentina:          ['peru', 'brazil'],
  iceland:            ['greenland', 'great_britain', 'scandinavia'],
  great_britain:      ['iceland', 'western_europe', 'northern_europe', 'scandinavia'],
  western_europe:     ['great_britain', 'northern_europe', 'southern_europe', 'north_africa'],
  northern_europe:    ['great_britain', 'western_europe', 'scandinavia', 'ukraine', 'southern_europe'],
  scandinavia:        ['iceland', 'great_britain', 'northern_europe', 'ukraine'],
  ukraine:            ['scandinavia', 'northern_europe', 'southern_europe', 'middle_east', 'afghanistan', 'ural'],
  southern_europe:    ['western_europe', 'northern_europe', 'ukraine', 'north_africa', 'egypt', 'middle_east'],
  north_africa:       ['western_europe', 'southern_europe', 'brazil', 'egypt', 'east_africa', 'congo'],
  egypt:              ['southern_europe', 'north_africa', 'east_africa', 'middle_east'],
  east_africa:        ['north_africa', 'egypt', 'congo', 'south_africa', 'madagascar', 'middle_east'],
  congo:              ['north_africa', 'east_africa', 'south_africa'],
  south_africa:       ['congo', 'east_africa', 'madagascar'],
  madagascar:         ['east_africa', 'south_africa'],
  middle_east:        ['ukraine', 'southern_europe', 'egypt', 'east_africa', 'afghanistan', 'india'],
  afghanistan:        ['ukraine', 'middle_east', 'ural', 'china', 'india'],
  ural:               ['ukraine', 'afghanistan', 'siberia', 'china'],
  siberia:            ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
  yakutsk:            ['siberia', 'kamchatka', 'irkutsk'],
  kamchatka:          ['alaska', 'yakutsk', 'irkutsk', 'mongolia', 'japan'],
  irkutsk:            ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
  mongolia:           ['siberia', 'irkutsk', 'kamchatka', 'china', 'japan'],
  china:              ['ural', 'afghanistan', 'siberia', 'mongolia', 'india', 'southeast_asia'],
  india:              ['middle_east', 'afghanistan', 'china', 'southeast_asia'],
  southeast_asia:     ['china', 'india', 'indonesia'],
  japan:              ['kamchatka', 'mongolia'],
  indonesia:          ['southeast_asia', 'new_guinea', 'western_australia'],
  new_guinea:         ['indonesia', 'western_australia', 'eastern_australia'],
  western_australia:  ['indonesia', 'new_guinea', 'eastern_australia'],
  eastern_australia:  ['new_guinea', 'western_australia'],
};

export const CONTINENTS = {
  northAmerica: {
    name: 'North America',
    bonus: 5,
    territories: ['alaska', 'northwest_territory', 'greenland', 'alberta', 'ontario', 'quebec', 'western_us', 'eastern_us', 'central_america'],
  },
  southAmerica: {
    name: 'South America',
    bonus: 2,
    territories: ['venezuela', 'peru', 'brazil', 'argentina'],
  },
  europe: {
    name: 'Europe',
    bonus: 5,
    territories: ['iceland', 'great_britain', 'western_europe', 'northern_europe', 'scandinavia', 'ukraine', 'southern_europe'],
  },
  africa: {
    name: 'Africa',
    bonus: 3,
    territories: ['north_africa', 'egypt', 'east_africa', 'congo', 'south_africa', 'madagascar'],
  },
  asia: {
    name: 'Asia',
    bonus: 7,
    territories: ['middle_east', 'afghanistan', 'ural', 'siberia', 'yakutsk', 'kamchatka', 'irkutsk', 'mongolia', 'china', 'india', 'southeast_asia', 'japan'],
  },
  australia: {
    name: 'Australia',
    bonus: 2,
    territories: ['indonesia', 'new_guinea', 'western_australia', 'eastern_australia'],
  },
};

export function areAdjacent(t1, t2) {
  return ADJACENCY[t1]?.includes(t2) ?? false;
}

export function getContinent(territoryId) {
  for (const [id, cont] of Object.entries(CONTINENTS)) {
    if (cont.territories.includes(territoryId)) return id;
  }
  return null;
}

// BFS over owned territories to find all reachable territories from `fromId`
export function getConnectedOwned(fromId, playerId, territories) {
  const visited = new Set([fromId]);
  const queue = [fromId];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const adjId of ADJACENCY[curr] ?? []) {
      if (!visited.has(adjId) && territories[adjId]?.owner === playerId) {
        visited.add(adjId);
        queue.push(adjId);
      }
    }
  }
  visited.delete(fromId);
  return [...visited];
}
