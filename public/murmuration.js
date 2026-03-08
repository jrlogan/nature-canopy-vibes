// ============================================================
// murmuration.js — Distant background starling murmurations
//
// Real starlings use topological neighborhoods (7 nearest birds,
// not a fixed radius), which is what creates the wave-like
// information propagation characteristic of murmurations.
//
// Depth layer system:
//   Three visual depth layers simulate a true 3D flock.
//   Layer 0 (far)   — small, faded, drawn first (behind everything)
//   Layer 1 (mid)   — normal size + opacity
//   Layer 2 (close) — larger, darker, drawn last (overlaps mid + far)
//
//   Birds migrate between layers over time (slow drift when calm,
//   rapid scatter when a predator dives). Cross-layer centroid
//   cohesion keeps all layers loosely coupled as one flock, so
//   they split/rejoin naturally rather than drifting apart forever.
//
// Architecture:
//   MurmurationSystem — spawns/retires Swarm instances
//   Swarm             — group of boids with lifecycle + predator + layers
//   Boid              — topological boids: separation/alignment/cohesion
//
// Drawn before the canopy so trees frame the sky naturally.
// ============================================================

const _MURM_MAX_SPEED = 4.2;
const _MURM_MIN_SPEED = 1.8;
const _MURM_MAX_FORCE = 0.15;
const _MURM_K_TOPO    = 7; // topological neighbor count (like real starlings)

// ----------------------------------------------------------
// Boid — individual bird in a swarm.
// All birds in a swarm share the same visual scale; distance
// is encoded per-swarm, not per-bird.
// ----------------------------------------------------------
class _MurmBoid {
  constructor(x, y, vx, vy) {
    this.x  = x;  this.y  = y;
    this.vx = vx; this.vy = vy;
    this.ax = 0;  this.ay = 0;
  }

  step() {
    this.vx += this.ax;
    this.vy += this.ay;
    let spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spd > _MURM_MAX_SPEED) {
      const s = _MURM_MAX_SPEED / spd;
      this.vx *= s; this.vy *= s; spd = _MURM_MAX_SPEED;
    }
    if (spd < _MURM_MIN_SPEED && spd > 0.001) {
      const s = _MURM_MIN_SPEED / spd;
      this.vx *= s; this.vy *= s;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.ax = 0;
    this.ay = 0;
  }
}

// ----------------------------------------------------------
// Swarm — one murmuration episode
// ----------------------------------------------------------
class _MurmSwarm {
  constructor() {
    // Spawn just outside one screen edge so the flock flies IN.
    const edge = Math.floor(Math.random() * 4);
    let sx, sy, initVx, initVy;
    if      (edge === 0) { sx = random(width);   sy = -60;            initVx = random(-1, 1);  initVy = random(2, 4);  }
    else if (edge === 1) { sx = width + 60;      sy = random(height); initVx = random(-4, -2); initVy = random(-1, 1); }
    else if (edge === 2) { sx = random(width);   sy = height + 60;    initVx = random(-1, 1);  initVy = random(-4,-2); }
    else                 { sx = -60;             sy = random(height); initVx = random(2, 4);   initVy = random(-1, 1); }

    // Per-swarm distance scale: all birds in this swarm appear the same apparent
    // size (consistent distance), set at spawn time by MurmurationSystem.
    // Default 1.0; MurmurationSystem overrides this to spread swarms across distances.
    this.distanceScale = 1.0;

    const count = Math.floor(random(70, 200));
    this.boids = [];
    for (let i = 0; i < count; i++) {
      const r = random(0, 45);
      const a = random(TWO_PI);
      this.boids.push(new _MurmBoid(
        sx + Math.cos(a) * r,
        sy + Math.sin(a) * r,
        initVx + random(-0.8, 0.8),
        initVy + random(-0.8, 0.8),
      ));
    }

    // Slowly-moving attractor kept near screen centre.
    this.atX  = width  * (0.35 + Math.random() * 0.30);
    this.atY  = height * (0.35 + Math.random() * 0.30);
    this.dAtX = random(-0.18, 0.18);
    this.dAtY = random(-0.18, 0.18);

    this.age      = 0;
    this.lifetime = Math.floor(random(900, 2200)); // 15–37 s @60fps

    // Predator (falcon) dives periodically.
    this.pred      = null;
    this.predTimer = Math.floor(random(220, 550));

    // Wave pulse: edge bird gets sharp perpendicular kick → propagates via alignment.
    this.pulseTimer = Math.floor(random(80, 200));
  }

  get isDone() {
    return this.age > this.lifetime + 180;
  }

  update() {
    this.age++;

    // Drift attractor, softly pulled back toward screen centre.
    this.atX += this.dAtX;
    this.atY += this.dAtY;
    this.dAtX += (width  * 0.5 - this.atX) * 0.00015;
    this.dAtY += (height * 0.5 - this.atY) * 0.00015;

    // Predator events.
    if (this.pred) {
      this.pred.x += this.pred.vx;
      this.pred.y += this.pred.vy;
      if (this.pred.x < -120 || this.pred.x > width  + 120 ||
          this.pred.y < -120 || this.pred.y > height + 120) {
        this.pred = null;
      }
    } else {
      this.predTimer--;
      if (this.predTimer <= 0 && this.age < this.lifetime) {
        this._spawnPredator();
        this.predTimer = Math.floor(random(350, 850));
      }
    }

    // Wave pulse.
    this.pulseTimer--;
    if (this.pulseTimer <= 0) {
      this._triggerPulse();
      this.pulseTimer = Math.floor(random(60, 180));
    }

    this._flock();
    for (const b of this.boids) b.step();
  }

  _spawnPredator() {
    const edge = Math.floor(Math.random() * 4);
    let px, py;
    if      (edge === 0) { px = random(width);  py = -40; }
    else if (edge === 1) { px = width + 40;     py = random(height); }
    else if (edge === 2) { px = random(width);  py = height + 40; }
    else                 { px = -40;            py = random(height); }
    const ang = Math.atan2(this.atY - py, this.atX - px);
    this.pred = {
      x: px, y: py,
      vx: Math.cos(ang) * 10,
      vy: Math.sin(ang) * 10,
    };
  }

  // Pick the bird farthest from attractor and give it a perpendicular kick.
  // The kick propagates through alignment, creating a visible wave sweep.
  _triggerPulse() {
    if (this.boids.length === 0) return;
    let farthest = this.boids[0];
    let maxD2 = 0;
    for (const b of this.boids) {
      const d2 = (b.x - this.atX) ** 2 + (b.y - this.atY) ** 2;
      if (d2 > maxD2) { maxD2 = d2; farthest = b; }
    }
    const spd  = Math.sqrt(farthest.vx ** 2 + farthest.vy ** 2) || 1;
    const sign = Math.random() < 0.5 ? 1 : -1;
    farthest.ax += (-farthest.vy / spd) * sign * 2.5;
    farthest.ay += ( farthest.vx / spd) * sign * 2.5;
  }

  _flock() {
    const n    = this.boids.length;
    const K    = Math.min(_MURM_K_TOPO, n - 1);
    // Reduced separation radius (vs the old 22px) so interior birds can pack
    // more naturally — real murmurations have dense centres with heavy overlap.
    const sep2 = 15 * 15;

    for (let i = 0; i < n; i++) {
      const b = this.boids[i];

      // ---- Topological K-nearest (all layers — the flock is one 2D body) ----
      const dists = new Array(n - 1);
      let di = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = this.boids[j].x - b.x;
        const dy = this.boids[j].y - b.y;
        dists[di++] = { j, d2: dx * dx + dy * dy };
      }
      // Partial insertion sort for first K entries (fast for small K).
      for (let k = 0; k < K; k++) {
        let minIdx = k;
        for (let m = k + 1; m < dists.length; m++) {
          if (dists[m].d2 < dists[minIdx].d2) minIdx = m;
        }
        if (minIdx !== k) { const tmp = dists[k]; dists[k] = dists[minIdx]; dists[minIdx] = tmp; }
      }

      // ---- Accumulate boid forces ----
      let sepX = 0, sepY = 0;
      let aliVx = 0, aliVy = 0;
      let cohX = 0, cohY = 0;

      for (let k = 0; k < K; k++) {
        const nb = this.boids[dists[k].j];
        const d2 = dists[k].d2;
        const dx = b.x - nb.x;
        const dy = b.y - nb.y;

        if (d2 < sep2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          sepX += (dx / d) * (sep2 - d2) / sep2;
          sepY += (dy / d) * (sep2 - d2) / sep2;
        }
        aliVx += nb.vx;
        aliVy += nb.vy;
        cohX  += nb.x;
        cohY  += nb.y;
      }

      const steer = (dx, dy, weight) => {
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return;
        const dvx = (dx / len) * _MURM_MAX_SPEED - b.vx;
        const dvy = (dy / len) * _MURM_MAX_SPEED - b.vy;
        const fl  = Math.sqrt(dvx * dvx + dvy * dvy);
        if (fl < 0.001) return;
        const scale = Math.min(fl, _MURM_MAX_FORCE) / fl * weight;
        b.ax += dvx * scale;
        b.ay += dvy * scale;
      };

      if (sepX !== 0 || sepY !== 0) steer(sepX, sepY, 1.55);
      if (aliVx !== 0 || aliVy !== 0) steer(aliVx, aliVy, 1.05);
      steer(cohX / K - b.x, cohY / K - b.y, 0.85);

      // ---- Attractor: keeps flock in the open sky zone ----
      const hx = this.atX - b.x;
      const hy = this.atY - b.y;
      const hd = Math.sqrt(hx * hx + hy * hy);
      if (hd > 60) steer(hx, hy, 0.22 + (hd - 60) * 0.003);

      // ---- Predator avoidance ----
      if (this.pred) {
        const px  = b.x - this.pred.x;
        const py  = b.y - this.pred.y;
        const pd2 = px * px + py * py;
        if (pd2 < 130 * 130 && pd2 > 0.01) {
          const pd = Math.sqrt(pd2);
          steer(px / pd, py / pd, (1 - pd2 / (130 * 130)) * 5.5);
        }
      }

      // ---- Soft screen boundary ----
      const mg = 70;
      if (b.x < mg)          b.ax += (mg - b.x)            * 0.008;
      if (b.x > width  - mg) b.ax -= (b.x - (width - mg))  * 0.008;
      if (b.y < mg)          b.ay += (mg - b.y)             * 0.008;
      if (b.y > height - mg) b.ay -= (b.y - (height - mg)) * 0.008;
    }
  }

  // All birds in this swarm share the same distanceScale — consistent apparent
  // distance. fillStyle is set once for all birds (one state change total).
  draw(alpha) {
    const dc      = drawingContext;
    const sc      = this.distanceScale;
    const isNight = env.timeOfDay < 6.5 || env.timeOfDay > 20.5;

    // Colour: far swarms (sc < 1) are hazier/lighter; close swarms (sc > 1) are richer.
    const haze = Math.max(0, Math.min(12, Math.round((1 - sc) * 10)));
    const r = isNight ? Math.min(255, 12 + haze) : Math.min(255, 18 + haze);
    const g = isNight ? Math.min(255,  6 + haze) : Math.min(255, 15 + haze);
    const b = isNight ? Math.min(255, 22 + haze) : Math.min(255, 20 + haze);
    // Far swarms slightly more transparent; close ones slightly more opaque.
    const aa = Math.max(0, Math.min(1, (alpha / 255) * (0.55 + sc * 0.45)));

    dc.save();
    dc.fillStyle = `rgba(${r},${g},${b},${aa.toFixed(3)})`;

    for (const boid of this.boids) {
      const spd = Math.sqrt(boid.vx * boid.vx + boid.vy * boid.vy);
      if (spd < 0.05) continue;
      const ang = Math.atan2(boid.vy, boid.vx);
      const w   = constrain(3.5 + (spd / _MURM_MAX_SPEED) * 3.0, 3.5, 6.5) * sc;
      const h   = 1.8 * sc;

      dc.save();
      dc.translate(boid.x, boid.y);
      dc.rotate(ang);
      dc.beginPath();
      dc.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
      dc.fill();
      dc.restore();
    }

    // Predator silhouette.
    if (this.pred) {
      const predAlpha = Math.max(0, Math.min(1, (alpha / 255) * 1.4));
      dc.fillStyle = isNight
        ? `rgba(30,10,40,${predAlpha.toFixed(3)})`
        : `rgba(45,30,20,${predAlpha.toFixed(3)})`;
      dc.save();
      dc.translate(this.pred.x, this.pred.y);
      dc.rotate(Math.atan2(this.pred.vy, this.pred.vx));
      dc.beginPath();
      dc.moveTo(9 * sc, 0);
      dc.lineTo(-4 * sc, -7 * sc);
      dc.lineTo(-2 * sc, 0);
      dc.lineTo(-4 * sc,  7 * sc);
      dc.closePath();
      dc.fill();
      dc.restore();
    }

    dc.restore();
  }
}

// ----------------------------------------------------------
// MurmurationSystem — public API, called from sketch.js
// ----------------------------------------------------------
class MurmurationSystem {
  constructor() {
    this.swarms    = [];
    // First murmuration arrives 20–60 s after startup.
    this.nextSpawn = millis() + random(20000, 60000);
  }

  // Assign a distance scale to a new swarm, picking a value that avoids
  // clustering too close to existing swarms' scales (so they look distinct).
  _assignDistanceScale() {
    // Pool of candidate distance buckets: far, mid-far, mid, mid-close, close.
    const candidates = [0.42, 0.62, 0.88, 1.18, 1.52];
    const used = this.swarms.map(s => s.distanceScale);
    // Pick the candidate furthest from any existing swarm's scale.
    let best = candidates[0], bestGap = 0;
    for (const c of candidates) {
      const minDist = used.length === 0 ? Infinity
        : Math.min(...used.map(u => Math.abs(u - c)));
      if (minDist > bestGap) { bestGap = minDist; best = c; }
    }
    // Add a small jitter so repeated spawns don't repeat identically.
    return best + (Math.random() - 0.5) * 0.10;
  }

  // Spawn one new swarm immediately — used by the "Trigger Flock" button.
  triggerFlock() {
    const tod = env.timeOfDay;
    const isNight = tod < 6.5 || tod > 20.5;
    if (isNight || env.currentWeather === 'storm') return;
    const swarm = new _MurmSwarm();
    swarm.distanceScale = this._assignDistanceScale();
    this.swarms.push(swarm);
  }

  update() {
    // Only active during daylight and sunset shoulder (never at night or in storms).
    const tod      = env.timeOfDay;
    const cloudCover = constrain(env.cloudCover ?? 0.28, 0, 1);
    const blockForCloud = cloudCover >= 0.42;
    const clearOutForCloud = cloudCover >= 0.56;
    const isActive = tod >= 6.2 && tod <= 20.5 && env.currentWeather !== 'storm' && !blockForCloud;
    const now      = millis();

    // Up to 3 concurrent swarms at different apparent distances.
    if (isActive && now >= this.nextSpawn && this.swarms.length < 3) {
      const swarm = new _MurmSwarm();
      swarm.distanceScale = this._assignDistanceScale();
      this.swarms.push(swarm);
      // Sunset (17:30–20:15): more frequent murmurations.
      const isSunset = tod >= 17.5 && tod <= 20.25;
      this.nextSpawn = now + (isSunset ? random(12000, 32000) : random(32000, 110000));
    } else if (!isActive && this.swarms.length > 0) {
      // Disperse active swarms quickly when night/storm/cloud build-up arrives.
      const disperseStep = clearOutForCloud ? 9 : 5;
      for (const s of this.swarms) s.age += disperseStep;
      this.nextSpawn = now + random(22000, 52000);
    }

    for (const s of this.swarms) s.update();
    this.swarms = this.swarms.filter(s => !s.isDone);
  }

  draw() {
    // Sort by distanceScale ascending so far swarms draw first (behind close ones).
    const sorted = this.swarms.slice().sort((a, b) => a.distanceScale - b.distanceScale);
    for (const s of sorted) {
      const fadeIn  = constrain(s.age / 90, 0, 1);
      const fadeOut = constrain((s.lifetime - s.age) / 90, 0, 1);
      const alpha   = Math.round(constrain(Math.min(fadeIn, fadeOut), 0, 1) * 178);
      if (alpha < 2) continue;
      s.draw(alpha);
    }
  }
}
