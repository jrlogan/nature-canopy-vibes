// ============================================================
// stars.js — Accurate star field (Yale BSC / Hipparcos)
// Features:
//   • ~120 real stars with spectral RGB tints
//   • Azimuthal equidistant projection (fisheye looking up)
//   • Optional constellation lines + labels (toggle: C key / panel)
//   • Milky Way as a wide diffuse glow band
//   • Perlin twinkling + shadowBlur glow for bright stars
// ============================================================

// Global toggle fallback — set by controls.js
window._ncvShowConstellations = false;

class StarField {
  constructor() {
    this.lat      = env.liveLocationLat ?? 41.3083;   // observer latitude (°N)
    this.lon      = env.liveLocationLon ?? -72.9279;  // observer longitude (°E positive)
    this.baseLST  = 342;
    this.nightThreshold = { start: 20.5, end: 6.5 };
    this.wasNight = null;
    this.cacheDirty = true;
    this.lastConfigStamp = '';
    this.nightBuffer = createGraphics(windowWidth, windowHeight);
    this.nightBuffer.pixelDensity(1);

    this.nameMap = {};        // must be initialised BEFORE _buildStars() writes to it
    this.stars   = this._buildStars();

    // Milky Way spine: [RA_deg, Dec_deg] along galactic equator, l=0→345°
    this.mwSpine = [
      [266.4,-28.9],[274.7,-20.0],[283.8,-9.0],[291.3,2.5],
      [298.0,17.5],[308.7,31.0],[318.4,48.0],[337.8,58.5],
      [3.5,61.5],[28.5,57.0],[36.0,56.5],[56.5,50.0],
      [86.4,28.9],[99.0,20.0],[104.0,10.5],[111.8,-5.0],
      [122.0,-17.0],[131.0,-32.0],[141.0,-44.5],[158.5,-55.0],
      [193.0,-63.5],[220.5,-62.0],[243.0,-52.5],[256.0,-41.0],
    ];

    // Constellation stick figures — [star_name_A, star_name_B] pairs
    this.constellations = {
      'Orion':       [['Rigel','Bellatrix'],['Rigel','Saiph'],
                      ['Bellatrix','Betelgeuse'],['Saiph','Betelgeuse'],
                      ['Betelgeuse','Bellatrix'],
                      ['Mintaka','Alnilam'],['Alnilam','Alnitak'],
                      ['Mintaka','Bellatrix'],['Alnitak','Saiph'],
                      ['Meissa','Bellatrix'],['Meissa','Betelgeuse'],
                      ['Tabit','Mintaka']],
      'Ursa Major':  [['Dubhe','Merak'],['Merak','Phecda'],
                      ['Phecda','Megrez'],['Megrez','Alioth'],
                      ['Alioth','Mizar'],['Mizar','Alkaid'],
                      ['Alioth','Alkaid'],['Phecda','Alioth']],
      'Ursa Minor':  [['Polaris','Kochab']],
      'Cassiopeia':  [['Caph','Schedar'],['Schedar','GammaCas'],
                      ['GammaCas','Ruchbah'],['Ruchbah','Segin']],
      'Gemini':      [['Castor','Pollux'],['Castor','Alhena'],['Pollux','Alhena'],
                      ['Castor','Delta Gem'],['Pollux','Delta Gem'],
                      ['Delta Gem','Kappa Gem']],
      'Leo':         [['Regulus','Algieba'],['Algieba','Zosma'],
                      ['Zosma','Denebola'],['Regulus','Denebola'],
                      ['Regulus','Zosma']],
      'Scorpius':    [['Antares','Graffias'],['Antares','Shaula'],
                      ['Shaula','Lesath'],['Graffias','Shaula']],
      'Cygnus':      [['Deneb','Sadr'],['Sadr','Albireo'],
                      ['Deneb','Delta Cyg'],['Delta Cyg','Sadr'],
                      ['Sadr','Zeta Cyg'],['Sadr','Iota Cyg']],
      'Lyra':        [['Vega','Sulafat']],
      'Perseus':     [['Mirfak','Algol'],['Mirfak','Atik'],['Mirfak','Zeta Per']],
      'Boötes':      [['Arcturus','Izar'],['Arcturus','Muphrid'],
                      ['Izar','Seginus'],['Seginus','Nekkar']],
      'Taurus':      [['Aldebaran','Elnath'],['Aldebaran','Alcyone'],
                      ['Alcyone','23 Tau'],['23 Tau','27 Tau']],
      'Aquila':      [['Altair','Tarazed']],
      'Pegasus':     [['Alpheratz','Markab'],['Markab','Scheat'],
                      ['Scheat','Matar'],['Markab','Biham']],
      'Andromeda':   [['Alpheratz','Mirach'],['Mirach','Almach']],
    };
  }

  resize() {
    this.nightBuffer = createGraphics(windowWidth, windowHeight);
    this.nightBuffer.pixelDensity(1);
    this.cacheDirty = true;
  }

  invalidateCache() {
    this.cacheDirty = true;
  }

  _syncObserverFromEnv() {
    const lat = Number(env.liveLocationLat);
    const lon = Number(env.liveLocationLon);
    const nextLat = Number.isFinite(lat) ? lat : this.lat;
    const nextLon = Number.isFinite(lon) ? lon : this.lon;
    if (Math.abs(nextLat - this.lat) > 0.35) {
      this.lat = nextLat;
      this.lon = nextLon;
      this.nameMap = {};
      this.stars = this._buildStars();
      this.cacheDirty = true;
      return;
    }
    if (Math.abs(nextLon - this.lon) > 0.35) {
      this.lon = nextLon;
      this.cacheDirty = true;
    }
  }

  _dateAtEnvTime() {
    const base = env.liveDateISO ? new Date(env.liveDateISO) : new Date();
    const d = Number.isFinite(base.getTime()) ? new Date(base.getTime()) : new Date();
    const hour = env.timeOfDay ?? 0;
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

  // ----------------------------------------------------------
  // Raw catalog: [ra_deg, dec_deg, mag, r, g, b, name]
  // ----------------------------------------------------------
  _rawCatalog() {
    // Spectral colours: O/B=blue-white, A=white, F=warm-white,
    //                   G=yellow, K=orange, M=red-orange
    return [
      // Canis Major
      [101.29,-16.72,-1.46,162,188,255,'Sirius'],
      [104.66,-28.97, 1.50,155,178,255,'Adhara'],
      [107.10,-26.39, 1.84,255,240,182,'Wezen'],
      [ 95.68,-17.96, 1.98,155,175,255,'Mirzam'],
      // Orion
      [ 78.63, -8.20, 0.13,165,195,255,'Rigel'],
      [ 88.79,  7.41, 0.50,255, 95, 55,'Betelgeuse'],
      [ 81.28,  6.35, 1.64,165,192,255,'Bellatrix'],
      [ 86.94, -9.67, 2.07,162,185,255,'Saiph'],
      [ 84.05, -1.20, 1.70,162,185,255,'Alnilam'],
      [ 85.19, -1.94, 1.74,162,185,255,'Alnitak'],
      [ 83.86, -0.30, 2.23,162,185,255,'Mintaka'],
      // Taurus
      [ 68.98, 16.51, 0.85,255,160, 78,'Aldebaran'],
      [ 81.57, 28.61, 1.65,162,185,255,'Elnath'],
      [ 56.87, 24.11, 2.87,202,215,255,'Alcyone'],
      // Gemini
      [116.33, 28.03, 1.14,255,188, 98,'Pollux'],
      [113.65, 31.89, 1.58,215,225,255,'Castor'],
      [ 99.43, 16.40, 1.93,215,225,255,'Alhena'],
      // Canis Minor
      [114.83,  5.22, 0.38,255,235,198,'Procyon'],
      // Leo
      [152.09, 11.97, 1.36,170,202,255,'Regulus'],
      [177.26, 14.57, 2.14,215,225,255,'Denebola'],
      [154.99, 19.84, 2.01,255,162, 82,'Algieba'],
      [168.53, 20.52, 2.56,215,225,255,'Zosma'],
      // Virgo
      [201.30,-11.16, 0.97,162,185,255,'Spica'],
      // Boötes
      [213.92, 19.18,-0.05,255,150, 50,'Arcturus'],
      [221.25, 27.07, 2.37,255,162, 82,'Izar'],
      // Corona Borealis
      [233.68, 26.71, 2.22,215,225,255,'Alphecca'],
      // Scorpius
      [247.35,-26.43, 1.06,255, 82, 62,'Antares'],
      [263.40,-37.10, 1.63,162,185,255,'Shaula'],
      [244.58,-28.22, 2.29,162,185,255,'Graffias'],
      [253.58,-37.10, 2.08,162,185,255,'Lesath'],
      // Sagittarius
      [283.82,-26.30, 2.05,162,185,255,'Nunki'],
      [276.04,-34.38, 1.85,162,185,255,'Kaus Australis'],
      // Ophiuchus
      [263.73, 12.56, 2.08,215,225,255,'Rasalhague'],
      // Aquila
      [297.70,  8.87, 0.77,215,225,255,'Altair'],
      [295.02, 10.61, 2.72,255,198,105,'Tarazed'],
      // Lyra
      [279.23, 38.78, 0.03,185,212,255,'Vega'],
      [284.74, 32.69, 3.52,215,225,255,'Sulafat'],
      // Cygnus
      [310.36, 45.28, 1.25,215,225,255,'Deneb'],
      [305.56, 40.26, 2.20,255,225,158,'Sadr'],
      [292.68, 27.96, 2.87,255,182, 92,'Albireo'],
      // Auriga
      [ 79.17, 45.99, 0.08,255,212,108,'Capella'],
      [ 89.88, 44.95, 1.90,215,225,255,'Menkalinan'],
      // Perseus
      [ 51.08, 49.86, 1.79,255,215,148,'Mirfak'],
      [ 47.04, 40.96, 2.09,170,202,255,'Algol'],
      // Andromeda
      [  2.10, 29.09, 2.07,215,225,255,'Alpheratz'],
      [ 17.43, 35.62, 2.07,255,108, 82,'Mirach'],
      [ 30.97, 42.33, 2.10,255,164, 84,'Almach'],
      // Cassiopeia
      [ 10.13, 56.54, 2.24,255,172, 92,'Schedar'],
      [  2.30, 59.15, 2.28,255,228,168,'Caph'],
      [ 14.18, 60.72, 2.47,162,185,255,'GammaCas'],
      [ 21.45, 60.24, 2.23,215,225,255,'Ruchbah'],
      [ 28.60, 63.67, 3.35,170,202,255,'Segin'],
      // Pegasus
      [326.05, 15.21, 2.44,170,202,255,'Markab'],
      [345.00, 28.08, 2.83,255,108, 82,'Scheat'],
      // Aries
      [ 31.79, 23.46, 2.00,255,172, 92,'Hamal'],
      // Cetus
      [ 10.90,-17.99, 2.04,255,172, 92,'Diphda'],
      // Piscis Austrinus
      [344.41,-29.62, 1.16,215,225,255,'Fomalhaut'],
      // Ursa Major
      [165.93, 61.75, 1.79,255,164, 84,'Dubhe'],
      [206.88, 49.31, 1.85,170,202,255,'Alkaid'],
      [193.51, 55.96, 1.76,215,225,255,'Alioth'],
      [200.98, 54.93, 2.27,215,225,255,'Mizar'],
      [165.46, 56.38, 2.34,215,225,255,'Merak'],
      [178.46, 53.69, 2.44,215,225,255,'Phecda'],
      [183.86, 57.03, 3.31,215,225,255,'Megrez'],
      // Ursa Minor
      [ 37.95, 89.26, 1.97,255,225,168,'Polaris'],
      [222.68, 74.16, 2.07,255,164, 84,'Kochab'],
      // Hydra
      [141.90, -8.66, 1.98,255,164, 84,'Alphard'],
      // Centaurus (visible from 45N)
      [211.67,-36.37, 2.06,255,164, 84,'Menkent'],
      // Corvus
      [183.95,-17.54, 2.58,170,202,255,'Gienah'],
      // Vela
      [136.00,-43.43, 1.96,215,225,255,'Delta Vel'],
      // Extra faint stars for sky density (mag 3.0–4.2)
      [ 46.85, 40.01, 3.05,162,185,255,'Atik'],
      [ 58.53, 23.95, 3.63,215,225,255,'23 Tau'],
      [ 51.20, 49.22, 3.77,170,202,255,'Zeta Per'],
      [ 59.46, 24.11, 3.70,215,225,255,'27 Tau'],
      [ 83.00,  9.93, 3.60,215,225,255,'Meissa'],
      [ 83.18,  2.00, 3.88,215,225,255,'Tabit'],
      [ 77.29,-8.75,  3.19,162,185,255,'Cursa'],
      [104.66,-28.97, 3.97,255,215,158,'Omicron2 CMa'],
      [116.33,21.98,  3.13,255,188, 98,'Delta Gem'],
      [130.82,28.90,  3.57,255,225,175,'Kappa Gem'],
      [147.75,59.03,  3.45,215,225,255,'Talitha'],
      [162.41,55.61,  3.00,255,172, 92,'Tania Borealis'],
      [166.44,56.38,  3.05,215,225,255,'Tania Australis'],
      [175.59,26.00,  3.44,255,215,158,'Zosma B'],
      [193.51,48.02,  3.32,215,225,255,'Phad'],
      [218.88,35.66,  3.57,215,225,255,'Nekkar'],
      [225.49,40.39,  3.46,215,225,255,'Seginus'],
      [231.23,58.97,  3.14,215,225,255,'Edasich'],
      [232.14,38.31,  3.66,215,225,255,'Muphrid'],
      [245.00,19.15,  3.20,255,172, 92,'Yed Prior'],
      [250.32,31.60,  3.66,255,225,175,'Marfik'],
      [259.25,-3.69,  3.27,215,225,255,'Sabik'],
      [262.69,-37.30, 3.32,162,185,255,'Eta Sco'],
      [270.55,-26.99, 2.99,162,185,255,'Ascella'],
      [278.42,-26.30, 3.17,215,225,255,'Phi Sgr'],
      [280.75,-22.74, 2.82,255,198,105,'Kaus Borealis'],
      [285.65,-29.88, 3.51,162,185,255,'Tau Sgr'],
      [296.56,37.60,  3.24,215,225,255,'Delta Cyg'],
      [303.41,47.71,  3.43,215,225,255,'Iota Cyg'],
      [311.55,45.13,  3.72,255,225,175,'Zeta Cyg'],
      [317.88,56.73,  3.22,215,225,255,'Eta Cyg'],
      [333.00,-9.00,  3.69,215,225,255,'Iota Aqr'],
      [338.40, 3.82,  3.27,255,172, 92,'Sadalsuud'],
      [339.14,29.22,  3.40,255,108, 82,'Biham'],
      [345.94,28.08,  3.40,215,225,255,'Matar'],
      [350.63,20.21,  3.47,215,225,255,'Baham'],
      [357.84,-3.82,  3.79,255,225,175,'Eta Psc'],
    ];
  }

  _buildStars() {
    const seen = new Set();
    return this._rawCatalog()
      .filter(([ra, dec, , , , , name]) => {
        const key = name || `${ra.toFixed(1)},${dec.toFixed(1)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return dec > -(90 - this.lat - 4);
      })
      .map(([ra, dec, mag, r, g, b, name]) => {
        const s = {
          ra, dec, mag, r, g, b, name,
          twinklePhase: Math.random() * 1000,
          baseSize:  Math.max(0.8, map(mag, -1.5, 4.5, 8.0, 0.9)),  // bigger range
          baseAlpha: Math.max(50,  map(mag, -1.5, 4.5, 255, 80)),
          sx: 0, sy: 0, visible: false,
        };
        if (name) this.nameMap[name] = s;
        return s;
      });
  }

  // ----------------------------------------------------------
  // Spherical projection: equatorial → screen
  // ----------------------------------------------------------
  _project(ra_deg, dec_deg, lst_deg, cx, cy, scale) {
    const lat = this.lat * (Math.PI / 180);
    const dec = dec_deg  * (Math.PI / 180);
    const H   = ((lst_deg - ra_deg + 360) % 360) * (Math.PI / 180);

    const sinAlt = Math.sin(dec) * Math.sin(lat) +
                   Math.cos(dec) * Math.cos(lat) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    if (alt < 0) return null;

    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) /
                  (Math.cos(alt) * Math.cos(lat));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(H) > 0) az = 2 * Math.PI - az;

    const r  = (Math.PI / 2 - alt) / (Math.PI / 2);
    return {
      sx: cx + Math.sin(az) * r * scale,
      sy: cy - Math.cos(az) * r * scale,
    };
  }

  _getLST() {
    const now = this._dateAtEnvTime();
    const jd = this._julianDay(now);
    return this._localSiderealDeg(jd, this.lon ?? 0);
  }

  _starAlpha() {
    const t = env.timeOfDay;
    if (t < 5.0 || t > 21.0) return 1.0;
    if (t < 6.2)  return 1 - (t - 5.0) / 1.2;
    if (t > 19.8) return (t - 19.8) / 1.2;
    return 0;
  }

  // ----------------------------------------------------------
  // Milky Way — wide, very diffuse glow band
  // More passes at lower opacity produce a genuine nebulous look.
  // ----------------------------------------------------------
  _drawMilkyWay(gfx, lst, visAlpha, nightAlpha, cx, cy, scale) {
    if (visAlpha < 0.005) return;

    const pts = this.mwSpine
      .map(([ra, dec]) => this._project(ra, dec, lst, cx, cy, scale))
      .filter(Boolean);
    if (pts.length < 3) return;

    // Crazy-soft continuous ribbon: no segment-by-segment stroking (prevents bright junction dots).
    const dc = gfx.drawingContext;
    dc.save();
    const blurMul = constrain(env.milkyWayBlur ?? 1, 0, 2);
    const ribbonBlur = lerp(12, 22, constrain(nightAlpha, 0, 1)) * blurMul;
    dc.filter = `blur(${ribbonBlur.toFixed(1)}px)`;
    dc.lineCap = 'butt';
    dc.lineJoin = 'round';
    gfx.noFill();
    for (let pass = 0; pass < 6; pass++) {
      const pct = pass / 5;
      const w = lerp(scale * 0.24, scale * 0.09, pct);
      const a = lerp(0.32, 0.92, pct) * visAlpha;
      gfx.stroke(
        lerp(166, 190, pct),
        lerp(210, 220, pct),
        lerp(242, 250, pct),
        a
      );
      gfx.strokeWeight(w);
      gfx.beginShape();
      gfx.curveVertex(pts[0].sx, pts[0].sy);
      for (const p of pts) gfx.curveVertex(p.sx, p.sy);
      gfx.curveVertex(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
      gfx.endShape();
    }
    dc.restore();

    // Very subtle center haze, trailing off strongly at both ends.
    gfx.noStroke();
    dc.save();
    const hazeBlur = lerp(18, 30, constrain(nightAlpha, 0, 1)) * blurMul;
    dc.filter = `blur(${hazeBlur.toFixed(1)}px)`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const local = sin((i / (pts.length - 1)) * PI); // 0 at ends, 1 center
      const centerK = Math.pow(local, 1.8);
      if (centerK < 0.03) continue;

      const jitter = noise(i * 0.23, this.baseLST * 0.004);
      const a = (0.44 + centerK * 1.30) * visAlpha * (0.82 + jitter * 0.20);
      const patchW = lerp(scale * 0.10, scale * 0.48, centerK);
      const patchH = patchW * lerp(0.78, 1.25, noise(i * 0.31, 11.4));

      gfx.fill(186, 214, 248, a);
      gfx.ellipse(
        p.sx + map(noise(i * 0.41, 6.7), 0, 1, -patchW * 0.28, patchW * 0.28),
        p.sy + map(noise(i * 0.37, 9.1), 0, 1, -patchH * 0.28, patchH * 0.28),
        patchW,
        patchH
      );
    }
    dc.restore();
  }

  // ----------------------------------------------------------
  // Constellation lines + optional labels
  // ----------------------------------------------------------
  _drawConstellations(gfx, alpha) {
    const showConstellations = !!(env.showConstellations ?? window._ncvShowConstellations);
    if (!showConstellations || alpha < 0.05) return;
    const cMul = constrain(env.constellationBrightness ?? 1, 0, 2);
    const showLabels = !!env.showConstellationLabels;

    gfx.stroke(200, 230, 255, 180 * alpha * cMul);
    gfx.strokeWeight(1.4);
    gfx.noFill();

    for (const [consName, lines] of Object.entries(this.constellations)) {
      const labelPts = [];
      for (const [nameA, nameB] of lines) {
        const sA = this.nameMap[nameA];
        const sB = this.nameMap[nameB];
        if (!sA || !sB || !sA.visible || !sB.visible) continue;

        gfx.line(sA.sx, sA.sy, sB.sx, sB.sy);
        if (showLabels) {
          labelPts.push([sA.sx, sA.sy], [sB.sx, sB.sy]);
        }
      }
      if (showLabels && labelPts.length >= 4) {
        let sx = 0;
        let sy = 0;
        for (const p of labelPts) {
          sx += p[0];
          sy += p[1];
        }
        const cx = sx / labelPts.length;
        const cy = sy / labelPts.length;
        gfx.push();
        gfx.textAlign(CENTER, CENTER);
        gfx.textSize(constrain(min(width, height) * 0.020, 16, 30));
        gfx.noStroke();
        gfx.fill(8, 16, 22, 180 * alpha * cMul);
        gfx.text(consName, cx + 2.0, cy + 2.0);
        gfx.fill(206, 228, 255, 210 * alpha * cMul);
        gfx.text(consName, cx, cy);
        gfx.pop();
      }
    }
  }

  isNight() {
    return env.timeOfDay < this.nightThreshold.end || env.timeOfDay > this.nightThreshold.start;
  }

  updateCache() {
    this._syncObserverFromEnv();
    const nowNight = this.isNight();
    const configStamp = [
      (env.starBrightness ?? 1).toFixed(2),
      (env.constellationBrightness ?? 1).toFixed(2),
      (env.showConstellations ?? window._ncvShowConstellations) ? '1' : '0',
      env.showConstellationLabels ? '1' : '0',
    ].join('|');
    if (this.wasNight === null) this.wasNight = nowNight;
    if (configStamp !== this.lastConfigStamp) {
      this.lastConfigStamp = configStamp;
      this.cacheDirty = true;
    }

    if (nowNight !== this.wasNight) {
      this.wasNight = nowNight;
      if (nowNight) this.cacheDirty = true;
    }

    if (nowNight && this.cacheDirty) this._renderNightBuffer();
  }

  getNightBuffer() {
    return this.nightBuffer;
  }

  _renderNightBuffer() {
    const sMul = constrain(env.starBrightness ?? 1, 0, 2);
    const mwMul = constrain(env.milkyWayIntensity ?? 1, 0, 2);
    const nightAlpha = this._starAlpha();
    const alpha = nightAlpha * sMul;
    const gfx   = this.nightBuffer;
    const lst   = this._getLST();
    const cx    = width / 2;
    const cy    = height / 2;
    const scale = min(width, height) * 0.5;

    gfx.clear();
    if (alpha <= 0) {
      this.cacheDirty = false;
      return;
    }

    const mwAlpha = nightAlpha * (1.1 + sMul * 0.95) * mwMul;
    this._drawMilkyWay(gfx, lst, mwAlpha, nightAlpha, cx, cy, scale);

    gfx.noStroke();
    for (const s of this.stars) {
      const proj = this._project(s.ra, s.dec, lst, cx, cy, scale);
      if (!proj) { s.visible = false; continue; }
      s.visible = true;
      s.sx = proj.sx;
      s.sy = proj.sy;

      const a = constrain(s.baseAlpha * alpha, 0, 255);
      const sz = s.baseSize;

      if (s.mag < 2.0) {
        const glowPx = sz * 5;
        gfx.drawingContext.shadowBlur = glowPx;
        gfx.drawingContext.shadowColor = `rgba(${s.r},${s.g},${s.b},${(alpha * 0.7).toFixed(2)})`;
      }

      gfx.fill(s.r, s.g, s.b, a);
      gfx.circle(s.sx, s.sy, sz);
      gfx.drawingContext.shadowBlur = 0;
    }

    this._drawConstellations(gfx, alpha);
    this.cacheDirty = false;
  }
}
