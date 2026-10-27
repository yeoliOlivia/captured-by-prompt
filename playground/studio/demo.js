const unsplash = id => `/studio/assets/${id}.jpg`;

export const demoMembers = [
  { id: 'maya', name: 'Maya', color: '#e7bdb0', initials: 'M' },
  { id: 'mark', name: 'Mark', color: '#c3cfb5', initials: 'M' },
  { id: 'olivia', name: 'Olivia', color: '#dec5ab', initials: 'O' },
  { id: 'owen', name: 'Owen', color: '#b9c7ce', initials: 'O' },
  { id: 'ella', name: 'Ella', color: '#d4bdd2', initials: 'E' },
  { id: 'leo', name: 'Leo', color: '#d6d3a2', initials: 'L' },
];

export const demoPlaces = [
  { id: 'alfama', name: 'Alfama', note: 'Getting happily lost', x: 66, y: 46 },
  { id: 'belem', name: 'Belém', note: 'One more pastel de nata', x: 25, y: 71 },
  { id: 'bairro', name: 'Bairro Alto', note: 'The long way home', x: 47, y: 36 },
  { id: 'cascais', name: 'Cascais', note: 'A little salt in our hair', x: 18, y: 24 },
  { id: 'miradouro', name: 'The lookout', note: 'Stayed for the sunset', x: 76, y: 20 },
];

// Deliberately authored fixtures, not model outputs. People and locations are
// fictional associations for demonstrating the product, not image recognition.
const rows = [
  ['1555881400-74d7acaacd8b', 'The long way to lunch', 'alfama', 'scenery', [], ['walking', 'city', 'colorful'], ['sunny', 'slow'], 92, false, false, .82],
  ['1529156069898-49953e39b3ac', 'The whole point of the trip', 'bairro', 'people', ['maya', 'mark', 'olivia', 'owen', 'ella', 'leo'], ['friends', 'together', 'walking'], ['joyful', 'candid'], 95, true, true, 1.18],
  ['1476514525535-07fb3b4ae5f1', 'No plans, just this', 'cascais', 'scenery', [], ['water', 'ocean', 'nature'], ['calm', 'blue'], 96, false, false, .84],
  ['1512621776951-a57141f2eefd', 'Lunch turned into dinner', 'belem', 'food', ['maya', 'ella'], ['food', 'lunch', 'table'], ['colorful', 'slow'], 86, false, false, 1.05],
  ['1500534623283-312aade485b7', 'Somewhere along the way', 'miradouro', 'scenery', [], ['nature', 'walking', 'golden hour'], ['quiet', 'warm'], 94, false, false, 1.22],
  ['1517841905240-472988babdf9', 'Maya, between moments', 'alfama', 'people', ['maya'], ['portrait', 'friends'], ['candid', 'sunny'], 91, true, true, .82],
  ['1516483638261-f4dbaf036963', 'Postcard behavior', 'alfama', 'scenery', [], ['city', 'colorful', 'ocean'], ['sunny', 'bright'], 97, false, false, .84],
  ['1507525428034-b723cf961d3e', 'Everyone forgot the time', 'cascais', 'scenery', [], ['beach', 'ocean', 'water'], ['calm', 'sunny'], 93, false, false, 1.18],
  ['1500648767791-00dcc994a43e', 'Mark’s one good portrait', 'bairro', 'people', ['mark'], ['portrait', 'friends'], ['candid'], 87, true, true, .82],
  ['1511632765486-a01980e01a18', 'Can we stay another day?', 'cascais', 'people', ['maya', 'mark', 'ella'], ['friends', 'together', 'outdoors'], ['joyful', 'warm'], 89, true, true, 1.17],
  ['1509042239860-f550ce710b93', 'The first of many coffees', 'belem', 'food', ['owen', 'leo'], ['coffee', 'breakfast', 'table'], ['cozy', 'slow'], 84, false, false, 1.1],
  ['1493246507139-91e8fad9978e', 'The detour was the plan', 'miradouro', 'scenery', [], ['nature', 'walking', 'outdoors'], ['quiet', 'green'], 92, false, false, .86],
  ['1534528741775-53994a69daeb', 'Olivia caught the light', 'miradouro', 'people', ['olivia'], ['portrait', 'friends', 'golden hour'], ['warm', 'candid'], 96, false, true, .82],
  ['1500530855697-b586d89ba3ee', 'A very good place to stop', 'cascais', 'scenery', [], ['nature', 'walking', 'outdoors'], ['adventure', 'calm'], 93, false, false, 1.23],
  ['1518837695005-2083093ee35b', 'Saltwater state of mind', 'cascais', 'scenery', [], ['ocean', 'beach', 'water'], ['blue', 'calm'], 88, false, false, 1.17],
  ['1511988617509-a57c8a288659', 'One for the group chat', 'bairro', 'people', ['maya', 'olivia', 'owen', 'leo'], ['friends', 'together', 'hanging out'], ['joyful', 'candid'], 90, true, false, 1.19],
  ['1506794778202-cad84cf45f1d', 'Owen, off duty', 'alfama', 'people', ['owen'], ['portrait', 'friends'], ['candid', 'calm'], 88, false, true, .83],
  ['1515387784663-e2e29a23f69e', 'Dinner without a reservation', 'belem', 'food', ['mark', 'olivia', 'ella'], ['food', 'dinner', 'table'], ['warm', 'cozy'], 85, false, false, 1.1],
  ['1464822759023-fed622ff2c3b', 'Taking the scenic route', 'miradouro', 'scenery', [], ['nature', 'walking', 'outdoors'], ['adventure', 'quiet'], 91, false, false, .86],
  ['1524504388940-b1c1722653e1', 'Ella, in her element', 'alfama', 'people', ['ella'], ['portrait', 'friends', 'golden hour'], ['warm', 'candid'], 94, false, true, .82],
  ['1469474968028-56623f02e42e', 'Before the world woke up', 'miradouro', 'scenery', [], ['nature', 'sunrise', 'outdoors'], ['quiet', 'warm'], 95, false, false, 1.23],
  ['1539571696357-5a69c17a67c6', 'Leo found his light', 'bairro', 'people', ['leo'], ['portrait', 'friends'], ['candid'], 87, false, true, .82],
  ['1519608487953-e999c86e7455', 'Just one more sunset', 'miradouro', 'scenery', [], ['sky', 'sunset', 'golden hour'], ['warm', 'quiet'], 96, false, false, 1.16],
  ['1528605248644-14dd04022da1', 'Same time next year?', 'bairro', 'people', ['maya', 'mark', 'olivia', 'owen', 'ella', 'leo'], ['friends', 'dinner', 'together'], ['joyful', 'warm'], 98, true, true, 1.18],
];

export const demoPhotos = rows.map((r, i) => ({
  id: `demo-${String(i + 1).padStart(2, '0')}`, name: r[1], image: unsplash(`photo-${r[0]}`), placeId: r[2], aspect: r[10],
  capturedAt: `2026-05-${16 + Math.floor(i / 8)}T${String(9 + i % 8).padStart(2, '0')}:24:00Z`,
  annotation: { provenance: 'demo', scene: r[3], members: r[4].map(memberId => ({ memberId, status: 'confirmed' })), activities: r[5], vibes: r[6], aesthetic: r[7], smilesVisible: r[8], facesClear: r[9], evidence: 'Authored sample labels for this concept. Not inferred from the photograph.' },
  credit: 'Illustrative photography via Unsplash',
}));

export const demoTrip = { id: 'demo-lisbon', title: 'A little lost in Lisbon', place: 'Lisbon, Portugal', startDate: '2026-05-16', endDate: '2026-05-18', members: demoMembers, photoCount: demoPhotos.length };
