// ============================================================
// canopy.js — Organic overhead canopy
//
// Driven by four env properties (all changes need rebuild()):
//   env.canopyCoverage (0–1)  how many trees / how far they reach
//   env.canopyDensity  (0–1)  leaves per branch (0 = bare, 1 = lush)
//   env.branchSpread   (0–1)  tight/columnar → wide/spreading
//   env.branchDepth    (3–5)  branching recursion levels
// ============================================================

class Canopy {
  constructor() {
    this.trees      = [];
    this.perchNodes = [];
    this._build();
  }

  get _maxDepth() { return Math.round(constrain(env.branchDepth, 3, 5)); }

  // ----------------------------------------------------------
  // Build — uses coverage to pick how many roots are active.
  // All 12 root positions are defined; coverage 0→1 activates
  // progressively more of them and scales branch length.
  // ----------------------------------------------------------
  _build() {
    this.trees = [];
    const h = height, w = width;

    // Full set of root positions — ordered so the first ones
    // give a well-balanced look even at low coverage.
    const ALL = [
      { x: -35,       y: h*0.80, a: -PI*0.14 },   // 1 left-low
      { x: w+35,      y: h*0.80, a: -PI*0.86 },   // 2 right-low
      { x: w*0.08,    y: -35,    a:  PI*0.46  },   // 3 top-left
      { x: w*0.92,    y: -35,    a:  PI*0.54  },   // 4 top-right
      { x: -35,       y: h*0.50, a: -PI*0.06  },   // 5 left-mid
      { x: w+35,      y: h*0.50, a: -PI*0.94  },   // 6 right-mid
      { x: -35,       y: h+35,   a: -PI*0.22  },   // 7 bot-left
      { x: w+35,      y: h+35,   a: -PI*0.78  },   // 8 bot-right
      { x: w*0.30,    y: -35,    a:  PI*0.48  },   // 9 top-centre-L
      { x: w*0.70,    y: -35,    a:  PI*0.52  },   // 10 top-centre-R
      { x: -35,       y: h*0.25, a: -PI*0.05  },   // 11 left-high
      { x: w+35,      y: h*0.25, a: -PI*0.95  },   // 12 right-high
    ];

    const coverage = constrain(env.canopyCoverage, 0, 1);
    const count    = Math.round(coverage * ALL.length);
    // At higher coverage branches also extend further into the frame
    const lenMult  = lerp(0.50, 1.20, coverage);

    for (let i = 0; i < count; i++) {
      const cfg  = ALL[i];
      const len  = h * 0.38 * lenMult;
      const root = this._makeNode(cfg.a, len, this._maxDepth);
      root.originX = cfg.x;
      root.originY = cfg.y;
      this._populate(root);
      this.trees.push(root);
    }
  }

  rebuild() { this._build(); }
  resize()  { this._build(); }

  // ----------------------------------------------------------
  // Create one branch node — all randomness baked here.
  // ----------------------------------------------------------
  _makeNode(baseAngle, len, depth) {
    const MD = this._maxDepth;

    // Structural organic variation
    const angleJitter = (Math.random() - 0.5) * 0.22;
    const dropFactor  = Math.random() * 0.09;
    const noisePhase  = Math.random() * 1000;

    // Leaf budget — scales from 0 (density=0) to many (density=1).
    // depthFromTip: 0 at outermost tips, MD at trunk.
    // Leaves concentrate toward tips but appear along all segments.
    const depthFromTip = MD - depth;
    const RAW = [0, 0, 1, 3, 6, 10]; // max leaves per node at each depth-from-tip
    const rawBudget = (RAW[depthFromTip] ?? 10) * env.canopyDensity;
    const leafCount = Math.floor(rawBudget + Math.random() * rawBudget * 0.7);

    const leaves = [];
    for (let i = 0; i < leafCount; i++) {
      const sz = (4 + Math.random() * 16) * map(depth, MD, 0, 0.28, 1.25);
      leaves.push({
        t:        0.18 + Math.random() * 0.82,   // position along segment
        perpOff:  (Math.random() - 0.5) * 34,    // lateral spread off branch
        // Ellipse axes — vary per-leaf for organic shape variety
        // Aspect changes from roundish (young tips) to elongated (mature)
        lw: sz * (0.7 + Math.random() * 1.1),
        lh: sz * (0.4 + Math.random() * 0.7),
        // Slow independent sway — max ~4 px
        phase:    Math.random() * Math.PI * 2,
        swaySpd:  0.002 + Math.random() * 0.005,
        swayAmt:  1.0   + Math.random() * 3.0,
        // Pre-baked per-leaf colour offsets — eliminates per-frame random()
        cr: Math.floor((Math.random() - 0.5) * 22),
        cg: Math.floor((Math.random() - 0.5) * 30),
        cb: Math.floor((Math.random() - 0.5) * 12),
        ca: Math.floor(Math.random() * 45),
        // Flag some leaves as "backlit" for day light-through effect
        backlit: Math.random() < 0.18,
      });
    }

    return {
      baseAngle, angleJitter, dropFactor, noisePhase,
      len, depth, leaves, children: [],
      perchable: depth === 1 || depth === 2,
      originX: 0, originY: 0,
      startX: 0, startY: 0, endX: 0, endY: 0,
      currentAngle: baseAngle,
    };
  }

  // ----------------------------------------------------------
  // Recursively attach children — asymmetric + spread-driven.
  // ----------------------------------------------------------
  _populate(node) {
    if (node.depth <= 0) return;
    const MD = this._maxDepth;

    const minS = lerp(0.14, 0.36, env.branchSpread);
    const maxS = lerp(0.28, 0.64, env.branchSpread);

    const childLen = node.len * (0.55 + Math.random() * 0.18);
    const sL = minS + Math.random() * (maxS - minS);
    const sR = minS + Math.random() * (maxS - minS);

    node.children.push(
      this._makeNode(node.baseAngle - sL, childLen,                              node.depth - 1),
      this._makeNode(node.baseAngle + sR, childLen * (0.86 + Math.random() * 0.20), node.depth - 1),
    );

    if (node.depth >= MD - 1 && Math.random() < 0.55) {
      node.children.push(this._makeNode(
        node.baseAngle + (Math.random() - 0.5) * 0.22,
        childLen * (0.50 + Math.random() * 0.20),
        node.depth - 1,
      ));
    }

    for (const c of node.children) this._populate(c);
  }

  // ----------------------------------------------------------
  // update() — must run before draw() and before flock.update()
  // ----------------------------------------------------------
  update() {
    const t = frameCount * (0.0018 + env.windSpeed * 0.004);
    this.perchNodes = [];
    for (const root of this.trees) {
      this._updateNode(root, root.originX, root.originY, t);
    }
  }

  _updateNode(node, sx, sy, t) {
    node.startX = sx;
    node.startY = sy;

    // Sway: tips move more than trunk (depthFactor amplifies outward)
    const depthFactor = 1 + (this._maxDepth - node.depth) * 0.28;
    const windAmp = (env.windSpeed * 0.28 +
                    (env.currentWeather === 'storm' ? env.windSpeed * 0.22 : 0))
                    * depthFactor;
    const sway  = (noise(node.noisePhase * 0.28, t) - 0.5) * 2 * windAmp;
    const droop = node.dropFactor * (this._maxDepth - node.depth) * 0.055;

    node.currentAngle = node.baseAngle + node.angleJitter + sway + droop;
    node.endX = sx + Math.cos(node.currentAngle) * node.len;
    node.endY = sy + Math.sin(node.currentAngle) * node.len;

    if (node.perchable) this.perchNodes.push(node);
    for (const c of node.children) this._updateNode(c, node.endX, node.endY, t);
  }

  // ----------------------------------------------------------
  // draw() — branches first pass, then leaves on top.
  // ----------------------------------------------------------
  draw() {
    for (const root of this.trees) this._drawBranch(root);
    for (const root of this.trees) this._drawLeaves(root);
  }

  // ----------------------------------------------------------
  // Branch — near-black silhouette, organic bezier.
  // ----------------------------------------------------------
  _drawBranch(node) {
    const MD = this._maxDepth;
    strokeWeight(map(node.depth, 0, MD, 2.0, 28));
    noFill();

    const isNight = env.timeOfDay < 6.5 || env.timeOfDay > 20.5;
    if (isNight) {
      stroke(4, 6, 10, 255);
    } else {
      const v = map(node.depth, 0, MD, 42, 10);
      stroke(v + 5, v + 2, v - 2, 255);
    }

    // Gravity-sag bezier
    const sagX = lerp(node.startX, node.endX, 0.5);
    const sagY = lerp(node.startY, node.endY, 0.5)
               + node.len * node.dropFactor * 1.6 + node.len * 0.012;

    beginShape();
    vertex(node.startX, node.startY);
    quadraticVertex(sagX, sagY, node.endX, node.endY);
    endShape();

    for (const c of node.children) this._drawBranch(c);
  }

  // ----------------------------------------------------------
  // Leaves — ellipse shapes, light-through effect at midday,
  // dark silhouette at night. Zero random() calls here.
  // ----------------------------------------------------------
  _drawLeaves(node) {
    if (node.leaves.length > 0) {
      noStroke();

      const tod = env.timeOfDay;
      const isNight     = tod < 6.5 || tod > 20.5;
      const isTwilight  = (tod >= 5.5 && tod < 7) || (tod > 19 && tod < 21);
      const isDawn      = tod < 13;

      // Base colour for the majority of leaves
      let br, bg, bb, ba;

      if (isNight) {
        // Pure dark silhouette — no green at all at night
        br = 5; bg = 14; bb = 8; ba = 230;

      } else if (isTwilight) {
        const frac = isDawn ? (tod - 5.5) / 1.5 : (21 - tod) / 2;
        br = lerp(140, 30, frac);
        bg = lerp( 88, 70, frac);
        bb = 16;
        ba = 195;

      } else {
        // Daytime — peak brightness at solar noon (tod=13)
        const sun  = 1 - abs(tod - 13) / 7;  // 0 at dawn/dusk, 1 at noon
        br = 24 + sun * 22;
        bg = 68 + sun * 46;
        bb = 12 + sun * 8;
        ba = 200;
      }

      const ft = frameCount;

      for (const lf of node.leaves) {
        // Position along branch + perpendicular spread
        const lx = lerp(node.startX, node.endX, lf.t);
        const ly = lerp(node.startY, node.endY, lf.t);
        const pa = node.currentAngle + HALF_PI;
        const px = lx + Math.cos(pa) * lf.perpOff;
        const py = ly + Math.sin(pa) * lf.perpOff;

        // Very gentle breeze — max ~4 px
        const sx = Math.sin(ft * lf.swaySpd       + lf.phase) * lf.swayAmt;
        const sy = Math.sin(ft * lf.swaySpd * 0.7 + lf.phase + 1.1) * lf.swayAmt * 0.35;

        // Light-through-leaves: some leaves during bright day are
        // semi-transparent yellow-green (backlit by sky)
        let lr, lg, lb, la;
        if (!isNight && !isTwilight && lf.backlit) {
          const sun = 1 - abs(tod - 13) / 7;
          lr = lerp(br, 180, sun * 0.6);  // warmer, yellower
          lg = lerp(bg, 210, sun * 0.5);
          lb = lerp(bb,  60, sun * 0.4);
          la = lerp(ba,  90, sun * 0.55); // more transparent — sky shows through
        } else {
          lr = constrain(br + lf.cr, 0, 255);
          lg = constrain(bg + lf.cg, 0, 255);
          lb = constrain(bb + lf.cb, 0, 255);
          la = constrain(ba - lf.ca, 55, 255);
        }

        fill(lr, lg, lb, la);
        ellipse(px + sx, py + sy, lf.lw, lf.lh);
      }
    }

    for (const c of node.children) this._drawLeaves(c);
  }
}
