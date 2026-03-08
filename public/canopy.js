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
    this.trees        = [];
    this.perchNodes   = [];
    this._leafBuf     = null; // p5.Graphics offscreen leaf buffer
    this._leafStep    = 1;    // stabilized LOD step to avoid frame-to-frame popping
    this._bgLeafData  = [];   // pre-baked background leaf clusters (static, edge-anchored)
    this._bgLeafBuf   = null; // cached blurred edge foliage layer
    this._bgLeafKey   = '';   // cache key for edge foliage appearance
    this._gust = {
      active: false,
      dir: 1,
      progress: 0,
      speed: 0.006,
      amp: 0,
      width: 180,
    };
    this._plantNames = ['Oak', 'Maple', 'Birch', 'Beech', 'Pine', 'Cedar', 'Willow', 'Aspen'];
    this._build();
  }

  get _maxDepth() { return Math.round(constrain(env.branchDepth, 3, 5)); }
  _treeSkyOpen()      { return constrain(env.treeSkyOpen ?? 1.0, 1.0, 1.5); }
  _treeFrameDensity() { return constrain(env.treeFrameDensity ?? 10, 4, 16); }
  _treeFoliageMass()  { return constrain(env.treeFoliageMass ?? 0.45, 0, 1); }
  _treeBranchReach()  { return constrain(env.treeBranchReach ?? 0.45, 0, 1); }
  _treeBranchChaos()  { return constrain(env.treeBranchChaos ?? 0.52, 0, 1); }
  _smoothstep(a, b, x) {
    if (b <= a) return x >= b ? 1 : 0;
    const t = constrain((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  _dayOfYear(dt) {
    const start = new Date(dt.getFullYear(), 0, 0);
    return Math.floor((dt - start) / 86400000);
  }
  _autoSeasonState() {
    const dRaw = env.liveDateISO ? new Date(env.liveDateISO) : new Date();
    const d = Number.isFinite(dRaw.getTime()) ? dRaw : new Date();
    const lat = Number(env.liveLocationLat);
    const hasLat = Number.isFinite(lat);
    const absLat = hasLat ? Math.abs(lat) : 0;
    const hemiSouth = hasLat && lat < 0;

    // Convert SH day-of-year into NH equivalent so one phenology curve works for both hemispheres.
    let doyN = this._dayOfYear(d);
    if (hemiSouth) {
      doyN += 182;
      while (doyN > 365) doyN -= 365;
    }

    // Latitude-aware phenology:
    //  - tropical/subtropical: evergreen
    //  - mild temperate: mostly evergreen with modest seasonal dip
    //  - cold temperate/boreal: strong leaf-off winter
    if (absLat <= 24) {
      return { key: 'tropical', leafK: 1.0, absLat };
    }

    let springStart, springFull, fallStart, fallBare;
    if (absLat < 40) {
      springStart = 58 + absLat * 0.55;
      springFull  = springStart + 34;
      fallStart   = 258 + absLat * 0.10;
      fallBare    = fallStart + 48;
    } else if (absLat < 50) {
      springStart = 56 + absLat * 0.75;
      springFull  = springStart + 46;
      fallStart   = 246 + absLat * 0.20;
      fallBare    = fallStart + 52;
    } else {
      springStart = 56 + absLat * 0.95;   // Seattle/Anchorage-like delay
      springFull  = springStart + (62 - absLat * 0.32);
      fallStart   = 236 + absLat * 0.28;
      fallBare    = fallStart + (58 - absLat * 0.20);
    }

    const springK = this._smoothstep(springStart, springFull, doyN);
    const fallK   = this._smoothstep(fallStart, fallBare, doyN);
    let leafK   = constrain(springK * (1 - fallK), 0, 1);
    if (absLat < 40) leafK = Math.max(0.72, leafK);
    else if (absLat < 50) leafK = Math.max(0.42, leafK);

    let key = 'winter';
    if (leafK <= 0.08) key = 'winter';
    else if (springK < 0.96) key = 'spring';
    else if (doyN >= 212 && doyN < fallStart) key = 'late_summer';
    else if (doyN >= fallStart && leafK < 0.98) key = 'fall';
    else key = 'summer';

    return { key, leafK, absLat };
  }
  _seasonKey() {
    const s = (env.season || 'auto').toLowerCase();
    if (s === 'spring' || s === 'summer' || s === 'fall' || s === 'winter') return s;
    const lat = Number(env.liveLocationLat);
    if (Number.isFinite(lat) && Math.abs(lat) <= 18) return 'tropical';
    return this._autoSeasonState().key;
  }
  _seasonProfile() {
    const seasonMode = (env.season || 'auto').toLowerCase();
    const autoState = seasonMode === 'auto' ? this._autoSeasonState() : null;
    const k = autoState ? autoState.key : this._seasonKey();
    if (k === 'tropical') {
      return { key: 'tropical', leafAmount: 1.0, leafSize: 0.98, edgeAmount: 1.0, cR: 0.88, cG: 1.10, cB: 0.86, edgeTone: 'summer' };
    }
    if (k === 'winter') {
      return { key: 'winter', leafAmount: 0.0, leafSize: 0.52, edgeAmount: 0.04, cR: 0.52, cG: 0.52, cB: 0.58, edgeTone: 'winter' };
    }
    if (k === 'spring') {
      return { key: 'spring', leafAmount: 0.78, leafSize: 0.78, edgeAmount: 0.70, cR: 0.96, cG: 1.08, cB: 0.88, edgeTone: 'spring' };
    }
    if (k === 'fall') {
      return { key: 'fall', leafAmount: 0.68, leafSize: 0.92, edgeAmount: 0.76, cR: 1.18, cG: 0.82, cB: 0.54, edgeTone: 'fall' };
    }
    if (k === 'late_summer') {
      return { key: 'late_summer', leafAmount: 1.0, leafSize: 1.0, edgeAmount: 1.0, cR: 0.86, cG: 1.14, cB: 0.82, edgeTone: 'late_summer' };
    }
    const base = { key: 'summer', leafAmount: 1.0, leafSize: 1.0, edgeAmount: 0.96, cR: 0.92, cG: 1.06, cB: 0.90, edgeTone: 'summer' };

    // In auto mode, apply phenology ramp so seasonal changes are gradual.
    if (autoState) {
      const lk = constrain(autoState.leafK, 0, 1);
      base.leafAmount = lk < 0.08 ? 0 : Math.pow(lk, 0.92);
      base.edgeAmount = lerp(0.10, base.edgeAmount, Math.pow(lk, 0.9));
      if (k === 'spring') base.leafSize = lerp(0.58, 0.90, lk);
      if (k === 'fall') base.leafSize = lerp(1.00, 0.78, 1 - lk);
      if (k === 'winter') base.leafSize = 0.52;
      base.key = k;
    }
    return base;
  }

  // ----------------------------------------------------------
  // Build — perimeter-rooted layers to preserve "looking up" feel:
  // all trunks start from edge/offscreen ring and grow inward.
  // ----------------------------------------------------------
  _build() {
    this.trees = [];
    const h = height, w = width;

    const reach     = this._treeBranchReach();
    const treeCount = this._treeFrameDensity();
    // treeFrameDensity is now a direct integer tree count (4–16).
    const totalTarget = Math.max(4, Math.round(treeCount));
    const heroCount   = Math.min(3, Math.max(1, Math.floor(totalTarget * 0.35)));
    // Fill count always >= 4 so every side gets at least one tree.
    const fillCount   = Math.max(4, totalTarget - heroCount);
    const heroRoots = this._makeHeroRoots(heroCount, reach);
    const fillRoots = this._makeEdgeRoots(fillCount, 25, 105, 0.82, 0.72, 0.88);
    const _fillChaos = this._treeBranchChaos();
    for (let fi = 0; fi < fillRoots.length; fi++) {
      const fr = fillRoots[fi];
      const fSign = Math.random() < 0.5 ? -1 : 1;
      fr.treeId      = heroCount + fi;
      fr.trunkLevel  = 1;
      fr.meanderBase = random(0.04, 0.09);
      fr.fanCenter   = fr.a + random(-0.18, 0.18); // aim inward with slight variation
      fr.fanSpan     = lerp(0.80, 1.25, _fillChaos) * random(0.88, 1.10);
      fr.splitBias   = fSign;
    }
    const roots = [...heroRoots, ...fillRoots];
    for (const cfg of roots) {
      const lenMult   = lerp(0.65, 1.15, reach) * cfg.layerLen;
      const len       = h * 0.25 * lenMult;
      const edgeBoost = 1 + constrain(env.canopyEdgeLushness ?? 1.0, 0, 1.5) * cfg.edgeAffinity * 1.35;
      const root      = this._makeNode(cfg.a, len, this._maxDepth, edgeBoost, {
        treeId: cfg.treeId,
        trunkLevel: cfg.trunkLevel,
        meanderBase: cfg.meanderBase,
        fanCenter: cfg.fanCenter,
        fanSpan: cfg.fanSpan,
        splitBias: cfg.splitBias,
      });
      root.plantName = random(this._plantNames);
      root.originX    = cfg.x;
      root.originY    = cfg.y;
      // Hero trees (trunkLevel >= 2) get an early shoulder for richer structure.
      if (cfg.trunkLevel >= 2) {
        const shoulderSign = Math.random() < 0.5 ? -1 : 1;
        const shoulder = this._makeNode(
          cfg.a + shoulderSign * random(0.12, 0.24),
          len * random(0.60, 0.75),
          Math.max(1, this._maxDepth - 1),
          edgeBoost * random(0.90, 1.02),
          {
            treeId: cfg.treeId,
            trunkLevel: Math.max(1, cfg.trunkLevel - 1),
            meanderBase: cfg.meanderBase * 0.9,
            fanCenter: cfg.fanCenter + shoulderSign * cfg.fanSpan * 0.18,
            fanSpan: cfg.fanSpan * 0.88,
            splitBias: -cfg.splitBias,
          },
        );
        root.children.push(shoulder);
      }
      this._populate(root);
      this.trees.push(root);
    }

    // Crown shyness: branches steer away from other trees' canopy zones.
    // All position computation + nudging is done at build time — zero runtime cost.
    this._applyCrownShyness();

    // Annotate leaf scores after shyness pass finalises branch angles.
    for (const root of this.trees) this._annotateLeafPresence(root);

    // Snapshot the params used at build time — runtime sliders compare against these.
    this._builtParams = {
      treeSkyOpen:     this._treeSkyOpen(),
      treeBranchReach: this._treeBranchReach(),
      treeBranchChaos: this._treeBranchChaos(),
    };
    this._runtimeLenMul = 1.0;

    // Background leaf clusters — generated once, drawn each frame behind everything.
    this._buildBgLeaves();
    if (this._bgLeafBuf) { this._bgLeafBuf.remove(); this._bgLeafBuf = null; }
    this._bgLeafKey = '';

    // Invalidate leaf buffer whenever tree structure changes.
    if (this._leafBuf) { this._leafBuf.remove(); this._leafBuf = null; }
  }

  // ----------------------------------------------------------
  // Incremental tree count — add/remove without full rebuild.
  // Adding places a new fill tree in the largest angular gap
  // between existing roots. Removing pops the last tree.
  // ----------------------------------------------------------
  updateTreeCount(newCount) {
    const target  = Math.max(4, Math.round(newCount));
    const current = this.trees.length;
    if (target === current) return;
    if (target > current) {
      for (let i = 0; i < target - current; i++) this._addOneTree();
    } else {
      for (let i = 0; i < current - target; i++) this._removeLastTree();
    }
    if (this._leafBuf) { this._leafBuf.remove(); this._leafBuf = null; }
  }

  _removeLastTree() {
    if (this.trees.length > 1) this.trees.pop();
  }

  _addOneTree() {
    // Find the largest angular gap between existing roots (from canvas centre).
    const cx = width * 0.5, cy = height * 0.5;
    const angles = this.trees.map(t => Math.atan2(t.originY - cy, t.originX - cx));
    angles.sort((a, b) => a - b);

    let maxGap = 0, gapMid = 0;
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length];
      let gap = next - angles[i];
      if (gap < 0) gap += TWO_PI;
      if (gap > maxGap) {
        maxGap = gap;
        gapMid = angles[i] + gap * 0.5;
      }
    }

    // gapMid is the angle FROM centre pointing toward the new gap direction.
    // The root sits ON the screen edge in that direction, offset just outside.
    const edgeDir = gapMid;  // angle from centre → edge
    const cosD = Math.cos(edgeDir), sinD = Math.sin(edgeDir);
    // Parametric ray to boundary.
    let tMax = 1e9;
    if (cosD >  0.0001) tMax = Math.min(tMax, (width  - cx) / cosD);
    if (cosD < -0.0001) tMax = Math.min(tMax, (0      - cx) / cosD);
    if (sinD >  0.0001) tMax = Math.min(tMax, (height - cy) / sinD);
    if (sinD < -0.0001) tMax = Math.min(tMax, (0      - cy) / sinD);

    const edgeX = cx + cosD * tMax;
    const edgeY = cy + sinD * tMax;
    const off   = random(25, 105);
    const rootX = edgeX + cosD * off;
    const rootY = edgeY + sinD * off;

    // Angle pointing inward (root → centre) with a small random wobble.
    const inward     = Math.atan2(cy - rootY, cx - rootX);
    const finalAngle = inward + random(-0.15, 0.15);
    const chaos      = this._treeBranchChaos();
    const reach      = this._treeBranchReach();

    const cfg = {
      x: rootX, y: rootY, a: finalAngle,
      layerLen: 0.82, edgeAffinity: 0.88,
      treeId: this.trees.length,
      trunkLevel: 1,
      meanderBase: random(0.04, 0.09),
      fanCenter: finalAngle + random(-0.18, 0.18),
      fanSpan: lerp(0.80, 1.25, chaos) * random(0.88, 1.10),
      splitBias: Math.random() < 0.5 ? -1 : 1,
    };

    const len       = height * 0.25 * lerp(0.65, 1.15, reach) * cfg.layerLen;
    const edgeBoost = 1 + constrain(env.canopyEdgeLushness ?? 1.0, 0, 1.5) * cfg.edgeAffinity * 1.35;

    const root = this._makeNode(cfg.a, len, this._maxDepth, edgeBoost, {
      treeId: cfg.treeId, trunkLevel: cfg.trunkLevel,
      meanderBase: cfg.meanderBase, fanCenter: cfg.fanCenter,
      fanSpan: cfg.fanSpan, splitBias: cfg.splitBias,
    });
    root.plantName = random(this._plantNames);
    root.originX = cfg.x;
    root.originY = cfg.y;
    this._populate(root);
    this.trees.push(root);

    // Apply one pass of crown shyness for the new tree against all existing zones.
    this._computeBuildPositions(root, root.originX, root.originY);
    const zones = [];
    for (const t of this.trees) this._collectCrownZones(t, zones, this._maxDepth);
    this._nudgeCrown(root, zones, this._maxDepth);
    this._computeBuildPositions(root, root.originX, root.originY);

    this._annotateLeafPresence(root);
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
    const placedAngles = [];
    const minAngGap = TWO_PI / Math.max(8, count * 1.05);
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
        let best = null;
        let bestSep = -1;
        const tBase = (i + 0.5) / n;
        for (let tries = 0; tries < 8; tries++) {
          const jitter = (Math.random() - 0.5) * (1 / Math.max(3, n)) * (tries < 3 ? 0.70 : 1.35);
          const tj = constrain(tBase + jitter, 0.04, 0.96);
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

          const ringAngle = Math.atan2(y - cy, x - cx);
          let sep = Math.PI;
          for (let ai = 0; ai < placedAngles.length; ai++) {
            const d = Math.abs(Math.atan2(Math.sin(ringAngle - placedAngles[ai]), Math.cos(ringAngle - placedAngles[ai])));
            if (d < sep) sep = d;
          }
          if (sep > bestSep) {
            const centerAngle = atan2(cy - y, cx - x);
            const tangent = centerAngle + (Math.random() < 0.5 ? -HALF_PI : HALF_PI);
            const tangentMix = 0.16 + Math.random() * 0.18;
            const inwardArc = lerp(centerAngle, tangent, tangentMix);
            const finalAngle = lerp(normalAngle, inwardArc, inwardAim) + random(-angularJitter, angularJitter);
            bestSep = sep;
            best = { x, y, a: finalAngle, ringAngle };
          }
          if (sep >= minAngGap) break;
        }

        roots.push({ x: best.x, y: best.y, a: best.a, layerLen, edgeAffinity });
        placedAngles.push(best.ringAngle);
      }
    }
    return roots;
  }

  _makeHeroRoots(count, reach) {
    const w = width;
    const h = height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const sideOrder = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const roots = [];
    const anchors = [0.16, 0.34, 0.52, 0.70, 0.84];
    const minGap = Math.min(w, h) * 0.22;
    const placed = [];
    const placedAngles = [];
    const minAngGap = TWO_PI / Math.max(6, count * 0.95);

    for (let i = 0; i < count; i++) {
      const side = sideOrder[i % sideOrder.length];
      let x = 0, y = 0, normalAngle = 0, t = 0;
      let best = null;
      let bestSep = -1;

      for (let tries = 0; tries < 9; tries++) {
        t = anchors[i % anchors.length] + random(-0.08, 0.08) + random(-0.10, 0.10) * (tries / 8);
        const off = random(95, 260);

        if (side === 0) {
          x = lerp(-w * 0.05, w * 1.05, constrain(t, 0.04, 0.96));
          y = -off;
          normalAngle = HALF_PI;
        } else if (side === 1) {
          x = w + off;
          y = lerp(-h * 0.05, h * 1.05, constrain(t, 0.04, 0.96));
          normalAngle = PI;
        } else if (side === 2) {
          x = lerp(-w * 0.05, w * 1.05, constrain(t, 0.04, 0.96));
          y = h + off;
          normalAngle = -HALF_PI;
        } else {
          x = -off;
          y = lerp(-h * 0.05, h * 1.05, constrain(t, 0.04, 0.96));
          normalAngle = 0;
        }

        const ringAngle = Math.atan2(y - cy, x - cx);
        let sep = Math.PI;
        for (let ai = 0; ai < placedAngles.length; ai++) {
          const d = Math.abs(Math.atan2(Math.sin(ringAngle - placedAngles[ai]), Math.cos(ringAngle - placedAngles[ai])));
          if (d < sep) sep = d;
        }
        if (sep > bestSep) {
          bestSep = sep;
          best = { x, y, normalAngle, ringAngle };
        }
        if (sep >= minAngGap) break;
      }
      x = best.x; y = best.y; normalAngle = best.normalAngle;
      placedAngles.push(best.ringAngle);
      // Keep hero trunks from clumping too tightly.
      for (let tries = 0; tries < 5; tries++) {
        let tooClose = false;
        for (let p = 0; p < placed.length; p++) {
          if (dist(x, y, placed[p].x, placed[p].y) < minGap) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) break;
        if (side === 0 || side === 2) x += random(-w * 0.12, w * 0.12);
        else y += random(-h * 0.12, h * 0.12);
      }
      placed.push({ x, y });

      const centerAngle = atan2(cy - y, cx - x);
      const fillBias = ((i / Math.max(1, count - 1)) - 0.5) * 0.46;
      const inwardTarget = centerAngle + fillBias;
      const finalAngle = lerp(normalAngle, inwardTarget, 0.74) + random(-0.07, 0.07);
      roots.push({
        x,
        y,
        a: finalAngle,
        layerLen: lerp(1.02, 1.26, reach) * random(0.92, 1.14),
        edgeAffinity: 1.0,
        treeId: i,
        trunkLevel: Math.max(2, Math.min(4, this._maxDepth)),
        meanderBase: random(0.045, 0.085),
        fanCenter: inwardTarget + random(-0.12, 0.12), // trunk aims at center (correct perspective)
        fanSpan: lerp(0.90, 1.45, this._treeBranchChaos()) * random(0.88, 1.08), // wide so branches spread outward
        splitBias: Math.random() < 0.5 ? -1 : 1,
      });
    }
    return roots;
  }

  rebuild() { this._build(); }
  resize()  {
    if (this._leafBuf) { this._leafBuf.remove(); this._leafBuf = null; }
    this._build(); // _build calls _buildBgLeaves so positions recompute for new canvas size
  }

  // ----------------------------------------------------------
  // Create one branch node — all randomness baked at build time.
  // Now uses 'clumps' (larger blobs) instead of individual leaves
  // for massive performance gains.
  // ----------------------------------------------------------
  _makeNode(baseAngle, len, depth, leafBoost = 1, meta = null) {
    const MD = this._maxDepth;
    // Build a full leaf pool once; live foliage slider reveals/hides groups at draw time.
    const foliage = 1;
    const angleJitter = (Math.random() - 0.5) * 0.22;
    const dropFactor  = Math.random() * 0.09;
    const noisePhase  = Math.random() * 1000;

    // depthFromTip: 0 at trunk, MD at outermost tips.
    const depthFromTip = MD - depth;
    
    // Smooth density response: avoid hard "none -> overload" jumps.
    const densityK = Math.pow(constrain(foliage, 0, 1), 0.78); // expands low-mid range
    const RAW      = [0.75, 1.10, 1.55, 2.00, 2.55, 3.20];
    // Keep edge lushness influential without starving non-edge branch-attached foliage.
    const edgeLeafBoost = 1 + Math.max(0, leafBoost - 1) * 0.55;
    const branchLeafBase = 0.92 + (meta?.trunkLevel > 0 ? 0.16 : 0.10);
    const rawBase  = (RAW[depthFromTip] ?? 1.8) * edgeLeafBoost * branchLeafBase;
    const clumpFloat = rawBase * (0.52 + densityK * 1.12) * (0.88 + Math.random() * 0.30);
    let count = Math.floor(clumpFloat);
    if (Math.random() < (clumpFloat - count)) count += 1; // fractional carry for smooth stepping

    // Keep all branch levels leaf-capable; prevents newly added trees from looking bare.
    if (depth <= MD && foliage > 0.14) count = Math.max(1, count);
    if (depth <= 2 && foliage > 0.18) count = Math.max(2, count);
    if (foliage < 0.06) count = 0;

    const clumps = [];
    const tipK = map(depth, MD, 0, 0.30, 1.0);
    const branchRadiusHint = map(depth, 0, MD, 5.5, 22);
    for (let i = 0; i < count; i++) {
      // Smaller clumps so foliage reads as finer units.
      const baseSz = (22 + Math.random() * 34) * map(depth, MD, 0, 0.40, 1.36);
      const sz = baseSz * (0.82 + densityK * 0.86); // smoother size progression

      // Anchor most clumps toward branch tips and joints (more realistic crown build-up).
      const isJoint = Math.random() < 0.34;
      const tBase = isJoint ? (0.68 + Math.random() * 0.28) : (0.50 + Math.random() * 0.46);
      const t = constrain(tBase, 0.24, 0.98);
      const maxPerp = (sz * 0.12 + branchRadiusHint * 0.34) * tipK;
      const perpOff = (Math.random() - 0.5) * maxPerp * 2.0;

      clumps.push({
        t,                                       // branch-relative anchor position
        perpOff,                                 // branch-relative lateral offset
        lw: sz * (0.88 + Math.random() * 0.58),
        lh: sz * (0.64 + Math.random() * 0.44),
        stretch: 0.75 + Math.random() * 0.95,   // along-branch elongation
        skew:    (Math.random() - 0.5) * 0.85,  // branch-side skew
        lobeMix: 0.45 + Math.random() * 0.45,   // lobe size variation
        polySides: 7 + Math.floor(Math.random() * 5), // 7..11
        polyNoise: 0.30 + Math.random() * 0.45,
        polyRot:   Math.random() * TWO_PI,
        alphaMul:  0.80 + Math.random() * 0.35,
        densityGate: 0.04 + Math.random() * 0.96,
        appearAt: Math.random() * 0.96,
        growSpan: 0.16 + Math.random() * 0.22,
        overlap:   Math.random() < 0.22,
        overlapDX: (Math.random() - 0.5) * 0.9,
        overlapDY: (Math.random() - 0.5) * 0.9,
        overlapScale: 0.38 + Math.random() * 0.24,
        overlapAlpha: 0.50 + Math.random() * 0.32,
        overlapRot: (Math.random() - 0.5) * 0.7,
        pepperCount: 1 + Math.floor(Math.random() * 3),
        pepper: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
          x: (Math.random() - 0.5) * 1.35,
          y: (Math.random() - 0.5) * 1.35,
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
        layer:   Math.random() < 0.60 ? 'back' : 'front',
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
        jointBias: isJoint ? 1 : 0,
        // Always draw a connector twig so clumps read as attached to the branch.
        stem: true,
      });
    }

    return {
      baseAngle, angleJitter, dropFactor, noisePhase,
      len, baseLen: len, // baseLen is immutable — used by runtime length multiplier
      depth, leafBoost, leaves: clumps, children: [], // kept 'leaves' key for compatibility
      treeId: meta?.treeId ?? -1,
      trunkLevel: meta?.trunkLevel ?? 0,
      meanderBase: (meta?.meanderBase ?? random(0.02, 0.06)) * random(0.85, 1.45),
      fanCenter: meta?.fanCenter ?? baseAngle,
      fanSpan: (meta?.fanSpan ?? random(0.28, 0.62)) * random(0.90, 1.35),
      splitBias: meta?.splitBias ?? (Math.random() < 0.5 ? -1 : 1),
      perchable: depth <= 3,
      originX: 0, originY: 0,
      startX: 0, startY: 0, endX: 0, endY: 0,
      sagX: 0, sagY: 0,
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
    const chaosWide = Math.pow(branchChaos, 1.25);
    const minS = lerp(0.10, 0.44, chaosWide);
    const maxS = lerp(0.28, 1.18, chaosWide); // stronger high-end chaos spread

    const isTrunk = node.trunkLevel > 0;
    const depthFromRoot = MD - node.depth;
    // Trunk nodes keep steering toward center (perspective is correct).
    // Branch nodes spread freely — only weak fan pull so they don't converge at center.
    const aimToFan = isTrunk
      ? constrain(0.14 + depthFromRoot * 0.12, 0.12, 0.46)
      : constrain(0.05 + depthFromRoot * 0.03, 0.04, 0.14);
    const targetAngle = lerp(node.baseAngle, node.fanCenter, aimToFan);

    // Higher length decay for trunks to prevent "crazy long" trees.
    const contLen = node.len * (isTrunk ? (0.78 + Math.random() * 0.16) : (0.58 + Math.random() * 0.24));
    const contAngle = targetAngle + (Math.random() - 0.5) * (isTrunk ? 0.14 : 0.32);
    node.children.push(this._makeNode(
      contAngle,
      contLen,
      node.depth - 1,
      node.leafBoost * (isTrunk ? 0.98 : 0.92),
      {
        treeId: node.treeId,
        trunkLevel: Math.max(0, node.trunkLevel - 1),
        meanderBase: node.meanderBase * 0.92,
        fanCenter: isTrunk
          ? node.fanCenter + (Math.random() - 0.5) * 0.15
          : node.fanCenter + (Math.random() - 0.5) * 0.50,
        fanSpan: node.fanSpan * 0.95,
        splitBias: node.splitBias,
      },
    ));

    // Irregular side branching: trunks always emit at least one side limb.
    const splitChance = isTrunk
      ? 1.0
      : (node.depth >= 2 ? lerp(0.42, 0.96, chaosWide) : lerp(0.18, 0.44, chaosWide));
    if (Math.random() < splitChance) {
      const trunkAlternator = ((MD - node.depth) % 2 === 0) ? 1 : -1;
      const signBase = isTrunk ? trunkAlternator * node.splitBias : (Math.random() < 0.70 ? node.splitBias : -node.splitBias);
      const sign = signBase * (Math.random() < 0.35 ? -1 : 1);
      const s = minS + Math.random() * (maxS - minS);
      const sideAim = node.fanCenter + sign * node.fanSpan * random(0.22, 0.85);
      const lenA = node.len * (isTrunk ? (0.64 + Math.random() * 0.28) : (0.48 + Math.random() * 0.42));
      node.children.push(this._makeNode(
        lerp(node.baseAngle + sign * s, sideAim, 0.44),
        lenA,
        node.depth - 1,
        node.leafBoost * (isTrunk ? (0.90 + Math.random() * 0.10) : (0.86 + Math.random() * 0.10)),
        {
          treeId: node.treeId,
          trunkLevel: 0,
          meanderBase: node.meanderBase * 0.78,
          // Trunk side branches fan off the center aim; other branches spread freely.
          fanCenter: isTrunk
            ? node.fanCenter + sign * node.fanSpan * 0.35
            : node.baseAngle + sign * node.fanSpan * 0.55 + (Math.random() - 0.5) * 0.60,
          fanSpan: node.fanSpan * 0.90,
          splitBias: -node.splitBias,
        },
      ));

      if ((isTrunk && node.trunkLevel >= 2 && Math.random() < lerp(0.46, 0.76, chaosWide)) ||
          (!isTrunk && node.depth >= 3 && Math.random() < lerp(0.24, 0.64, chaosWide))) {
        const s2 = minS + Math.random() * (maxS - minS) * 0.85;
        const lenB = node.len * (isTrunk ? (0.48 + Math.random() * 0.28) : (0.35 + Math.random() * 0.35));
        node.children.push(this._makeNode(
          lerp(node.baseAngle - sign * s2, node.fanCenter - sign * node.fanSpan * 0.30, 0.38),
          lenB,
          node.depth - 1,
          node.leafBoost * (0.82 + Math.random() * 0.08),
          {
            treeId: node.treeId,
            trunkLevel: 0,
            meanderBase: node.meanderBase * 0.70,
            fanCenter: node.fanCenter - sign * node.fanSpan * 0.18,
            fanSpan: node.fanSpan * 0.78,
            splitBias: node.splitBias,
          },
        ));
      }

      // Very high chaos gets occasional extra branch for richer, wider structure.
      if (!isTrunk && node.depth >= 2 && chaosWide > 0.72 && Math.random() < (chaosWide - 0.64) * 0.55) {
        const sign3 = Math.random() < 0.5 ? -1 : 1;
        const s3 = minS + Math.random() * (maxS - minS);
        const lenC = node.len * (0.28 + Math.random() * 0.28);
        node.children.push(this._makeNode(
          node.baseAngle + sign3 * s3 + (Math.random() - 0.5) * 0.28,
          lenC,
          node.depth - 1,
          node.leafBoost * (0.78 + Math.random() * 0.10),
          {
            treeId: node.treeId,
            trunkLevel: 0,
            meanderBase: node.meanderBase * 0.66,
            fanCenter: node.fanCenter + sign3 * node.fanSpan * 0.42 + (Math.random() - 0.5) * 0.4,
            fanSpan: node.fanSpan * 0.74,
            splitBias: -node.splitBias,
          },
        ));
      }
    }

    if (this._treeFoliageMass() > 0.16) {
      for (const c of node.children) {
        if (c.depth <= 3 && c.depth > 0 && c.leaves.length === 0 && Math.random() < 0.9) {
          c.leaves.push(this._makeFallbackLeafClump(c.depth));
        }
      }
    }

    for (const c of node.children) this._populate(c);
    }

    _makeFallbackLeafClump(depth) {
      const sz = 20 + Math.random() * 18;
      return {
        t: 0.58 + Math.random() * 0.34,
        perpOff: (Math.random() - 0.5) * (8 + (4 - Math.min(4, depth)) * 2.5),
        lw: sz * (0.86 + Math.random() * 0.36),
        lh: sz * (0.64 + Math.random() * 0.30),
        stretch: 0.78 + Math.random() * 0.34,
        skew: (Math.random() - 0.5) * 0.55,
        lobeMix: 0.48 + Math.random() * 0.24,
        polySides: 7 + Math.floor(Math.random() * 3),
        polyNoise: 0.28 + Math.random() * 0.22,
        polyRot: Math.random() * TWO_PI,
        alphaMul: 0.90 + Math.random() * 0.22,
        densityGate: 0.04 + Math.random() * 0.96,
        appearAt: Math.random() * 0.96,
        growSpan: 0.14 + Math.random() * 0.20,
        overlap: Math.random() < 0.14,
        overlapDX: (Math.random() - 0.5) * 0.7,
        overlapDY: (Math.random() - 0.5) * 0.7,
        overlapScale: 0.42 + Math.random() * 0.16,
        overlapAlpha: 0.52 + Math.random() * 0.18,
        overlapRot: (Math.random() - 0.5) * 0.5,
        pepperCount: 1 + Math.floor(Math.random() * 2),
        pepper: Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => ({
          x: (Math.random() - 0.5) * 1.1,
          y: (Math.random() - 0.5) * 1.1,
          sz: 0.58 + Math.random() * 0.8,
          alpha: 0.40 + Math.random() * 0.40,
          type: Math.random() < 0.72 ? 'ellipse' : 'poly',
          rot: Math.random() * TWO_PI,
          sides: 5 + Math.floor(Math.random() * 2),
          sx: 0.72 + Math.random() * 0.45,
          sy: 0.72 + Math.random() * 0.45,
          swayAmt: 0.40 + Math.random() * 0.35,
          swaySpd: 0.001 + Math.random() * 0.0018,
          swayPhase: Math.random() * TWO_PI,
        })),
        layer: Math.random() < 0.62 ? 'back' : 'front',
        phase: Math.random() * Math.PI * 2,
        swaySpd: 0.0012 + Math.random() * 0.0020,
        swayAmt: 2.2 + Math.random() * 2.2,
        cr: Math.floor((Math.random() - 0.5) * 12),
        cg: Math.floor((Math.random() - 0.5) * 16),
        cb: Math.floor((Math.random() - 0.5) * 8),
        ca: Math.floor(Math.random() * 22),
        backlit: Math.random() < 0.18,
        seed: Math.random() * 10000,
        jointBias: 0,
        stem: true,
      };
    }

    _annotateLeafPresence(node) {
    let score = node.leaves.length;
    for (const c of node.children) score += this._annotateLeafPresence(c);
    node.leafScore = score;
    return score;
    }

    // ----------------------------------------------------------
    // Crown shyness — build-time only, zero runtime cost.
    // Computes approximate branch positions using baseAngle + angleJitter,
    // then runs 3 passes of: collect zones → nudge angles → recompute.
    // Trees organically steer away from each other's canopy, filling
    // empty sky instead of overlapping.
    // ----------------------------------------------------------

    _computeBuildPositions(node, sx, sy) {
      node._bx = sx;
      node._by = sy;
      const a = node.baseAngle + node.angleJitter;
      node._ex = sx + Math.cos(a) * node.len;
      node._ey = sy + Math.sin(a) * node.len;
      for (const c of node.children) this._computeBuildPositions(c, node._ex, node._ey);
    }

    _collectCrownZones(node, zones, MD) {
      // Collect outer canopy branches (depth 0–3 from tip) as repulsion zones.
      const fromTip = MD - node.depth;
      if (fromTip <= 3 && node._ex !== undefined) {
        zones.push({
          x: (node._bx + node._ex) * 0.5,
          y: (node._by + node._ey) * 0.5,
          r: node.len * 0.55,
          treeId: node.treeId,
          trunk: node.trunkLevel > 0,
        });
      }
      if (node.trunkLevel > 0 && node._ex !== undefined) {
        zones.push({
          x: (node._bx + node._ex) * 0.5,
          y: (node._by + node._ey) * 0.5,
          r: node.len * 0.34,
          treeId: node.treeId,
          trunk: true,
        });
      }
      for (const c of node.children) this._collectCrownZones(c, zones, MD);
    }

    _nudgeCrown(node, zones, MD) {
      const fromTip = MD - node.depth;
      const isTrunkNode = node.trunkLevel > 0;
      const trunkWindow = isTrunkNode && fromTip <= 2;
      const crownWindow = !isTrunkNode && fromTip >= 1 && fromTip <= 3;
      if ((trunkWindow || crownWindow) && node._bx !== undefined) {
        const mx = (node._bx + node._ex) * 0.5;
        const my = (node._by + node._ey) * 0.5;
        let pushX = 0, pushY = 0;
        for (const z of zones) {
          if (z.treeId === node.treeId) continue;
          if (isTrunkNode && !z.trunk) continue;
          const dx = mx - z.x;
          const dy = my - z.y;
          const d2 = dx * dx + dy * dy;
          const minD = z.r + node.len * (isTrunkNode ? 0.30 : 0.45);
          if (d2 < minD * minD && d2 > 0.25) {
            const d = Math.sqrt(d2);
            const overlap = (minD - d) / minD;
            pushX += (dx / d) * overlap;
            pushY += (dy / d) * overlap;
          }
        }
        if (pushX !== 0 || pushY !== 0) {
          const pushAngle = Math.atan2(pushY, pushX);
          const diff = Math.atan2(
            Math.sin(pushAngle - node.baseAngle),
            Math.cos(pushAngle - node.baseAngle)
          );
          // Tips bend more, trunk bends less.
          const maxNudge = isTrunkNode
            ? lerp(0.14, 0.07, constrain(fromTip / 2, 0, 1))
            : lerp(0.50, 0.18, fromTip / 3);
          const gain = isTrunkNode ? 0.22 : 0.42;
          const adjustment = constrain(diff * gain, -maxNudge, maxNudge);
          node.baseAngle += adjustment;
          // Partial fan follow so branches don't spring back toward competitor.
          node.fanCenter += adjustment * (isTrunkNode ? 0.18 : 0.32);
        }
        if (isTrunkNode) {
          // Keep trunks primarily inward even after anti-overlap nudging.
          const inward = Math.atan2(height * 0.5 - node._by, width * 0.5 - node._bx);
          const corr = Math.atan2(Math.sin(inward - node.baseAngle), Math.cos(inward - node.baseAngle));
          node.baseAngle += constrain(corr * 0.08, -0.04, 0.04);
        }
      }
      for (const c of node.children) this._nudgeCrown(c, zones, MD);
    }

    _applyCrownShyness() {
      const MD = this._maxDepth;
      // 3 passes: each pass tightens the shyness gap organically.
      for (let pass = 0; pass < 3; pass++) {
        for (const root of this.trees) {
          this._computeBuildPositions(root, root.originX, root.originY);
        }
        const zones = [];
        for (const root of this.trees) this._collectCrownZones(root, zones, MD);
        for (const root of this.trees) this._nudgeCrown(root, zones, MD);
      }
      // Final position sync so _ex/_ey reflect the settled angles.
      for (const root of this.trees) {
        this._computeBuildPositions(root, root.originX, root.originY);
      }
    }

    // ----------------------------------------------------------
    // update() — must run before draw() and before flock.update()
    // ----------------------------------------------------------
  update() {
    if (env.forceTreeless) {
      this.perchNodes = [];
      return;
    }
    // Runtime length multiplier — lets sky-open and branch-reach sliders
    // adjust tree geometry without a rebuild:
    //   Sky open ↑  → openScale  < 1 → trees recede toward edges (shorter, center opens up)
    //   Branch reach ↑ → reachScale > 1 → trees extend further inward
    const bp         = this._builtParams ?? {};
    const builtOpen  = bp.treeSkyOpen  ?? this._treeSkyOpen();
    const builtReach = bp.treeBranchReach ?? this._treeBranchReach();
    const openDelta  = this._treeSkyOpen()     - builtOpen;
    const reachDelta = this._treeBranchReach() - builtReach;
    // openDelta > 0: slider moved right (more sky) → trees shorter (recede toward edges)
    // openDelta < 0: slider moved left (less sky) → trees longer (advance into centre)
    const skyOpenNow = this._treeSkyOpen();
    const openScale  = Math.max(0.18, Math.min(2.0, 1.0 - openDelta * 2.4));
    // Absolute sky-open influence (independent of build baseline) so the
    // opening is controlled by branch reach geometry, not per-leaf masking.
    const openNorm   = constrain((skyOpenNow - 1.0) / 0.5, 0, 1);
    const openAbsMul = lerp(1.0, 0.62, openNorm);
    const reachScale = Math.max(0.22, Math.min(2.4, 1.0 + reachDelta * 2.0));
    this._runtimeLenMul = Math.max(0.14, openScale * openAbsMul * reachScale);

    const t = frameCount * (0.0018 + env.windSpeed * 0.004);
    this._updateGust();
    this.perchNodes = [];
    for (const root of this.trees) {
      this._updateNode(root, root.originX, root.originY, t);
    }
    }

    _updateGust() {
      const g = this._gust;
      if (!g.active) {
        const wind = constrain(env.windSpeed ?? 0.22, 0, 1);
        const stormBoost = env.currentWeather === 'storm' ? 1.8 : 1.0;
        const trigger = 0.00035 + wind * 0.00125 * stormBoost;
        if (Math.random() < trigger) {
          g.active = true;
          g.dir = Math.random() < 0.5 ? -1 : 1;
          g.progress = 0;
          g.speed = random(0.0045, 0.0105);
          g.amp = random(0.10, 0.24) * (0.7 + wind * 0.9) * stormBoost;
          g.width = random(width * 0.16, width * 0.34);
        }
        return;
      }
      g.progress += g.speed;
      if (g.progress > 1.28) g.active = false;
    }

    _gustStrengthAtX(x) {
      const g = this._gust;
      if (!g.active) return 0;
      const startX = g.dir > 0 ? -g.width : width + g.width;
      const endX = g.dir > 0 ? width + g.width : -g.width;
      const frontX = lerp(startX, endX, g.progress);
      const dx = x - frontX;
      const sigma2 = g.width * g.width;
      const envelope = Math.exp(-(dx * dx) / (2 * sigma2));
      return g.amp * envelope;
    }

  _updateNode(node, sx, sy, t) {
    node.startX = sx;
    node.startY = sy;

    const depthFromRoot = this._maxDepth - node.depth;
    const depthFactor = 1 + depthFromRoot * 0.28;
    // Stiffness model:
    // - Bigger lower/trunk branches resist wind/gust motion.
    // - Smaller outer branches flex more.
    const baseLen = node.baseLen ?? node.len ?? 0;
    const stiffLenK = constrain(map(baseLen, 0, height * 0.34, 0.08, 1.0), 0.08, 1.0);
    const trunkK = node.trunkLevel > 0 ? constrain(0.58 + node.trunkLevel * 0.12, 0.58, 0.90) : 1.0;
    const depthFlexK = constrain(map(depthFromRoot, 0, this._maxDepth, 0.82, 1.40), 0.82, 1.40);
    const stiffness = constrain(stiffLenK * trunkK, 0.08, 1.0);
    const flexK = constrain((1.02 - stiffness) * depthFlexK, 0.14, 1.55);
    const windAmp = (env.windSpeed * 0.28 +
                    (env.currentWeather === 'storm' ? env.windSpeed * 0.22 : 0))
                    * depthFactor * flexK;
    const sway  = (noise(node.noisePhase * 0.28, t) - 0.5) * 2 * windAmp;
    const gust = this._gustStrengthAtX(sx) * depthFactor * lerp(0.45, 1.12, flexK);
    const gustSway = Math.sin(t * 2.8 + node.noisePhase * 0.22) * gust;
    const droop = node.dropFactor * (this._maxDepth - node.depth) * 0.055;

    const meander = Math.sin(t * (0.65 + node.meanderBase * 4.0) + node.noisePhase * 0.17)
      * node.meanderBase * (1 + (this._maxDepth - node.depth) * 0.08);
    node.currentAngle = node.baseAngle + node.angleJitter + sway + gustSway + droop + meander;

    // Runtime chaos motion — strong live response on outer non-trunk branches.
    const chaosNow = this._treeBranchChaos();
    if (node.depth <= 3 && node.trunkLevel === 0) {
      const depthK = map(node.depth, 3, 0, 1.15, 0.55);
      const chaosBase = (noise(node.noisePhase * 0.65 + 1800, t * 0.10) - 0.5) * chaosNow * 2.5 * depthK;
      const chaosWave = Math.sin(t * (1.8 + chaosNow * 2.4) + node.noisePhase * 0.11) * chaosNow * 0.35 * depthK;
      node.currentAngle += chaosBase + chaosWave;
    }

    // Apply runtime length multiplier (sky open + branch reach sliders).
    const effLen = (node.baseLen ?? node.len) * (this._runtimeLenMul ?? 1.0);
    node.endX = sx + Math.cos(node.currentAngle) * effLen;
    node.endY = sy + Math.sin(node.currentAngle) * effLen;

    node.sagX = lerp(node.startX, node.endX, 0.5);
    node.sagY = lerp(node.startY, node.endY, 0.5)
               + effLen * node.dropFactor * 1.6 + effLen * 0.012;

    if (node.perchable) {
      // Only register perch slots on visible branches (not inside the sky opening).
      const slots = [0.3, 0.6, 0.9];
      for (const tPerch of slots) {
        const mt = 1 - tPerch;
        const px = mt * mt * node.startX + 2 * mt * tPerch * node.sagX + tPerch * tPerch * node.endX;
        const py = mt * mt * node.startY + 2 * mt * tPerch * node.sagY + tPerch * tPerch * node.endY;
        if (this._centerVoidFactor(px, py) > 0.15) {
          this.perchNodes.push({ x: px, y: py, branch: node, t: tPerch });
        }
      }
    }
    for (const c of node.children) this._updateNode(c, node.endX, node.endY, t);
    }

    _perspectiveScale(x, y) {
    const p     = constrain(env.canopyPerspective ?? 0.72, 0, 1);
    const d     = dist(x, y, width * 0.5, height * 0.5);
    const edgeT = constrain(d / (min(width, height) * 0.70), 0, 1);
    return lerp(1, lerp(0.72, 1.42, edgeT), p);
    }

    _edgeLushFactor(x, y) {
    const lush    = constrain(env.canopyEdgeLushness ?? 1.0, 0, 1.5);
    const edgeDist = Math.min(x, width - x, y, height - y);
    const tRaw    = 1 - constrain(edgeDist / (min(width, height) * 0.18), 0, 1);
    const t       = Math.pow(tRaw, 1.5);
    const lushNorm = constrain(lush / 1.0, 0, 1);
    const lushK   = Math.pow(lushNorm, 1.35);
    const topBoost = Math.pow(constrain((lushNorm - 0.88) / 0.12, 0, 1), 1.2)
      + Math.pow(constrain((lush - 1.0) / 0.5, 0, 1), 1.15) * 0.8;
    return 1 + lushK * t * (0.48 + topBoost * 0.24);
    }

    _centerVoidFactor(x, y) {
      // Use live skyOpen so the opening shape responds immediately to slider moves.
      const skyOpen  = this._treeSkyOpen();
      const minDim   = Math.min(width, height);
      // Larger, slightly oval opening with stable irregular edge.
      const baseR = lerp(minDim * 0.18, minDim * 0.48, skyOpen);
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
      // Increased feathering for a much softer transition.
      const feather = 0.65;
      return constrain((e - 0.85) / feather, 0, 1);
    }

    // ----------------------------------------------------------
    // draw() — some leaves behind branches, some in front.
    // Branches are now filled polygons (offset from bezier skeleton)
    // so they taper seamlessly through joints with no stroke-cap artefacts.
    // ----------------------------------------------------------
    draw() {
      if (env.forceTreeless) return;
      this._drawBgLeaves();      // leafed-in background behind everything
      this._drawLeafPass('back');
      for (const root of this.trees) this._drawBranchPoly(root);
      this._drawLeafPass('front');
      this._drawPlantLabels();
    }

  _drawPlantLabels() {
      if (!env.showPlantLabels) return;
      push();
      textAlign(CENTER, CENTER);
      textSize(constrain(min(width, height) * 0.020, 16, 30));
      noStroke();
      for (const root of this.trees) {
        if (!root || !root.plantName) continue;
        const towardCx = width * 0.5 - root.originX;
        const towardCy = height * 0.5 - root.originY;
        const d = Math.sqrt(towardCx * towardCx + towardCy * towardCy) || 1;
        const ux = towardCx / d;
        const uy = towardCy / d;
        const px = root.originX + ux * 44;
        const py = root.originY + uy * 44;
        if (this._centerVoidFactor(px, py) < 0.12) continue;
        fill(8, 16, 12, 170);
        text(root.plantName, px + 2.0, py + 2.0);
        fill(206, 236, 214, 170);
        text(root.plantName, px, py);
      }
      pop();
    }

    // ----------------------------------------------------------
    // Background leaf clusters — baked once at build time, drawn each frame
    // behind trunks and foreground leaves so the screen edges always read as
    // leafed-in canopy.  Same irregular polygon shapes as the real leaves.
    // ----------------------------------------------------------
  _buildBgLeaves() {
      this._bgLeafData = [];
      const w = width, h = height;
      const minDim = Math.min(w, h);
      // Build a max-density pool once; live slider adds/removes via draw-time gating.
      const lush = 1;
      const pushBlob = (bx, by) => {
        const edgeDist = Math.min(bx, w - bx, by, h - by);
        const edgeBias = 1 - constrain(edgeDist / (minDim * 0.20), 0, 1);
        // Keep mostly edge-concentrated foliage via spawn geometry only.
        this._bgLeafData.push({
          x:     bx,
          y:     by,
          rx:    18 + random() * 40,
          ry:    14 + random() * 34,
          rot:   random() * TWO_PI,
          sides: 6 + Math.floor(random(5)),  // 6–10 sides — irregular blob
          noise: 0.22 + random() * 0.42,
          cr:    Math.floor((random() - 0.5) * 18),
          cg:    Math.floor((random() - 0.5) * 24),
          cb:    Math.floor((random() - 0.5) * 12),
          edgeBias,
          baseA: 0.52 + random() * 0.32,    // per-blob base opacity
          lushGate: 0.14 + random() * 0.84, // threshold for live edge-lush reveal
        });
      };
      // More lushness => more perimeter clusters; still balanced across all 4 sides.
      const clusterCount = Math.round(48 + lush * 86 + random(-6, 6));
      const perSide = Math.floor(clusterCount / 4);
      const sideCounts = [perSide, perSide, perSide, perSide];
      for (let i = 0; i < clusterCount - perSide * 4; i++) sideCounts[i % 4] += 1;

      // Scatter clusters along all four edges, denser toward corners.
      for (let side = 0; side < 4; side++) {
        const n = sideCounts[side];
        for (let i = 0; i < n; i++) {
          const sideT = (i + 0.5) / Math.max(1, n);
          const cornerBias = Math.pow(Math.abs(sideT - 0.5) * 2, 1.35);
          const cornerPull = cornerBias * random(0.08, 0.22);
          const t = constrain(sideT + (Math.random() < 0.5 ? -cornerPull : cornerPull), 0.02, 0.98);

        // Power-bias toward the very edge (low pull = hugging the boundary).
          const pullBase = Math.pow(random(), 0.52);
          const pull = constrain(pullBase * lerp(1.05, 0.72, lush), 0, 1);
          const inset = pull * Math.min(w, h) * 0.28;
        let cx, cy;
          if      (side === 0) { cx = lerp(-w * 0.03, w * 1.03, t); cy = inset; }
          else if (side === 1) { cx = w - inset;                    cy = lerp(-h * 0.03, h * 1.03, t); }
          else if (side === 2) { cx = lerp(-w * 0.03, w * 1.03, t); cy = h - inset; }
          else                 { cx = inset;                        cy = lerp(-h * 0.03, h * 1.03, t); }

        // Each cluster is 2–5 overlapping blobs, like a real leaf clump.
          const blobCount = 2 + Math.floor(random(3 + lush * 1.5));
          for (let j = 0; j < blobCount; j++) {
            const spread = (14 + pull * 30) * lerp(1.05, 0.9, lush); // tighter spread near edge
            const bx = cx + (random() - 0.5) * spread * 2;
            const by = cy + (random() - 0.5) * spread * 2;
            pushBlob(bx, by);
          }
        }
      }

      // At maximum lushness, guarantee random leaf groups around the entire perimeter.
      if (lush >= 0.98) {
        const ringGroupsPerSide = 24;
        for (let side = 0; side < 4; side++) {
          for (let i = 0; i < ringGroupsPerSide; i++) {
            const t = constrain((i + 0.5) / ringGroupsPerSide + random(-0.03, 0.03), 0.01, 0.99);
            const inset = random(0, Math.min(w, h) * 0.075);
            let cx, cy;
            if      (side === 0) { cx = lerp(0, w, t); cy = inset; }
            else if (side === 1) { cx = w - inset;     cy = lerp(0, h, t); }
            else if (side === 2) { cx = lerp(0, w, t); cy = h - inset; }
            else                 { cx = inset;         cy = lerp(0, h, t); }

            const ringBlobCount = 1 + Math.floor(random(3));
            for (let j = 0; j < ringBlobCount; j++) {
              const bx = cx + random(-20, 20);
              const by = cy + random(-20, 20);
              pushBlob(bx, by);
            }
          }
        }
      }
    }

  _drawBgLeaves() {
      if (!this._bgLeafData.length) return;
      const season = this._seasonProfile();
      if (season.edgeAmount <= 0.01) return;
      const lush = constrain(env.canopyEdgeLushness ?? 1.0, 0, 1.5);
      const lushNorm = constrain(lush / 1.0, 0, 1);
      const lushLive = lushNorm >= 0.995 ? 1.0 : Math.pow(lushNorm, 1.4);
      const lushTopBoost = Math.pow(constrain((lushNorm - 0.86) / 0.14, 0, 1), 1.15)
        + Math.pow(constrain((lush - 1.0) / 0.5, 0, 1), 1.10) * 0.75;
      const lushVisual = lushLive * (1 + lushTopBoost * 0.32);
      const tod        = env.timeOfDay;
      const isNight    = tod < 6.5 || tod > 20.5;
      const isTwilight = (tod >= 5.5 && tod < 7) || (tod > 19 && tod < 21);
      const isDawn     = tod < 13;
      const sun        = (!isNight && !isTwilight) ? (1 - Math.abs(tod - 13) / 7) : 0;
      const flashK     = constrain((window._ncvFlashAlpha || 0) / 255, 0, 1);

      // Same base palette as tree leaves, slightly darkened so edge reads as behind.
      let br, bg, bb;
      if (isNight) {
        br = 3; bg = 8; bb = 4;
      } else if (isTwilight) {
        const frac = isDawn ? (tod - 5.5) / 1.5 : (21 - tod) / 2;
        br = lerp(132, 42, frac);
        bg = lerp(104, 82, frac);
        bb = lerp(34, 18, frac);
      } else {
        br = 24 + sun * 22;
        bg = 68 + sun * 46;
        bb = 12 + sun * 8;
      }

      // Quantized key prevents per-frame cache churn while preserving smooth updates.
      const todBucket = Math.round(tod * 5) / 5; // 0.2h buckets
      br = br * season.cR * (isNight ? 0.68 : 0.74);
      bg = bg * season.cG * (isNight ? 0.72 : 0.78);
      bb = bb * season.cB * (isNight ? 0.70 : 0.76);

      const key = [
        width, height,
        (Math.round(lushLive * 100) / 100).toFixed(2),
        (Math.round(lushVisual * 100) / 100).toFixed(2),
        season.key,
        season.edgeAmount.toFixed(2),
        todBucket.toFixed(1),
        isNight ? 1 : 0,
        isTwilight ? 1 : 0,
      ].join('|');

      if (!this._bgLeafBuf || this._bgLeafBuf.width !== width || this._bgLeafBuf.height !== height || key !== this._bgLeafKey) {
        if (this._bgLeafBuf) this._bgLeafBuf.remove();
        this._bgLeafBuf = createGraphics(width, height);
        this._bgLeafBuf.pixelDensity(1);
        this._bgLeafBuf.clear();
        const gdc = this._bgLeafBuf.drawingContext;
        gdc.save();

        for (const lf of this._bgLeafData) {
          if ((lf.lushGate ?? 0.5) > Math.min(1.001, lushVisual)) continue;
          const edgeK = Math.pow(constrain(lf.edgeBias ?? 1, 0, 1), 1.25);
          if (edgeK < 0.12) continue;

          let r = Math.max(0, Math.min(255, br + lf.cr));
          let g = Math.max(0, Math.min(255, bg + lf.cg));
          let b = Math.max(0, Math.min(255, bb + lf.cb));

          // Seasonal tint is intentionally subtle so edge mostly matches tree leaves.
          if (season.edgeTone === 'fall') {
            const warmT = constrain((Math.sin((lf.x * 0.013 + lf.y * 0.011 + lf.rot * 2.1)) + 1) * 0.5, 0, 1);
            const fr = lerp(164, 216, warmT);
            const fg = lerp(66, 146, warmT);
            const fb = lerp(16, 44, warmT);
            r = lerp(r, fr, 0.34);
            g = lerp(g, fg, 0.34);
            b = lerp(b, fb, 0.30);
          } else if (season.edgeTone === 'spring') {
            r = lerp(r, 170, 0.08);
            g = lerp(g, 210, 0.12);
            b = lerp(b, 120, 0.08);
          } else if (season.edgeTone === 'late_summer') {
            r = lerp(r, 78, 0.07);
            g = lerp(g, 122, 0.16);
            b = lerp(b, 66, 0.07);
          } else if (season.edgeTone === 'winter') {
            r = lerp(r, 86, 0.12);
            g = lerp(g, 90, 0.13);
            b = lerp(b, 98, 0.14);
          }

          const a = (lf.baseA * (isNight ? 0.90 : 0.82) * lushVisual * edgeK * season.edgeAmount).toFixed(3);

          gdc.fillStyle = `rgba(${r},${g},${b},${a})`;
          gdc.save();
          gdc.translate(lf.x, lf.y);
          gdc.rotate(lf.rot);
          gdc.beginPath();
          for (let k = 0; k <= lf.sides; k++) {
            const tt = (k / lf.sides) * Math.PI * 2;
            const n  = 1 + Math.sin(tt * 2.6 + lf.rot) * lf.noise;
            const px = Math.cos(tt) * lf.rx * n;
            const py = Math.sin(tt) * lf.ry * n;
            k === 0 ? gdc.moveTo(px, py) : gdc.lineTo(px, py);
          }
          gdc.closePath();
          gdc.fill();
          gdc.restore();
        }

        gdc.restore();
        this._bgLeafKey = key;
      }

      if (isNight && flashK > 0.001) {
        const mul = constrain(1 - flashK * 0.95, 0, 1);
        push();
        tint(Math.round(255 * mul), Math.round(255 * mul), Math.round(255 * mul), 255);
        image(this._bgLeafBuf, 0, 0, width, height);
        noTint();
        pop();
      } else {
        image(this._bgLeafBuf, 0, 0, width, height);
      }
    }

    // ----------------------------------------------------------
    // Branch — filled polygon built by offsetting the bezier skeleton
    // laterally. The polygon shape tapers naturally from base to tip,
    // and child polygons start exactly where the parent ends so there
    // are no thickness jumps or stroke-cap artefacts at joints.
    // ----------------------------------------------------------
  _drawBranchPoly(node) {
    const MD = this._maxDepth;

      const mx    = (node.startX + node.endX) * 0.5;
      const my    = (node.startY + node.endY) * 0.5;
      const persp = this._perspectiveScale(mx, my);

      const isNight = env.timeOfDay < 6.5 || env.timeOfDay > 20.5;
      const flashK  = constrain((window._ncvFlashAlpha || 0) / 255, 0, 1);
      let fr, fg, fb;
      if (isNight) {
        const vv = lerp(5, 0, flashK * 0.95);
        fr = vv; fg = vv; fb = vv;
      } else {
        const vd = 28 * (1 - flashK * 0.2);
        fr = vd + 4; fg = vd + 1; fb = vd - 3;
      }

      // Width at skeleton base and tip — continuous with children.
      const wStart = lerp(2.0, 24, Math.pow(node.depth / MD, 1.2)) * persp;
      const wEnd   = lerp(2.0, 24, Math.pow(Math.max(0, node.depth - 1) / MD, 1.2)) * persp;

      // Sample bezier skeleton into evenly-spaced points.
      const STEPS = 8;
      const { startX, startY, endX, endY, sagX, sagY } = node;
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        const t  = i / STEPS;
        const mt = 1 - t;
        pts.push({
          x: mt*mt*startX + 2*mt*t*sagX + t*t*endX,
          y: mt*mt*startY + 2*mt*t*sagY + t*t*endY,
          w: lerp(wStart, wEnd, t) * 0.5, // half-width for offset
        });
      }

      // Build left and right offset edges using perpendicular of tangent.
      const leftPts  = [];
      const rightPts = [];
      for (let i = 0; i <= STEPS; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(STEPS, i + 1)];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const tLen = Math.sqrt(tx * tx + ty * ty);
        if (tLen < 0.001) {
          leftPts.push([pts[i].x, pts[i].y]);
          rightPts.push([pts[i].x, pts[i].y]);
          continue;
        }
        // Perpendicular (rotate tangent 90°)
        const nx =  -ty / tLen;
        const ny =   tx / tLen;
        const hw = pts[i].w;
        leftPts.push( [pts[i].x + nx * hw, pts[i].y + ny * hw]);
        rightPts.push([pts[i].x - nx * hw, pts[i].y - ny * hw]);
      }

      // Filled outline polygon: left edge forward, right edge reversed.
      // Plain vertex (not curveVertex) so the first/last points sit exactly at the
      // attachment positions — curveVertex would pull them inward and leave junction gaps.
      // 8 bezier samples give sufficient smoothness without spline artefacts.
      noStroke();
      fill(fr, fg, fb, 255);
      beginShape();
      for (const [x, y] of leftPts)                         vertex(x, y);
      for (let i = rightPts.length - 1; i >= 0; i--)        vertex(rightPts[i][0], rightPts[i][1]);
      endShape(CLOSE);

      // Weld cap at the branch joint to hide tiny gaps from angular changes.
      const joinR = Math.max(0.45, wEnd * 0.36);
      circle(node.endX, node.endY, joinR * 2);

      for (const c of node.children) this._drawBranchPoly(c);
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
    const season     = this._seasonProfile();
    const isNight    = tod < 6.5 || tod > 20.5;
    const isTwilight = (tod >= 5.5 && tod < 7) || (tod > 19 && tod < 21);
    const isDawn     = tod < 13;
    const sun        = (!isNight && !isTwilight) ? (1 - abs(tod - 13) / 7) : 0;
    const flashK     = constrain((window._ncvFlashAlpha || 0) / 255, 0, 1);
    const ft         = frameCount;

    // Stabilized adaptive stepping with hysteresis to prevent pop flicker.
    let targetStep = 1;
    if (q < 0.56) targetStep = 3;
    else if (q < 0.82) targetStep = 2;
    if (targetStep > this._leafStep) {
      this._leafStep = targetStep;
    } else if (targetStep < this._leafStep) {
      const upThreshold = this._leafStep === 3 ? 0.66 : 0.90;
      if (q > upThreshold) this._leafStep = targetStep;
    }
    const step = this._leafStep;

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
    br *= season.cR; bg *= season.cG; bb *= season.cB;

    g.push();
    g.scale(resScale);

    const softCtrl = constrain(env.leafSoftness ?? 0.6, 0, 4);
    // Tree foliage: keep low softness so branch-attached leaf groups stay defined.
    const leafSoft = softCtrl <= 0
      ? 0
      : constrain(Math.pow(softCtrl, 1.30) * (0.30 + q * 0.25), 0, 3.6);
    g.drawingContext.shadowBlur  = leafSoft;
    g.drawingContext.shadowColor = `rgba(20,30,20,${(0.18 + leafSoft * 0.022).toFixed(2)})`;

    for (const root of this.trees) {
      this._drawLeavesNode(g, root, br, bg, bb, ba,
        isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer, season);
    }

    g.pop();

    drawingContext.imageSmoothingEnabled = true;
    drawingContext.imageSmoothingQuality = q > 0.8 ? 'medium' : 'low';
    // Skip costly full-layer blur unless softness is intentionally high.
    const postBlur = softCtrl < 1.0 ? 0 : constrain(Math.pow(softCtrl, 1.15) * 0.22, 0, 1.2);
    if (postBlur > 0.05) {
      drawingContext.save();
      drawingContext.filter = `blur(${postBlur.toFixed(2)}px)`;
      image(g, 0, 0, width, height);
      drawingContext.restore();
    } else {
      image(g, 0, 0, width, height);
    }
    }

  _drawLeavesNode(g, node, br, bg, bb, ba,
                  isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer, season) {

    // Simple on-screen check for branch bounding box
    const margin = 180; // tighter guard band cuts offscreen leaf work
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
      const foliageLive = constrain((env.treeFoliageMass ?? 0.35) * (season.leafAmount ?? 1), 0, 1);
      // Make low slider values much lighter (e.g. 0.25 should not look dense).
      const foliageResponse = foliageLive >= 0.995 ? 1.0 : Math.pow(foliageLive, 1.85);
      const foliageGate = foliageResponse >= 0.995 ? 1.001 : foliageResponse;
      const foliageDensityK = Math.pow(foliageResponse, 0.82);

      const escR = lerp(1, 1.18, edgeLush - 1);
      const escG = lerp(1, 1.26, edgeLush - 1);
      const escA = lerp(1, 1.10, edgeLush - 1);

      const pa    = node.currentAngle + HALF_PI;
      const ba    = node.currentAngle;
      const cosPa = Math.cos(pa);
      const sinPa = Math.sin(pa);
      const cosBa = Math.cos(ba);
      const sinBa = Math.sin(ba);

      // Cached curve sag point for correct leaf anchoring.
      const sagX = node.sagX;
      const sagY = node.sagY;

      for (let i = 0; i < node.leaves.length; i += step) {
        const lf = node.leaves[i];
        const appearAt = lf.appearAt ?? lf.densityGate ?? 0.5;
        const growSpan = Math.max(0.06, lf.growSpan ?? 0.20);
        const growK = constrain((foliageResponse - appearAt) / growSpan, 0, 1);
        if (growK <= 0) continue;
        if (lf.layer !== layer) continue;

        // Quadratic Bezier interpolation for correct attachment to curved branch.
        const t = lf.t;
        const mt = 1 - t;
        const lx = mt * mt * node.startX + 2 * mt * t * sagX + t * t * node.endX;
        const ly = mt * mt * node.startY + 2 * mt * t * sagY + t * t * node.endY;

        // Keep clumps close to branch frame to avoid center overfill.
        const skyOpenNorm = constrain((this._treeSkyOpen() - 1.0) / 0.5, 0, 1);
        const spreadMul = lerp(1.0, 0.74, skyOpenNorm);
        const perpReach = lf.perpOff * (1 + lf.lobeMix * 0.20) * spreadMul;
        const px = lx + cosPa * perpReach;
        const py = ly + sinPa * perpReach;
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

        // Fall palette: stable per-clump warm mix (amber/orange/rust).
        if (season.key === 'fall' && !isNight) {
          const warmT = constrain(0.25 + ((Math.sin((lf.seed ?? 0) * 0.0017) + 1) * 0.5) * 0.75, 0, 1);
          const wr = lerp(170, 212, warmT);
          const wg = lerp(72, 142, warmT);
          const wb = lerp(18, 42, warmT);
          const mix = isTwilight ? 0.45 : 0.70;
          lr = lerp(lr, wr, mix);
          lg = lerp(lg, wg, mix);
          lb = lerp(lb, wb, mix * 0.95);
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
        const localGrow = Math.pow(growK, 0.82);
        const sizeK = lerp(0.72, 1.24, foliageDensityK) * lerp(0.40, 1.0, localGrow) * (season.leafSize ?? 1);
        const wMain = lf.lw * persp * sizeK;
        const hMain = lf.lh * persp * sizeK;
        // Keep clumps attached to branch frame; branch drives leaf grouping.
        const tipInfluence = lf.t;
        const along = wMain * (0.08 + lf.stretch * (0.12 + tipInfluence * 0.12));
        const side  = hMain * lf.skew * (0.16 + tipInfluence * 0.08);
        const lobeW = wMain * lf.lobeMix;
        const lobeH = hMain * (0.72 + lf.lobeMix * 0.25);
        const layerAlpha = layer === 'back' ? 0.86 : 0.72;

        // Branch-influenced polygon clump (cheap irregular blob).
        const jointPull = lf.jointBias ? 0.34 : 0.18;
        const cxp = fx + cosBa * along * jointPull + cosPa * side * 0.22;
        const cyp = fy + sinBa * along * jointPull + sinPa * side * 0.22;
        const rx = Math.max(3, (wMain * (0.72 + lf.lobeMix * 0.52)) * 0.5);
        const ry = Math.max(3, (hMain * (0.78 + lf.lobeMix * 0.48)) * 0.5);
        const alphaGrow = lerp(0.22, 1.0, Math.pow(growK, 0.75));
        const alphaBaseRaw = la * layerAlpha * lf.alphaMul * lerp(0.38, 1.52, foliageDensityK) * alphaGrow;
        const minAlpha = isNight
          ? lerp(34, lerp(84, 182, foliageDensityK), alphaGrow)
          : lerp(14, lerp(38, 108, foliageDensityK), alphaGrow);
        const bigLeafK = constrain(((rx * ry) - 120) / 680, 0, 1);
        const bigLeafFloor = isNight
          ? (lerp(24, lerp(90, 188, foliageDensityK), alphaGrow) + bigLeafK * 30 * alphaGrow)
          : (lerp(10, lerp(42, 112, foliageDensityK), alphaGrow) + bigLeafK * 72 * alphaGrow);
        const aBase = Math.min(255, Math.max(alphaBaseRaw, minAlpha, bigLeafFloor));

        // Thin connector twig keeps clump visually attached to supporting branch.
        if (lf.stem) {
          const stemA = aBase * (layer === 'back' ? 0.26 : 0.34) * lerp(0.45, 1, localGrow);
          const stemW = Math.max(0.7, Math.min(2.0, 0.55 + persp * 0.65));
          g.push();
          g.stroke(28, 46, 20, stemA);
          g.strokeWeight(stemW);
          // Anchor pinned to branch (lx, ly), leaf end follows clump (cxp, cyp).
          g.line(lx, ly, cxp, cyp);
          g.pop();
        }

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
        const overlapFull = foliageResponse > 0.93 && (lf.seed % 1) > 0.56;
        if ((lf.overlap || overlapFull) && growK >= 0.72) {
          const ovSway = Math.sin(ft * (0.0011 + lf.swaySpd * 0.35) + lf.phase) * 0.18;
          const ox = cxp + cosBa * rx * (lf.overlapDX + ovSway) + cosPa * ry * lf.overlapDY;
          const oy = cyp + sinBa * rx * (lf.overlapDX + ovSway) + sinPa * ry * lf.overlapDY;
          g.fill(lr, lg, lb, aBase * (overlapFull ? Math.max(0.76, lf.overlapAlpha) : lf.overlapAlpha));
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
        isNight, isTwilight, sun, flashK, ft, step, occluders, hasOcc, layer, season);
    }
  }
}
