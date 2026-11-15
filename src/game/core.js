// Pure game simulation — no rendering. Grid-based territory with continuous movement.
import {
  GRID, ROUND_TIME, WIN_SHARE, PLAYER_SPEED, TURN_RATE, START_RADIUS,
  BOT_RESPAWN, TICK, ANIMALS, BOT_NAMES, NUM_BOTS,
  AREA_SPEED_MAX, KILL_SPEED, KILL_SPEED_MAX, RUSH_SPEED, RUSH_KILL, BIG_GRAB, RUSH_MAX,
} from './config.js';
import { BotBrain } from './bot.js';

const N = GRID;
const TOTAL = N * N;

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  constructor(id, animal, name, isBot) {
    this.id = id;
    this.code = id + 1; // value stored in grids
    this.animal = animal.id;
    this.color = animal.color;
    this.name = name;
    this.isBot = isBot;
    this.alive = false;
    this.x = 0; this.z = 0;
    this.angle = 0; this.targetAngle = 0;
    this.baseSpeed = PLAYER_SPEED;
    this.speed = PLAYER_SPEED;
    this.lifeKills = 0; // kills since last spawn (feeds the permanent kill bonus)
    this.rush = 0; // seconds of speed surge left
    this.cell = -1;
    this.trail = []; // cell indices
    this.path = []; // smooth points {x,z} for trail ribbon
    this.area = 0;
    this.maxArea = 0;
    this.kills = 0;
    this.respawn = 0;
    this.deaths = 0;
    this.aliveTime = 0;
    this.brain = null;
    this.minX = 0; this.maxX = 0; this.minZ = 0; this.maxZ = 0;
    this.spawnTime = 0;
  }
  get share() { return this.area / TOTAL; }
  // total speed bonus as a fraction of base speed
  get speedBonus() {
    const area = AREA_SPEED_MAX * Math.sqrt(Math.min(1, this.share / WIN_SHARE));
    const kills = Math.min(KILL_SPEED_MAX, this.lifeKills * KILL_SPEED);
    const rush = this.rush > 0 ? RUSH_SPEED * Math.min(1, this.rush / 0.6) : 0; // eases out over the last 0.6s
    return area + kills + rush;
  }
  addRush(sec) { this.rush = Math.min(RUSH_MAX, Math.max(0, this.rush) + sec); }
}

export class Game {
  constructor({ playerAnimal = 'fox', playerName = 'You', numBots = NUM_BOTS, seed } = {}) {
    this.N = N;
    this.owner = new Uint8Array(TOTAL);
    this.trailGrid = new Uint8Array(TOTAL);
    this.prevOwner = new Uint8Array(TOTAL);
    this.capTime = new Float32Array(TOTAL).fill(-100);
    this.visit = new Uint8Array(TOTAL);
    this.queue = new Int32Array(TOTAL);
    this.time = 0;
    this.timeLeft = ROUND_TIME;
    this.state = 'playing'; // playing | won | lost
    this.result = null;
    this.events = [];
    this.dirtyCells = true;
    this.players = [];
    this.acc = 0;

    const pa = ANIMALS.find((a) => a.id === playerAnimal) || ANIMALS[0];
    const human = new Player(0, pa, playerName, false);
    this.players.push(human);
    this.human = human;
    const others = ANIMALS.filter((a) => a.id !== pa.id);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < numBots; i++) {
      const p = new Player(i + 1, others[i % others.length], names[i], true);
      p.brain = new BotBrain(this, p, i);
      p.baseSpeed = PLAYER_SPEED * 0.95; // a small edge for the human
      this.players.push(p);
    }
    for (const p of this.players) this.spawn(p);
  }

  idx(x, z) { return z * N + x; }

  // ---------- spawning ----------
  findSpawn() {
    let best = null; let bestScore = -1;
    const r = Math.ceil(START_RADIUS) + 2;
    for (let tries = 0; tries < 60; tries++) {
      const x = r + 2 + Math.random() * (N - 2 * r - 4);
      const z = r + 2 + Math.random() * (N - 2 * r - 4);
      // must be on neutral ground
      let blocked = 0;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const i = this.idx(Math.floor(x + dx), Math.floor(z + dz));
          if (this.owner[i] || this.trailGrid[i]) blocked++;
        }
      }
      let minD = 1e9;
      for (const o of this.players) {
        if (!o.alive) continue;
        minD = Math.min(minD, Math.hypot(o.x - x, o.z - z));
      }
      const score = Math.min(minD, 40) - blocked * 3;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best;
  }

  spawn(p) {
    const s = this.findSpawn();
    p.alive = true;
    p.x = s.x; p.z = s.z;
    p.angle = Math.random() * Math.PI * 2;
    p.targetAngle = p.angle;
    p.trail = []; p.path = [];
    p.area = 0;
    p.lifeKills = 0; p.rush = 0;
    p.spawnTime = this.time;
    p.minX = N; p.maxX = 0; p.minZ = N; p.maxZ = 0;
    const r = START_RADIUS;
    const cx = Math.floor(s.x); const cz = Math.floor(s.z);
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dz * dz <= r * r) {
          const x = cx + dx; const z = cz + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const i = this.idx(x, z);
          if (this.trailGrid[i]) continue;
          this.setOwner(i, p, true);
        }
      }
    }
    p.cell = this.idx(cx, cz);
    p.x = cx + 0.5; p.z = cz + 0.5;
    if (p.brain) p.brain.reset();
    this.events.push({ type: 'spawn', player: p });
  }

  setOwner(i, p, anim) {
    const prev = this.owner[i];
    if (prev === p.code) return false;
    if (prev) {
      const o = this.players[prev - 1];
      o.area--;
    }
    this.owner[i] = p.code;
    this.prevOwner[i] = prev;
    p.area++;
    const x = i % N; const z = (i / N) | 0;
    if (x < p.minX) p.minX = x; if (x > p.maxX) p.maxX = x;
    if (z < p.minZ) p.minZ = z; if (z > p.maxZ) p.maxZ = z;
    if (anim) this.capTime[i] = this.time;
    this.dirtyCells = true;
    return prev;
  }

  // ---------- main update ----------
  update(dt) {
    if (this.state !== 'playing') {
      // keep world alive in the background (bots keep playing)
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= TICK) { this.acc -= TICK; this.tick(TICK, true); }
      return;
    }
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(TICK, false);
      if (this.state !== 'playing') break;
    }
  }

  tick(dt, post) {
    this.time += dt;
    if (!post) this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const p of this.players) {
      if (!p.alive) {
        if (p.isBot) {
          p.respawn -= dt;
          if (p.respawn <= 0) this.spawn(p);
        }
        continue;
      }
      p.aliveTime += dt;
      if (p.rush > 0) p.rush = Math.max(0, p.rush - dt);
      p.speed = p.baseSpeed * (1 + p.speedBonus);
      if (p.brain) p.brain.think(dt);
      this.movePlayer(p, dt);
    }
    this.checkHeadCollisions();
    for (const p of this.players) if (p.area > p.maxArea) p.maxArea = p.area;
    if (!post) this.checkEnd();
  }

  movePlayer(p, dt) {
    const d = angleDiff(p.angle, p.targetAngle);
    // turn faster when moving faster so the turning circle stays the same size
    const maxTurn = TURN_RATE * Math.max(1, p.speed / PLAYER_SPEED) * dt;
    p.angle += Math.max(-maxTurn, Math.min(maxTurn, d));
    let nx = p.x + Math.cos(p.angle) * p.speed * dt;
    let nz = p.z + Math.sin(p.angle) * p.speed * dt;
    // soft arena walls: slide along and steer back inside
    const lo = 0.5; const hi = N - 0.5;
    let hit = false;
    if (nx < lo) { nx = lo; hit = true; }
    if (nx > hi) { nx = hi; hit = true; }
    if (nz < lo) { nz = lo; hit = true; }
    if (nz > hi) { nz = hi; hit = true; }
    if (hit) {
      const c = N / 2;
      const inward = Math.atan2(c - nz, c - nx);
      p.angle += angleDiff(p.angle, inward) * Math.min(1, dt * 4);
    }
    p.x = nx; p.z = nz;
    const cx = Math.floor(nx); const cz = Math.floor(nz);
    const ci = this.idx(cx, cz);
    if (ci !== p.cell) {
      const ox = p.cell % N; const oz = (p.cell / N) | 0;
      if (ox !== cx && oz !== cz) {
        // diagonal hop: visit an intermediate cell to keep the trail 4-connected
        // prefer the corner cell that is safest for the mover (own land > neutral > own trail)
        const m1 = this.idx(ox, cz); const m2 = this.idx(cx, oz);
        const score = (m) => (this.owner[m] === p.code ? 2 : 0) - (this.trailGrid[m] === p.code ? 4 : 0);
        const mid = score(m1) >= score(m2) ? m1 : m2;
        this.enterCell(p, mid);
        if (!p.alive) return;
      }
      this.enterCell(p, ci);
    }
    if (!p.alive) return;
    // smooth path for ribbon
    if (p.trail.length > 0) {
      const last = p.path[p.path.length - 1];
      if (!last || Math.hypot(last.x - nx, last.z - nz) > 0.3) p.path.push({ x: nx, z: nz });
    }
  }

  enterCell(p, i) {
    const t = this.trailGrid[i];
    if (t) {
      const victim = this.players[t - 1];
      if (victim === p) {
        // Skimming along a cell boundary can re-enter a cell you just laid: forgive that.
        const L = p.trail.length;
        for (let k = Math.max(0, L - 4); k < L; k++) {
          if (p.trail[k] === i) { p.cell = i; return; }
        }
        this.kill(p, null, 'self');
        return;
      }
      this.kill(victim, p, 'cut');
    }
    const prevCell = p.cell;
    p.cell = i;
    if (this.owner[i] === p.code) {
      if (p.trail.length > 0) this.capture(p);
    } else {
      if (p.trail.length === 0) {
        // leaving home: start the ribbon at the border
        p.path = [{ x: (prevCell % N) + 0.5, z: ((prevCell / N) | 0) + 0.5 }];
      }
      this.trailGrid[i] = p.code;
      p.trail.push(i);
      this.dirtyCells = true;
    }
  }

  capture(p) {
    const owner = this.owner; const N2 = N;
    const captured = [];
    // trail becomes territory
    for (const i of p.trail) {
      this.trailGrid[i] = 0;
      const prev = this.setOwner(i, p, true);
      captured.push(i);
      if (prev) this.checkWipe(prev, p);
    }
    p.trail = [];
    p.path = [];
    // flood fill from the edge of an expanded bounding box
    const x0 = Math.max(0, p.minX - 1); const x1 = Math.min(N2 - 1, p.maxX + 1);
    const z0 = Math.max(0, p.minZ - 1); const z1 = Math.min(N2 - 1, p.maxZ + 1);
    const vis = this.visit; const q = this.queue;
    for (let z = z0; z <= z1; z++) vis.fill(0, z * N2 + x0, z * N2 + x1 + 1);
    let head = 0; let tail = 0;
    const code = p.code;
    const push = (x, z) => {
      const i = z * N2 + x;
      if (vis[i] || owner[i] === code) return;
      vis[i] = 1; q[tail++] = i;
    };
    for (let x = x0; x <= x1; x++) { push(x, z0); push(x, z1); }
    for (let z = z0; z <= z1; z++) { push(x0, z); push(x1, z); }
    // cells on the bbox border touching the true grid edge are outside anyway;
    // cells strictly inside the bbox border are reachable only via BFS.
    while (head < tail) {
      const i = q[head++];
      const x = i % N2; const z = (i / N2) | 0;
      if (x > x0) push(x - 1, z);
      if (x < x1) push(x + 1, z);
      if (z > z0) push(x, z - 1);
      if (z < z1) push(x, z + 1);
    }
    const wiped = new Set();
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = z * N2 + x;
        if (!vis[i] && owner[i] !== code) {
          const prev = this.setOwner(i, p, true);
          captured.push(i);
          if (prev) wiped.add(prev);
          // an enemy trail swallowed by the capture is cut
          const t = this.trailGrid[i];
          if (t && t !== code) {
            const v = this.players[t - 1];
            if (v.alive) this.kill(v, p, 'enclosed');
          }
        }
      }
    }
    for (const w of wiped) this.checkWipe(w, p);
    if (captured.length) {
      // big grab: a speed rush that grows with the size of the haul
      const big = captured.length >= BIG_GRAB;
      if (big) p.addRush(1.5 + Math.min(3.5, (captured.length - BIG_GRAB) / 150));
      this.events.push({ type: 'capture', player: p, cells: captured, amount: captured.length, big });
    }
  }

  checkWipe(code, by) {
    const o = this.players[code - 1];
    if (o.alive && o.area <= 0) this.kill(o, by, 'wiped');
  }

  kill(victim, killer, reason) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.respawn = BOT_RESPAWN;
    for (const i of victim.trail) if (this.trailGrid[i] === victim.code) this.trailGrid[i] = 0;
    const lostCells = [];
    const code = victim.code;
    for (let i = 0; i < TOTAL; i++) {
      if (this.owner[i] === code) { this.owner[i] = 0; this.prevOwner[i] = code; this.capTime[i] = this.time; lostCells.push(i); }
    }
    victim.area = 0;
    victim.trail = []; victim.path = [];
    if (killer && killer !== victim) {
      killer.kills++;
      if (killer.alive) { killer.lifeKills++; killer.addRush(RUSH_KILL); }
    }
    this.dirtyCells = true;
    this.events.push({ type: 'death', victim, killer, reason, x: victim.x, z: victim.z, cells: lostCells });
  }

  checkHeadCollisions() {
    const ps = this.players;
    for (let a = 0; a < ps.length; a++) {
      const A = ps[a]; if (!A.alive) continue;
      for (let b = a + 1; b < ps.length; b++) {
        const B = ps[b]; if (!B.alive) continue;
        const dx = A.x - B.x; const dz = A.z - B.z;
        if (dx * dx + dz * dz > 0.8) continue;
        const aSafe = this.owner[A.cell] === A.code;
        const bSafe = this.owner[B.cell] === B.code;
        if (aSafe && bSafe) continue;
        if (aSafe) this.kill(B, A, 'bump');
        else if (bSafe) this.kill(A, B, 'bump');
        else if (A.trail.length > B.trail.length) this.kill(A, B, 'bump');
        else if (B.trail.length > A.trail.length) this.kill(B, A, 'bump');
        else { this.kill(A, B, 'bump'); this.kill(B, A, 'bump'); }
      }
    }
  }

  ranking() {
    return [...this.players].sort((a, b) => b.area - a.area);
  }

  checkEnd() {
    const h = this.human;
    if (!h.alive) {
      this.finish(false, 'eliminated');
      return;
    }
    if (h.share >= WIN_SHARE) { this.finish(true, 'domination'); return; }
    if (this.timeLeft <= 0) {
      const top = this.ranking()[0];
      this.finish(top === h, top === h ? 'timeout-lead' : 'timeout-behind');
    }
  }

  finish(won, reason) {
    this.state = won ? 'won' : 'lost';
    const rank = this.ranking().indexOf(this.human) + 1;
    this.result = {
      won, reason, rank,
      share: this.human.share,
      maxShare: this.human.maxArea / TOTAL,
      kills: this.human.kills,
      time: ROUND_TIME - this.timeLeft,
    };
    this.events.push({ type: 'end', result: this.result });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

export { angleDiff };
