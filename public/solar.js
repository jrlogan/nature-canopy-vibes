// ============================================================
// solar.js — Sun, moon and precession helpers shared by every subsystem.
//
// Everything that used to ask "is it after 20:30?" now asks the sun. That is
// what makes polar night, midnight sun, and December afternoons look right,
// and it is what journey mode needs when it drops you in Tromsø or Antarctica.
//
//   NCV_SKY.phase()                → cached per (lat, time, day) sun state
//   NCV_SKY.sunAltAz(lat, tod, doy) → altitude/azimuth from local solar time
//   NCV_SKY.moonEquatorial(d)       → low-precision RA/Dec + phase (Schlyter)
//   NCV_SKY.precess(ra, dec, jd)    → J2000 → epoch-of-date (Meeus 21.2)
//   NCV_SKY.sceneDate()             → the Date the scene is showing (journey aware)
//
// Thresholds (sun altitude, degrees):
//   isDay      ≥ +3      sunK ramps 0→1 from +2° to +50°
//   isTwilight −9 … +3   twilightK ramps 0→1 across it (night side → day side)
//   isNight    < −9      starK ramps 0→1 from −3° to −13°
// ============================================================
(function () {
  const DEG = Math.PI / 180;
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const norm360 = (v) => ((v % 360) + 360) % 360;

  function sceneDate() {
    const e = typeof env !== 'undefined' ? env : {};
    if (e.journeyActive && Number.isFinite(e.journeyEpochMs)) return new Date(e.journeyEpochMs);
    const base = e.liveDateISO ? new Date(e.liveDateISO) : new Date();
    const d = Number.isFinite(base.getTime()) ? new Date(base.getTime()) : new Date();
    const hour = Number(e.timeOfDay) || 0;
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const s = Math.floor((((hour - h) * 60) - m) * 60);
    d.setHours(h, m, s, 0);
    return d;
  }

  function dayOfYear(dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike || Date.now());
    if (!Number.isFinite(d.getTime())) return 172;
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    return Math.floor((d.getTime() - start) / 86400000);
  }

  function sunDeclinationDeg(doy) {
    return 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365.24);
  }

  // Local solar time in, altitude/azimuth out. tod is hours (0–24) of local
  // *solar* time, which is what the server derives from longitude.
  function sunAltAz(latDeg, tod, doy) {
    const dec = sunDeclinationDeg(doy) * DEG;
    const lat = latDeg * DEG;
    const H = (tod - 12) * 15 * DEG;
    const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / Math.max(1e-8, Math.cos(alt) * Math.cos(lat));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(H) > 0) az = 2 * Math.PI - az;
    return { alt: alt / DEG, az: az / DEG, morning: H < 0 };
  }

  let cache = { key: '', value: null };
  function phase() {
    const e = typeof env !== 'undefined' ? env : {};
    const lat = Number.isFinite(Number(e.liveLocationLat)) ? Number(e.liveLocationLat) : 41.31;
    const tod = Number(e.timeOfDay) || 0;
    const doy = dayOfYear(e.liveDateISO);
    const key = `${lat.toFixed(2)}|${tod.toFixed(3)}|${doy}`;
    if (key === cache.key) return cache.value;
    const s = sunAltAz(lat, tod, doy);
    const alt = s.alt;
    const v = {
      alt,
      az: s.az,
      morning: s.morning,
      isDay: alt >= 3,
      isTwilight: alt >= -9 && alt < 3,
      isNight: alt < -9,
      isDawn: alt >= -9 && alt < 3 && s.morning,
      isDusk: alt >= -9 && alt < 3 && !s.morning,
      sunK: smooth(2, 50, alt),          // canopy "strong sunlight"
      daylight: smooth(-4, 4, alt),      // birds/flocks/daytime things
      twilightK: smooth(-9, 3, alt),     // 0 at night side, 1 at day side
      starK: 1 - smooth(-13, -3, alt),   // stars fully out below −13°
      glowK: 1 - Math.min(1, Math.abs(alt + 0.5) / 7), // horizon colour, peaks at sunrise/set
      doy,
    };
    cache = { key, value: v };
    return v;
  }

  // ---- Moon (Paul Schlyter's low-precision method; ~1° in position) ----
  // d = days since 2000 Jan 0.0 (same convention as atmosphere.js planets).
  function moonEquatorial(d) {
    const N = norm360(125.1228 - 0.0529538083 * d);
    const i = 5.1454;
    const w = norm360(318.0634 + 0.1643573223 * d);
    const a = 60.2666;
    const ecc = 0.054900;
    const M = norm360(115.3654 + 13.0649929509 * d);
    const Ms = norm360(356.0470 + 0.9856002585 * d);
    const ws = norm360(282.9404 + 4.70935e-5 * d);
    let E = M + (ecc / DEG) * Math.sin(M * DEG) * (1 + ecc * Math.cos(M * DEG));
    for (let k = 0; k < 3; k++) {
      E = E - (E - (ecc / DEG) * Math.sin(E * DEG) - M) / (1 - ecc * Math.cos(E * DEG));
    }
    const xv = a * (Math.cos(E * DEG) - ecc);
    const yv = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E * DEG);
    const v = Math.atan2(yv, xv) / DEG;
    const r = Math.hypot(xv, yv);
    const vw = (v + w) * DEG;
    const xe = r * (Math.cos(N * DEG) * Math.cos(vw) - Math.sin(N * DEG) * Math.sin(vw) * Math.cos(i * DEG));
    const ye = r * (Math.sin(N * DEG) * Math.cos(vw) + Math.cos(N * DEG) * Math.sin(vw) * Math.cos(i * DEG));
    const ze = r * Math.sin(vw) * Math.sin(i * DEG);
    let lon = Math.atan2(ye, xe) / DEG;
    let lat = Math.atan2(ze, Math.hypot(xe, ye)) / DEG;
    // Main perturbations.
    const Ls = Ms + ws, Lm = N + w + M;
    const D = (Lm - Ls) * DEG, F = (Lm - N) * DEG, Mr = M * DEG, Msr = Ms * DEG;
    lon += -1.274 * Math.sin(Mr - 2 * D) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(Msr)
      - 0.059 * Math.sin(2 * Mr - 2 * D) - 0.057 * Math.sin(Mr - 2 * D + Msr) + 0.053 * Math.sin(Mr + 2 * D)
      + 0.046 * Math.sin(2 * D - Msr) + 0.041 * Math.sin(Mr - Msr) - 0.035 * Math.sin(D)
      - 0.031 * Math.sin(Mr + Msr) - 0.015 * Math.sin(2 * F - 2 * D) + 0.011 * Math.sin(Mr - 4 * D);
    lat += -0.173 * Math.sin(F - 2 * D) - 0.055 * Math.sin(Mr - F - 2 * D) - 0.046 * Math.sin(Mr + F - 2 * D)
      + 0.033 * Math.sin(F + 2 * D) + 0.017 * Math.sin(2 * Mr + F);
    const ecl = (23.4393 - 3.563e-7 * d) * DEG;
    const lo = lon * DEG, la = lat * DEG;
    const xq = Math.cos(lo) * Math.cos(la);
    const yq = Math.sin(lo) * Math.cos(la) * Math.cos(ecl) - Math.sin(la) * Math.sin(ecl);
    const zq = Math.sin(lo) * Math.cos(la) * Math.sin(ecl) + Math.sin(la) * Math.cos(ecl);
    const raDeg = norm360(Math.atan2(yq, xq) / DEG);
    const decDeg = Math.atan2(zq, Math.hypot(xq, yq)) / DEG;
    const phaseFrac = norm360(lon - Ls) / 360; // 0 new, 0.5 full
    return { raDeg, decDeg, phase: phaseFrac, eclLonDeg: norm360(lon) };
  }

  // ---- Precession: J2000 equatorial → mean equator/equinox of date ----
  const precCache = { jd: null, p: null };
  function precessionAngles(jd) {
    if (precCache.jd === jd) return precCache.p;
    const T = (jd - 2451545.0) / 36525.0;
    const arc = 1 / 3600 * DEG;
    const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * arc;
    const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * arc;
    const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * arc;
    const p = { zeta, z, theta, sinT: Math.sin(theta), cosT: Math.cos(theta), T };
    precCache.jd = jd;
    precCache.p = p;
    return p;
  }
  function precess(raDeg, decDeg, jd) {
    const p = precessionAngles(jd);
    if (Math.abs(p.T) < 0.02) return { ra: raDeg, dec: decDeg }; // within ~2 years of J2000: skip
    const a0 = raDeg * DEG + p.zeta, d0 = decDeg * DEG;
    const A = Math.cos(d0) * Math.sin(a0);
    const B = p.cosT * Math.cos(d0) * Math.cos(a0) - p.sinT * Math.sin(d0);
    const C = p.sinT * Math.cos(d0) * Math.cos(a0) + p.cosT * Math.sin(d0);
    return {
      ra: norm360((Math.atan2(A, B) + p.z) / DEG),
      dec: Math.asin(Math.max(-1, Math.min(1, C))) / DEG,
    };
  }

  window.NCV_SKY = { phase, sunAltAz, sunDeclinationDeg, dayOfYear, moonEquatorial, precess, precessionAngles, sceneDate, smooth };
})();
