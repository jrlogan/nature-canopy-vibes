// ============================================================
// atmosphere.js — Clouds, sun/moon, lightning, and ambient audio
// ============================================================

class AtmosphereSystem {
  constructor() {
    this.clouds = [];
    this.flashAlpha = 0;
    this.lightningSegments = [];
    this.nextLightningAt = millis() + random(3000, 11000);
    this.audio = new AtmosphereAudio();
    this._flashPeak = 0;
    this._cloudCoreBuf = null; // Offscreen buffer for dense cloud mass
    this._cloudWispBuf = null; // Offscreen buffer for wispy cloud fringe
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
        y: random(height * 0.04, height * 0.52),
        size: random(90, 300),
        drift: random(0.15, 0.9),
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

    for (const c of this.clouds) {
      c.x += (0.05 + wind * c.drift) * weatherBoost;
      c.y += sin((frameCount * 0.002) + c.seed) * 0.06;
      if (c.x > width + c.size * 0.8) c.x = -c.size * 1.2;
    }

    this._updateLightning();
    window._ncvFlashAlpha = this.flashAlpha;
    this.audio.update();
  }

  _updateLightning() {
    if (env.currentWeather !== 'storm') {
      this.flashAlpha = max(0, this.flashAlpha - 18);
      return;
    }

    const now = millis();
    if (now >= this.nextLightningAt) {
      this._triggerLightning();
      this.nextLightningAt = now + random(2000, 9000);
    }

    this.flashAlpha = max(0, this.flashAlpha - 24);
  }

  _triggerLightning() {
    this.flashAlpha = random(190, 255);
    this._flashPeak = this.flashAlpha;
    this.lightningSegments = [];

    let x = random(width * 0.25, width * 0.75);
    let y = -20;
    const steps = floor(random(7, 12));
    for (let i = 0; i < steps; i++) {
      const nx = x + random(-40, 40);
      const ny = y + random(height * 0.04, height * 0.10);
      this.lightningSegments.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    }

    if (window._ncvSocket && window._ncvSocket.connected) {
      window._ncvSocket.emit('lightning_strike');
    }
    const intensity = constrain(this._flashPeak / 255, 0.7, 1.0);
    this.audio.playThunder(intensity);
  }

  drawSky() {
    this._drawOvercastWash();
    this._drawSunAndMoon();
    this._drawClouds();
    this._drawFlashSkyWash();
    this._drawLightningBolt();
  }

  drawOverlay() {
    // No post-foreground wash: we want trees to stay dark silhouettes.
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
    const resScale = 0.55 * q;
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

    for (const c of this.clouds) {
      const t = noise(c.seed, frameCount * 0.002);
      const cloudDark = env.currentWeather === 'storm' ? 26 : (env.currentWeather === 'rain' ? 58 : 78);
      const cloudLight = env.currentWeather === 'storm' ? 72 : (env.currentWeather === 'rain' ? 120 : 140);
      const shade = lerp(cloudDark, cloudLight, t);
      const aCore = alphaBase * lerp(0.68, 1.0, t);
      const aWisp = alphaBase * lerp(0.36, 0.62, t);

      const bandCount = Math.max(2, Math.floor(c.flowBands + c.puff * 0.22));
      const flowA = c.flowAngle + Math.sin(frameCount * 0.00045 + c.seed) * 0.10;
      const flowLen = c.size * c.flowLen;

      for (let i = 0; i < bandCount; i++) {
        const bandT = bandCount === 1 ? 0.5 : (i / (bandCount - 1));
        const px = c.x + (bandT - 0.5) * c.size * 0.9 + Math.sin(c.seed + i * 1.7) * 10;
        const py = c.y + Math.sin(c.seed * 0.8 + i * 0.9 + frameCount * 0.0012) * c.size * 0.10;
        const coreThick = c.size * lerp(0.20, 0.34, noise(c.seed + i * 0.21));
        const wispThick = coreThick * (1.5 + c.wispSpread * 0.8);

        // Dense flowing core ribbon.
        gCore.fill(shade, shade + 6, shade + 14, aCore * lerp(0.82, 1.0, bandT));
        this._drawCloudRibbon(
          gCore, px, py, flowLen * lerp(0.66, 1.0, bandT), coreThick,
          flowA + (bandT - 0.5) * 0.18, c.coreSides, c.jag * 0.85, c.seed + i * 17.3
        );

        // Wispy flowing shell ribbon.
        gWisp.fill(shade + 8, shade + 12, shade + 18, aWisp * lerp(0.75, 1.0, bandT));
        this._drawCloudRibbon(
          gWisp,
          px + Math.sin(c.seed + i * 0.8) * 8,
          py + Math.cos(c.seed * 0.6 + i + frameCount * 0.001) * 5,
          flowLen * (0.84 + c.wispSpread * 0.45),
          wispThick,
          flowA + (bandT - 0.5) * 0.26,
          c.wispSides,
          c.jag * 1.45,
          c.seed + i * 29.7
        );
      }
    }
    gCore.pop();
    gWisp.pop();

    // Composite: dense part mostly crisp, wispy part heavily blurred.
    image(gCore, 0, 0, width, height);

    const wispBlurPx = constrain((env.skyBlur ?? 1.2) * (6.6 + cover * 5.6) * q, 0, 32);
    if (wispBlurPx > 0.05) drawingContext.filter = `blur(${wispBlurPx.toFixed(2)}px)`;
    image(gWisp, 0, 0, width, height);
    if (wispBlurPx > 0.05) drawingContext.filter = 'none';
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
      const flowBend = Math.sin(t * TWO_PI * 1.15 + seed * 0.003 + frameCount * 0.0011) * thick * 0.22;
      const n = (noise(seed + t * 2.6, frameCount * 0.0018) - 0.5) * 2;
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
      const n = noise(seed + i * 0.23, frameCount * 0.002) * 2 - 1;
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
    const sun = this._celestialFromTime(t);
    const moon = this._moonFromTimeAndDate(t);
    const cover = constrain(env.cloudCover ?? 0.2, 0, 1);
    const heavyOvercast = cover > 0.72 || env.currentWeather === 'storm';
    const q = constrain(window._ncvQualityScale ?? 1, 0.5, 1);
    const blurPx = constrain((env.skyBlur ?? 1.2) * q, 0, 6);

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
        fill(255, 216, 140, 50 * haze);
        circle(sun.x, sun.y, 140);
        fill(255, 228, 165, 130 * haze);
        circle(sun.x, sun.y, 72);
        fill(255, 244, 205, 190 * haze);
        circle(sun.x, sun.y, 34);
      }
    }

    if (moon.visible) {
      const phase = moon.phase;
      const d = 42;
      const illum = 0.5 * (1 - cos(TWO_PI * phase)); // 0=new, 1=full
      const waxing = phase < 0.5;

      // Extremely soft, wide atmospheric bloom
      drawingContext.filter = blurPx > 0.05 ? `blur(${(blurPx * 10.5).toFixed(2)}px)` : 'none';
      noStroke();
      fill(170, 200, 255, heavyOvercast ? 5 : 10);
      circle(moon.x, moon.y, 320);
      fill(180, 210, 255, heavyOvercast ? 7 : 15);
      circle(moon.x, moon.y, 200);
      fill(195, 220, 255, heavyOvercast ? 10 : 22);
      circle(moon.x, moon.y, 120);
      drawingContext.filter = 'none';

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
        fill(205, 214, 226, 120 * (1 - cover * 0.45));
        circle(moon.x, moon.y, d);

        // Lit portion: bright ellipse shifted by phase, avoiding hard shadow edges.
        const litW = d * (0.16 + illum * 0.84);
        const offset = (waxing ? -1 : 1) * (d * 0.42 * (1 - illum));
        fill(240, 246, 255, (40 + illum * 190) * (1 - cover * 0.45));
        ellipse(moon.x + offset, moon.y, litW, d * 0.98);
      }
    }
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

  _celestialFromTime(hour) {
    if (hour < 6 || hour > 18) return { visible: false, x: 0, y: 0 };
    const p = map(hour, 6, 18, 0, 1);
    return {
      visible: true,
      x: lerp(width * 0.08, width * 0.92, p),
      y: height * (0.68 - sin(p * PI) * 0.56),
    };
  }

  _moonFromTimeAndDate(hour) {
    const phase = this._moonPhaseFraction();
    // Approx moon transit offset: new moon near sun, full moon opposite.
    const hourOffset = phase * 24;
    const moonHour = (hour + hourOffset) % 24;
    const visible = (moonHour >= 6 && moonHour <= 18);
    if (!visible) return { visible: false, x: 0, y: 0, phase };

    const p = map(moonHour, 6, 18, 0, 1);
    return {
      visible: true,
      phase,
      x: lerp(width * 0.12, width * 0.88, p),
      y: height * (0.70 - sin(p * PI) * 0.54),
    };
  }

  _moonPhaseFraction() {
    // Known new moon anchor: 2000-01-06 18:14 UTC.
    const synodicMonth = 29.530588853;
    const now = Date.now();
    const anchor = Date.UTC(2000, 0, 6, 18, 14, 0);
    const days = (now - anchor) / 86400000;
    return ((days % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth;
  }

  _drawLightningBolt() {
    if (this.flashAlpha <= 8 || this.lightningSegments.length === 0) return;
    stroke(230, 245, 255, 215);
    strokeWeight(2.2);
    for (const [x1, y1, x2, y2] of this.lightningSegments) {
      line(x1, y1, x2, y2);
    }
  }
}

class AtmosphereAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;

    this.windGain = null;
    this.rainGain = null;
    this.baseNoise = null;
    this.filteredWind = null;
    this.filteredRain = null;

    this.nextCricket = 0;
    this.nextBird = 0;
    this.nextNightBird = 0;
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

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    const noise = this._createLoopingNoise();

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.filteredWind = this.ctx.createBiquadFilter();
    this.filteredWind.type = 'lowpass';
    this.filteredWind.frequency.value = 650;
    noise.connect(this.filteredWind);
    this.filteredWind.connect(this.windGain);
    this.windGain.connect(this.master);

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    this.filteredRain = this.ctx.createBiquadFilter();
    this.filteredRain.type = 'highpass';
    this.filteredRain.frequency.value = 1300;
    noise.connect(this.filteredRain);
    this.filteredRain.connect(this.rainGain);
    this.rainGain.connect(this.master);

    this.baseNoise = noise;
    this.baseNoise.start();
  }

  _createLoopingNoise() {
    const bufferSize = 2 * (this.ctx ? this.ctx.sampleRate : 48000);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) out[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  update() {
    if (!this.enabled || !this.ctx) return;

    const now = this.ctx.currentTime;
    const isNight = env.timeOfDay < 6.5 || env.timeOfDay > 20.5;

    const master = constrain(env.soundMaster ?? 0.5, 0, 1);
    this.master.gain.setTargetAtTime(master * 0.75, now, 0.15);

    const windLvl = constrain(env.soundWind ?? 0.35, 0, 1);
    const rainLvl = constrain(env.soundRain ?? 0.4, 0, 1);
    const stormMul = env.currentWeather === 'storm' ? 1.0 : (env.currentWeather === 'rain' ? 0.65 : 0.14);

    this.windGain.gain.setTargetAtTime((0.01 + env.windSpeed * 0.06) * windLvl * (0.5 + stormMul), now, 0.25);
    this.filteredWind.frequency.setTargetAtTime(420 + env.windSpeed * 1200, now, 0.2);

    this.rainGain.gain.setTargetAtTime(stormMul * rainLvl * 0.07, now, 0.2);

    if (millis() > this.nextCricket && isNight) {
      this._playCricket(constrain(env.soundCrickets ?? 0.4, 0, 1));
      this.nextCricket = millis() + random(150, 1200);
    }

    if (millis() > this.nextBird && !isNight) {
      this._playBird(constrain(env.soundBirds ?? 0.35, 0, 1));
      this.nextBird = millis() + random(1200, 5200);
    }

    if (millis() > this.nextNightBird && isNight) {
      this._playNightBird(constrain(env.soundNightBirds ?? 0.25, 0, 1));
      this.nextNightBird = millis() + random(5000, 12000);
    }
  }

  playThunder(intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    const lvl = constrain(env.soundThunder ?? 0.6, 0, 1);
    if (lvl <= 0.01) return;

    // Keep thunder perceptibly linked to the flash, but still natural.
    const delay = random(0.25, 1.15);
    const t0 = this.ctx.currentTime + delay;
    const power = lvl * intensity;

    if (this.thunderBuffers.length > 0) {
      this._playThunderSample(t0, power);
      return;
    }

    // 1) Immediate crack transient (high-passed noise).
    this._thunderNoiseBurst({
      start: t0,
      duration: 0.24,
      gain: 0.36 * power,
      filterType: 'highpass',
      freq: 1100,
    });

    // 2) Main low rumble body (pitched, long decay).
    const rumbleOsc = this.ctx.createOscillator();
    rumbleOsc.type = 'triangle';
    rumbleOsc.frequency.setValueAtTime(86, t0 + 0.03);
    rumbleOsc.frequency.exponentialRampToValueAtTime(31, t0 + 3.6);

    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, t0);
    rumbleGain.gain.exponentialRampToValueAtTime(0.88 * power, t0 + 0.11);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.2);

    // Slight low-pass to thicken and reduce harshness.
    const rumbleLP = this.ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.setValueAtTime(420, t0);
    rumbleLP.frequency.exponentialRampToValueAtTime(170, t0 + 5.0);

    rumbleOsc.connect(rumbleLP);
    rumbleLP.connect(rumbleGain);
    rumbleGain.connect(this.master);
    rumbleOsc.start(t0);
    rumbleOsc.stop(t0 + 5.4);

    // 3) Rolling tail air/noise to make thunder more dramatic.
    this._thunderNoiseBurst({
      start: t0 + 0.12,
      duration: 4.9,
      gain: 0.26 * power,
      filterType: 'bandpass',
      freq: 170,
      q: 0.9,
    });
  }

  async _loadThunderSamples() {
    if (!this.ctx) return;
    this.thunderLoaded = true;

    const candidates = [
      'audio/thunder/thunder-1.mp3',
      'audio/thunder/thunder-2.mp3',
      'audio/thunder/thunder-3.mp3',
      'audio/thunder/thunder-4.mp3',
      'audio/thunder/thunder-1.ogg',
      'audio/thunder/thunder-2.ogg',
      'audio/thunder/thunder-3.ogg',
      'audio/thunder/thunder-4.ogg',
      'audio/thunder/thunder-1.wav',
      'audio/thunder/thunder-2.wav',
      'audio/thunder/thunder-3.wav',
      'audio/thunder/thunder-4.wav',
    ];

    const decoded = [];
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr.slice(0));
        decoded.push(buf);
      } catch (_) {
        // Ignore missing/unreadable files; synthesis fallback remains active.
      }
    }
    this.thunderBuffers = decoded;
  }

  _playThunderSample(t0, power) {
    const sample = random(this.thunderBuffers);
    if (!sample) return;

    const src = this.ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = random(0.9, 1.1);

    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 1600;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1.0 * power, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(3.2, sample.duration * 1.05));

    src.connect(low);
    low.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + Math.max(3.4, sample.duration * 1.1));
  }

  _thunderNoiseBurst({ start, duration, gain, filterType, freq, q = 1 }) {
    const src = this._createLoopingNoise();
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.12, duration * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(start);
    src.stop(start + duration + 0.05);
  }

  _playCricket(level) {
    if (level <= 0.01 || random() > 0.55) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = random(3200, 4800);
      const t = t0 + i * random(0.03, 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level * 0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.08);
    }
  }

  _playBird(level) {
    if (level <= 0.01) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(random(1100, 1700), t0);
    osc.frequency.exponentialRampToValueAtTime(random(1900, 2600), t0 + 0.08);
    osc.frequency.exponentialRampToValueAtTime(random(1200, 1600), t0 + 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level * 0.08, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  }

  _playNightBird(level) {
    if (level <= 0.01) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(random(350, 560), t0);
    osc.frequency.exponentialRampToValueAtTime(random(620, 760), t0 + 0.20);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level * 0.08, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.30);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.34);
  }
}
