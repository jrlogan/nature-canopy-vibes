// ============================================================
// atmosphere.js — Clouds, sun/moon, lightning, and ambient audio
// ============================================================

class AtmosphereSystem {
  constructor() {
    this.clouds = [];
    this.flashAlpha = 0;
    this._flashPeak = 0;
    // New lightning state
    this.lightningBolts     = []; // [{segments, alpha, weight}] — fade independently
    this.pendingStrikes     = []; // [{at, type}] — queued succession strikes
    this.distantFlashAlpha  = 0;
    this.distantFlashAngle  = 0;
    this.manualFlashUntil   = 0;
    this.nextLightningAt    = millis() + random(4000, 14000);
    this.audio = new AtmosphereAudio();
    this._cloudCoreBuf = null;
    this._cloudWispBuf = null;
    this.aurora = { active: false, alpha: 0, target: 0, nextCheckAt: 0, hueShift: random(1000) };
    this._seedClouds();
  }

  resize() {
    this._seedClouds();
    if (this._cloudCoreBuf) { this._cloudCoreBuf.remove(); this._cloudCoreBuf = null; }
    if (this._cloudWispBuf) { this._cloudWispBuf.remove(); this._cloudWispBuf = null; }
  }

  enableAudio() {
    this.audio.enable();
  }

  _seedClouds() {
    this.clouds = [];
    const count = 20;
    for (let i = 0; i < count; i++) {
      this.clouds.push({
        x: random(-width * 0.4, width * 1.4),
        y: random(height * 0.04, height * 0.96), // full canvas — looking up, clouds anywhere
        size: random(90, 300),
        drift:  random(0.15, 0.9),
        driftY: random(-0.25, 0.25), // gentle vertical drift for overhead feel
        puff: random(4, 8),
        seed: random(10000),
        flowAngle: random(-0.28, 0.28),
        flowLen: random(1.8, 3.2),
        flowBands: 2 + Math.floor(random(3)), // 2..4
        coreSides: 8 + Math.floor(random(5)), // 8..12
        wispSides: 11 + Math.floor(random(6)), // 11..16
        jag: random(0.10, 0.30),
        wispSpread: random(0.35, 0.72),
      });
    }
  }

  update() {
    const wind = env.windSpeed || 0;
    const weatherBoost = env.currentWeather === 'storm' ? 1.45 : (env.currentWeather === 'rain' ? 1.15 : 1.0);

    const dt = window._ncvAnimDt;
    for (const c of this.clouds) {
      c.x += (0.05 + wind * c.drift) * weatherBoost * dt;
      c.y += ((c.driftY ?? 0) * weatherBoost * 0.5) * dt + sin((window._ncvAnimT * 0.002) + c.seed) * 0.06;
      if (c.x > width  + c.size * 0.8) c.x = -c.size * 1.2;
      if (c.x < -c.size * 1.2)         c.x = width  + c.size * 0.8;
      if (c.y > height + c.size * 0.8) c.y = -c.size * 1.2;
      if (c.y < -c.size * 1.2)         c.y = height + c.size * 0.8;
    }

    this._updateLightning();
    this._updateAurora();
    window._ncvFlashAlpha = this.flashAlpha;
    this.audio.update();
  }

  _updateAurora() {
    const lat = Math.abs(Number(env.liveLocationLat));
    const isPolar = Number.isFinite(lat) && lat >= 56;
    const isNight = NCV_SKY.phase().alt < -8;
    const cloud = constrain(env.cloudCover ?? 0.28, 0, 1);
    const weatherOk = env.currentWeather !== 'storm';
    const visibleCond = isPolar && isNight && weatherOk && cloud < 0.62;
    const now = millis();

    if (!visibleCond) {
      this.aurora.active = false;
      this.aurora.target = 0;
      this.aurora.alpha = max(0, this.aurora.alpha - 2.4);
      return;
    }

    if (now >= this.aurora.nextCheckAt) {
      const latK = constrain((lat - 56) / 16, 0, 1);
      const activityChance = 0.26 + latK * 0.46;
      this.aurora.active = random() < activityChance;
      this.aurora.target = this.aurora.active ? random(34, 118) : random(0, 22);
      this.aurora.nextCheckAt = now + random(14000, 36000);
    }

    const dt = window._ncvAnimDt;
    const speed = this.aurora.target > this.aurora.alpha ? 0.8 : 0.45;
    this.aurora.alpha = lerp(this.aurora.alpha, this.aurora.target, speed * 0.035 * dt);
    this.aurora.hueShift += (0.003 + (env.windSpeed ?? 0.2) * 0.004) * dt;
  }

  _updateLightning() {
    const now = millis();
    const manualActive = now < this.manualFlashUntil;
    const dt = window._ncvAnimDt;

    if (env.currentWeather !== 'storm' && !manualActive) {
      this.flashAlpha         = max(0, this.flashAlpha - 18 * dt);
      this.distantFlashAlpha  = max(0, this.distantFlashAlpha - 6 * dt);
      this.lightningBolts     = [];
      this.pendingStrikes     = [];
      return;
    }

    if (env.currentWeather !== 'storm' && manualActive) {
      this.flashAlpha        = max(0, this.flashAlpha - 22 * dt);
      this.distantFlashAlpha = max(0, this.distantFlashAlpha - 5 * dt);
      this.lightningBolts = this.lightningBolts.filter(b => {
        b.alpha -= 30 * dt;
        return b.alpha > 0;
      });
      return;
    }

    // Fire any queued succession strikes.
    while (this.pendingStrikes.length > 0 && now >= this.pendingStrikes[0].at) {
      this._triggerStrike(this.pendingStrikes.shift().type);
    }

    // Schedule the next group.
    if (now >= this.nextLightningAt) {
      this._scheduleStrikeGroup();
    }

    // Fade sky flash and distant glow.
    this.flashAlpha        = max(0, this.flashAlpha        - 22 * dt);
    this.distantFlashAlpha = max(0, this.distantFlashAlpha -  5 * dt);

    // Fade each bolt's alpha independently.
    this.lightningBolts = this.lightningBolts.filter(b => {
      b.alpha -= 30 * dt;
      return b.alpha > 0;
    });
  }

  // ---- scheduling ----

  _scheduleStrikeGroup() {
    const now = millis();
    // env.lightningIntensity is real-world data (0.0 to 1.0).
    const realIntensity = env.lightningIntensity ?? 0.0;
    
    // Calculate distance biased by real intensity: 
    // High intensity = more overhead strikes, Low intensity = more horizon heat lightning.
    let distance = Math.random();
    if (realIntensity > 0.4) {
      distance *= (1.0 - realIntensity * 0.5); // pull strikes closer
    } else {
      distance = lerp(distance, 0.8 + random(0.2), 0.5); // push to horizon
    }

    this._handleLightningEvent(distance);

    // Succession: close strikes occasionally fire 1–2 follow-ups rapidly.
    if (distance < 0.2 && Math.random() < (0.35 + realIntensity * 0.3)) {
      const t1 = now + random(90, 260);
      this.pendingStrikes.push({ at: t1, distance: distance + random(0.05, 0.15) });
    }

    // Bimodal wait: active cell (short) vs quiet spell (long).
    // Frequency increases with realIntensity.
    const isStruggling = !!window._ncvIsStruggling;
    const struggleMul = isStruggling ? 2.5 : 1.0;
    const freqMul     = 1.0 / (0.4 + realIntensity * 1.6); // 2.5x faster when intensity is high
    
    this.nextLightningAt = now + (Math.random() < 0.35
      ? random(1200, 4500) * struggleMul * freqMul
      : random(8000, 24000) * struggleMul * freqMul);
  }

  _handleLightningEvent(d) {
    const isStruggling = !!window._ncvIsStruggling;
    const now = millis();

    // 1. DISTANCE TIERS
    if (d < 0.2) {
      // CLOSE STRIKE
      const alpha = random(210, 255);
      this.flashAlpha = max(this.flashAlpha, alpha);
      
      const startX = random(width * 0.15, width * 0.85);
      const targetY = height * random(0.3, 0.7);
      const maxDepth = isStruggling ? 3 : 4;
      const segments = this._buildBoltTree(startX, -10, targetY, maxDepth);
      this.lightningBolts.push({ segments, alpha: 255, weight: random(2.0, 3.2) });

      if (window._ncvSocket?.connected) window._ncvSocket.emit('lightning_strike', { intensity: 1.0, distance: d });
      this._scheduleThunder(d);

    } else if (d < 0.8) {
      // DISTANT STRIKE
      const alpha = map(d, 0.2, 0.8, 160, 60);
      this.flashAlpha = max(this.flashAlpha, alpha);
      
      if (window._ncvSocket?.connected) window._ncvSocket.emit('lightning_strike', { intensity: 0.6, distance: d });
      this._scheduleThunder(d);

    } else {
      // HEAT LIGHTNING (d >= 0.8)
      this.distantFlashAlpha = random(30, 65);
      this.distantFlashAngle = random(TWO_PI);
      // Origin for heat lightning is often more localized/central
      this.heatOriginX = random(width * 0.2, width * 0.8);
      this.heatOriginY = random(height * 0.1, height * 0.4);
      this.isHeat = true;

      if (window._ncvSocket?.connected) window._ncvSocket.emit('heat_lightning', { distance: d });
      // No thunder for heat lightning
    }
  }

  _scheduleThunder(d) {
    // delay: 0.0 -> 0ms, 0.8 -> 5000ms
    const delayMs = map(d, 0, 0.8, 0, 5000);
    // volume: 0.0 -> 1.0, 0.8 -> 0.2
    const volume = map(d, 0, 0.8, 1.0, 0.2);

    setTimeout(() => {
      if (this.audio) this.audio.playThunder(volume, true); // true = forced immediate (no internal jitter)
    }, delayMs);
  }

  _triggerStrike(type) {
    // Legacy support: redirect to middle-ground distance
    this._handleLightningEvent(type === 'distant' ? 0.5 : 0.1);
  }

  // ---- local bolt ----

  _triggerLocalBolt() {
    this._handleLightningEvent(0.1);
  }

  forceLightningFlash(distance = 0.1) {
    this.manualFlashUntil = millis() + 1600;
    this._handleLightningEvent(distance);
  }

  // Recursively builds a branching bolt tree.
  // depth controls how many more segments to add; branches fork with decreasing prob.
  _buildBoltTree(x, y, targetY, depth) {
    const segs = [];
    if (depth <= 0 || y >= targetY) return segs;

    const stepH  = (targetY - y) / (depth + 1);
    const jitter = lerp(18, 52, 1 - depth / 5);
    const nx = x + random(-jitter, jitter);
    const ny = y + stepH * random(0.7, 1.4);

    segs.push({ x1: x, y1: y, x2: nx, y2: ny, depth });

    // Continue main channel.
    for (const s of this._buildBoltTree(nx, ny, targetY, depth - 1)) segs.push(s);

    // Random fork branch — probability and reach decrease with depth.
    if (depth >= 2 && Math.random() < 0.36) {
      const sign   = Math.random() < 0.5 ? -1 : 1;
      const fx     = nx + sign * random(12, 38);
      const fy     = ny + random(8, 28);
      const fEnd   = Math.min(targetY, fy + stepH * random(1.2, 3.0));
      for (const s of this._buildBoltTree(fx, fy, fEnd, depth - 2)) segs.push(s);
    }

    return segs;
  }

  // ---- distant flash (no bolt) ----

  _triggerDistantFlash() {
    this.distantFlashAlpha = random(40, 105);
    this.distantFlashAngle = random(TWO_PI); // glow origin on any edge

    // Soft, noticeably delayed thunder — sounds far away.
    const delay     = random(2.8, 7.5);
    const intensity = random(0.12, 0.38);
    setTimeout(() => this.audio.playThunder(intensity), delay * 1000);
  }

  drawSky() {
    this._drawTwilightGradient();
    this._drawOvercastWash();
    this._drawAurora();
    this._drawSunAndMoon();
    this._drawClouds();
    this._drawDistantFlash();
    this._drawFlashSkyWash();
    this._drawLightningBolt();
  }

  drawOverlay() {
    // No post-foreground wash: we want trees to stay dark silhouettes.
  }

  _drawAurora() {
    const a = this.aurora.alpha;
    if (a <= 1) return;

    const cloud = constrain(env.cloudCover ?? 0.28, 0, 1);
    const vis = (1 - cloud * 0.8);
    if (vis <= 0.08) return;
    const alpha = a * vis;
    const bands = 3;
    const baseY = height * 0.18;

    drawingContext.save();
    drawingContext.globalCompositeOperation = 'screen';
    for (let b = 0; b < bands; b++) {
      const y = baseY + b * height * 0.09;
      const amp = height * (0.06 + b * 0.01);
      const phase = this.aurora.hueShift + b * 0.8;
      const grad = drawingContext.createLinearGradient(0, y - amp, 0, y + amp * 1.4);
      const g1 = Math.round(180 + 55 * Math.sin(phase * 0.7 + 0.2));
      const b1 = Math.round(110 + 70 * Math.sin(phase * 0.9 + 1.1));
      grad.addColorStop(0.00, `rgba(120,${g1},${b1},0)`);
      grad.addColorStop(0.35, `rgba(100,${Math.min(255, g1 + 25)},${Math.max(80, b1 - 20)},${(alpha / 255 * 0.30).toFixed(3)})`);
      grad.addColorStop(0.70, `rgba(90,${Math.min(255, g1 + 40)},${Math.max(70, b1 - 28)},${(alpha / 255 * 0.22).toFixed(3)})`);
      grad.addColorStop(1.00, `rgba(80,150,110,0)`);
      drawingContext.fillStyle = grad;

      beginShape();
      for (let x = -40; x <= width + 40; x += 24) {
        const n = noise(x * 0.0022 + b * 0.71, window._ncvAnimT * 0.0015 + phase);
        const yy = y + (n - 0.5) * 2 * amp;
        vertex(x, yy);
      }
      vertex(width + 40, y + amp * 1.9);
      vertex(-40, y + amp * 1.9);
      endShape(CLOSE);
    }
    drawingContext.restore();
  }

  // Radial twilight gradient: you are looking UP at the ceiling.
  // The center of the frame is the zenith (directly overhead) — paler.
  // The edges are toward the horizon where all the sunset/sunrise color lives.
  _drawTwilightGradient() {
    // Peaks with the sun on the horizon, gone by ±7° of altitude. Under the
    // midnight sun this glow simply never leaves.
    const k = constrain(NCV_SKY.phase().glowK, 0, 1);
    if (k <= 0.01) return;

    const cx = width * 0.5;
    const cy = height * 0.5;
    // Radius reaches the corners so edges fully saturate.
    const r = Math.sqrt(cx * cx + cy * cy) * 1.08;

    const grad = drawingContext.createRadialGradient(cx, cy, 0, cx, cy, r);
    // Zenith (center overhead): pale warm white-yellow
    grad.addColorStop(0,    `rgba(255, 245, 220, ${(0.50 * k).toFixed(3)})`);
    grad.addColorStop(0.30, `rgba(248, 200, 130, ${(0.42 * k).toFixed(3)})`);
    // Mid: golden orange
    grad.addColorStop(0.58, `rgba(220, 105, 35,  ${(0.55 * k).toFixed(3)})`);
    // Edge (horizon): deep red-orange
    grad.addColorStop(0.82, `rgba(185, 55, 18,   ${(0.62 * k).toFixed(3)})`);
    grad.addColorStop(1.0,  `rgba(140, 28, 8,    ${(0.68 * k).toFixed(3)})`);

    drawingContext.save();
    drawingContext.fillStyle = grad;
    drawingContext.fillRect(0, 0, width, height);
    drawingContext.restore();
  }

  _drawFlashSkyWash() {
    if (this.flashAlpha <= 1) return;
    noStroke();
    fill(248, 250, 255, this.flashAlpha);
    rect(0, 0, width, height);
    fill(240, 246, 255, this.flashAlpha * 0.65);
    rect(0, 0, width, height);
  }

  _drawClouds() {
    const cover = constrain(env.cloudCover ?? 0.2, 0, 1);
    const q = constrain(window._ncvQualityScale ?? 1, 0.45, 1);
    const weatherBase = env.currentWeather === 'storm' ? 0.95 : (env.currentWeather === 'rain' ? 0.66 : 0.28);
    const alphaBase = (25 + weatherBase * 120) * cover;
    if (alphaBase <= 0.5) return;

    // Offscreen buffers for polygon cloud core + wispy blur layer.
    const resScale = 0.55 * q * (window._ncvIsStruggling ? 0.65 : 1.0);
    const bufW = Math.ceil(width * resScale);
    const bufH = Math.ceil(height * resScale);

    if (!this._cloudCoreBuf || this._cloudCoreBuf.width !== bufW || this._cloudCoreBuf.height !== bufH) {
      if (this._cloudCoreBuf) this._cloudCoreBuf.remove();
      this._cloudCoreBuf = createGraphics(bufW, bufH);
    }
    if (!this._cloudWispBuf || this._cloudWispBuf.width !== bufW || this._cloudWispBuf.height !== bufH) {
      if (this._cloudWispBuf) this._cloudWispBuf.remove();
      this._cloudWispBuf = createGraphics(bufW, bufH);
    }

    const gCore = this._cloudCoreBuf;
    const gWisp = this._cloudWispBuf;
    gCore.clear(); gWisp.clear();
    gCore.noStroke(); gWisp.noStroke();
    gCore.push(); gWisp.push();
    gCore.scale(resScale);
    gWisp.scale(resScale);

    const isStruggling = !!window._ncvIsStruggling;
    for (const c of this.clouds) {
      const t = noise(c.seed, window._ncvAnimT * 0.002);
      const cloudDark = env.currentWeather === 'storm' ? 26 : (env.currentWeather === 'rain' ? 58 : 78);
      const cloudLight = env.currentWeather === 'storm' ? 72 : (env.currentWeather === 'rain' ? 120 : 140);
      const shade = lerp(cloudDark, cloudLight, t);
      const aCore = alphaBase * lerp(0.68, 1.0, t);
      const aWisp = alphaBase * lerp(0.36, 0.62, t);

      let bandCount = Math.max(2, Math.floor(c.flowBands + c.puff * 0.22));
      if (isStruggling) bandCount = Math.max(1, Math.floor(bandCount * 0.6));
      
      const flowA = c.flowAngle + Math.sin(window._ncvAnimT * 0.00045 + c.seed) * 0.10;
      const flowLen = c.size * c.flowLen;

      for (let i = 0; i < bandCount; i++) {
        const bandT = bandCount === 1 ? 0.5 : (i / (bandCount - 1));
        const px = c.x + (bandT - 0.5) * c.size * 0.9 + Math.sin(c.seed + i * 1.7) * 10;
        const py = c.y + Math.sin(c.seed * 0.8 + i * 0.9 + window._ncvAnimT * 0.0012) * c.size * 0.10;
        const coreThick = c.size * lerp(0.20, 0.34, noise(c.seed + i * 0.21));
        const wispThick = coreThick * (1.5 + c.wispSpread * 0.8);

        // Dense flowing core ribbon.
        gCore.fill(shade, shade + 6, shade + 14, aCore * lerp(0.82, 1.0, bandT));
        this._drawCloudRibbon(
          gCore, px, py, flowLen * lerp(0.66, 1.0, bandT), coreThick,
          flowA + (bandT - 0.5) * 0.18, isStruggling ? Math.floor(c.coreSides * 0.7) : c.coreSides, c.jag * 0.85, c.seed + i * 17.3
        );

        // Wispy flowing shell ribbon (skipped if really struggling)
        if (!isStruggling || q > 0.65) {
          gWisp.fill(shade + 8, shade + 12, shade + 18, aWisp * lerp(0.75, 1.0, bandT));
          this._drawCloudRibbon(
            gWisp,
            px + Math.sin(c.seed + i * 0.8) * 8,
            py + Math.cos(c.seed * 0.6 + i + window._ncvAnimT * 0.001) * 5,
            flowLen * (0.84 + c.wispSpread * 0.45),
            wispThick,
            flowA + (bandT - 0.5) * 0.26,
            isStruggling ? Math.floor(c.wispSides * 0.7) : c.wispSides,
            c.jag * 1.45,
            c.seed + i * 29.7
          );
        }
      }
    }
    gCore.pop();
    gWisp.pop();

    // Composite: dense part mostly crisp, wispy part heavily blurred.
    image(gCore, 0, 0, width, height);

    const wispBlurPx = constrain((env.skyBlur ?? 1.2) * (6.6 + cover * 5.6) * q, 0, 32);
    if (wispBlurPx > 0.05 && (!isStruggling || q > 0.7)) {
      drawingContext.filter = `blur(${wispBlurPx.toFixed(2)}px)`;
      image(gWisp, 0, 0, width, height);
      drawingContext.filter = 'none';
    } else if (!isStruggling || q > 0.65) {
      image(gWisp, 0, 0, width, height);
    }
  }

  _drawCloudRibbon(g, cx, cy, len, thick, angle, segments, jag, seed) {
    const half = len * 0.5;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const nx = -sa;
    const ny = ca;

    const top = [];
    const bot = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x0 = -half + t * len;
      const flowBend = Math.sin(t * TWO_PI * 1.15 + seed * 0.003 + window._ncvAnimT * 0.0011) * thick * 0.22;
      const n = (noise(seed + t * 2.6, window._ncvAnimT * 0.0018) - 0.5) * 2;
      const w = thick * (0.62 + Math.sin(t * PI) * 0.9) * (1 + n * jag);
      const px = cx + x0 * ca + flowBend * nx;
      const py = cy + x0 * sa + flowBend * ny;
      top.push([px + nx * w * 0.5, py + ny * w * 0.5]);
      bot.push([px - nx * w * 0.5, py - ny * w * 0.5]);
    }

    g.beginShape();
    g.curveVertex(bot[0][0], bot[0][1]);
    for (let i = 0; i < top.length; i++) g.curveVertex(top[i][0], top[i][1]);
    for (let i = bot.length - 1; i >= 0; i--) g.curveVertex(bot[i][0], bot[i][1]);
    g.curveVertex(top[0][0], top[0][1]);
    g.curveVertex(top[1][0], top[1][1]);
    g.endShape(CLOSE);
  }

  _drawCloudPoly(g, cx, cy, rx, ry, sides, jag, seed, roundness = 0.35) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * TWO_PI;
      const n = noise(seed + i * 0.23, window._ncvAnimT * 0.002) * 2 - 1;
      const rmx = 1 + n * jag;
      const rmy = 1 + Math.sin(seed + i * 0.7) * jag * 0.65;
      pts.push([Math.cos(t) * rx * rmx, Math.sin(t) * ry * rmy]);
    }

    g.push();
    g.translate(cx, cy);
    g.rotate((noise(seed * 0.37) - 0.5) * roundness);
    g.beginShape();
    g.curveVertex(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    for (const p of pts) g.curveVertex(p[0], p[1]);
    g.curveVertex(pts[0][0], pts[0][1]);
    g.curveVertex(pts[1][0], pts[1][1]);
    g.endShape(CLOSE);
    g.pop();
  }

  _drawSunAndMoon() {
    const t = env.timeOfDay;
    const sun = this._sunScreenPosition(t);
    const moon = this._moonFromTimeAndDate(t);
    window._ncvMoonState = moon;
    const cover = constrain(env.cloudCover ?? 0.2, 0, 1);
    const heavyOvercast = cover > 0.72 || env.currentWeather === 'storm';
    const blurPx = 4;

    if (sun.visible) {
      noStroke();
      if (heavyOvercast) {
        drawingContext.filter = blurPx > 0.05 ? `blur(${(blurPx * 2.4).toFixed(2)}px)` : 'none';
        const blotchAlpha = map(cover, 0.72, 1, 55, 24, true);
        fill(245, 240, 212, blotchAlpha);
        ellipse(sun.x, sun.y, 210, 160);
        fill(246, 242, 220, blotchAlpha * 0.55);
        ellipse(sun.x + 12, sun.y - 4, 128, 94);
        drawingContext.filter = 'none';
      } else {
        const haze = env.currentWeather === 'storm' ? 0.35 : 1.0 - cover * 0.45;
        fill(255, 242, 195, 220 * haze);
        circle(sun.x, sun.y, 44);
      }
    }

    if (moon.visible) {
      const phase = moon.phase;
      const d = 42;
      const illum = 0.5 * (1 - cos(TWO_PI * phase)); // 0=new, 1=full
      const waxing = phase < 0.5;
      const moonDayDim = sun.visible ? 0.28 : 1.0;
      const moonAtNight = !sun.visible;

      // Hard occultation disc so stars never show through the moon body.
      noStroke();
      fill(18, 24, 34, 255);
      circle(moon.x, moon.y, d * 1.02);

      // Extremely soft atmospheric bloom at night only.
      if (moonAtNight) {
        drawingContext.filter = blurPx > 0.05 ? `blur(${(blurPx * 10.5).toFixed(2)}px)` : 'none';
        fill(170, 200, 255, (heavyOvercast ? 5 : 10) * moonDayDim);
        circle(moon.x, moon.y, 320);
        fill(180, 210, 255, (heavyOvercast ? 7 : 15) * moonDayDim);
        circle(moon.x, moon.y, 200);
        fill(195, 220, 255, (heavyOvercast ? 10 : 22) * moonDayDim);
        circle(moon.x, moon.y, 120);
        drawingContext.filter = 'none';
      }

      if (heavyOvercast) {
        drawingContext.filter = blurPx > 0.05 ? `blur(${(blurPx * 2.6).toFixed(2)}px)` : 'none';
        const blotchAlpha = map(cover, 0.72, 1, 48, 20, true);
        fill(220, 230, 248, blotchAlpha);
        ellipse(moon.x, moon.y, 150, 112);
        fill(224, 236, 252, blotchAlpha * 0.5);
        ellipse(moon.x - 10, moon.y + 6, 98, 72);
        drawingContext.filter = 'none';
      } else {
        // Base moon disc remains visible but subtle.
        const baseA = moonAtNight ? (120 * (1 - cover * 0.45) * moonDayDim) : (92 * (1 - cover * 0.28));
        fill(moonAtNight ? 205 : 232, moonAtNight ? 214 : 236, moonAtNight ? 226 : 238, baseA);
        circle(moon.x, moon.y, d);

        // Lit portion: bright ellipse shifted by phase, avoiding hard shadow edges.
        const litW = d * (0.16 + illum * 0.84);
        const offset = (waxing ? -1 : 1) * (d * 0.42 * (1 - illum));
        const litA = moonAtNight
          ? ((40 + illum * 190) * (1 - cover * 0.45) * moonDayDim)
          : ((68 + illum * 150) * (1 - cover * 0.30));
        fill(moonAtNight ? 240 : 246, moonAtNight ? 246 : 248, moonAtNight ? 255 : 250, litA);
        ellipse(moon.x + offset, moon.y, litW, d * 0.98);
      }
    }

    this._drawPlanets(t, cover, moon, sun);
  }

  _drawOvercastWash() {
    const cover = constrain(env.cloudCover ?? 0.2, 0, 1);
    if (cover <= 0.68 && env.currentWeather === 'clear') return;

    const stormK = env.currentWeather === 'storm' ? 1 : 0;
    const rainK = env.currentWeather === 'rain' ? 1 : 0;
    const amt = map(cover, 0.68, 1, 0, 1, true);

    noStroke();
    const base = lerp(0, 130, amt) * (0.6 + stormK * 0.6 + rainK * 0.25);
    fill(150 - stormK * 38, 158 - stormK * 34, 168 - stormK * 30, base);
    rect(0, 0, width, height);
  }

  // Sun on the same dome as the stars and planets (azimuthal equidistant,
  // zenith at centre, horizon at the inscribed circle), from its real RA/Dec.
  _sunScreenPosition(hour) {
    const now = this._dateAtHour(hour);
    const jd = this._julianDay(now);
    const d = jd - 2451543.5;
    const latDeg = Number.isFinite(Number(env.liveLocationLat)) ? Number(env.liveLocationLat) : 41.31;
    const lonDeg = Number.isFinite(Number(env.liveLocationLon)) ? Number(env.liveLocationLon) : -72.93;
    const lstDeg = this._localSiderealDeg(jd, lonDeg);
    const earth = this._heliocentricEcliptic('earth', d);
    const eq = this._sunRaDecFromEarth(earth, d);
    const hor = this._radecToHorizontal(eq.raDeg, eq.decDeg, lstDeg, latDeg);
    if (hor.altDeg < -0.8) return { visible: false, x: 0, y: 0, altDeg: hor.altDeg };
    const proj = this._horizontalToScreen(Math.max(0, hor.altDeg), hor.azDeg + (Number(env.skyAzimuthOffsetDeg) || 0), width * 0.5, height * 0.5, min(width, height) * 0.5);
    return { visible: true, x: proj.x, y: proj.y, altDeg: hor.altDeg };
  }

  // Real moon: position from a low-precision lunar theory, phase from the
  // moon–sun elongation on the scene's date (so a birthday shows its moon).
  _moonFromTimeAndDate(hour) {
    const now = this._dateAtHour(hour);
    const jd = this._julianDay(now);
    const d = jd - 2451543.5;
    const m = NCV_SKY.moonEquatorial(d);
    const phase = m.phase;
    const latDeg = Number.isFinite(Number(env.liveLocationLat)) ? Number(env.liveLocationLat) : 41.31;
    const lonDeg = Number.isFinite(Number(env.liveLocationLon)) ? Number(env.liveLocationLon) : -72.93;
    const lstDeg = this._localSiderealDeg(jd, lonDeg);
    const hor = this._radecToHorizontal(m.raDeg, m.decDeg, lstDeg, latDeg);
    if (hor.altDeg < 1) return { visible: false, x: 0, y: 0, phase, altDeg: hor.altDeg };
    const proj = this._horizontalToScreen(hor.altDeg, hor.azDeg + (Number(env.skyAzimuthOffsetDeg) || 0), width * 0.5, height * 0.5, min(width, height) * 0.5);
    return { visible: true, phase, x: proj.x, y: proj.y, altDeg: hor.altDeg };
  }

  _drawPlanets(hour, cloudCover, moon, sun) {
    const cloudK = 1 - cloudCover * 0.55;
    if (cloudK <= 0.08) return;

    const now = this._dateAtHour(hour);
    const jd = this._julianDay(now);
    const d = jd - 2451543.5; // days since 2000 Jan 0.0 (UT)
    const latDeg = Number.isFinite(Number(env.liveLocationLat)) ? Number(env.liveLocationLat) : 41.31;
    const lonDeg = Number.isFinite(Number(env.liveLocationLon)) ? Number(env.liveLocationLon) : -72.93;
    const lstDeg = this._localSiderealDeg(jd, lonDeg);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const scale = min(width, height) * 0.5;
    const isNight = NCV_SKY.phase().alt < -6;

    const earth = this._heliocentricEcliptic('earth', d);
    const sunEq = this._sunRaDecFromEarth(earth, d);

    const planets = [
      { key: 'venus',  r: 255, g: 241, b: 208, size: 7.2, mag: -4.2 },
      { key: 'mars',   r: 238, g: 153, b: 124, size: 5.8, mag:  1.0 },
      { key: 'jupiter',r: 236, g: 220, b: 188, size: 9.0, mag: -2.2 },
      { key: 'saturn', r: 230, g: 207, b: 162, size: 7.4, mag:  0.7 },
    ];

    noStroke();
    for (const p of planets) {
      const eq = this._planetRaDec(p.key, d, earth);
      const hor = this._radecToHorizontal(eq.raDeg, eq.decDeg, lstDeg, latDeg);
      if (hor.altDeg <= 1.5) continue; // not visible above horizon

      const proj = this._horizontalToScreen(hor.altDeg, hor.azDeg, cx, cy, scale);
      if (!proj) continue;
      if (moon.visible && dist(proj.x, proj.y, moon.x, moon.y) < 58) continue;

      const sunSep = this._angularSeparationDeg(eq.raDeg, eq.decDeg, sunEq.raDeg, sunEq.decDeg);
      let dayDim = isNight ? 1.0 : 0.22;
      if (!isNight) {
        if (sunSep < 14) continue;
        if (sunSep < 28) dayDim *= 0.45;
        if (p.mag > 0.8) dayDim *= 0.70; // dimmer planets are harder in daylight
      }

      const magK = constrain(map(p.mag, -4.5, 1.5, 1.05, 0.36), 0.30, 1.1);
      const a = 225 * cloudK * dayDim * magK;
      if (a < 8) continue;

      fill(p.r, p.g, p.b, a);
      circle(proj.x, proj.y, p.size);

      if (p.key === 'jupiter') {
        noFill();
        stroke(226, 212, 182, a * 0.68);
        strokeWeight(1.0);
        push();
        translate(proj.x, proj.y);
        rotate(-0.30);
        ellipse(0, 0, p.size * 2.45, p.size * 0.92);
        pop();
        noStroke();
      }
    }
  }

  _dateAtHour(hour) {
    if (env.journeyActive && Number.isFinite(env.journeyEpochMs)) return new Date(env.journeyEpochMs);
    const base = env.liveDateISO ? new Date(env.liveDateISO) : new Date();
    const d = Number.isFinite(base.getTime()) ? new Date(base.getTime()) : new Date();
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const s = Math.floor((((hour - h) * 60) - m) * 60);
    d.setHours(h, m, s, 0);
    return d;
  }

  _julianDay(dateObj) {
    return dateObj.getTime() / 86400000 + 2440587.5;
  }

  _normDeg(v) {
    return ((v % 360) + 360) % 360;
  }

  _localSiderealDeg(jd, lonDeg) {
    const T = (jd - 2451545.0) / 36525.0;
    const gmst = 280.46061837
      + 360.98564736629 * (jd - 2451545.0)
      + 0.000387933 * T * T
      - (T * T * T) / 38710000;
    return this._normDeg(gmst + lonDeg);
  }

  _planetElements(key, d) {
    if (key === 'earth') {
      return { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1.0, e: 0.016709 - 1.151e-9 * d, M: 356.0470 + 0.9856002585 * d };
    }
    if (key === 'venus') {
      return { N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d };
    }
    if (key === 'mars') {
      return { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d };
    }
    if (key === 'jupiter') {
      return { N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.8950 + 0.0830853001 * d };
    }
    if (key === 'saturn') {
      return { N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.9670 + 0.0334442282 * d };
    }
    return null;
  }

  _solveKepler(Mrad, e) {
    let E = Mrad + e * Math.sin(Mrad) * (1 + e * Math.cos(Mrad));
    for (let i = 0; i < 6; i++) {
      E -= (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
    }
    return E;
  }

  _heliocentricEcliptic(key, d) {
    const el = this._planetElements(key, d);
    if (!el) return { x: 0, y: 0, z: 0 };
    const N = radians(this._normDeg(el.N));
    const i = radians(el.i);
    const w = radians(this._normDeg(el.w));
    const M = radians(this._normDeg(el.M));
    const E = this._solveKepler(M, el.e);
    const xv = el.a * (Math.cos(E) - el.e);
    const yv = el.a * (Math.sqrt(1 - el.e * el.e) * Math.sin(E));
    const v = Math.atan2(yv, xv);
    const r = Math.sqrt(xv * xv + yv * yv);
    const vw = v + w;

    return {
      x: r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)),
      y: r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)),
      z: r * (Math.sin(vw) * Math.sin(i)),
    };
  }

  _eclipticToEquatorial(x, y, z, d) {
    const obl = radians(23.4393 - 3.563e-7 * d);
    const xeq = x;
    const yeq = y * Math.cos(obl) - z * Math.sin(obl);
    const zeq = y * Math.sin(obl) + z * Math.cos(obl);
    const ra = this._normDeg(degrees(Math.atan2(yeq, xeq)));
    const dec = degrees(Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)));
    return { raDeg: ra, decDeg: dec };
  }

  _planetRaDec(key, d, earthHelio) {
    const p = this._heliocentricEcliptic(key, d);
    return this._eclipticToEquatorial(p.x - earthHelio.x, p.y - earthHelio.y, p.z - earthHelio.z, d);
  }

  _sunRaDecFromEarth(earthHelio, d) {
    return this._eclipticToEquatorial(-earthHelio.x, -earthHelio.y, -earthHelio.z, d);
  }

  _radecToHorizontal(raDeg, decDeg, lstDeg, latDeg) {
    const H = radians(this._normDeg(lstDeg - raDeg));
    const lat = radians(latDeg);
    const dec = radians(decDeg);
    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) /
                  (Math.max(1e-8, Math.cos(alt) * Math.cos(lat)));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(H) > 0) az = TWO_PI - az;
    return { altDeg: degrees(alt), azDeg: degrees(az) };
  }

  _horizontalToScreen(altDeg, azDeg, cx, cy, scale) {
    if (altDeg < 0) return null;
    const alt = radians(altDeg);
    const az = radians(azDeg);
    const r = (HALF_PI - alt) / HALF_PI;
    return {
      x: cx + Math.sin(az) * r * scale,
      y: cy - Math.cos(az) * r * scale,
    };
  }

  _angularSeparationDeg(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
    const ra1 = radians(ra1Deg), dec1 = radians(dec1Deg);
    const ra2 = radians(ra2Deg), dec2 = radians(dec2Deg);
    const cosSep = Math.sin(dec1) * Math.sin(dec2) +
                   Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
    return degrees(Math.acos(Math.max(-1, Math.min(1, cosSep))));
  }

  _moonPhaseFraction() {
    // Known new moon anchor: 2000-01-06 18:14 UTC. Uses the scene's date.
    const synodicMonth = 29.530588853;
    const now = NCV_SKY.sceneDate().getTime();
    const anchor = Date.UTC(2000, 0, 6, 18, 14, 0);
    const days = (now - anchor) / 86400000;
    return ((days % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth;
  }

  _drawDistantFlash() {
    if (this.distantFlashAlpha <= 1) return;
    const a = this.distantFlashAlpha;
    
    let sx, sy, r;
    if (this.isHeat && this.heatOriginX !== undefined) {
      // Localized cloud glow
      sx = this.heatOriginX;
      sy = this.heatOriginY;
      r = Math.max(width, height) * 0.35;
    } else {
      // Edge-based horizon flash
      const ang = this.distantFlashAngle;
      sx = width * 0.5 + Math.cos(ang) * width * 0.85;
      sy = height * 0.5 + Math.sin(ang) * height * 0.85;
      r = Math.max(width, height) * 0.72;
    }

    const grad = drawingContext.createRadialGradient(sx, sy, 0, sx, sy, r);
    grad.addColorStop(0,   `rgba(215,232,255,${(a/255*0.55).toFixed(3)})`);
    grad.addColorStop(0.38,`rgba(200,222,255,${(a/255*0.22).toFixed(3)})`);
    grad.addColorStop(1.0, `rgba(185,210,255,0)`);
    drawingContext.save();
    drawingContext.fillStyle = grad;
    drawingContext.fillRect(0, 0, width, height);
    drawingContext.restore();

    // Reset heat state once alpha is very low
    if (a < 2) this.isHeat = false;
  }

  // Draw all active bolts — each fades independently.
  // Uses raw canvas 2D API with batched paths for performance:
  //   - Glow + mid passes: all segments in ONE beginPath() → ONE stroke() call each.
  //   - Core pass: group segments by depth so strokeWeight changes are minimised.
  _drawLightningBolt() {
    if (this.lightningBolts.length === 0) return;
    const dc = drawingContext;
    dc.save();
    dc.lineCap = 'round';
    noStroke(); // prevent p5 from overwriting canvas state

    for (const bolt of this.lightningBolts) {
      if (bolt.alpha <= 0) continue;
      const a    = constrain(bolt.alpha, 0, 255) / 255;
      const segs = bolt.segments;
      if (segs.length === 0) continue;

      // --- Glow pass: all segments → one path ---
      dc.lineWidth   = bolt.weight * 4.5;
      dc.strokeStyle = `rgba(190,220,255,${(a * 0.30).toFixed(3)})`;
      dc.beginPath();
      for (const s of segs) { dc.moveTo(s.x1, s.y1); dc.lineTo(s.x2, s.y2); }
      dc.stroke();

      // --- Mid glow: all segments → one path ---
      dc.lineWidth   = bolt.weight * 2.2;
      dc.strokeStyle = `rgba(220,238,255,${(a * 0.55).toFixed(3)})`;
      dc.beginPath();
      for (const s of segs) { dc.moveTo(s.x1, s.y1); dc.lineTo(s.x2, s.y2); }
      dc.stroke();

      // --- Core: group by depth to minimise lineWidth changes ---
      dc.strokeStyle = `rgba(235,248,255,${a.toFixed(3)})`;
      const sorted = segs.slice().sort((a, b) => b.depth - a.depth);
      let curW = -1;
      dc.beginPath();
      for (const s of sorted) {
        const w = bolt.weight * (0.35 + (s.depth / 5) * 0.65);
        if (Math.abs(w - curW) > 0.08) {
          if (curW >= 0) dc.stroke();
          dc.beginPath();
          curW = w;
          dc.lineWidth = curW;
        }
        dc.moveTo(s.x1, s.y1);
        dc.lineTo(s.x2, s.y2);
      }
      if (curW >= 0) dc.stroke();
    }

    dc.restore();
  }
}

// ============================================================
// AtmosphereAudio — procedural ambience bus
//
// Everything is synthesised so the install works offline, but two kinds of
// recordings are picked up automatically if present:
//   audio/thunder/thunder-{1..4}.{mp3,ogg,wav}  → replaces synth thunder
//   audio/scenes/<name>.{mp3,ogg,wav}           → loop for env.sceneAudio=<name>
//
// Signal flow:   sources → bus ─┬─ dry ──────┐
//                               └─ convolver ┴─ master → destination
// The convolver uses a generated 2.2 s impulse so distant sounds sit "outside".
// Point sounds (birds, crickets, drops, crackles, thunder peals) are panned.
// Thunder has a dedicated sub-bass layer (28–45 Hz) for a subwoofer / shaker.
// ============================================================
class AtmosphereAudio {
  constructor() {
    this.ctx = null;
    this.master = null;   // final gain — sketch.js zeroes this on sleep
    this.bus = null;
    this.enabled = false;

    // Beds
    this.windGain = null; this.filteredWind = null; this.windRoarGain = null;
    this.rainGain = null; this.filteredRain = null; this.rainPatterGain = null;
    this.baseNoise = null;
    this.gust = { value: 0.5, target: 0.5, nextAt: 0 };

    // Scheduling
    this.nextCricket = 0;
    this.nextBird = 0;
    this.nextNightBird = 0;
    this.nextCrackle = 0;
    this.nextPop = 0;
    this.cricketVoices = [];
    this.birdVoices = [];
    this.birdVoiceRefreshAt = 0;

    // Scenes
    this.scene = { current: '', nodes: {}, gains: {}, loading: {} };

    this.thunderBuffers = [];
    this.thunderLoaded = false;
  }

  enable() {
    if (!this.ctx) this._init();
    if (!this.ctx) return;
    this.ctx.resume();
    this.enabled = true;
    if (!this.thunderLoaded) this._loadThunderSamples();
  }

  // ---------------------------------------------------------- graph
  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.bus = ctx.createGain();
    this.dry = ctx.createGain();
    this.dry.gain.value = 1.0;
    this.bus.connect(this.dry);
    this.dry.connect(this.master);

    try {
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this._makeImpulse(2.2, 2.6);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.30;
      this.bus.connect(this.convolver);
      this.convolver.connect(this.wet);
      this.wet.connect(this.master);
    } catch (_) { /* no convolver: dry only */ }

    const noise = this._createLoopingNoise();
    this.baseNoise = noise;

    // Wind: hiss (low-pass, cutoff moves with gusts) + roar (band-pass body).
    this.filteredWind = ctx.createBiquadFilter();
    this.filteredWind.type = 'lowpass';
    this.filteredWind.frequency.value = 650;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.filteredWind);
    this.filteredWind.connect(this.windGain);
    this.windGain.connect(this.bus);

    this.windRoar = ctx.createBiquadFilter();
    this.windRoar.type = 'bandpass';
    this.windRoar.frequency.value = 160;
    this.windRoar.Q.value = 0.6;
    this.windRoarGain = ctx.createGain();
    this.windRoarGain.gain.value = 0;
    noise.connect(this.windRoar);
    this.windRoar.connect(this.windRoarGain);
    this.windRoarGain.connect(this.bus);

    // Rain: broadband hiss + bright patter band. Individual drops are scheduled.
    this.filteredRain = ctx.createBiquadFilter();
    this.filteredRain.type = 'highpass';
    this.filteredRain.frequency.value = 1300;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    noise.connect(this.filteredRain);
    this.filteredRain.connect(this.rainGain);
    this.rainGain.connect(this.bus);

    this.rainPatter = ctx.createBiquadFilter();
    this.rainPatter.type = 'bandpass';
    this.rainPatter.frequency.value = 4200;
    this.rainPatter.Q.value = 1.1;
    this.rainPatterGain = ctx.createGain();
    this.rainPatterGain.gain.value = 0;
    noise.connect(this.rainPatter);
    this.rainPatter.connect(this.rainPatterGain);
    this.rainPatterGain.connect(this.bus);

    noise.start();
  }

  _createLoopingNoise(seconds = 2) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const buffer = this.ctx.createBuffer(1, n, sr);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  _createBrownNoise(seconds = 3) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const buffer = this.ctx.createBuffer(1, n, sr);
    const out = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      out[i] = last * 3.5;
    }
    // Soften the loop seam.
    const fade = Math.min(2048, n >> 2);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      out[i] *= k;
      out[n - 1 - i] *= k;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  _makeImpulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const env = Math.pow(1 - i / n, decay);
        // Progressive low-pass: highs die first, like outdoors.
        lp += (Math.random() * 2 - 1 - lp) * (0.35 - 0.25 * (i / n));
        d[i] = lp * env;
      }
    }
    return buf;
  }

  _panner(pan = 0) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    return this.ctx.createGain();
  }

  // ---------------------------------------------------------- per-frame
  update() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const ms = millis();
    const sky = NCV_SKY.phase();
    const isNight = sky.isNight;
    const isDawn = sky.morning && sky.alt >= -6 && sky.alt < 12;   // dawn chorus window
    const isDusk = !sky.morning && sky.alt >= -8 && sky.alt < 4;

    const master = constrain(env.soundMaster ?? 0.5, 0, 1);
    this.master.gain.setTargetAtTime(env.sleeping ? 0 : master * 0.75, now, 0.15);

    // ---- wind with gusts ----
    const windLvl = constrain(env.soundWind ?? 0.35, 0, 1);
    const wind = constrain(env.windSpeed ?? 0.2, 0, 1);
    const storm = env.currentWeather === 'storm';
    const rain = env.currentWeather === 'rain';
    const stormMul = storm ? 1.0 : (rain ? 0.65 : 0.14);
    if (ms > this.gust.nextAt) {
      this.gust.target = 0.25 + Math.random() * 0.75 * (0.4 + wind);
      this.gust.nextAt = ms + random(2500, 9000) / (0.5 + wind);
    }
    this.gust.value += (this.gust.target - this.gust.value) * 0.02 * (window._ncvAnimDt || 1);
    const g = this.gust.value;
    const windAmt = (0.01 + wind * 0.07) * windLvl * (0.5 + stormMul) * (0.55 + g * 0.9);
    this.windGain.gain.setTargetAtTime(windAmt, now, 0.4);
    this.filteredWind.frequency.setTargetAtTime(320 + wind * 900 + g * 900, now, 0.6);
    this.windRoarGain.gain.setTargetAtTime(windAmt * 0.9 * (0.3 + wind), now, 0.5);
    this.windRoar.frequency.setTargetAtTime(110 + g * 120, now, 0.8);

    // ---- rain ----
    const rainLvl = constrain(env.soundRain ?? 0.4, 0, 1);
    const rainK = storm ? 1.0 : (rain ? 0.7 : 0.0);
    this.rainGain.gain.setTargetAtTime(rainK * rainLvl * 0.055, now, 0.6);
    this.rainPatterGain.gain.setTargetAtTime(rainK * rainLvl * 0.03, now, 0.6);
    if (rainK > 0 && rainLvl > 0.02) {
      // Individual drops: a few per frame at most.
      const perSec = 6 + rainK * 26;
      let n = 0;
      let p = perSec / 30 * (window._ncvAnimDt || 1) / 2;
      while (p > 0 && n < 3) {
        if (Math.random() < p) { this._playDrop(rainLvl * rainK); n++; }
        p -= 1;
      }
    }

    // ---- crickets: rate follows temperature (Dolbear's law) ----
    const cricketLvl = constrain(env.soundCrickets ?? 0.4, 0, 1);
    if ((isNight || isDusk) && cricketLvl > 0.01 && rainK < 0.9) {
      this._updateCrickets(ms, cricketLvl * (isDusk ? 0.6 : 1) * (1 - rainK * 0.6));
    }

    // ---- birds ----
    const birdLvl = constrain(env.soundBirds ?? 0.35, 0, 1);
    if (!isNight && birdLvl > 0.01) {
      if (ms > this.birdVoiceRefreshAt) this._refreshBirdVoices(ms);
      if (ms > this.nextBird) {
        const chorus = isDawn ? 2.2 : (isDusk ? 1.4 : 1.0);
        const quiet = 1 - rainK * 0.7 - (storm ? 0.3 : 0);
        if (quiet > 0.1) this._playBirdSong(birdLvl * Math.min(1, quiet), isDawn);
        this.nextBird = ms + random(1500, 6500) / chorus;
      }
    }

    // ---- owls / night birds ----
    const nightLvl = constrain(env.soundNightBirds ?? 0.25, 0, 1);
    if (isNight && nightLvl > 0.01 && ms > this.nextNightBird) {
      if (rainK < 0.8) this._playOwl(nightLvl);
      this.nextNightBird = ms + random(7000, 20000);
    }

    // ---- scene beds ----
    this._updateScene(ms);
  }

  // ---------------------------------------------------------- crickets
  _updateCrickets(ms, level) {
    const tC = Number.isFinite(env.liveTemperatureC) ? env.liveTemperatureC : 16;
    const tF = tC * 9 / 5 + 32;
    if (tF < 50) return;                           // too cold: silence
    const perMin = Math.max(20, 40 + 4 * (tF - 50));   // Dolbear
    const coldFade = constrain((tF - 50) / 12, 0.15, 1);
    if (this.cricketVoices.length === 0) {
      for (let i = 0; i < 3; i++) {
        this.cricketVoices.push({
          freq: random(3900, 5100),
          pan: random(-0.8, 0.8),
          gain: random(0.5, 1.0),
          phaseMs: random(0, 800),
          nextAt: ms + random(0, 800),
          pulses: 3 + Math.floor(random(2)),
        });
      }
    }
    for (const v of this.cricketVoices) {
      if (ms < v.nextAt) continue;
      const period = 60000 / (perMin * random(0.92, 1.08));
      v.nextAt = ms + period;
      if (Math.random() < 0.12) { v.nextAt += period * random(2, 6); continue; } // breathers
      this._playCricketChirp(v, level * coldFade * 0.035);
    }
  }

  _playCricketChirp(v, gainPeak) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = v.freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    const pulseLen = 0.014, gap = 0.011;
    for (let i = 0; i < v.pulses; i++) {
      const t = t0 + i * (pulseLen + gap);
      g.gain.linearRampToValueAtTime(gainPeak * v.gain, t + 0.003);
      g.gain.linearRampToValueAtTime(gainPeak * v.gain * 0.85, t + pulseLen - 0.003);
      g.gain.linearRampToValueAtTime(0.0001, t + pulseLen);
    }
    const pan = this._panner(v.pan);
    osc.connect(g); g.connect(pan); pan.connect(this.bus);
    const end = t0 + v.pulses * (pulseLen + gap) + 0.02;
    osc.start(t0); osc.stop(end);
  }

  // ---------------------------------------------------------- birds
  _refreshBirdVoices(ms) {
    this.birdVoiceRefreshAt = ms + 90000;
    this.birdVoices = [];
    const n = 3 + Math.floor(random(3));
    for (let i = 0; i < n; i++) {
      const kind = random(['whistler', 'triller', 'chipper', 'warbler']);
      this.birdVoices.push({
        kind,
        base: kind === 'chipper' ? random(2600, 3800) : random(1300, 2600),
        pan: random(-0.9, 0.9),
        dist: random(0.15, 1.0),          // 1 = far
        syll: 2 + Math.floor(random(kind === 'chipper' ? 6 : 4)),
        gap: random(0.06, 0.22),
      });
    }
  }

  _playBirdSong(level, isDawn) {
    if (this.birdVoices.length === 0) return;
    const v = random(this.birdVoices);
    const ctx = this.ctx;
    const pan = this._panner(v.pan);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000 - v.dist * 3200;
    const out = ctx.createGain();
    out.gain.value = level * 0.10 * (1 - v.dist * 0.65) * (isDawn ? 1.15 : 1);
    lp.connect(pan); pan.connect(out); out.connect(this.bus);

    let t = ctx.currentTime + 0.02;
    const syllables = v.syll + Math.floor(random(-1, 2));
    for (let s = 0; s < Math.max(1, syllables); s++) {
      const dur = v.kind === 'chipper' ? random(0.05, 0.09) : (v.kind === 'triller' ? random(0.25, 0.5) : random(0.12, 0.28));
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = v.base * random(0.9, 1.1);
      if (v.kind === 'whistler') {
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f0 * random(1.25, 1.7), t + dur * 0.55);
        osc.frequency.exponentialRampToValueAtTime(f0 * random(0.85, 1.05), t + dur);
      } else if (v.kind === 'warbler') {
        osc.frequency.setValueAtTime(f0 * random(1.2, 1.5), t);
        osc.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.4);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + dur);
      } else if (v.kind === 'chipper') {
        osc.frequency.setValueAtTime(f0 * 1.3, t);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
      } else { // triller: FM
        osc.frequency.setValueAtTime(f0, t);
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = random(16, 30);
        const lfoG = ctx.createGain();
        lfoG.gain.value = f0 * 0.18;
        lfo.connect(lfoG); lfoG.connect(osc.frequency);
        lfo.start(t); lfo.stop(t + dur + 0.02);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1.0, t + Math.min(0.02, dur * 0.3));
      g.gain.setValueAtTime(1.0, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.02);
      t += dur + v.gap * random(0.7, 1.4);
    }
  }

  _playOwl(level) {
    const ctx = this.ctx;
    const pan = this._panner(random(-0.7, 0.7));
    const dist = random(0.3, 1.0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 - dist * 700;
    const out = ctx.createGain();
    out.gain.value = level * 0.14 * (1 - dist * 0.6);
    lp.connect(pan); pan.connect(out); out.connect(this.bus);
    let t = ctx.currentTime + 0.02;
    const f = random(330, 420);
    const notes = Math.random() < 0.5 ? [0.28, 0.24, 0.55] : [0.32, 0.6];
    for (let i = 0; i < notes.length; i++) {
      const dur = notes[i];
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f * (i === notes.length - 1 ? 0.94 : 1), t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 0.06);
      g.gain.setValueAtTime(1, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // breathy component
      const br = this._createLoopingNoise(0.5);
      const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = f * 2.2; bf.Q.value = 3;
      const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.12, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      br.connect(bf); bf.connect(bg); bg.connect(lp);
      br.start(t); br.stop(t + dur + 0.02);
      osc.connect(g); g.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.02);
      t += dur + (i === 0 ? 0.12 : 0.28);
    }
  }

  // ---------------------------------------------------------- rain drops
  _playDrop(level) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = random(0.008, 0.03);
    const src = this._createLoopingNoise(0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = random(1800, 6500);
    bp.Q.value = random(2, 6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level * random(0.02, 0.07), t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const pan = this._panner(random(-1, 1));
    src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.bus);
    src.start(t0); src.stop(t0 + dur + 0.01);
  }

  // ---------------------------------------------------------- thunder
  playThunder(intensity = 1, isImmediate = false) {
    if (!this.enabled || !this.ctx) return;
    const lvl = constrain(env.soundThunder ?? 0.6, 0, 1);
    if (lvl <= 0.01) return;
    const delay = isImmediate ? 0 : random(0.25, 1.15);
    const t0 = this.ctx.currentTime + delay;
    const power = lvl * constrain(intensity, 0, 1);
    const distance = 1 - constrain(intensity, 0, 1); // 0 = overhead
    if (this.thunderBuffers.length > 0) {
      this._playThunderSample(t0, power, distance);
      return;
    }
    this._playThunderSynth(t0, power, distance);
  }

  _playThunderSynth(t0, power, distance) {
    const ctx = this.ctx;
    const close = 1 - distance;

    // 1) Crack / tear — only when close. Two bands: a snap and a rip.
    if (close > 0.45) {
      const snapK = (close - 0.45) / 0.55;
      this._thunderNoiseBurst({ start: t0, duration: 0.05, gain: 0.55 * power * snapK, filterType: 'highpass', freq: 2400, pan: random(-0.3, 0.3) });
      this._thunderNoiseBurst({ start: t0 + 0.02, duration: 0.22, gain: 0.45 * power * snapK, filterType: 'bandpass', freq: 900, q: 0.8, pan: random(-0.5, 0.5) });
      this._thunderNoiseBurst({ start: t0 + 0.05, duration: 0.6, gain: 0.35 * power * snapK, filterType: 'bandpass', freq: 380, q: 0.7, pan: random(-0.5, 0.5) });
    }

    // 2) Rolling peals — several overlapping low rumbles that wander in stereo.
    const peals = 3 + Math.floor(random(3)) + (close > 0.6 ? 1 : 0);
    let t = t0 + (close > 0.45 ? 0.08 : 0.0);
    let amp = 0.9;
    for (let i = 0; i < peals; i++) {
      const dur = random(1.2, 3.2) + distance * 1.2;
      const cutoff = (140 + close * 140) * random(0.75, 1.25) * (1 - i * 0.08);
      this._thunderPeal({
        start: t,
        duration: dur,
        gain: power * amp * random(0.6, 1.0),
        cutoff,
        panFrom: random(-0.9, 0.9),
        panTo: random(-0.9, 0.9),
        attack: random(0.05, 0.35) + distance * 0.3,
      });
      t += random(0.25, 1.1) * (0.7 + distance * 0.6);
      amp *= random(0.55, 0.85);
    }

    // 3) Sub layer for the subwoofer / shaker: pitched 42→27 Hz.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(42 - distance * 6, t0 + 0.02);
    sub.frequency.exponentialRampToValueAtTime(27, t0 + 3.0);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t0);
    subG.gain.exponentialRampToValueAtTime(0.7 * power * (0.5 + close * 0.5), t0 + 0.12 + distance * 0.25);
    subG.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6 + close * 1.2);
    sub.connect(subG);
    subG.connect(this.master); // straight to master: reverb would smear the sub
    sub.start(t0); sub.stop(t0 + 4.2);

    // 4) Long airy tail.
    this._thunderNoiseBurst({ start: t + 0.2, duration: 4.5 + distance * 3, gain: 0.16 * power, filterType: 'bandpass', freq: 120, q: 0.6, pan: random(-0.4, 0.4) });
  }

  _thunderPeal({ start, duration, gain, cutoff, panFrom, panTo, attack }) {
    const ctx = this.ctx;
    const src = this._createLoopingNoise(1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(cutoff * 1.6, start);
    lp.frequency.exponentialRampToValueAtTime(Math.max(45, cutoff * 0.45), start + duration);
    // Slow amplitude wobble so it "rolls".
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    const wobbles = Math.max(2, Math.floor(duration / 0.35));
    for (let i = 1; i <= wobbles; i++) {
      const tt = start + attack + (duration - attack) * (i / wobbles);
      const k = Math.pow(1 - i / wobbles, 1.4);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, gain * k * random(0.45, 1.0)), tt);
    }
    g.gain.linearRampToValueAtTime(0.0001, start + duration + 0.05);
    const pan = this._panner(panFrom);
    if (pan.pan) pan.pan.linearRampToValueAtTime(panTo, start + duration);
    src.connect(lp); lp.connect(g); g.connect(pan); pan.connect(this.bus);
    src.start(start); src.stop(start + duration + 0.1);
  }

  _thunderNoiseBurst({ start, duration, gain, filterType, freq, q = 1, pan = 0 }) {
    const src = this._createLoopingNoise(Math.min(2, duration + 0.2));
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(0.12, duration * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    const p = this._panner(pan);
    src.connect(filt); filt.connect(g); g.connect(p); p.connect(this.bus);
    src.start(start); src.stop(start + duration + 0.05);
  }

  async _loadThunderSamples() {
    if (!this.ctx) return;
    this.thunderLoaded = true;
    const decoded = [];
    for (let i = 1; i <= 4; i++) {
      for (const ext of ['mp3', 'ogg', 'wav']) {
        try {
          const res = await fetch(`audio/thunder/thunder-${i}.${ext}`);
          if (!res.ok) continue;
          const arr = await res.arrayBuffer();
          decoded.push(await this.ctx.decodeAudioData(arr.slice(0)));
          break;
        } catch (_) { /* try next */ }
      }
    }
    this.thunderBuffers = decoded;
    if (decoded.length) console.log(`[audio] ${decoded.length} thunder recording(s) loaded`);
  }

  _playThunderSample(t0, power, distance = 0.3) {
    const sample = random(this.thunderBuffers);
    if (!sample) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = random(0.9, 1.1);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 2400 - distance * 1900; // far thunder loses its highs
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1.0 * power, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(3.2, sample.duration * 1.05));
    const pan = this._panner(random(-0.5, 0.5));
    src.connect(low); low.connect(g); g.connect(pan); pan.connect(this.bus);
    src.start(t0);
    src.stop(t0 + Math.max(3.4, sample.duration * 1.1));
  }

  // ---------------------------------------------------------- scenes
  // env.sceneAudio names a bed. 'fire' and 'drone' are synthesised; any name
  // also tries audio/scenes/<name>.{mp3,ogg,wav} as a loop (file wins).
  _updateScene(ms) {
    const want = String(env.sceneAudio || '').trim().toLowerCase();
    const now = this.ctx.currentTime;
    if (want !== this.scene.current) {
      this.scene.current = want;
      if (want) this._ensureScene(want);
    }
    for (const name of Object.keys(this.scene.gains)) {
      const target = (name === want) ? this._sceneLevel(name) : 0;
      this.scene.gains[name].gain.setTargetAtTime(target, now, 2.5);
    }
    if (want === 'fire' && this.scene.nodes.fire) this._tickFire(ms);
  }

  _sceneLevel(name) {
    const master = constrain(env.soundMaster ?? 0.5, 0, 1);
    const base = name === 'fire' ? 0.55 : (name === 'drone' ? 0.35 : 0.6);
    return base * (0.5 + master * 0.5);
  }

  _ensureScene(name) {
    if (this.scene.gains[name]) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.bus);
    this.scene.gains[name] = g;
    // Try a file first; fall back to a synth bed for known names.
    this._loadSceneLoop(name, g).then((ok) => {
      if (ok) return;
      if (name === 'fire') this._buildFire(g);
      else if (name === 'drone') this._buildDrone(g);
    });
  }

  async _loadSceneLoop(name, out) {
    for (const ext of ['mp3', 'ogg', 'wav']) {
      try {
        const res = await fetch(`audio/scenes/${name}.${ext}`);
        if (!res.ok) continue;
        const buf = await this.ctx.decodeAudioData((await res.arrayBuffer()).slice(0));
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        src.connect(out); src.start();
        this.scene.nodes[name] = { src, file: true };
        console.log(`[audio] scene loop loaded: ${name}.${ext}`);
        return true;
      } catch (_) { /* next */ }
    }
    return false;
  }

  _buildFire(out) {
    const ctx = this.ctx;
    const bed = this._createBrownNoise(3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const bedG = ctx.createGain(); bedG.gain.value = 0.25;
    bed.connect(lp); lp.connect(bedG); bedG.connect(out); bed.start();
    const hiss = this._createLoopingNoise(2);
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 0.7;
    const hissG = ctx.createGain(); hissG.gain.value = 0.012;
    hiss.connect(hp); hp.connect(hissG); hissG.connect(out); hiss.start();
    this.scene.nodes.fire = { bed, hiss, out };
  }

  _tickFire(ms) {
    const out = this.scene.nodes.fire.out;
    if (ms > this.nextCrackle) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const n = 1 + Math.floor(random(3));
      for (let i = 0; i < n; i++) {
        const t = t0 + i * random(0.01, 0.06);
        const dur = random(0.006, 0.035);
        const src = this._createLoopingNoise(0.1);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = random(1200, 5200); bp.Q.value = random(2, 8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(random(0.05, 0.28), t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const pan = this._panner(random(-0.6, 0.6));
        src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(out);
        src.start(t); src.stop(t + dur + 0.01);
      }
      this.nextCrackle = ms + random(60, 420);
    }
    if (ms > this.nextPop) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(random(90, 160), t0);
      osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + 0.1);
      this.nextPop = ms + random(1500, 7000);
    }
  }

  _buildDrone(out) {
    // Low voices through drifting vowel formants: a stand-in for distant chant.
    const ctx = this.ctx;
    const vowels = [[450, 800], [700, 1100], [325, 700], [500, 1000]];
    const voices = [];
    const roots = [82.4, 110.0, 123.5, 164.8, 98.0];
    for (let i = 0; i < roots.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'sawtooth' : 'triangle';
      osc.frequency.value = roots[i] * random(0.995, 1.005);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7;
      const mix = ctx.createGain(); mix.gain.value = 0.16;
      const swell = ctx.createGain(); swell.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = random(0.04, 0.09);
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.45;
      lfo.connect(lfoG); lfoG.connect(swell.gain);
      const pan = this._panner(random(-0.7, 0.7));
      osc.connect(f1); osc.connect(f2); f1.connect(mix); f2.connect(mix);
      mix.connect(swell); swell.connect(pan); pan.connect(out);
      osc.start(); lfo.start();
      voices.push({ osc, f1, f2, lfo });
    }
    // Drift the formants between vowels every few seconds.
    const drift = () => {
      if (!this.scene.nodes.drone) return;
      const now = ctx.currentTime;
      for (const v of voices) {
        const vw = random(vowels);
        v.f1.frequency.setTargetAtTime(vw[0] * random(0.95, 1.05), now, 2.5);
        v.f2.frequency.setTargetAtTime(vw[1] * random(0.95, 1.05), now, 2.5);
      }
      this.scene.nodes.drone.timer = setTimeout(drift, random(3500, 8000));
    };
    this.scene.nodes.drone = { voices, timer: null };
    drift();
  }
}
