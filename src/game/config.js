export const GRID = 140; // cells per side
export const ROUND_TIME = 150; // seconds
export const WIN_SHARE = 0.25; // instant victory at 25% of the arena
export const PLAYER_SPEED = 9.4; // base cells per second
// speed bonuses (fractions of base speed, added together)
export const AREA_SPEED_MAX = 0.3; // bonus at WIN_SHARE land; scales with sqrt(share) so early land matters
export const KILL_SPEED = 0.04; // permanent bonus per kill this life...
export const KILL_SPEED_MAX = 0.2; // ...capped
export const RUSH_SPEED = 0.4; // temporary surge while a rush is active
export const RUSH_KILL = 3; // seconds of rush per kill
export const BIG_GRAB = 150; // cells captured in one go that count as a big grab
export const RUSH_MAX = 7; // rush time cap (seconds)
export const TURN_RATE = 6.5; // radians per second
export const START_RADIUS = 3.2; // starting territory radius (cells)
export const BOT_RESPAWN = 3.5; // seconds
export const NUM_BOTS = 7;
export const TICK = 1 / 120;

export const ANIMALS = [
  { id: 'fox', name: 'Fox', color: '#ff7a2f', title: 'Ember' },
  { id: 'bunny', name: 'Bunny', color: '#ff7eb6', title: 'Blossom' },
  { id: 'cat', name: 'Cat', color: '#a77bff', title: 'Mystic' },
  { id: 'frog', name: 'Frog', color: '#5fd35a', title: 'Mossy' },
  { id: 'penguin', name: 'Penguin', color: '#3fb7ff', title: 'Frost' },
  { id: 'unicorn', name: 'Unicorn', color: '#ffd23f', title: 'Glimmer' },
  { id: 'bear', name: 'Bear', color: '#ff4f5e', title: 'Rumble' },
  { id: 'owl', name: 'Owl', color: '#2fe0c8', title: 'Sage' },
];

export const BOT_NAMES = [
  'Pip', 'Mochi', 'Biscuit', 'Juniper', 'Nimbus', 'Pickle', 'Clover', 'Waffles',
  'Bramble', 'Tofu', 'Sprout', 'Nugget', 'Pebble', 'Maple', 'Ziggy', 'Pudding',
];
