// ============================================================
// canopy.js — Organic overhead canopy
//
// Performance architecture for ceiling projection:
//   • Leaf layer rendered into a 70 % resolution offscreen buffer.
//     Bilinear upscaling on composite gives natural canopy softness
//     without per-leaf blur — ideal for projector optics.
//   • perspectiveScale / edgeLushFactor / cos+sin of branch angle
//     cached once per branch node (not once per leaf), cutting
//     those calls from ~60 k/frame down to ~420/frame.
//   • shadowBlur set once for the entire leaf pass, not per node.
//   • All time-of-day / quality / flash state computed once per frame.
//   • Bird-avoidance physics skipped when no birds are present.
//   • Leaf budget reduced ~40 %; leaf size increased proportionally
//     so visual density is unchanged.
//
// Driven by env properties (all changes need rebuild()):
//   env.canopyCoverage (0–1)  how far branches reach into frame
//   env.canopyTreeCount(0–1)  how many trees are spawned
//   env.canopyDensity  (0–1)  leaves per branch (0 = bare, 1 = lush)
//   env.branchSpread   (0–1)  tight/columnar → wide/spreading
//   env.branchDepth    (3–5)  branching recursion levels
// ============================================================

class Canopy {
  constructor() {
    this.trees      = [];
    this.perchNodes = [];
    this._leafBuf   = null; // p5.Graphics offscreen leaf buffer
    this._build();
  }

  get _maxDepth() { return Math.round(constrain(env.branchDepth, 3, 5)); }
  _treeSkyOpen()      { return constrain(env.treeSkyOpen ?? (1 - (env.canopyCoverage ?? 0.45)), 0, 1); }
  _treeFrameDensity() { return constrain(env.treeFrameDensity ?? env.canopyTreeCount ?? 0.5, 0, 1); }
  _treeFoliageMass()  { return constrain(env.treeFoliageMass ?? env.canopyDensity ?? 0.45, 0, 1); }
  _treeBranchReach()  { return constrain(env.treeBranchReach ?? env.canopyCoverage ?? 0.45, 0, 1); }
  _treeBranchChaos()  { return constrain(env.treeBranchChaos ?? env.branchSpread ?? 0.52, 0, 1); }

  // ----------------------------------------------------------
  // Build — perimeter-rooted layers to preserve "looking up" feel:
  // all trunks start from edge/offscreen ring and grow inward.
  // ----------------------------------------------------------
  _build() {
    this.trees = [];
    const h = height, w = width;

    const reach     = this._treeBranchReach();
    const treeCount = this._treeFrameDensity();
    const treeK     = Math.pow(treeCount, 1.22); // better sparse control at low slider values

    // Edge-rooted placement: trunks start offscreen and grow inward.
    const outerCount = Math.round(lerp(6, 30, treeK));
    const outerRoots = this._makeEdgeRoots(outerCount, 100, 240, 0.74, 1.34, 1.0);

    const midCount = Math.round(lerp(2, 16, treeK));
    const midRoots = this._makeEdgeRoots(midCount, 30, 120, 0.82, 1.02, 0.84);

    // Side-fill ring: shorter trees near screen edges to keep foliage present
    // along the full perimeter outside the sky opening.
    const sideFillCount = treeK < 0.18 ? 0 : Math.round(lerp(0, 12, treeK));
    const sideFillRoots = this._makeEdgeRoots(sideFillCount, 6, 62, 0.90, 0.86, 0.72);

    const roots = [...sideFillRoots, ...midRoots, ...outerRoots];
    for (const cfg of roots) {
      const lenMult   = lerp(0.36, 1.14, reach) * cfg.layerLen;
      const len       = h * 0.38 * lenMult;
      const edgeBoost = 1 + constrain(env.canopyEdgeLushness ?? 0.75, 0, 1) * cfg.edgeAffinity * 1.35;
      const root      = this._makeNode(cfg.a, len, this._maxDepth, edgeBoost);
      root.originX    = cfg.x;
      root.originY    = cfg.y;
      this._populate(root);
      this._annotateLeafPresence(root);
      this.trees.push(root);
    }

    // Invalidate leaf buffer whenever tree structure changes.
    if (this._leafBuf) { this._leafBuf.remove(); this._leafBuf = null; }
  }

  // ----------------------------------------------------------
  // Places trees just outside each screen edge and points them inward.
  // This avoids center-origin artifacts and preserves a "look up" frame.
  // ----------------------------------------------------------
  _makeEdgeRoots(count, offMin, offMax, inwardAim, layerLen, edgeAffinity) {
    if (count <= 0) return [];
    const w = width;
    const h = height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const roots  = [];
    const branchChaos = this._treeBranchChaos();
    const angularJitter = lerp(0.10, 0.26, branchChaos);
    const sideCounts = [0, 0, 0, 0];
    const base = Math.floor(count / 4);
    let rem = count - base * 4;
    for (let s = 0; s < 4; s++) {
      sideCounts[s] = base + (rem > 0 ? 1 : 0);
      rem -= rem > 0 ? 1 : 0;
    }

    // Build each side with stratified spacing so canopy doesn't clump.
    for (let side = 0; side < 4; side++) {
      const n = sideCounts[side];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const jitter = (Math.random() - 0.5) * (1 / Math.max(3, n)) * 0.70;
        const tj = constrain(t + jitter, 0.04, 0.96);
        const off = random(offMin, offMax);
        let x = 0;
        let y = 0;
        let normalAngle = 0;

        if (side === 0) {
          x = lerp(-w * 0.07, w * 1.07, tj);
          y = -off;
          normalAngle = HALF_PI;
        } else if (side === 1) {
          x = w + off;
          y = lerp(-h * 0.07, h * 1.07, tj);
          normalAngle = PI;
        } else if (side === 2) {
          x = lerp(-w * 0.07, w * 1.07, tj);
          y = h + off;
          normalAngle = -HALF_PI;
        } else {
          x = -off;
          y = lerp(-h * 0.07, h * 1.07, tj);
          normalAngle = 0;
        }

        const centerAngle = atan2(cy - y, cx - x);
        const tangent = centerAngle + (Math.random() < 0.5 ? -HALF_PI : HALF_PI);
        const tangentMix = 0.16 + Math.random() * 0.18;
        const inwardArc = lerp(centerAngle, tangent, tangentMix);
        const finalAngle = lerp(normalAngle, inwardArc, inwardAim) + random(-angularJitter, angularJitter);
        
        roots.push({ x, y, a: finalAngle, layerLen, edgeAffinity });
      }
    }
    return roots;
  }

  rebuild() { this._build(); }
  resize()  { if (this._leafBuf) { this._leafBuf.remove(); this._leafBuf = null; } this._build(); }

  // ----------------------------------------------------------
  // Create one branch node — all randomness baked at build time.
  // Now uses 'clumps' (larger blobs) instead of individual leaves
  // for massive performance gains.
  // ----------------------------------------------------------
  _makeNode(baseAngle, len, depth, leafBoost = 1) {
    const MD = this._maxDepth;
    const foliage = this._treeFoliageMass();
    const angleJitter = (Math.random() - 0.5) * 0.22;
    const dropFactor  = Math.random() * 0.09;
    const noisePhase  = Math.random() * 1000;

    // depthFromTip: 0 at trunk, MD at outermost tips.
    const depthFromTip = MD - depth;
    
    // Smooth density response: avoid hard "none -> overload" jumps.
    const densityK = Math.pow(constrain(foliage, 0, 1), 0.78); // expands low-mid range
    const RAW      = [0.45, 0.70, 1.00, 1.35, 1.70, 2.20];
    const rawBase  = (RAW[depthFromTip] ?? 1.8) * leafBoost;
    const clumpFloat = rawBase * (0.24 + densityK * 0.96) * (0.86 + Math.random() * 0.24);
    let count = Math.floor(clumpFloat);
    if (Math.random() < (clumpFloat - count)) count += 1; // fractional carry for smooth stepping

    // Keep tips from going completely bald at non-zero foliage.
    if (depth <= 1 && foliage > 0.16) count = Math.max(1, count);
    if (foliage < 0.06) count = 0;

    const clumps = [];
    for (let i = 0; i < count; i++) {
      // Larger clumps with stronger variation.
      const baseSz = (30 + Math.random() * 50) * map(depth, MD, 0, 0.42, 1.52);
      const sz = baseSz * (0.82 + densityK * 0.86); // smoother size progression
      
      clumps.push({
        t:       0.25 + Math.random() * 0.75,   // position along segment
        perpOff: (Math.random() - 0.5) * 52,    // lateral spread
        lw: sz * (1.1 + Math.random() * 0.8),
        lh: sz * (0.7 + Math.random() * 0.6),
        stretch: 0.75 + Math.random() * 0.95,   // along-branch elongation
        skew:    (Math.random() - 0.5) * 0.85,  // branch-side skew
        lobeMix: 0.45 + Math.random() * 0.45,   // lobe size variation
        polySides: 7 + Math.floor(Math.random() * 5), // 7..11
        polyNoise: 0.30 + Math.random() * 0.45,
        polyRot:   Math.random() * TWO_PI,
        alphaMul:  0.80 + Math.random() * 0.35,
        overlap:   Math.random() < 0.28,
        overlapDX: (Math.random() - 0.5) * 0.9,
        overlapDY: (Math.random() - 0.5) * 0.9,
        overlapScale: 0.42 + Math.random() * 0.30,
        overlapAlpha: 0.55 + Math.random() * 0.37,
        overlapRot: (Math.random() - 0.5) * 0.7,
        pepperCount: 1 + Math.floor(Math.random() * 3),
        pepper: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
          x: (Math.random() - 0.5) * 2.1,
          y: (Math.random() - 0.5) * 2.1,
          sz: 0.55 + Math.random() * 1.15,
          alpha: 0.35 + Math.random() * 0.55,
          type: Math.random() < 0.68 ? 'ellipse' : 'poly',
          rot: Math.random() * TWO_PI,
          sides: 5 + Math.floor(Math.random() * 3),
          sx: 0.7 + Math.random() * 0.7,
          sy: 0.7 + Math.random() * 0.8,
          swayAmt: 0.35 + Math.random() * 0.65,
          swaySpd: 0.0008 + Math.random() * 0.0022,
          swayPhase: Math.random() * TWO_PI,
        })),
        layer:   Math.random() < 0.42 ? 'back' : 'front',
        // Independent slow sway
        phase:   Math.random() * Math.PI * 2,
        swaySpd: 0.001 + Math.random() * 0.003,
        swayAmt: 2.0   + Math.random() * 4.0,
        // Pre-baked per-clump colour offsets
        cr: Math.floor((Math.random() - 0.5) * 15),
        cg: Math.floor((Math.random() - 0.5) * 20),
        cb: Math.floor((Math.random() - 0.5) * 10),
        ca: Math.floor(Math.random() * 30),
        // Backlit clumps: more transparent
        backlit: Math.random() < 0.22,
        seed: Math.random() * 10000,
      });
    }

    return {
      baseAngle, angleJitter, dropFactor, noisePhase,
      len, depth, leafBoost, leaves: clumps, children: [], // kept 'leaves' key for compatibility
      perchable: depth === 1 || depth === 2,
      originX: 0, originY: 0,
      startX: 0, startY: 0, endX: 0, endY: 0,
      currentAngle: baseAngle,
    };
  }

  // ----------------------------------------------------------
  // Recursively attach children — asymmetric + spread-driven with
  // extra randomization so limb lengths and branch counts vary more.
  // ----------------------------------------------------------
  _populate(node) {
    if (node.depth <= 0) return;
    const MD   = this._maxDepth;
    const branchChaos = this._treeBranchChaos();
    const minS = lerp(0.10, 0.34, branchChaos);
    const maxS = lerp(0.24, 0.78, branchChaos);

    const childLenBase = node.len * (0.44 + Math.random() * 0.46);
    const sL = minS + Math.random() * (maxS - minS);
    const sR = minS + Math.random() * (maxS - minS);

    // Core split: allow strong asymmetry and long/short outliers.
    const lenL = childLenBase * (0.60 + Math.random() * 0.95);
    const lenR = childLenBase * (0.58 + Math.random() * 1.00);
    node.children.push(this._makeNode(
      node.baseAngle - sL,
      lenL,
      node.depth - 1,
      node.leafBoost * (0.93 + Math.random() * 0.06),
    ));
    node.children.push(this._makeNode(
      node.baseAngle + sR,
      lenR,
      node.depth - 1,
      node.leafBoost * (0.93 + Math.random() * 0.06),
    ));

    // Extra fork (common near trunks, less common near tips).
    const extraForkChance = node.depth >= MD - 1 ? 0.30 : (node.depth >= 2 ? 0.13 : 0.05);
    if (Math.random() < extraForkChance) {
      node.children.push(this._makeNode(
        node.baseAngle + (Math.random() - 0.5) * 0.22,
        childLenBase * (0.30 + Math.random() * 1.05),
        node.depth - 1,
        node.leafBoost * (0.88 + Math.random() * 0.10),
      ));
    }

    // Occasional tiny twig or long reaching limb for natural irregularity.
    if (node.depth >= 3 && Math.random() < 0.07) {
      const sign = Math.random() < 0.5 ? -1 : 1;
      const twigSpread = minS + Math.random() * (maxS * 0.75);
      const longOrShort = Math.random() < 0.5 ? 0.26 + Math.random() * 0.22 : 1.05 + Math.random() * 0.35;
      node.children.push(this._makeNode(
        node.baseAngle + sign * twigSpread,
        childLenBase * longOrShort,
        node.depth - 1,
        node.leafBoost * (0.82 + Math.random() * 0.12),
      ));
    }

    for (const c of node.children) this._populate(c);
  }

  _annotateLeafPresence(node) {
    let score = node.leaves.length;
    for (const c of node.children) score += this._annotateLeafPresence(c);
    node.leafScore = score;
    return score;
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

  _perspectiveScale(x, y) {
    const p     = constrain(env.canopyPerspective ?? 0.72, 0, 1);
    const d     = dist(x, y, width * 0.5, height * 0.5);
    const edgeT = constrain(d / (min(width, height) * 0.70), 0, 1);
    return lerp(1, lerp(0.72, 1.42, edgeT), p);
  }

  _edgeLushFactor(x, y) {
    const lush    = constrain(env.canopyEdgeLushness ?? 0.75, 0, 1);
    const edgeDist = Math.min(x, width - x, y, height - y);
    const t       = 1 - constrain(edgeDist / (min(width, height) * 0.24), 0, 1);
    return 1 + lush * t * 0.65;
  }

  _centerVoidFactor(x, y) {
    const skyOpen  = this._treeSkyOpen();
    const minDim   = Math.min(width, height);
    // Larger, slightly oval opening with stable irregular edge.
    const baseR = lerp(minDim * 0.24, minDim * 0.56, skyOpen);
    const rx    = baseR * 1.10;
    const ry    = baseR * 0.90;
    const dx    = x - width * 0.5;
    const dy    = y - height * 0.5;
    const ang   = Math.atan2(dy, dx);
    const edgeNoise =
      (noise(Math.cos(ang) * 1.25 + 9.2, Math.sin(ang) * 1.25 + 21.7) - 0.5) * 0.26 +
      (noise(Math.cos(ang * 2.0) * 0.9 + 40.3, Math.sin(ang * 2.0) * 0.9 + 11.4) - 0.5) * 0.14;
    const wobble = 1 + edgeNoise;
    const e = Math.sqrt((dx / (rx * wobble)) ** 2 + (dy / (ry * wobble)) ** 2);
    const feather = 0.44;
    return constrain((e - 1) / feather, 0, 1);
  }

  // ----------------------------------------------------------
  // draw() — some leaves behind branches, some in front.
  // ----------------------------------------------------------
  draw() {
    this._drawLeafPass('back');
    for (const root of this.trees) this._drawBranch(root);
    this._drawLeafPass('front');
  }

  // ----------------------------------------------------------
  // Branch — near-black silhouette, organic bezier.
  // ----------------------------------------------------------
  _drawBranch(node, isRoot = true) {
    const MD  = this._maxDepth;
    
    const mx  = (node.startX + node.endX) * 0.5;
    const my  = (node.startY + node.endY) * 0.5;
    const persp = this._perspectiveScale(mx, my);
    const centerK = this._centerVoidFactor(mx, my);
    if (centerK < 0.08) return;
    const leafScore = node.leafScore ?? node.leaves.length;
    if (leafScore <= 0 && centerK < 0.65) return;

    strokeWeight(map(node.depth, 0, MD, 2.0, 28) * persp * (0.35 + centerK * 0.65));
    noFill();

    const isNight = env.timeOfDay < 6.5 || env.timeOfDay > 20.5;
    const flashK  = constrain((window._ncvFlashAlpha || 0) / 255, 0, 1);
    if (isNight) {
      const vv = lerp(5, 0, flashK * 0.95);
      stroke(vv, vv, vv, 255);
    } else {
      const v  = map(node.depth, 0, MD, 58, 24);
      const vd = v * (1 - flashK * 0.2);
      stroke(vd + 5, vd + 2, vd - 2, 255);
    }

    const sagX = lerp(node.startX, node.endX, 0.5);
    const sagY = lerp(node.startY, node.endY, 0.5)
               + node.len * node.dropFactor * 1.6 + node.len * 0.012;

    beginShape();
    vertex(node.startX, node.startY);
    quadraticVertex(sagX, sagY, node.endX, node.endY);
    endShape();

    for (const c of node.children) this._drawBranch(c, false);
  }

  // ----------------------------------------------------------
  // Leaf pass — renders leaf layer to a resolution-scaled offscreen
  // buffer, then composites at full size. The bilinear upscaling
  // provides a natural canopy softness without per-leaf blur cost.
  // ----------------------------------------------------------
  _drawLeafPass(layer = 'front') {
    const q = constrain(window._ncvQualityScale ?? 1, 0.45, 1);
    
    // Dynamic resolution based on quality scale — 70% down to 35%
    const resScale = 0.70 * q;
    const bufW = Math.floor(width  * resScale);
    const bufH = Math.floor(height * resScale);
    
    if (!this._leafBuf || this._leafBuf.width !== bufW || this._leafBuf.height !== bufH) {
      if (this._leafBuf) this._leafBuf.remove();
      this._leafBuf = createGraphics(bufW, bufH);
      this._leafBuf.colorMode(RGB, 255, 255, 255, 255);
    }

    const g = this._leafBuf;
    g.clear();
    g.noStroke();

    // Occluders — pre-sliced once, bird-physics fully skipped when absent.
    const rawOcc    = window._ncvBirdOccluders || [];
    const hasOcc    = rawOcc.length > 0;
    const occluders = hasOcc ? rawOcc.slice(0, Math.max(2, Math.floor(10 * q))) : [];

    // Time-of-day state — identical for every leaf this frame.
    const tod        = env.timeOfDay;
    const isNight    = tod < 6.5 || tod > 20.5;
    const isTwilight = (tod >= 5.5 && tod < 7) || (tod > 19 && tod < 21);
    const isDawn     = tod < 13;
    const sun        = (!isNight && !isTwilight) ? (1 - abs(tod - 13) / 7) : 0;
    const flashK     = constrain((window._ncvFlashAlpha || 0) / 255, 0, 1);
    const ft         = frameCount;
    
    // Adaptive stepping: 1 (high q), 2 (mid q), 3 (low q)
    const step       = q < 0.6 ? 3 : (q < 0.85 ? 2 : 1);

    // Base colour computed once for the entire frame.
    let br, bg, bb, ba;
    if (isNight) {
      // Night canopy should read as a dense dark silhouette, not fade away.
      br = 3; bg = 8; bb = 4; ba = 255;
    } else if (isTwilight) {
      const frac = isDawn ? (tod - 5.5) / 1.5 : (21 - tod) / 2;
      // Keep foliage clearly visible at dawn/dusk while still warm-toned.
      br = lerp(132, 42, frac);
      bg = lerp(104, 82, frac);
      bb = lerp(34, 18, frac);
      ba = 238;
    } else {
      br = 24 + sun * 22;
      bg = 68 + sun * 46;
      bb = 12 + sun * 8;
      ba = 200;
    }

    g.push();
    g.scale(resScale);

    const leafSoft = constrain((env.leafSoftness ?? 0.6) * q, 0, 3);
    g.drawingContext.shadowBlur  = leafSoft;
    g.drawingContext.shadowColor = `rgba(20,30,20,${(0.22 + leafSoft * 0.04).toFixed(2)})`;

    for (const root of this.trees) {
      this._drawLeavesNode(g, root, br, bg, bb, ba,
        isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer);
    }

    g.pop();

    drawingContext.imageSmoothingEnabled = true;
    drawingContext.imageSmoothingQuality = q > 0.8 ? 'medium' : 'low';
    image(g, 0, 0, width, height);
  }

  _drawLeavesNode(g, node, br, bg, bb, ba,
                  isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer) {
    
    // Simple on-screen check for branch bounding box
    const margin = 100;
    const minX = Math.min(node.startX, node.endX) - margin;
    const maxX = Math.max(node.startX, node.endX) + margin;
    const minY = Math.min(node.startY, node.endY) - margin;
    const maxY = Math.max(node.startY, node.endY) + margin;
    
    const isOffScreen = maxX < 0 || minX > width || maxY < 0 || minY > height;

    if (!isOffScreen && node.leaves.length > 0) {
      const mx       = (node.startX + node.endX) * 0.5;
      const my       = (node.startY + node.endY) * 0.5;
      const persp    = this._perspectiveScale(mx, my);
      const edgeLush = this._edgeLushFactor(mx, my);

      const escR = lerp(1, 1.18, edgeLush - 1);
      const escG = lerp(1, 1.26, edgeLush - 1);
      const escA = lerp(1, 1.10, edgeLush - 1);

      const pa    = node.currentAngle + HALF_PI;
      const ba    = node.currentAngle;
      const cosPa = Math.cos(pa);
      const sinPa = Math.sin(pa);
      const cosBa = Math.cos(ba);
      const sinBa = Math.sin(ba);

      for (let i = 0; i < node.leaves.length; i += step) {
        const lf = node.leaves[i];
        if (lf.layer !== layer) continue;
        const lx = lerp(node.startX, node.endX, lf.t);
        const ly = lerp(node.startY, node.endY, lf.t);
        const px = lx + cosPa * lf.perpOff;
        const py = ly + sinPa * lf.perpOff;
        const sx = Math.sin(ft * lf.swaySpd       + lf.phase) * lf.swayAmt;
        const sy = Math.sin(ft * lf.swaySpd * 0.7 + lf.phase + 1.1) * lf.swayAmt * 0.35;

        let bx = 0, by = 0;
        if (hasOcc) {
          for (const o of occluders) {
            const dx = (px + sx) - o.x;
            const dy = (py + sy) - o.y;
            const d2 = dx * dx + dy * dy;
            const r2 = o.r * o.r;
            if (d2 >= r2 || d2 < 1) continue;
            const f   = (1 - d2 / r2) * 3.5;
            const inv = 1 / Math.sqrt(d2);
            bx += dx * inv * f;
            by += dy * inv * f;
          }
        }

        let lr, lg, lb, la;
        if (!isNight && !isTwilight && lf.backlit) {
          lr = lerp(br, 180, sun * 0.6);
          lg = lerp(bg, 210, sun * 0.5);
          lb = lerp(bb,  60, sun * 0.4);
          la = lerp(ba,  90, sun * 0.55);
        } else {
          lr = (br + lf.cr) * escR;
          lg = (bg + lf.cg) * escG;
          lb = (bb + lf.cb);
          la = (ba - lf.ca) * escA;
        }

        if (isNight) {
          // Clamp night leaves to solid dark tones and strong opacity.
          lr = Math.min(lr, 8);
          lg = Math.min(lg, 14);
          lb = Math.min(lb, 10);
          la = Math.max(la, 242);
        }

        if (isNight && flashK > 0) {
          lr = lerp(lr, 0, flashK * 0.95);
          lg = lerp(lg, 0, flashK * 0.95);
          lb = lerp(lb, 0, flashK * 0.95);
        }

        const fx = px + sx + bx;
        const fy = py + sy + by;
        const centerK = this._centerVoidFactor(fx, fy);
        if (centerK < 0.03) continue;

        const sizeK = 0.76 + centerK * 0.40;
        const wMain = lf.lw * persp * sizeK;
        const hMain = lf.lh * persp * sizeK;
        const along = wMain * (0.18 + lf.stretch * 0.24);
        const side  = hMain * lf.skew * 0.28;
        const lobeW = wMain * lf.lobeMix;
        const lobeH = hMain * (0.72 + lf.lobeMix * 0.25);
        const layerAlpha = layer === 'back' ? 0.90 : 1.0;

        // Branch-influenced polygon clump (cheap irregular blob).
        const cxp = fx + cosBa * along * 0.24 + cosPa * side * 0.25;
        const cyp = fy + sinBa * along * 0.24 + sinPa * side * 0.25;
        const rx = Math.max(3, (wMain * (0.72 + lf.lobeMix * 0.52)) * 0.5);
        const ry = Math.max(3, (hMain * (0.78 + lf.lobeMix * 0.48)) * 0.5);
        const alphaBaseRaw = la * centerK * layerAlpha * lf.alphaMul;
        const minAlpha = (isNight ? 182 : 108) * (0.35 + centerK * 0.65);
        const aBase = Math.max(alphaBaseRaw, minAlpha);

        g.fill(lr, lg, lb, aBase);
        g.push();
        g.translate(cxp, cyp);
        g.rotate(ba + lf.skew * 0.7);
        g.beginShape();
        const pts = [];
        for (let k = 0; k < lf.polySides; k++) {
          const t = (k / lf.polySides) * TWO_PI + lf.polyRot;
          const n = 1 + Math.sin(t * 2.6 + lf.phase) * lf.polyNoise;
          const px = Math.cos(t) * rx * n;
          const py = Math.sin(t) * ry * (1 + Math.cos(t * 1.9 + lf.phase) * lf.polyNoise * 0.7);
          pts.push([px, py]);
        }
        // Rounded polygon feel via curveVertex loop closure.
        g.curveVertex(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        for (let k = 0; k < pts.length; k++) g.curveVertex(pts[k][0], pts[k][1]);
        g.curveVertex(pts[0][0], pts[0][1]);
        g.curveVertex(pts[1][0], pts[1][1]);
        g.endShape(CLOSE);
        g.pop();

        // Occasional overlapping sibling clump.
        if (lf.overlap) {
          const ovSway = Math.sin(ft * (0.0011 + lf.swaySpd * 0.35) + lf.phase) * 0.18;
          const ox = cxp + cosBa * rx * (lf.overlapDX + ovSway) + cosPa * ry * lf.overlapDY;
          const oy = cyp + sinBa * rx * (lf.overlapDX + ovSway) + sinPa * ry * lf.overlapDY;
          g.fill(lr, lg, lb, aBase * lf.overlapAlpha);
          g.push();
          g.translate(ox, oy);
          g.rotate(ba + lf.skew * 0.6 + lf.overlapRot);
          g.beginShape();
          const s = Math.max(6, lf.polySides - 1);
          const rr = rx * lf.overlapScale;
          for (let k = 0; k < s; k++) {
            const t = (k / s) * TWO_PI + lf.polyRot * 0.7;
            const n = 1 + Math.sin(t * 2.1 + lf.phase + 1.3) * lf.polyNoise * 0.8;
            const sy = 0.82 + Math.sin(lf.seed * 0.02 + k * 1.9) * 0.18;
            g.vertex(Math.cos(t) * rr * n, Math.sin(t) * rr * n * sy);
          }
          g.endShape(CLOSE);
          g.pop();
        }

        // Peppered secondary leaves around the clump.
        for (let p = 0; p < lf.pepper.length; p++) {
          const pp = lf.pepper[p];
          const ps = Math.sin(ft * pp.swaySpd + pp.swayPhase) * pp.swayAmt;
          const px = cxp + pp.x * rx + cosBa * ps * 1.6;
          const py = cyp + pp.y * ry + sinBa * ps * 1.6;
          const pr = (2.2 + pp.sz * 4.6) * persp;
          g.fill(lr, lg, lb, aBase * pp.alpha);
          if (pp.type === 'ellipse') {
            g.ellipse(px, py, pr * (1.2 + pp.sx * 1.4), pr * (0.9 + pp.sy * 1.1));
          } else {
            g.push();
            g.translate(px, py);
            g.rotate(pp.rot + ps * 0.08);
            g.beginShape();
            for (let k = 0; k < pp.sides; k++) {
              const t = (k / pp.sides) * TWO_PI;
              const rr = pr * (0.75 + Math.sin(pp.swayPhase + k * 1.7) * 0.18);
              g.vertex(Math.cos(t) * rr * pp.sx, Math.sin(t) * rr * pp.sy);
            }
            g.endShape(CLOSE);
            g.pop();
          }
        }
      }
    }

    // CRITICAL: Always recurse into children so off-screen parent segments
    // don't cull their on-screen descendants.
    for (const c of node.children) {
      this._drawLeavesNode(g, c, br, bg, bb, ba,
        isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer);
    }
  }
}
