// Deterministic mechanics tests for the simulation core.
import assert from 'node:assert/strict';
import { Game } from '../src/game/core.js';

function freshGame() {
  const g = new Game({ playerAnimal: 'fox' });
  // park every bot far away, frozen, so scenarios are deterministic
  for (const p of g.players) { if (p.isBot) { p.brain = { think() {}, reset() {} }; p.baseSpeed = 0; } }
  return g;
}
function run(g, sec) { for (let t = 0; t < sec; t += 1 / 60) g.update(1 / 60); }
function clearBoard(g) {
  for (const p of g.players) if (p.alive) g.kill(p, null, 'reset');
  g.drainEvents();
}
function place(g, p, x, z, r = 3) {
  p.alive = true; p.area = 0; p.trail = []; p.path = [];
  p.minX = g.N; p.maxX = 0; p.minZ = g.N; p.maxZ = 0;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) g.setOwner((z + dz) * g.N + (x + dx), p, false);
  p.x = x + 0.5; p.z = z + 0.5; p.cell = z * g.N + x;
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓', name); }

test('loop outside territory captures the enclosed area', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; place(g, h, 40, 40); h.baseSpeed = 8;
  const before = h.area;
  const legs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const a of legs) { h.angle = h.targetAngle = a; run(g, 1.3); }
  // head back home
  for (let t = 0; t < 3 && h.trail.length; t += 1 / 60) {
    h.targetAngle = Math.atan2(40.5 - h.z, 40.5 - h.x); g.update(1 / 60);
  }
  assert.ok(h.alive, 'still alive');
  assert.equal(h.trail.length, 0, 'trail consumed');
  assert.ok(h.area > before + 60, `area grew ${before} -> ${h.area}`);
  const ev = g.drainEvents().filter((e) => e.type === 'capture');
  assert.ok(ev.length >= 1, 'capture event emitted');
});

test('crossing an enemy trail eliminates its owner', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; const b = g.players[1];
  place(g, h, 30, 60); place(g, b, 60, 30);
  // give the bot an exposed trail across x=30..50 at z=45
  for (let x = 30; x <= 50; x++) { const i = 45 * g.N + x; g.trailGrid[i] = b.code; b.trail.push(i); }
  h.baseSpeed = 8; h.angle = h.targetAngle = -Math.PI / 2; // move up (towards smaller z)
  run(g, 2.5);
  assert.equal(b.alive, false, 'bot eliminated');
  assert.equal(h.kills, 1, 'kill credited');
  assert.equal(b.area, 0, 'victim territory removed');
  assert.ok(h.alive, 'killer alive');
});

test('crossing your own trail is harmless and still captures', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; place(g, h, 70, 70); h.baseSpeed = 8;
  h.angle = h.targetAngle = 0; run(g, 1.5); // out to the right
  h.targetAngle = Math.PI / 2; run(g, 0.5);
  h.targetAngle = Math.PI; run(g, 0.4);
  h.targetAngle = -Math.PI / 2; run(g, 1.2); // cut back across own trail
  assert.ok(h.alive, 'human survives crossing own trail');
  const before = h.area;
  for (let t = 0; t < 4 && h.trail.length; t += 1 / 60) {
    h.targetAngle = Math.atan2(70.5 - h.z, 70.5 - h.x); g.update(1 / 60);
  }
  assert.equal(h.trail.length, 0, 'made it home');
  assert.ok(h.area > before, 'loop captured');
});

test('running along the arena edge is faster', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; place(g, h, 70, 70);
  const mid = h.speedBonus;
  h.x = 0.6;
  const instant = h.speedBonus;
  assert.ok(instant > mid + 0.15, `edge bonus ${mid} -> ${instant}`);
  for (let t = 0; t < 2; t += 1 / 60) h.updateEdge(1 / 60);
  const twoSec = h.speedBonus;
  for (let t = 0; t < 2; t += 1 / 60) h.updateEdge(1 / 60);
  const fourSec = h.speedBonus;
  assert.ok(twoSec > instant + 0.1 && fourSec > twoSec + 0.3, `edge ramps up ${instant} -> ${twoSec} -> ${fourSec}`);
  h.x = 70.5;
  for (let t = 0; t < 1.5; t += 1 / 60) h.updateEdge(1 / 60);
  assert.equal(h.edgeRamp, 0, 'edge boost fades after leaving the lane');
});

test('killing a rival hands you their land', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; const b = g.players[1];
  place(g, h, 30, 30); place(g, b, 90, 90, 5);
  const hBefore = h.area; const bLand = b.area;
  g.kill(b, h, 'cut');
  assert.equal(b.area, 0, 'victim has no land');
  assert.equal(h.area, hBefore + bLand, 'killer inherits it all');
  assert.equal(g.owner[90 * g.N + 90], h.code, 'victim home now belongs to killer');
  const ev = g.drainEvents().find((e) => e.type === 'death');
  assert.equal(ev.inherited, bLand);
});

test('players are safe from bumps inside their own territory', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; const b = g.players[1];
  place(g, h, 50, 50, 5);
  b.alive = true; b.x = 50.5; b.z = 50.5 + 0.3; b.cell = 50 * g.N + 50; b.trail = [1]; // intruder head-to-head inside human land
  g.checkHeadCollisions();
  assert.ok(h.alive, 'owner survives');
  assert.equal(b.alive, false, 'intruder dies');
});

test('round ends with defeat when the human dies', () => {
  const g = freshGame();
  g.kill(g.human, g.players[1], 'cut');
  run(g, 0.05);
  assert.equal(g.state, 'lost');
  assert.equal(g.result.reason, 'eliminated');
});

test('round ends at the timer with the leader winning', () => {
  const g = freshGame();
  g.timeLeft = 0.02;
  const h = g.human; place(g, h, 70, 70, 6);
  run(g, 0.1);
  assert.equal(g.state, 'won');
  assert.equal(g.result.reason, 'timeout-lead');
});

test('area bookkeeping matches the grid after random play', () => {
  const g = new Game({}); g.checkEnd = () => {};
  run(g, 60);
  const counts = new Array(10).fill(0);
  for (const o of g.owner) counts[o]++;
  for (const p of g.players) assert.equal(counts[p.code], p.area, `${p.name} area`);
});

test('more land means more speed', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; place(g, h, 40, 40, 2);
  const small = h.speedBonus;
  place(g, h, 70, 70, 20);
  assert.ok(h.speedBonus > small + 0.1, `bonus ${small} -> ${h.speedBonus}`);
  run(g, 0.05);
  assert.ok(h.speed > h.baseSpeed * 1.1, 'speed applied');
});

test('kills grant a rush and a lasting speed bonus', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; const b = g.players[1];
  place(g, h, 30, 30); place(g, b, 90, 90);
  const before = h.speedBonus;
  g.kill(b, h, 'cut');
  assert.ok(h.rush > 0, 'rush started');
  assert.ok(h.speedBonus > before + 0.3, 'big temporary boost');
  run(g, 8);
  assert.equal(h.rush, 0, 'rush expired');
  assert.ok(h.speedBonus > before, 'lasting kill bonus remains');
});

test('a big single capture triggers a rush, a small one does not', () => {
  const g = freshGame(); clearBoard(g); g.checkEnd = () => {};
  const h = g.human; place(g, h, 60, 60, 2);
  // small loop
  for (let x = 63; x <= 64; x++) { const i = 58 * g.N + x; g.trailGrid[i] = h.code; h.trail.push(i); }
  g.capture(h);
  assert.equal(h.rush, 0, 'no rush for small grab');
  // large loop: a 16x16 ring of trail around open ground next to home
  const x0 = 63, z0 = 55, s = 16;
  for (let x = x0; x < x0 + s; x++) for (const z of [z0, z0 + s - 1]) { const i = z * g.N + x; if (!g.trailGrid[i]) { g.trailGrid[i] = h.code; h.trail.push(i); } }
  for (let z = z0; z < z0 + s; z++) for (const x of [x0, x0 + s - 1]) { const i = z * g.N + x; if (!g.trailGrid[i]) { g.trailGrid[i] = h.code; h.trail.push(i); } }
  g.drainEvents();
  g.capture(h);
  const ev = g.drainEvents().find((e) => e.type === 'capture');
  assert.ok(ev.big && ev.amount >= 150, `big grab of ${ev.amount}`);
  assert.ok(h.rush > 1, 'rush started');
});

console.log(`\n${passed} tests passed`);
