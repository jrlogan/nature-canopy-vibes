// ============================================================
// creatures.js — Birds (day) and Bats (night)
//
// Bird state machine:
//   FLYING  — arc-flight along a bezier curve toward a perch node
//   PERCHED — sitting still on a branch, following its sway
//   LEAVING — scatter flight off-screen after spook
//
// CreatureFlock manages:
//   flockIn  — periodic event: a group flies in from one edge
//   spook    — periodic event: all perched birds scatter
// ============================================================

// ----------------------------------------------------------
// Bat wing drawing (kept simple — erratic Perlin-steered flier)
// ----------------------------------------------------------
function _drawBatWings(span, flapAmt) {
  const s = span;
  const wingSpan = s * 1.06;
  const wingLift = s * 0.16 + flapAmt * 0.34;
  noStroke();
  // Underside silhouette with broad symmetric wings.
  beginShape();
  vertex(-wingSpan, 0);
  quadraticVertex(-s * 0.80, -wingLift, -s * 0.34, -s * 0.10);
  quadraticVertex(-s * 0.12,  s * 0.05, 0, 0);
  quadraticVertex( s * 0.12,  s * 0.05, s * 0.34, -s * 0.10);
  quadraticVertex( s * 0.80, -wingLift, wingSpan, 0);
  quadraticVertex( s * 0.54,  s * 0.34, 0, s * 0.20);
  quadraticVertex(-s * 0.54,  s * 0.34, -wingSpan, 0);
  endShape(CLOSE);

  // Body ridge + tail notch.
  fill(16, 10, 18);
  ellipse(0, 0, s * 0.28, s * 0.48);
  triangle(0, s * 0.10, -s * 0.10, s * 0.28, s * 0.10, s * 0.28);
}

// ===========================================================
// Bird — state machine with perching behaviour
// ===========================================================
class Bird {
  // startX/Y: position to appear from (screen edge or perch)
  // targetNode: BranchNode to fly to (or null to start perched)
  constructor(startX, startY, targetNode) {
    this.x          = startX;
    this.y          = startY;
    this.size       = random(13, 24);
    this.flapPhase  = random(TWO_PI);
    this.flapRate   = 0;
    this.shouldRemove = false;
    this.vel        = { x: 1, y: 0 };
    this.layer      = random() < 0.58 ? 'back' : 'front';

    // Head bob state
    this.headBobTimer = floor(random(80, 250));
    this.headBobPhase = 0;

    if (targetNode) {
      this._startFlight(startX, startY, targetNode, false);
    } else {
      this.state     = 'PERCHED';
      this.perchNode = null;
      this.perchTimer = floor(random(240, 600));
    }
  }

  // ----------------------------------------------------------
  // State transitions
  // ----------------------------------------------------------
  _startFlight(fromX, fromY, toNode, isHop) {
    this.state       = 'FLYING';
    this.flightFrom  = { x: fromX, y: fromY };
    this.flightTarget = toNode;
    this.perchNode   = null;
    this.flightT     = 0;
    // Hops are quick; flock arrivals are slower and more graceful
    this.flightSpeed = isHop ? random(0.030, 0.055) : random(0.014, 0.025);
    this.flapRate    = 0.22;
    // Arc height proportional to distance — short hops arc less
    const d = dist(fromX, fromY, toNode.x, toNode.y);
    this.arcHeight   = d * random(0.22, 0.42);
  }

  _land(node) {
    this.state      = 'PERCHED';
    this.perchNode  = node;
    this.flightTarget = null;
    this.x          = node.x;
    this.y          = node.y;
    this.perchTimer = floor(random(220, 700));
    this.flapRate   = 0;
  }

  _scatter() {
    this.state     = 'LEAVING';
    this.perchNode = null;
    // Fly away from screen centre with random scatter angle
    const cx    = width / 2, cy = height / 2;
    const away  = atan2(this.y - cy, this.x - cx);
    const angle = away + random(-PI * 0.4, PI * 0.4);
    const speed = random(5, 9);
    this.vel    = { x: cos(angle) * speed, y: sin(angle) * speed };
    this.flapRate = 0.30; // frantic
  }

  spook() {
    if (this.state === 'PERCHED' || this.state === 'FLYING') this._scatter();
  }

  // ----------------------------------------------------------
  // Update
  // ----------------------------------------------------------
  update() {
    switch (this.state) {
      case 'FLYING':  this._updateFlight();  break;
      case 'PERCHED': this._updatePerched(); break;
      case 'LEAVING': this._updateLeaving(); break;
    }
    this.flapPhase += this.flapRate;
  }

  _updateFlight() {
    this.flightT = min(1, this.flightT + this.flightSpeed);
    const t  = this.flightT;
    const fx = this.flightFrom.x,   fy = this.flightFrom.y;
    const tx = this.flightTarget.x, ty = this.flightTarget.y;

    // Quadratic bezier arc (mid-point pushed upward)
    const midX = lerp(fx, tx, 0.5);
    const midY = lerp(fy, ty, 0.5) - this.arcHeight;

    const prevX = this.x, prevY = this.y;
    this.x = (1-t)*(1-t)*fx + 2*(1-t)*t*midX + t*t*tx;
    this.y = (1-t)*(1-t)*fy + 2*(1-t)*t*midY + t*t*ty;
    this.vel = { x: this.x - prevX, y: this.y - prevY };

    if (this.flightT >= 1) this._land(this.flightTarget);
  }

  _updatePerched() {
    // Follow the branch as it sways — recalculate exact bezier position from
    // the branch node (updated every frame by canopy._updateNode) and our t value.
    if (this.perchNode) {
      const bn = this.perchNode.branch;
      const t  = this.perchNode.t;
      if (bn !== undefined && t !== undefined) {
        const mt = 1 - t;
        this.x = mt*mt*bn.startX + 2*mt*t*bn.sagX + t*t*bn.endX;
        this.y = mt*mt*bn.startY + 2*mt*t*bn.sagY + t*t*bn.endY;
      } else {
        this.x = this.perchNode.x;
        this.y = this.perchNode.y;
      }
    }

    // Occasional head bob
    this.headBobTimer--;
    if (this.headBobTimer <= 0) {
      this.headBobTimer = floor(random(80, 300));
      this.headBobPhase = TWO_PI; // triggers one bob cycle
    }
    if (this.headBobPhase > 0) this.headBobPhase = max(0, this.headBobPhase - 0.18);

    // Countdown to next action
    this.perchTimer--;
    if (this.perchTimer <= 0) {
      if (random() < 0.22) {
        this._scatter();                // 22 %: fly away on its own
      } else {
        this._hopToNewPerch();          // 78 %: hop to another branch
      }
    }
  }

  _updateLeaving() {
    this.x += this.vel.x;
    this.y += this.vel.y;
    // Light air resistance
    this.vel.x *= 0.985;
    this.vel.y *= 0.985;
    if (this.x < -140 || this.x > width  + 140 ||
        this.y < -140 || this.y > height + 140) {
      this.shouldRemove = true;
    }
  }

  _hopToNewPerch() {
    if (!canopy || canopy.perchNodes.length === 0) {
      // No perches available — stay put a little longer
      this.perchTimer = floor(random(60, 180));
      return;
    }
    const target = random(canopy.perchNodes);
    this._startFlight(this.x, this.y, target, true);
  }

  // ----------------------------------------------------------
  // Draw
  // ----------------------------------------------------------
  draw() {
    const alpha = this._daytimeAlpha();
    if (alpha <= 0) return;
    if (this.state === 'PERCHED') this._drawPerched(alpha);
    else                          this._drawFlying(alpha);
  }

  _drawPerched(alpha) {
    push();
    translate(this.x, this.y);
    const bobY = this.headBobPhase > 0 ? sin(this.headBobPhase * 2.4) * 2.2 : 0;
    const s = this.size;

    // Underside silhouette while perched: compact body with folded wings.
    noStroke();
    fill(8, 8, 8, alpha);
    ellipse(0, -s * 0.38 + bobY, s * 0.95, s * 0.56); // torso
    ellipse(-s * 0.28, -s * 0.35 + bobY, s * 0.52, s * 0.32); // folded wing L
    ellipse( s * 0.28, -s * 0.35 + bobY, s * 0.52, s * 0.32); // folded wing R
    triangle(0, -s * 0.10 + bobY, -s * 0.20, s * 0.22, s * 0.20, s * 0.22); // tail fan

    // Feet gripping branch beneath.
    stroke(8, 8, 8, alpha);
    strokeWeight(1.0);
    line(-s * 0.12, s * 0.02, -s * 0.12, s * 0.20);
    line( s * 0.12, s * 0.02,  s * 0.12, s * 0.20);
    line(-s * 0.12, s * 0.20, -s * 0.26, s * 0.20);
    line( s * 0.12, s * 0.20,  s * 0.26, s * 0.20);

    pop();
  }

  _drawFlying(alpha) {
    const angle  = atan2(this.vel.y, this.vel.x);
    const s      = this.size;
    const flap   = sin(this.flapPhase) * s * 0.42;
    const wingSpan = s * 1.45;
    const wingLift = s * 0.22 + flap;

    push();
    translate(this.x, this.y);
    rotate(angle);
    fill(8, 8, 8, alpha);
    noStroke();

    // Underside flight silhouette with broad symmetric wings.
    beginShape();
    vertex(-wingSpan, 0);
    quadraticVertex(-s * 0.78, -wingLift, -s * 0.30, -s * 0.08);
    quadraticVertex(-s * 0.10, s * 0.06, 0, 0);
    quadraticVertex( s * 0.10, s * 0.06, s * 0.30, -s * 0.08);
    quadraticVertex( s * 0.78, -wingLift, wingSpan, 0);
    quadraticVertex( s * 0.52,  s * 0.34, 0, s * 0.22);
    quadraticVertex(-s * 0.52,  s * 0.34, -wingSpan, 0);
    endShape(CLOSE);

    // Body ridge + tail notch.
    fill(14, 14, 14, alpha);
    ellipse(0, 0, s * 0.44, s * 0.70);
    triangle(0, s * 0.14, -s * 0.16, s * 0.42, s * 0.16, s * 0.42);

    pop();
  }

  _daytimeAlpha() {
    const t = env.timeOfDay;
    if (t < 7  || t > 20) return 0;
    if (t < 8)            return map(t,  7,  8, 0, 255);
    if (t > 19)           return map(t, 19, 20, 255, 0);
    return 255;
  }
}

// ===========================================================
// Bat — erratic Perlin-steered flier, unchanged from Phase 2
// ===========================================================
class Bat {
  constructor(opts = {}) {
    this.mode      = opts.mode || 'hunt_pass';
    this.pos       = createVector(
      opts.x ?? random(width * 0.2, width * 0.8),
      opts.y ?? random(height * 0.2, height * 0.7),
    );
    this.vel       = createVector(opts.vx ?? 0, opts.vy ?? 0);
    if (this.vel.magSq() < 0.1) this.vel = p5.Vector.random2D().mult(random(2.6, 4.8));
    this.flapPhase = random(TWO_PI);
    this.size      = opts.size ?? random(16, 28);
    this.noiseOff  = random(2000);
    this.noiseSpd  = random(0.018, 0.032);
    this.shouldRemove = false;
    this.life = opts.life ?? floor(random(180, 420));
    this.leader = opts.leader || null; // for commute followers
    this.offset = opts.offset ? opts.offset.copy() : createVector(0, 0);
    this.disperseAt = opts.disperseAt ?? floor(this.life * random(0.42, 0.68));
    this.swoopAmp = opts.swoopAmp ?? random(8, 26);
    this.swoopRate = opts.swoopRate ?? random(0.020, 0.048);
    this.homeBandY = opts.homeBandY ?? random(height * 0.60, height * 0.88);
    this.phaseJit = random(1000);
    this.huntTarget = null;
    this.huntHops = opts.huntHops ?? floor(random(2, 5));
  }

  update() {
    if (this.mode === 'commute_lead') {
      // Fast, low commute line at dusk/dawn with synchronized swoop.
      const n = noise(this.pos.x * 0.0018, this.pos.y * 0.0018, frameCount * this.noiseSpd + this.noiseOff);
      const angle = (n - 0.5) * 0.65;
      this.vel.add(p5.Vector.fromAngle(angle).mult(0.08)).limit(6.0);
      this.pos.add(this.vel);
      this.pos.y += sin(frameCount * this.swoopRate + this.phaseJit) * 0.7;
      this.flapPhase += 0.34;
      this.life--;
      if (this.life <= this.disperseAt) {
        this.mode = 'hunt_pass';
        this.vel.limit(4.8);
      }
      if (this.life <= 0 ||
          this.pos.x < -140 || this.pos.x > width + 140 ||
          this.pos.y < -140 || this.pos.y > height + 140) {
        this.shouldRemove = true;
      }
      return;
    }

    if (this.mode === 'commute_follow' && this.leader && !this.leader.shouldRemove) {
      // Tight group cohesion around the commute leader.
      const desired = p5.Vector.add(this.leader.pos, this.offset);
      const to = p5.Vector.sub(desired, this.pos);
      this.vel.add(to.mult(0.07));
      this.vel.limit(6.2);
      this.pos.add(this.vel);
      this.pos.y += sin(frameCount * this.swoopRate + this.phaseJit) * 0.55;
      this.flapPhase += 0.36;
      this.life--;
      if (this.life <= this.disperseAt) {
        this.mode = 'hunt_pass';
        this.leader = null;
        this.vel.limit(4.8);
      }
      if (this.life <= 0 ||
          this.pos.x < -170 || this.pos.x > width + 170 ||
          this.pos.y < -170 || this.pos.y > height + 170) {
        this.shouldRemove = true;
      }
      return;
    }

    if (this.mode === 'exit') {
      this.pos.add(this.vel);
      this.flapPhase += 0.40;
      this.life--;
      if (this.life <= 0 ||
          this.pos.x < -170 || this.pos.x > width + 170 ||
          this.pos.y < -170 || this.pos.y > height + 170) {
        this.shouldRemove = true;
      }
      return;
    }

    // Hunt quickly between tree perches, then leave.
    const pickHuntTarget = () => {
      if (!canopy || !canopy.perchNodes || canopy.perchNodes.length === 0) return null;
      // Favor mid/high canopy targets so low bats are less common.
      const candidates = canopy.perchNodes.filter(p => p.y <= height * 0.76 && p.y >= height * 0.22);
      if (!candidates.length) return random(canopy.perchNodes);
      return random(candidates);
    };

    if (!this.huntTarget) this.huntTarget = pickHuntTarget();
    if (this.huntTarget) {
      const tgt = createVector(this.huntTarget.x, this.huntTarget.y);
      const to = p5.Vector.sub(tgt, this.pos);
      const d = to.mag();
      if (d > 0.001) {
        to.normalize().mult(0.58);
        this.vel.add(to).limit(7.4);
      }
      this.pos.add(this.vel);
      this.pos.y += sin(frameCount * this.swoopRate + this.phaseJit) * 0.6;
      if (this.pos.y < height * 0.34) this.pos.y = lerp(this.pos.y, height * 0.40, 0.10);
      if (this.pos.y > height * 0.86) this.pos.y = lerp(this.pos.y, height * 0.78, 0.16);
      if (d < 42) {
        this.huntHops--;
        this.huntTarget = pickHuntTarget();
      }
    } else {
      const angle = noise(this.pos.x * 0.0028, this.pos.y * 0.0028, frameCount * this.noiseSpd + this.noiseOff) * TWO_PI * 2;
      this.vel.add(p5.Vector.fromAngle(angle).mult(0.14)).limit(6.5);
      this.pos.add(this.vel);
    }
    this.flapPhase += 0.38;
    this.life--;
    if (this.huntHops <= 0 || this.life <= 0) {
      const cx = width / 2;
      const cy = height / 2;
      const away = atan2(this.pos.y - cy, this.pos.x - cx) + random(-0.32, 0.32);
      this.vel = p5.Vector.fromAngle(away).mult(random(6.6, 8.6));
      this.mode = 'exit';
      this.life = floor(random(70, 140));
      this.huntTarget = null;
    }
  }

  draw() {
    const t = env.timeOfDay;
    let alpha = 0;
    if (t < 5 || t > 21)             alpha = 220;
    else if (t >= 5  && t <= 6)      alpha = map(t,  5,  6, 220, 0);
    else if (t >= 20 && t <= 21)     alpha = map(t, 20, 21,   0, 220);
    if (alpha <= 0) return;

    const flap = sin(this.flapPhase) * this.size * 0.5;
    push();
    translate(this.pos.x, this.pos.y);
    // Keep bats in underside view (looking up): avoid side-profile heading rotation.
    rotate(sin(frameCount * 0.011 + this.noiseOff) * 0.14);
    fill(20, 0, 30, alpha);
    _drawBatWings(this.size, flap);
    pop();
  }
}

// ===========================================================
// CreatureFlock — event-driven flock and spook manager
// ===========================================================
class CreatureFlock {
  constructor() {
    this.birds = [];
    this.bats  = [];

    // Timers in frames (@60 fps)
    this.flockInTimer = 30;                          // first flock arrives quickly
    this.spookTimer   = floor(random(28, 55) * 60);
    this.batGroupTimer = floor(random(6, 12) * 60);
  }

  // ----------------------------------------------------------
  update() {
    // Remove birds that have flown off screen
    this.birds = this.birds.filter(b => !b.shouldRemove);
    this.bats  = this.bats.filter(b => !b.shouldRemove);

    const perched = this.birds.filter(b => b.state === 'PERCHED').length;
    const total   = this.birds.length;
    const activeFlock = total > 0;
    const t = env.timeOfDay;
    const isNight = t < 6.5 || t > 20.5;
    const isSunset = t >= 17.4 && t <= 20.3;
    const isDusk = t >= 18.0 && t <= 20.9;
    const isDawn = t >= 4.5 && t <= 6.7;
    const isStorm = env.currentWeather === 'storm';
    const cloudCover = constrain(env.cloudCover ?? 0.28, 0, 1);
    const blockFlocksForCloud = cloudCover >= 0.42;   // stop new arrivals before sky gets heavy
    const clearOutForCloud = cloudCover >= 0.56;      // force departure before dense overcast
    const isStruggling = !!window._ncvIsStruggling;

    // --- Flock-in event ---
    this.flockInTimer--;
    if (this.flockInTimer <= 0) {
      if (!isNight && !isStorm && !blockFlocksForCloud && !isStruggling && !activeFlock && canopy && canopy.perchNodes.length > 0) {
        this._triggerFlockIn();
      }
      // Schedule next flock-in whether or not this one fired
      this.flockInTimer = floor(this._nextBirdFlockDelaySec(isSunset) * 60);
    }

    // --- Spook event ---
    this.spookTimer--;
    if (this.spookTimer <= 0) {
      if (!isNight && perched >= 2) {
        this._triggerSpook();
        // Schedule a new flock-in shortly after the scatter
        this.flockInTimer = floor(random(6, 14) * 60);
      }
      this.spookTimer = floor(random(30, 60) * 60);
    }

    if ((isStorm || isStruggling) && this.birds.length > 0) {
      this._triggerSpook();
      this.flockInTimer = floor(random(25, 45) * 60);
    }
    if (clearOutForCloud && this.birds.length > 0) {
      this._triggerSpook();
      this.flockInTimer = floor(random(20, 40) * 60);
    }

    for (const b of this.birds) b.update();

    // Bat population: grow at night, trim by day
    const hunters = this.bats.filter(b => b.mode === 'hunt_pass').length;
    if (isNight && hunters < 2 && !isStruggling && random() < 0.0013) {
      this.bats.push(new Bat({
        mode: 'hunt_pass',
        x: random(-80, width + 80),
        y: random(height * 0.36, height * 0.74),
        life: floor(random(170, 320)),
        huntHops: floor(random(2, 4)),
        size: random(13, 21),
      }));
    }
    if (!isNight && hunters > 0) {
      const idx = this.bats.findIndex(b => b.mode === 'hunt_pass');
      if (idx >= 0) this.bats.splice(idx, 1);
    }

    this.batGroupTimer--;
    const hasCommuteGroup = this.bats.some(b => b.mode === 'commute_lead' || b.mode === 'commute_follow');
    if ((isDusk || isDawn) && this.batGroupTimer <= 0 && !isStruggling) {
      if (!hasCommuteGroup) this._spawnBatCommuteGroup(isDawn ? 'inbound' : 'outbound');
      this.batGroupTimer = floor(random(5, 10) * 60);
    } else if (!(isDusk || isDawn) && this.batGroupTimer <= 0) {
      this.batGroupTimer = floor(random(14, 28) * 60);
    }

    for (const b of this.bats) b.update();
  }

  _nextBirdFlockDelaySec(isSunset) {
    if (isSunset) return random(8, 18);
    return random(20, 44);
  }

  _spawnBatCommuteGroup(kind = 'outbound') {
    const count = floor(random(8, 18));
    const fromLeft = random() < 0.5;
    const sx = fromLeft ? -120 : width + 120;
    // Keep commute groups farther away (higher in frame) for distant-swarm feel.
    const syBase = random(height * 0.30, height * 0.50);
    const tx = fromLeft ? width + 120 : -120;
    const ty = constrain(syBase + random(-28, 28), height * 0.24, height * 0.58);
    const dir = createVector(tx - sx, ty - syBase).normalize().mult(random(5.2, 6.6));
    const lifeBase = floor(random(240, 430));

    const leader = new Bat({
      mode: 'commute_lead',
      x: sx + random(-10, 10),
      y: syBase + random(-8, 8),
      vx: dir.x,
      vy: dir.y,
      size: random(12, 18),
      life: lifeBase,
      disperseAt: floor(lifeBase * (kind === 'outbound' ? random(0.52, 0.74) : random(0.38, 0.60))),
      swoopAmp: random(10, 22),
      swoopRate: random(0.024, 0.042),
    });
    this.bats.push(leader);

    for (let i = 0; i < count - 1; i++) {
      const ring = Math.floor(i / 4) + 1;
      const slot = i % 4;
      const ox = (slot < 2 ? -1 : 1) * ring * random(8, 16);
      const oy = (slot % 2 === 0 ? -1 : 1) * ring * random(6, 12);
      this.bats.push(new Bat({
        mode: 'commute_follow',
        x: leader.pos.x + ox + random(-4, 4),
        y: leader.pos.y + oy + random(-4, 4),
        vx: dir.x + random(-0.35, 0.35),
        vy: dir.y + random(-0.35, 0.35),
        size: random(10, 16),
        life: lifeBase + floor(random(-40, 60)),
        disperseAt: leader.disperseAt + floor(random(-40, 60)),
        leader,
        offset: createVector(ox, oy),
        swoopAmp: random(8, 18),
        swoopRate: random(0.022, 0.040),
      }));
    }
  }

  // ----------------------------------------------------------
  _triggerFlockIn() {
    const count = floor(random(3, 7));
    // Pick one screen edge as the arrival point
    const edge = floor(random(4));
    let ex, ey;
    if      (edge === 0) { ex = -70;        ey = random(height * 0.25, height * 0.8); }
    else if (edge === 1) { ex = width + 70; ey = random(height * 0.25, height * 0.8); }
    else if (edge === 2) { ex = random(width); ey = -70; }
    else                 { ex = random(width); ey = height + 70; }

    for (let i = 0; i < count; i++) {
      const target = random(canopy.perchNodes);
      this.birds.push(new Bird(
        ex + random(-50, 50),
        ey + random(-50, 50),
        target,
      ));
    }
    console.log(`[flock] ${count} birds flying in`);
  }

  _triggerSpook() {
    for (const b of this.birds) b.spook();
    console.log('[flock] Spooked!');
  }

  // ----------------------------------------------------------
  getOccluders() {
    const occ = [];
    for (const b of this.birds) {
      if (b.state === 'LEAVING') continue;
      occ.push({ x: b.x, y: b.y, r: b.size * (b.state === 'PERCHED' ? 1.35 : 1.1) });
    }
    return occ;
  }

  drawBackLayer() {
    for (const b of this.birds) {
      if (b.layer === 'back') b.draw();
    }
  }

  drawFrontLayer() {
    for (const b of this.birds) {
      if (b.layer !== 'back') b.draw();
    }
    for (const b of this.bats) b.draw();
  }
}
