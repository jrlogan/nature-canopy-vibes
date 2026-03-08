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
  const bw = span * 0.12;
  noFill();
  strokeWeight(1.4);
  // Left membrane
  beginShape();
  vertex(-span,         flapAmt * 0.55);
  vertex(-span * 0.62,  flapAmt * 0.05);
  vertex(-span * 0.34, -flapAmt * 0.52);
  vertex(-bw,           flapAmt * 0.12);
  endShape();
  // Right membrane
  beginShape();
  vertex(span,          flapAmt * 0.55);
  vertex(span  * 0.62,  flapAmt * 0.05);
  vertex(span  * 0.34, -flapAmt * 0.52);
  vertex(bw,            flapAmt * 0.12);
  endShape();
  // Body
  fill(20, 0, 30);
  noStroke();
  circle(0, 0, bw * 2.2);
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
    this.mode      = opts.mode || 'wander';
    this.pos       = createVector(
      opts.x ?? random(width * 0.2, width * 0.8),
      opts.y ?? random(height * 0.2, height * 0.7),
    );
    this.vel       = createVector(opts.vx ?? 0, opts.vy ?? 0);
    if (this.vel.magSq() < 0.1) this.vel = p5.Vector.random2D().mult(random(1.5, 3.5));
    this.flapPhase = random(TWO_PI);
    this.size      = opts.size ?? random(16, 28);
    this.noiseOff  = random(2000);
    this.noiseSpd  = random(0.018, 0.032);
    this.shouldRemove = false;
    this.life = opts.life ?? floor(random(420, 920));
  }

  update() {
    if (this.mode === 'cross') {
      const angle = noise(this.pos.x * 0.0024, this.pos.y * 0.0024,
                          frameCount * this.noiseSpd + this.noiseOff) * TWO_PI * 2;
      this.vel.add(p5.Vector.fromAngle(angle).mult(0.05)).limit(4.4);
      this.pos.add(this.vel);
      this.flapPhase += 0.34;
      this.life--;
      if (this.life <= 0 ||
          this.pos.x < -140 || this.pos.x > width + 140 ||
          this.pos.y < -140 || this.pos.y > height + 140) {
        this.shouldRemove = true;
      }
      return;
    }

    const angle = noise(this.pos.x * 0.003, this.pos.y * 0.003,
                        frameCount * this.noiseSpd + this.noiseOff) * TWO_PI * 3;
    this.vel.add(p5.Vector.fromAngle(angle).mult(0.12)).limit(3.5);
    this.pos.add(this.vel);
    this.flapPhase += 0.28;
    // Wrap
    if (this.pos.x < -60)         this.pos.x = width  + 60;
    if (this.pos.x > width  + 60) this.pos.x = -60;
    if (this.pos.y < -60)         this.pos.y = height + 60;
    if (this.pos.y > height + 60) this.pos.y = -60;
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
    rotate(atan2(this.vel.y, this.vel.x));
    stroke(20, 0, 30, alpha);
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
    this.bats  = Array.from({ length: 2 }, () => new Bat({ mode: 'wander' }));

    // Timers in frames (@60 fps)
    this.flockInTimer = 30;                          // first flock arrives quickly
    this.spookTimer   = floor(random(28, 55) * 60);
    this.batGroupTimer = floor(random(9, 17) * 60);
  }

  // ----------------------------------------------------------
  update() {
    // Remove birds that have flown off screen
    this.birds = this.birds.filter(b => !b.shouldRemove);
    this.bats  = this.bats.filter(b => !b.shouldRemove);

    const perched = this.birds.filter(b => b.state === 'PERCHED').length;
    const total   = this.birds.length;
    const t = env.timeOfDay;
    const isNight = t < 6.5 || t > 20.5;
    const isSunset = t >= 17.4 && t <= 20.3;
    const isEarlyNight = (t >= 20.5 && t <= 23.9) || (t >= 4.7 && t <= 6.3);
    const isStorm = env.currentWeather === 'storm';
    const cloudCover = constrain(env.cloudCover ?? 0.28, 0, 1);
    const blockFlocksForCloud = cloudCover >= 0.42;   // stop new arrivals before sky gets heavy
    const clearOutForCloud = cloudCover >= 0.56;      // force departure before dense overcast

    // --- Flock-in event ---
    this.flockInTimer--;
    if (this.flockInTimer <= 0) {
      if (!isNight && !isStorm && !blockFlocksForCloud && total < 5 && canopy && canopy.perchNodes.length > 0) {
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

    if (isStorm && this.birds.length > 0) {
      this._triggerSpook();
      this.flockInTimer = floor(random(25, 45) * 60);
    }
    if (clearOutForCloud && this.birds.length > 0) {
      this._triggerSpook();
      this.flockInTimer = floor(random(20, 40) * 60);
    }

    for (const b of this.birds) b.update();

    // Bat population: grow at night, trim by day
    const roamers = this.bats.filter(b => b.mode !== 'cross').length;
    if (isNight && roamers < 4 && random() < 0.0023) this.bats.push(new Bat({ mode: 'wander' }));
    if (!isNight && roamers > 2) {
      const idx = this.bats.findIndex(b => b.mode !== 'cross');
      if (idx >= 0) this.bats.splice(idx, 1);
    }

    this.batGroupTimer--;
    if (isEarlyNight && this.batGroupTimer <= 0) {
      this._spawnBatGroup();
      this.batGroupTimer = floor(random(8, 16) * 60);
    } else if (!isEarlyNight && this.batGroupTimer <= 0) {
      this.batGroupTimer = floor(random(18, 35) * 60);
    }

    for (const b of this.bats) b.update();
  }

  _nextBirdFlockDelaySec(isSunset) {
    if (isSunset) return random(8, 18);
    return random(20, 44);
  }

  _spawnBatGroup() {
    const count = floor(random(4, 10));
    const fromLeft = random() < 0.5;
    const sx = fromLeft ? -90 : width + 90;
    const syBase = random(height * 0.20, height * 0.64);
    const moon = window._ncvMoonState || { visible: false };
    const targetX = moon.visible && random() < 0.68
      ? moon.x + random(-26, 26)
      : (fromLeft ? width + 80 : -80);
    const targetY = moon.visible && random() < 0.68
      ? moon.y + random(-20, 22)
      : random(height * 0.18, height * 0.66);

    for (let i = 0; i < count; i++) {
      const px = sx + random(-28, 28);
      const py = syBase + random(-34, 34);
      const dir = createVector(targetX - px, targetY - py).normalize().mult(random(2.3, 4.1));
      this.bats.push(new Bat({
        mode: 'cross',
        x: px,
        y: py,
        vx: dir.x + random(-0.45, 0.45),
        vy: dir.y + random(-0.45, 0.45),
        size: random(18, 30),
        life: floor(random(320, 640)),
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
