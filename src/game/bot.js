// Bot brain: plans loops out of its territory, retreats under threat, hunts exposed trails.
import { GRID, TURN_RATE, PLAYER_SPEED } from './config.js';

const N = GRID;
const PERSONAS = [
  { greed: 1.0, aggression: 0.5, caution: 1.0 },
  { greed: 1.5, aggression: 0.2, caution: 0.8 },
  { greed: 0.8, aggression: 0.9, caution: 1.1 },
  { greed: 1.2, aggression: 0.6, caution: 0.7 },
  { greed: 0.7, aggression: 0.3, caution: 1.4 },
  { greed: 1.3, aggression: 0.8, caution: 0.9 },
  { greed: 1.0, aggression: 1.0, caution: 1.0 },
  { greed: 1.6, aggression: 0.4, caution: 1.2 },
];

export class BotBrain {
  constructor(game, player, index) {
    this.g = game;
    this.p = player;
    this.persona = PERSONAS[index % PERSONAS.length];
    this.reset();
  }

  reset() {
    this.state = 'home';
    this.waypoints = [];
    this.target = null;
    this.timer = 0;
    this.decide = 0;
    this.stateTime = 0;
    this.huntTarget = null;
    this.homeCache = null;
    this.pause = 0.3 + Math.random() * 0.8;
  }

  inOwn() { return this.g.owner[this.p.cell] === this.p.code; }

  // Nearest own cell reachable in a straight line without crossing my own trail.
  nearestOwn(maxR = 90) {
    const g = this.g; const p = this.p; const code = p.code;
    const cx = p.cell % N; const cz = (p.cell / N) | 0;
    const cands = [];
    let firstR = -1;
    for (let r = 1; r <= maxR; r++) {
      if (firstR >= 0 && r > firstR * 1.6 + 8) break;
      for (let k = -r; k <= r; k++) {
        const pts = [[cx + k, cz - r], [cx + k, cz + r]];
        if (k > -r && k < r) pts.push([cx - r, cz + k], [cx + r, cz + k]);
        for (const [x, z] of pts) {
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const i = z * N + x;
          if (g.owner[i] !== code || g.trailGrid[i]) continue;
          if (firstR < 0) firstR = r;
          cands.push({ x: x + 0.5, z: z + 0.5, d: Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) });
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const lim = Math.min(cands.length, 60);
    for (let k = 0; k < lim; k++) {
      const c = cands[k];
      if (this.clearLine(c.x, c.z)) return c;
    }
    return this.pathHome() || cands[0];
  }

  // BFS around my own trail to the nearest own cell; returns the farthest
  // path point that is still in clear line of sight (smoothed waypoint).
  pathHome() {
    return this.bfsHome(true) || this.bfsHome(false);
  }

  bfsHome(inflate) {
    const g = this.g; const p = this.p; const code = p.code;
    const prev = g.queue; // reuse game scratch buffers is unsafe during capture; use our own
    if (!BotBrain.par) { BotBrain.par = new Int32Array(N * N); BotBrain.q = new Int32Array(N * N); BotBrain.seen = new Uint32Array(N * N); BotBrain.stamp = 0; }
    void prev;
    const par = BotBrain.par; const q = BotBrain.q; const seen = BotBrain.seen;
    const stamp = ++BotBrain.stamp;
    const L = p.trail.length;
    const recent = new Set(p.trail.slice(Math.max(0, L - 3)));
    let head = 0; let tail = 0;
    q[tail++] = p.cell; seen[p.cell] = stamp; par[p.cell] = -1;
    let goal = -1;
    while (head < tail && head < 12000) {
      const i = q[head++];
      if (g.owner[i] === code && !g.trailGrid[i]) { goal = i; break; }
      const x = i % N; const z = (i / N) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, z > 0 ? i - N : -1, z < N - 1 ? i + N : -1];
      for (const j of nb) {
        if (j < 0 || seen[j] === stamp) continue;
        if (g.trailGrid[j] === code && !recent.has(j)) continue;
        if (inflate && this.nearTrail(j, recent)) continue;
        seen[j] = stamp; par[j] = i; q[tail++] = j;
      }
    }
    if (goal < 0) return null;
    const path = [];
    for (let c = goal; c !== -1; c = par[c]) path.push(c);
    path.reverse();
    let pick = path[Math.min(path.length - 1, 1)];
    for (let k = path.length - 1; k >= 1; k--) {
      const c = path[k];
      if (this.clearLine((c % N) + 0.5, ((c / N) | 0) + 0.5)) { pick = c; break; }
    }
    const x = (pick % N) + 0.5; const z = ((pick / N) | 0) + 0.5;
    return { x, z, d: path.length };
  }

  nearTrail(j, recent) {
    const g = this.g; const code = this.p.code;
    const x = j % N; const z = (j / N) | 0;
    if (Math.abs(x - (this.p.cell % N)) + Math.abs(z - ((this.p.cell / N) | 0)) <= 2) return false;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
        const k = zz * N + xx;
        if (g.trailGrid[k] === code && !recent.has(k)) return true;
      }
    }
    return false;
  }

  clearLine(tx, tz) {
    const p = this.p; const g = this.g;
    const L = p.trail.length;
    const recent = new Set(p.trail.slice(Math.max(0, L - 4)));
    const dx = tx - p.x; const dz = tz - p.z; const d = Math.hypot(dx, dz);
    const steps = Math.ceil(d / 0.35);
    const px = -dz / (d || 1) * 0.55; const pz = dx / (d || 1) * 0.55;
    for (let s = 1; s <= steps; s++) {
      const x = p.x + (dx * s) / steps; const z = p.z + (dz * s) / steps;
      // thick line: centre plus both shoulders
      for (let k = -1; k <= 1; k++) {
        const xx = x + px * k; const zz = z + pz * k;
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
        const i = Math.floor(zz) * N + Math.floor(xx);
        if (g.trailGrid[i] === p.code && !recent.has(i)) return false;
      }
    }
    return true;
  }

  // closest distance from any enemy head to my exposed trail
  threatToTrail() {
    const p = this.p; const g = this.g;
    if (!p.trail.length) return { d: 1e9 };
    let best = 1e9; let who = null;
    const step = Math.max(1, Math.floor(p.trail.length / 40));
    for (const o of g.players) {
      if (o === p || !o.alive) continue;
      for (let k = 0; k < p.trail.length; k += step) {
        const i = p.trail[k];
        const d = Math.hypot((i % N) + 0.5 - o.x, ((i / N) | 0) + 0.5 - o.z);
        if (d < best) { best = d; who = o; }
      }
      // also the head itself (bumps)
      const dh = Math.hypot(o.x - p.x, o.z - p.z);
      if (dh < best) { best = dh; who = o; }
    }
    return { d: best, who };
  }

  findPrey(radius) {
    const p = this.p; const g = this.g;
    let best = null; let bestD = radius;
    for (const o of g.players) {
      if (o === p || !o.alive || !o.trail.length) continue;
      // aim at the trail behind them, not at their head (cuts, not head-on bumps)
      const usable = o.trail.length - 6;
      if (usable <= 0) continue;
      const step = Math.max(1, Math.floor(usable / 30));
      for (let k = 0; k < usable; k += step) {
        const i = o.trail[k];
        const x = (i % N) + 0.5; const z = ((i / N) | 0) + 0.5;
        if (Math.hypot(x - o.x, z - o.z) < 4) continue;
        const d = Math.hypot(x - p.x, z - p.z);
        // only chase if I can plausibly get there before the owner closes the loop
        if (d < bestD) { bestD = d; best = { x, z, owner: o, d }; }
      }
    }
    return best;
  }

  planLoop() {
    const p = this.p; const g = this.g; const per = this.persona;
    const size = Math.sqrt(Math.max(p.area, 30));
    // choose a direction with the most non-owned ground nearby
    let bestA = 0; let bestScore = -1e9;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      let score = 0; let exitDist = 0;
      for (let s = 1; s < 22; s++) {
        const x = Math.floor(p.x + Math.cos(a) * s); const z = Math.floor(p.z + Math.sin(a) * s);
        if (x < 2 || z < 2 || x >= N - 2 || z >= N - 2) { score -= 25; break; }
        const o = g.owner[z * N + x];
        if (o === p.code) { exitDist = s; continue; }
        score += o ? 1.6 : 1; // enemy land is juicy
      }
      score -= exitDist * 0.5;
      score += Math.random() * 6;
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    // find exit distance along that direction
    let exit = 0;
    for (let s = 0; s < 60; s++) {
      const x = Math.floor(p.x + Math.cos(bestA) * s); const z = Math.floor(p.z + Math.sin(bestA) * s);
      if (x < 0 || z < 0 || x >= N || z >= N) break;
      if (g.owner[z * N + x] !== p.code) { exit = s; break; }
    }
    const L = (4 + Math.random() * 6 + size * 0.35) * per.greed;
    const W = (3 + Math.random() * 6 + size * 0.3) * per.greed;
    const side = Math.random() < 0.5 ? 1 : -1;
    const ca = Math.cos(bestA); const sa = Math.sin(bestA);
    const px = -sa * side; const pz = ca * side;
    const clamp = (v) => Math.max(2, Math.min(N - 2, v));
    const ax = p.x + ca * (exit + L); const az = p.z + sa * (exit + L);
    const bx = ax + px * W; const bz = az + pz * W;
    this.waypoints = [
      { x: clamp(ax), z: clamp(az) },
      { x: clamp(bx), z: clamp(bz) },
      // head back roughly parallel before homing on the nearest border
      { x: clamp(bx - ca * L * 0.7), z: clamp(bz - sa * L * 0.7) },
    ];
    this.maxTrail = (L + W) * 2.6 + 10;
  }

  setState(s) { this.state = s; this.stateTime = 0; }

  think(dt) {
    const p = this.p; const per = this.persona;
    this.stateTime += dt;
    this.decide -= dt;
    const own = this.inOwn();

    if (this.decide <= 0) {
      this.decide = 0.12 + Math.random() * 0.06;
      this.evaluate(own);
    }

    // movement target
    let tx; let tz;
    if (this.state === 'return' || this.state === 'retreat') {
      if (this.homeCache) { tx = this.homeCache.x; tz = this.homeCache.z; }
    } else if (this.state === 'hunt' && this.huntTarget) {
      tx = this.huntTarget.x; tz = this.huntTarget.z;
    } else if (this.waypoints.length) {
      const w = this.waypoints[0];
      tx = w.x; tz = w.z;
      if (Math.hypot(w.x - p.x, w.z - p.z) < 1.6) {
        this.waypoints.shift();
        if (!this.waypoints.length && this.state === 'out') this.setState('return');
      }
    } else if (this.wander) {
      tx = this.wander.x; tz = this.wander.z;
    }
    if (tx !== undefined) {
      const desired = Math.atan2(tz - p.z, tx - p.x);
      p.targetAngle = this.avoid(desired);
    }
    void per;
  }

  evaluate(own) {
    const p = this.p; const per = this.persona;
    const exposed = p.trail.length > 0;

    if (!exposed && own) {
      // safely home
      if (this.state !== 'home' && this.state !== 'hunt') {
        this.setState('home');
        this.waypoints = [];
        this.pause = 0.2 + Math.random() * 0.9 * per.caution;
        const h = this.nearestInner();
        this.wander = h;
      }
      if (this.state === 'home') {
        // occasionally go hunting
        if (per.aggression > 0.25) {
          const prey = this.findPrey(10 + per.aggression * 14);
          if (prey && Math.random() < per.aggression * 0.6) {
            this.huntTarget = prey; this.setState('hunt'); return;
          }
        }
        this.pause -= 0.15;
        if (this.pause <= 0 && !this.waypoints.length) {
          this.planLoop();
          this.setState('out');
        }
      }
    }

    if (this.state === 'hunt') {
      const prey = this.findPrey(10 + per.aggression * 18);
      if (!prey || this.stateTime > 5) {
        this.huntTarget = null;
        this.setState(exposed ? 'return' : 'home');
        this.pause = 0;
      } else {
        this.huntTarget = prey;
      }
    }

    if (exposed) {
      const home = this.nearestOwn();
      this.homeCache = home;
      const distHome = home ? home.d : 999;
      const threat = this.threatToTrail();
      const margin = 3 + 4 * per.caution;
      if (threat.d < distHome + margin && this.state !== 'hunt') {
        this.setState('retreat');
      }
      if (this.state === 'hunt' && threat.d < distHome * 0.6 + 2) {
        this.setState('retreat');
      }
      if (p.trail.length > (this.maxTrail || 40) && this.state === 'out') this.setState('return');
      if (this.state === 'home') this.setState('out');
      if (!this.waypoints.length && this.state === 'out') this.setState('return');
    }
  }

  nearestInner() {
    // a random own cell near the bot, to wander toward while "home"
    const p = this.p; const g = this.g;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2; const r = 1 + Math.random() * 4;
      const x = Math.floor(p.x + Math.cos(a) * r); const z = Math.floor(p.z + Math.sin(a) * r);
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (g.owner[z * N + x] === p.code) return { x: x + 0.5, z: z + 0.5 };
    }
    return null;
  }

  // Simulate the real turning arc toward angle a; returns time until hitting my own trail / a wall.
  timeToCollision(a, horizon = 0.75) {
    const p = this.p; const g = this.g;
    const L = p.trail.length;
    const recent = this._recent;
    let x = p.x; let z = p.z; let ang = p.angle;
    const dt = 0.04;
    const turn = TURN_RATE * Math.max(1, p.speed / PLAYER_SPEED);
    for (let t = dt; t < horizon; t += dt) {
      let d = a - ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const mt = turn * dt;
      ang += Math.max(-mt, Math.min(mt, d));
      x += Math.cos(ang) * p.speed * dt; z += Math.sin(ang) * p.speed * dt;
      if (x < 0.8 || z < 0.8 || x > N - 0.8 || z > N - 0.8) return t;
      if (!L) continue;
      const sx = -Math.sin(ang) * 0.4; const sz = Math.cos(ang) * 0.4;
      for (let k = -1; k <= 1; k++) {
        const i = Math.floor(z + sz * k) * N + Math.floor(x + sx * k);
        if (g.trailGrid[i] === p.code && !recent.has(i)) return t;
      }
    }
    return Infinity;
  }

  blocked(a) { return this.timeToCollision(a) !== Infinity; }

  avoid(desired) {
    const p = this.p;
    this._recent = new Set(p.trail.slice(Math.max(0, p.trail.length - 4)));
    const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.45, -1.45, 1.9, -1.9, 2.4, -2.4, 2.9, -2.9];
    let best = desired; let bestT = -1;
    for (const o of offsets) {
      const a = desired + o;
      const t = this.timeToCollision(a);
      if (t === Infinity) return a;
      if (t > bestT) { bestT = t; best = a; }
    }
    return best; // boxed in: take the escape that survives longest
  }

}
