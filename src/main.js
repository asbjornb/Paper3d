import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Game } from './game/core.js';
import { BotBrain } from './game/bot.js';
import { GRID, ANIMALS, WIN_SHARE, ROUND_TIME } from './game/config.js';
import { TerritoryLayer } from './render/territory.js';
import { TrailLayer } from './render/trails.js';
import { createAnimal } from './render/animals.js';
import { Particles, Rings } from './render/particles.js';
import { buildEnvironment } from './render/environment.js';
import { Sfx } from './audio.js';

const ANIMAL_SCALE = 1.55;
let camZoom = 1;
const EMOJI = { fox: '🦊', bunny: '🐰', cat: '🐱', frog: '🐸', penguin: '🐧', unicorn: '🦄', bear: '🐻', owl: '🦉' };
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#3a1f5c', 0.0065);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(GRID / 2, 40, GRID / 2 + 25);

const hemi = new THREE.HemisphereLight('#cdb8ff', '#1f5a52', 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe2c4', 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);
const rim = new THREE.DirectionalLight('#ff8fd8', 0.6);
rim.position.set(1, 0.6, 1);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const env = buildEnvironment(scene, GRID);
const particles = new Particles(scene);
const rings = new Rings(scene);
const sfx = new Sfx();

// chevron on the ground pointing back home while your trail is exposed
const homeArrow = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(0.55, 0); sh.lineTo(-0.35, 0.5); sh.lineTo(-0.12, 0); sh.lineTo(-0.35, -0.5); sh.lineTo(0.55, 0);
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
  m.renderOrder = 3;
  m.scale.setScalar(1.5);
  scene.add(m);
  return m;
})();

// ---------------------------------------------------------------- world (per round)
let world = null;
let mode = 'menu'; // menu | countdown | playing | paused | ended
let selectedAnimal = 'fox';
let playerName = '';
try {
  selectedAnimal = localStorage.getItem('ff-animal') || 'fox';
  playerName = localStorage.getItem('ff-name') || '';
} catch { /* ignore */ }

function disposeWorld() {
  if (!world) return;
  scene.remove(world.territory.mesh);
  world.territory.mesh.geometry.dispose();
  world.trails.dispose(scene);
  for (const a of world.animals.values()) scene.remove(a.root);
  for (const l of world.labels.values()) l.remove();
  world = null;
}

function newWorld(attract) {
  disposeWorld();
  const name = (playerName || '').trim() || 'You';
  const game = new Game({ playerAnimal: attract ? ANIMALS[Math.floor(Math.random() * ANIMALS.length)].id : selectedAnimal, playerName: attract ? 'Scout' : name });
  if (attract) {
    game.human.brain = new BotBrain(game, game.human, 7);
    game.checkEnd = () => {};
    // pre-simulate so the menu backdrop is already a colourful, contested meadow
    for (let t = 0; t < 45; t += 1 / 30) game.update(1 / 30);
    game.drainEvents();
  }
  const territory = new TerritoryLayer(game);
  scene.add(territory.mesh);
  const trails = new TrailLayer(game, scene);
  const animals = new Map();
  const labels = new Map();
  for (const p of game.players) {
    const a = createAnimal(p.animal, p.color, { isHuman: !attract && p === game.human });
    scene.add(a.root);
    a.spawnT = 0;
    animals.set(p, a);
    const el = document.createElement('div');
    el.className = 'label' + (!attract && p === game.human ? ' me' : '');
    el.textContent = p.name;
    el.style.color = p.color;
    $('labels').appendChild(el);
    labels.set(p, el);
  }
  game.drainEvents();
  world = {
    game, territory, trails, animals, labels, attract,
    camTarget: new THREE.Vector3(game.human.x, 0, game.human.z),
    shake: 0, lastKillT: -10, multi: 0, deathInfo: null, wasOut: false, dangerT: 0,
    lbTimer: 0, mmTimer: 0,
    homeFinder: new BotBrain(game, game.human, 0), home: null, homeT: 0,
  };
  // snap camera
  const t = world.camTarget;
  if (attract) { t.x = Math.max(35, Math.min(GRID - 35, t.x)); t.z = Math.max(30, Math.min(GRID - 45, t.z)); }
  camera.position.set(t.x, attract ? 70 : 34, t.z + (attract ? 45 : 19));
  camera.lookAt(t);
}

// ---------------------------------------------------------------- input
const input = { keys: new Set(), mouse: null, mouseActive: false, touch: null, lastKeyAngle: null };
window.addEventListener('keydown', (e) => {
  if (document.activeElement === $('name-input')) {
    if (e.key === 'Enter') startGame();
    return;
  }
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
    input.keys.add(k); input.mouseActive = false; e.preventDefault();
  }
  if (k === 'escape' || k === 'p') togglePause();
  if (k === 'enter' || k === ' ') {
    if (mode === 'menu') startGame();
    else if (mode === 'ended' && !$('end').classList.contains('hidden')) startGame();
  }
  if (k === 'm') toggleMute();
});
window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { input.keys.clear(); if (mode === 'playing') togglePause(); });
window.addEventListener('mousemove', (e) => { input.mouse = { x: e.clientX, y: e.clientY }; input.mouseActive = true; });
const joy = $('joystick');
window.addEventListener('touchstart', (e) => {
  if (mode !== 'playing' && mode !== 'countdown') return;
  if (e.target.closest && e.target.closest('button')) return;
  const t = e.changedTouches[0];
  input.touch = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
  input.mouseActive = false;
  joy.classList.remove('hidden');
  joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px';
  joy.firstElementChild.style.transform = 'translate(0px, 0px)';
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (!input.touch) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== input.touch.id) continue;
    input.touch.x = t.clientX; input.touch.y = t.clientY;
    let dx = t.clientX - input.touch.ox; let dy = t.clientY - input.touch.oy;
    const l = Math.hypot(dx, dy); if (l > 40) { dx *= 40 / l; dy *= 40 / l; }
    joy.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!input.touch) return;
  for (const t of e.changedTouches) if (t.identifier === input.touch.id) { input.touch = null; joy.classList.add('hidden'); }
});

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpV = new THREE.Vector3();
const ndc = new THREE.Vector2();

function steerHuman() {
  const h = world.game.human;
  if (!h.alive) return;
  const k = input.keys;
  let dx = 0; let dz = 0;
  if (k.has('arrowup') || k.has('w')) dz -= 1;
  if (k.has('arrowdown') || k.has('s')) dz += 1;
  if (k.has('arrowleft') || k.has('a')) dx -= 1;
  if (k.has('arrowright') || k.has('d')) dx += 1;
  if (dx || dz) { h.targetAngle = Math.atan2(dz, dx); return; }
  if (input.touch) {
    const tx = input.touch.x - input.touch.ox; const ty = input.touch.y - input.touch.oy;
    if (Math.hypot(tx, ty) > 8) h.targetAngle = Math.atan2(ty, tx);
    return;
  }
  if (input.mouseActive && input.mouse) {
    ndc.set((input.mouse.x / window.innerWidth) * 2 - 1, -(input.mouse.y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, tmpV)) {
      const ddx = tmpV.x - h.x; const ddz = tmpV.z - h.z;
      if (Math.hypot(ddx, ddz) > 0.9) h.targetAngle = Math.atan2(ddz, ddx);
    }
  }
}

// ---------------------------------------------------------------- UI: menu
function buildMenu() {
  const grid = $('animal-grid');
  grid.innerHTML = '';
  for (const a of ANIMALS) {
    const b = document.createElement('button');
    b.className = 'animal-card' + (a.id === selectedAnimal ? ' sel' : '');
    b.style.setProperty('--c', a.color);
    b.innerHTML = `<span class="em">${EMOJI[a.id]}</span><span class="an">${a.name}</span><br><span class="at" style="color:${a.color}">${a.title}</span>`;
    b.onclick = () => {
      selectedAnimal = a.id;
      try { localStorage.setItem('ff-animal', a.id); } catch { /* ignore */ }
      grid.querySelectorAll('.animal-card').forEach((c) => c.classList.remove('sel'));
      b.classList.add('sel');
      sfx.tone(660, 0.12, { type: 'triangle', vol: 0.12 });
    };
    grid.appendChild(b);
  }
  $('name-input').value = playerName;
  const best = loadBest();
  $('best').innerHTML = best.games ? `Best peak <b>${(best.peak * 100).toFixed(1)}%</b> · Most kills <b>${best.kills}</b> · Wins <b>${best.wins}</b> / ${best.games}` : '';
}

function loadBest() {
  try { return { peak: 0, kills: 0, wins: 0, games: 0, ...JSON.parse(localStorage.getItem('ff-best') || '{}') }; } catch { return { peak: 0, kills: 0, wins: 0, games: 0 }; }
}
function saveBest(b) { try { localStorage.setItem('ff-best', JSON.stringify(b)); } catch { /* ignore */ } }

$('play-btn').onclick = () => startGame();
$('again-btn').onclick = () => startGame();
$('menu-btn').onclick = () => showMenu();
$('resume-btn').onclick = () => togglePause();
$('quit-btn').onclick = () => showMenu();
$('mute').onclick = () => toggleMute();
$('pausebtn').onclick = () => togglePause();
function toggleMute() { sfx.setMuted(!sfx.muted); $('mute').textContent = sfx.muted ? '🔇' : '🔊'; }
$('mute').textContent = sfx.muted ? '🔇' : '🔊';

function showMenu() {
  mode = 'menu';
  ['hud', 'end', 'pause', 'countdown'].forEach((id) => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
  $('danger').classList.remove('on');
  buildMenu();
  newWorld(true);
}

let countdownT = 0;
let countdownStep = 0;
function startGame() {
  sfx.ensure();
  playerName = $('name-input').value.trim();
  try { localStorage.setItem('ff-name', playerName); } catch { /* ignore */ }
  ['menu', 'end', 'pause'].forEach((id) => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden');
  $('hint').style.opacity = 1;
  $('killfeed').innerHTML = '';
  $('popups').innerHTML = '';
  newWorld(false);
  celebrate = 0; lastTick = -1;
  mode = 'countdown';
  countdownT = 0; countdownStep = -1;
  $('countdown').classList.remove('hidden');
  updateHud(true);
}

function togglePause() {
  if (mode === 'playing') { mode = 'paused'; $('pause').classList.remove('hidden'); }
  else if (mode === 'paused') { mode = 'playing'; $('pause').classList.add('hidden'); }
}

// ---------------------------------------------------------------- HUD
const mm = $('minimap');
const mmCtx = mm.getContext('2d');
const mmBuf = document.createElement('canvas'); mmBuf.width = GRID; mmBuf.height = GRID;
const mmBufCtx = mmBuf.getContext('2d');
const mmImg = mmBufCtx.createImageData(GRID, GRID);
mm.width = 300; mm.height = 300;

function hexToRgb(h) { const c = new THREE.Color(h); return [c.r * 255, c.g * 255, c.b * 255]; }

function drawMinimap() {
  const g = world.game;
  const cols = [[40, 70, 72]];
  for (const p of g.players) cols[p.code] = hexToRgb(p.color);
  const d = mmImg.data;
  for (let i = 0; i < g.owner.length; i++) {
    const o = g.owner[i]; const t = g.trailGrid[i];
    const j = i * 4;
    let c;
    if (t) { c = cols[t]; d[j] = c[0] * 0.6 + 100; d[j + 1] = c[1] * 0.6 + 100; d[j + 2] = c[2] * 0.6 + 100; }
    else if (o) { c = cols[o]; d[j] = c[0] * 0.85; d[j + 1] = c[1] * 0.85; d[j + 2] = c[2] * 0.85; }
    else { d[j] = 30; d[j + 1] = 58; d[j + 2] = 64; }
    d[j + 3] = 255;
  }
  mmBufCtx.putImageData(mmImg, 0, 0);
  mmCtx.imageSmoothingEnabled = false;
  mmCtx.clearRect(0, 0, mm.width, mm.height);
  mmCtx.drawImage(mmBuf, 0, 0, mm.width, mm.height);
  const s = mm.width / GRID;
  for (const p of g.players) {
    if (!p.alive) continue;
    const me = p === g.human && !world.attract;
    mmCtx.beginPath();
    mmCtx.arc(p.x * s, p.z * s, me ? 9 : 6, 0, Math.PI * 2);
    mmCtx.fillStyle = me ? '#ffffff' : p.color;
    mmCtx.fill();
    mmCtx.lineWidth = 3; mmCtx.strokeStyle = me ? p.color : 'rgba(0,0,0,0.6)'; mmCtx.stroke();
  }
}

function updateLeaderboard() {
  const g = world.game;
  const rank = g.ranking();
  const top = Math.max(rank[0].area, 1);
  let html = '<div class="lb-title">Leaderboard</div>';
  rank.forEach((p, i) => {
    const me = p === g.human;
    html += `<div class="lb-row${me ? ' me' : ''}${p.alive ? '' : ' dead'}"><div class="bar" style="width:${(p.area / top) * 100}%;background:${p.color}"></div>`
      + `<span class="rk">${i + 1}</span><span class="sw" style="background:${p.color};color:${p.color}"></span>`
      + `<span class="nm">${EMOJI[p.animal]} ${escapeHtml(p.name)}</span><span class="pc">${(p.share * 100).toFixed(1)}%</span></div>`;
  });
  $('leaderboard').innerHTML = html;
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const ARC_LEN = 2 * Math.PI * 42;
$('share-arc').style.strokeDasharray = `${ARC_LEN}`;
$('goal-tick').style.strokeDasharray = `2.5 ${ARC_LEN}`;
$('goal-tick').style.strokeDashoffset = `${-ARC_LEN * WIN_SHARE}`;

function updateHud(force) {
  const g = world.game; const h = g.human;
  const tl = Math.ceil(g.timeLeft);
  $('timer').textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('urgent', g.timeLeft <= 15 && mode === 'playing');
  const share = h.share;
  $('share-text').textContent = `${(share * 100).toFixed(1)}%`;
  $('share-arc').style.strokeDashoffset = `${ARC_LEN * (1 - Math.min(1, share / WIN_SHARE) * WIN_SHARE)}`;
  $('share-arc').style.stroke = h.color;
  $('share-arc').style.color = h.color;
  $('kills-text').textContent = h.kills;
  const spd = Math.round(h.speedBonus * 100);
  $('speed-text').textContent = `+${spd}%`;
  $('speed-text').parentElement.classList.toggle('rush', h.alive && h.rush > 0);
  $('rank-text').textContent = '#' + (g.ranking().indexOf(h) + 1);
  const now = performance.now();
  if (force || now - world.lbTimer > 250) { updateLeaderboard(); world.lbTimer = now; }
}

function popup(text, color, x, y, big = false) {
  const el = document.createElement('div');
  el.className = 'popup' + (big ? ' big' : '');
  el.textContent = text; el.style.color = color;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function feed(html, me) {
  const el = document.createElement('div');
  el.className = 'kf' + (me ? ' me' : '');
  el.innerHTML = html;
  const kfEl = $('killfeed');
  kfEl.prepend(el);
  while (kfEl.children.length > 5) kfEl.lastChild.remove();
  setTimeout(() => el.remove(), 5000);
}

function screenOf(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, vis: tmpV.z < 1 };
}

const rushCol = new THREE.Color();
const pName = (p) => `<b style="color:${p.color}">${EMOJI[p.animal]} ${escapeHtml(p.name)}</b>`;

// ---------------------------------------------------------------- events -> effects
function handleEvents() {
  const g = world.game; const h = g.human;
  const live = mode === 'playing' && !world.attract;
  const camT = world.camTarget;
  for (const e of g.drainEvents()) {
    if (e.type === 'capture') {
      const p = e.player;
      const col = new THREE.Color(p.color);
      const n = Math.min(90, 8 + Math.floor(e.cells.length / 4));
      for (let k = 0; k < n; k++) {
        const i = e.cells[Math.floor(Math.random() * e.cells.length)];
        const x = (i % GRID) + Math.random(); const z = Math.floor(i / GRID) + Math.random();
        particles.emit(x, 0.3, z, (Math.random() - 0.5) * 0.6, 2 + Math.random() * 3, (Math.random() - 0.5) * 0.6,
          Math.random() < 0.3 ? new THREE.Color('#ffffff') : col, 0.35 + Math.random() * 0.35, 0.9 + Math.random() * 0.8, Math.random() < 0.5 ? 1 : 0, -1.5);
      }
      if (Math.hypot(p.x - camT.x, p.z - camT.z) < 45) rings.spawn(p.x, p.z, p.color, 3 + Math.min(10, Math.sqrt(e.cells.length) * 0.5), 0.7);
      if (p === h && live) {
        sfx.capture(e.cells.length);
        const s = screenOf(p.x, 2.5, p.z);
        const pct = (e.cells.length / (GRID * GRID)) * 100;
        popup(`+${pct.toFixed(pct < 1 ? 2 : 1)}%`, p.color, s.x, s.y - 30, e.cells.length > 300);
        if (e.big) {
          const label = e.cells.length >= 600 ? 'MEGA GRAB!' : e.cells.length >= 300 ? 'HUGE GRAB!' : 'BIG GRAB!';
          popup(label, '#7af0ff', window.innerWidth / 2, window.innerHeight * 0.24, true);
          popup('⚡ SPEED RUSH', '#7af0ff', s.x, s.y + 10);
        }
        if (e.cells.length > 400) world.shake = Math.max(world.shake, 0.35);
      }
    } else if (e.type === 'death') {
      const v = e.victim; const k = e.killer;
      const a = world.animals.get(v);
      particles.burst(e.x, 1, e.z, v.color, 90, { speed: 9, size: 0.7, life: 1.3, up: 7, star: 0.5 });
      particles.burst(e.x, 1, e.z, '#ffffff', 25, { speed: 5, size: 0.5, life: 0.8, up: 5, star: 1 });
      rings.spawn(e.x, e.z, v.color, 8, 0.8);
      // fragments of lost land float upward
      for (let n = 0; n < Math.min(70, e.cells.length / 3); n++) {
        const i = e.cells[Math.floor(Math.random() * e.cells.length)];
        particles.emit((i % GRID) + 0.5, 0.2, Math.floor(i / GRID) + 0.5, 0, 1 + Math.random() * 2, 0, new THREE.Color(v.color), 0.4, 1.2, 0, 0.5);
      }
      if (a) a.root.visible = false;
      const near = Math.hypot(e.x - camT.x, e.z - camT.z) < 35;
      const verb = e.reason === 'self' ? 'tripped on their own trail' : e.reason === 'bump' ? 'was bumped by' : e.reason === 'wiped' ? 'lost all land to' : e.reason === 'enclosed' ? 'was engulfed by' : 'was cut by';
      if (!world.attract) {
        if (e.reason === 'self' || !k) feed(`${pName(v)} tripped on their own trail`, v === h);
        else feed(`${pName(k)} ✂ ${pName(v)}`, v === h || k === h);
      }
      if (v === h) world.deathInfo = { killer: k, reason: e.reason, verb };
      if (!live) continue;
      if (v === h) {
        sfx.death();
        world.shake = 1.0;
      } else if (k === h) {
        sfx.kill();
        world.shake = Math.max(world.shake, 0.5);
        const now = g.time;
        world.multi = now - world.lastKillT < 4 ? world.multi + 1 : 1;
        world.lastKillT = now;
        const s = screenOf(h.x, 2.5, h.z);
        const label = world.multi >= 3 ? 'RAMPAGE!' : world.multi === 2 ? 'DOUBLE CUT!' : e.reason === 'wiped' ? 'WIPED OUT!' : e.reason === 'bump' ? 'BONK!' : 'TRAIL CUT!';
        popup(label, '#ffe27a', window.innerWidth / 2, window.innerHeight * 0.32, true);
        popup(`${EMOJI[v.animal]} ${v.name}`, v.color, s.x, s.y - 20);
        popup('⚡ SPEED RUSH', '#7af0ff', s.x, s.y + 14);
      } else if (near) {
        sfx.enemyDeath();
      }
    } else if (e.type === 'spawn') {
      const a = world.animals.get(e.player);
      if (a) { a.root.visible = true; a.spawnT = 0; }
      particles.burst(e.player.x, 0.5, e.player.z, e.player.color, 30, { speed: 4, size: 0.5, life: 0.9, up: 4, star: 0.8 });
      rings.spawn(e.player.x, e.player.z, e.player.color, 5, 0.6);
    } else if (e.type === 'end') {
      onEnd(e.result);
    }
  }
}

let celebrate = 0;
let lastTick = -1;
function onEnd(r) {
  mode = 'ended';
  if (r.won) celebrate = 3.5;
  const g = world.game;
  $('danger').classList.remove('on');
  if (g.human.alive) g.human.brain = new BotBrain(g, g.human, 7); // keep the world alive behind the overlay
  const best = loadBest();
  const newPeak = r.maxShare > best.peak; const newKills = r.kills > best.kills && r.kills > 0;
  best.games++; if (r.won) best.wins++;
  best.peak = Math.max(best.peak, r.maxShare); best.kills = Math.max(best.kills, r.kills);
  saveBest(best);
  setTimeout(() => {
    if (r.won) sfx.victory(); else sfx.defeat();
  }, r.reason === 'eliminated' ? 700 : 0);
  setTimeout(() => {
    if (mode !== 'ended') return;
    const t = $('end-title');
    t.textContent = r.won ? 'Victory!' : r.reason === 'eliminated' ? 'Eliminated' : 'Out-claimed';
    t.className = 'end-title ' + (r.won ? 'win' : 'lose');
    let sub = '';
    const top = g.ranking()[0];
    if (r.reason === 'domination') sub = `You claimed ${(WIN_SHARE * 100).toFixed(0)}% of the enchanted meadow!`;
    else if (r.reason === 'timeout-lead') sub = 'Time! Your realm was the largest in the land.';
    else if (r.reason === 'timeout-behind') sub = `Time! ${EMOJI[top.animal]} ${escapeHtml(top.name)} held more land.`;
    else {
      const d = world.deathInfo;
      if (!d || d.reason === 'self' || !d.killer) sub = 'You tripped over your own trail.';
      else {
        const you = { bump: 'You were bumped by', wiped: 'Your land was swallowed by', enclosed: 'You were engulfed by' }[d.reason] || 'Your trail was cut by';
        sub = `${you} ${EMOJI[d.killer.animal]} ${escapeHtml(d.killer.name)}.`;
      }
    }
    $('end-sub').innerHTML = sub;
    const tm = Math.floor(r.time);
    $('end-stats').innerHTML = [
      ['Final land', `${(r.share * 100).toFixed(1)}%`],
      ['Peak land', `${(r.maxShare * 100).toFixed(1)}%`],
      ['Rank', `#${r.rank}`],
      ['Kills', r.kills],
      [r.won ? 'Time' : 'Survived', `${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, '0')}`],
      ['Wins', `${best.wins}/${best.games}`],
    ].map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    $('end-best').textContent = newPeak ? '★ New best peak territory!' : newKills ? '★ New kill record!' : '';
    $('end').classList.remove('hidden');
  }, r.reason === 'eliminated' ? 1600 : 900);
}

// ---------------------------------------------------------------- per-frame
function dangerFor(p) {
  if (!p.alive || !p.trail.length) return 0;
  const g = world.game;
  let best = 1e9;
  const step = Math.max(1, Math.floor(p.trail.length / 30));
  for (const o of g.players) {
    if (o === p || !o.alive) continue;
    if (Math.abs(o.x - p.x) > 60 || Math.abs(o.z - p.z) > 60) continue;
    for (let k = 0; k < p.trail.length; k += step) {
      const i = p.trail[k];
      const d = Math.abs((i % GRID) + 0.5 - o.x) + Math.abs(Math.floor(i / GRID) + 0.5 - o.z);
      if (d < best) best = d;
    }
  }
  return best < 6 ? 1 : best < 12 ? 0.5 : 0;
}

const perf = { js: 0 };
let prevTime = performance.now();
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prevTime) / 1000);
  prevTime = now;
  elapsed += dt;
  if (!world) return;
  const g = world.game;
  const h = g.human;

  if (mode === 'countdown') {
    countdownT += dt;
    const step = Math.floor(countdownT / 0.85);
    if (step !== countdownStep) {
      countdownStep = step;
      const labels = ['3', '2', '1', 'GO!'];
      if (step < 4) {
        $('countdown').innerHTML = `<span>${labels[step]}</span>`;
        sfx.beep(step === 3);
      }
      if (step === 3) mode = 'playing';
    }
    steerHuman();
    h.angle = h.targetAngle; // aim before the start
  }
  if (mode === 'playing' && countdownT > 0 && countdownT < 4) {
    countdownT += dt;
    if (countdownT > 3.4 + 0.5) $('countdown').classList.add('hidden');
  }
  if (mode === 'playing') {
    steerHuman();
    g.update(dt);
    if (g.time > 6) $('hint').style.opacity = 0;
  } else if (mode === 'menu' || mode === 'ended') {
    g.update(dt);
  }
  handleEvents();

  // leaving territory cue + danger
  if (mode === 'playing' && h.alive) {
    const out = h.trail.length > 0;
    if (out && !world.wasOut) sfx.leave();
    world.wasOut = out;
    const dang = dangerFor(h);
    $('danger').classList.toggle('on', dang >= 1);
    world.dangerT -= dt;
    if (dang >= 1 && world.dangerT <= 0) { sfx.warn(); world.dangerT = 0.5; }
  }

  // victory confetti
  if (celebrate > 0) {
    celebrate -= dt;
    const t = world.camTarget;
    const cols = g.players.map((p) => p.color).concat(['#ffffff', '#ffe27a']);
    for (let k = 0; k < 6; k++) {
      const c = new THREE.Color(cols[Math.floor(Math.random() * cols.length)]);
      particles.emit(t.x + (Math.random() - 0.5) * 30, 12 + Math.random() * 4, t.z + (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 2, -2 - Math.random() * 2, (Math.random() - 0.5) * 2, c, 0.5 + Math.random() * 0.4, 3.5, Math.random() < 0.4 ? 1 : 0, -1.2);
    }
  }
  // final countdown ticks
  if (mode === 'playing' && g.timeLeft <= 10) {
    const sec = Math.ceil(g.timeLeft);
    if (sec !== lastTick && sec > 0) { lastTick = sec; sfx.tone(sec <= 3 ? 990 : 740, 0.08, { type: 'square', vol: 0.06 }); }
  }

  // home arrow
  {
    const show = mode === 'playing' && h.alive && h.trail.length > 3;
    world.homeT -= dt;
    if (show && world.homeT <= 0) { world.home = world.homeFinder.nearestOwn(); world.homeT = 0.2; }
    const tgtOp = show && world.home ? Math.min(0.85, 0.25 + h.trail.length / 60) : 0;
    homeArrow.material.opacity += (tgtOp - homeArrow.material.opacity) * Math.min(1, dt * 6);
    if (world.home && homeArrow.material.opacity > 0.01) {
      const a = Math.atan2(world.home.z - h.z, world.home.x - h.x);
      const r = 3.0 + Math.sin(elapsed * 6) * 0.2;
      homeArrow.position.set(h.x + Math.cos(a) * r, 0.14, h.z + Math.sin(a) * r);
      homeArrow.rotation.y = -a;
      homeArrow.material.color.set(h.color).lerp(new THREE.Color('#ffffff'), 0.45);
      homeArrow.visible = true;
    } else homeArrow.visible = homeArrow.material.opacity > 0.01;
  }

  // animals
  for (const [p, a] of world.animals) {
    if (!p.alive) { a.root.visible = false; continue; }
    a.root.visible = true;
    a.root.position.set(p.x, 0, p.z);
    a.root.rotation.y = Math.PI / 2 - p.angle;
    a.spawnT = Math.min(1, (a.spawnT || 0) + dt * 2.5);
    const sp = a.spawnT < 1 ? 1 + Math.sin(a.spawnT * Math.PI) * 0.4 - (1 - a.spawnT) * 0.8 : 1;
    a.root.scale.setScalar(ANIMAL_SCALE * Math.max(0.05, sp));
    const moving = mode !== 'countdown' && mode !== 'paused';
    if (mode !== 'paused') a.update(dt, moving, p.angle);
    // speed rush: streak of sparks behind the runner
    if (moving && p.rush > 0 && Math.random() < dt * 40 && Math.hypot(p.x - world.camTarget.x, p.z - world.camTarget.z) < 45) {
      const bx = p.x - Math.cos(p.angle) * 0.8; const bz = p.z - Math.sin(p.angle) * 0.8;
      particles.emit(bx + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, bz + (Math.random() - 0.5) * 0.6,
        -Math.cos(p.angle) * 2, 0.8 + Math.random(), -Math.sin(p.angle) * 2,
        Math.random() < 0.5 ? new THREE.Color('#ffffff') : rushCol.set(p.color), 0.3 + Math.random() * 0.25, 0.45, 1, 0);
    }
  }

  world.territory.update(elapsed);
  world.trails.update(elapsed, dangerFor);
  if (mode !== 'paused') { particles.update(dt, renderer.domElement.height / renderer.getPixelRatio()); rings.update(dt); }

  // ambient sparkles trailing the human
  if (mode === 'playing' && h.alive && Math.random() < 0.5) {
    particles.emit(h.x + (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, h.z + (Math.random() - 0.5) * 0.8, 0, 0.6, 0,
      new THREE.Color(Math.random() < 0.5 ? '#fff4b0' : h.color), 0.25, 0.7, 1, 0);
  }

  // camera
  let focus = h;
  if (world.attract) {
    focus = g.ranking().find((p) => p.alive) || h;
  } else if (!h.alive) {
    // after you fall, watch the one who got you
    const k = world.deathInfo && world.deathInfo.killer;
    focus = k && k.alive ? k : null;
  }
  const target = world.camTarget;
  if (focus) {
    const look = focus.alive ? 3 : 0;
    let fx = focus.x + Math.cos(focus.angle) * look; let fz = focus.z + Math.sin(focus.angle) * look;
    if (world.attract) { fx = Math.max(35, Math.min(GRID - 35, fx)); fz = Math.max(30, Math.min(GRID - 45, fz)); }
    target.x += (fx - target.x) * Math.min(1, dt * (world.attract ? 0.8 : 5));
    target.z += (fz - target.z) * Math.min(1, dt * (world.attract ? 0.8 : 5));
  }
  let height; let back;
  if (world.attract) {
    height = 62; back = 42;
    target.x += Math.sin(elapsed * 0.1) * 0.02;
  } else {
    const zoom = 1 + Math.min(0.45, h.trail.length / 160) + (h.alive ? 0 : 0.6);
    const portrait = camera.aspect < 1 ? 1.3 : 1;
    height = 30 * zoom * camZoom * portrait; back = 17 * zoom * camZoom * portrait;
  }
  const cx = target.x; const cz = target.z + back;
  camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 6);
  camera.position.y += (height - camera.position.y) * Math.min(1, dt * 2.5);
  camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 6);
  camera.lookAt(target.x, 0, target.z);
  if (world.shake > 0) {
    const s = world.shake * 0.6;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    world.shake = Math.max(0, world.shake - dt * 2.2);
  }
  sun.position.set(target.x - 28, 55, target.z - 20);
  sun.target.position.set(target.x, 0, target.z);
  rim.position.set(target.x + 30, 20, target.z + 40);
  rim.target = sun.target;

  // labels
  for (const [p, el] of world.labels) {
    if (!p.alive) { el.style.display = 'none'; continue; }
    const s = screenOf(p.x, 3.3, p.z);
    if (!s.vis || s.x < -50 || s.y < -50 || s.x > window.innerWidth + 50 || s.y > window.innerHeight + 50) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.transform = `translate(${s.x}px, ${s.y - 10}px) translate(-50%, -100%)`;
  }

  env.update(elapsed, camera, renderer.domElement.height / renderer.getPixelRatio(), dt);

  if (!world.attract && (mode === 'playing' || mode === 'countdown' || mode === 'ended')) {
    updateHud(false);
    world.mmTimer -= dt;
    if (world.mmTimer <= 0) { drawMinimap(); world.mmTimer = 0.15; }
  }

  perf.js += (performance.now() - now - perf.js) * 0.05;
  composer.render();
  adaptResolution(dt);
}

// drop the pixel ratio on slow GPUs, raise it back when there is headroom
let frameAvg = 16; let adaptCooldown = 3;
const maxDpr = Math.min(window.devicePixelRatio, 2);
function adaptResolution(dt) {
  frameAvg += (dt * 1000 - frameAvg) * 0.05;
  adaptCooldown -= dt;
  if (adaptCooldown > 0) return;
  const cur = renderer.getPixelRatio();
  let next = cur;
  if (frameAvg > 24 && cur > 0.75) next = Math.max(0.75, cur - 0.25);
  else if (frameAvg < 14 && cur < maxDpr) next = Math.min(maxDpr, cur + 0.25);
  if (next !== cur) {
    renderer.setPixelRatio(next);
    composer.setPixelRatio(next);
    adaptCooldown = 2;
  }
}

window.addEventListener('resize', () => {
  const w = window.innerWidth; const hh = window.innerHeight;
  camera.aspect = w / hh; camera.updateProjectionMatrix();
  renderer.setSize(w, hh); composer.setSize(w, hh);
  bloom.resolution.set(w / 2, hh / 2);
});

// debug / test hooks
window.__ff = {
  get world() { return world; }, perf, set camZoom(z) { camZoom = z; }, get mode() { return mode; }, startGame, showMenu,
  setAngle(a) { if (world) world.game.human.targetAngle = a; },
  // fast-forward the simulation (testing): optionally let a bot brain drive the human
  advance(sec, autopilot = false) {
    const g = world.game;
    if (autopilot && !g.human.brain) g.human.brain = new BotBrain(g, g.human, 2);
    if (mode === 'countdown') { mode = 'playing'; $('countdown').classList.add('hidden'); }
    for (let t = 0; t < sec && (g.state === 'playing' || mode !== 'playing'); t += 1 / 60) { g.update(1 / 60); handleEvents(); }
    if (autopilot && mode === 'playing') g.human.brain = null;
  },
};
void ROUND_TIME;

showMenu();
requestAnimationFrame(frame);
