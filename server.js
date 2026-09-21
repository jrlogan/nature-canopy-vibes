// ============================================================
// server.js — Nature Canopy Vibes | Backend Bridge
// Phase 1: Express + Socket.io foundation
// ============================================================

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;
const TICK_MS = 60 * 1000;
const LIVE_FETCH_MS = 10 * 60 * 1000;

// Shared environment state for all connected clients.
const environmentState = {
  timeOfDay:      21.2,
  windSpeed:      0.22,
  liveWindKph:    10,
  liveTemperatureC: 8,
  liveCloudCoverPct: 28,
  liveIsDay: false,
  liveSeasonLabel: 'Late Winter',
  currentWeather: 'clear',
  starBrightness: 1.1,
  constellationBrightness: 1.0,
  showConstellations: false,
  showConstellationLabels: false,
  showPlantLabels: false,
  showCompassDirections: false,
  skyAzimuthOffsetDeg: 0,
  forceTreeType: '',
  forceTreeless: false,
  cloudCover: 0.28,
  skyBlur: 1.0,
  leafSoftness: 0.45,
  soundMaster: 0.5,
  soundCrickets: 0.35,
  soundThunder: 0.9,
  soundBirds: 0.35,
  soundRain: 0.55,
  soundWind: 0.45,
  soundNightBirds: 0.25,
  canopyCoverage: 0.34,
  canopyTreeCount: 0.92,
  canopyDensity: 0.9,
  canopyPerspective: 0.92,
  canopyEdgeLushness: 0.95,
  branchSpread: 0.66,
  branchDepth: 5,
  simulationMode: 'live', // manual | random | live
  season: 'auto', // auto | spring | summer | fall | winter
  liveDateISO: new Date().toISOString(),
  liveLocationName: 'New Haven, CT',
  liveLocationLat: 41.3083,
  liveLocationLon: -72.9279,
  performanceMode: 'auto',
  sleeping: false,
  lightningIntensity: 0.0, // 0.0 to 1.0 based on real-world data

  // Room / presentation controls (see CLAUDE.md "Journey mode").
  brightness: 1.0,          // 0.05–1: global output dimmer for dark rooms
  overlayRotationDeg: 0,    // 0–359: which way is "down" for on-ceiling text
  overlayDual: false,       // draw text overlays twice, 180° apart
  showClock: false,         // clock/date/location card on the display
  showMap: 'auto',          // off | auto (on location change) | always
  sceneAudio: '',           // '' | fire | drone | <name of file in audio/scenes/>

  // Journey (time travel) mode — canonical clock is journeyEpochMs (UTC ms).
  journeyActive: false,
  journeyRate: 0,           // simulated seconds per real second; negative = backwards
  journeyEpochMs: Date.now(),
  journeySyncAtMs: Date.now(), // server wall-clock when journeyEpochMs was last stamped
  journeyLabel: '',
  journeyWeatherHold: false,   // manual weather edit while journeying → stop auto weather
  journeyWeatherSource: 'model', // model | archive | forecast | hold
};

let lastLiveFetchAt = 0;

const { exec } = require('child_process');

// Build an env that lets desktop-session tools (wlr-randr, xset) find the
// compositor when this process is launched from systemd, where WAYLAND_DISPLAY
// / DISPLAY / XDG_RUNTIME_DIR are normally absent. The defaults below match
// the typical single-user Pi kiosk (uid 1000, seat 0).
function sessionEnv() {
  const env = { ...process.env };
  if (!env.XDG_RUNTIME_DIR) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  }
  if (!env.WAYLAND_DISPLAY) env.WAYLAND_DISPLAY = 'wayland-0';
  if (!env.DISPLAY) env.DISPLAY = ':0';
  return env;
}

function execProbe(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { env: sessionEnv(), timeout: 2000 }, (err, stdout) => {
      resolve({ err, stdout: String(stdout || '') });
    });
  });
}

// Probe once, then cache. wlr-randr (Wayland — default on Pi OS Bookworm+) is
// tried first; xset (X11) and vcgencmd (legacy Pi firmware) are fallbacks.
async function detectDisplayStrategy() {
  const wlr = await execProbe('wlr-randr');
  if (!wlr.err) {
    // Output names appear at column 0; descriptions are indented. Grab the
    // first one (e.g. "HDMI-A-1").
    const m = wlr.stdout.match(/^([A-Za-z0-9._-]+)\s/m);
    if (m) return { kind: 'wlr-randr', output: m[1] };
  }
  const xset = await execProbe('xset q');
  if (!xset.err) return { kind: 'xset' };
  const vcgen = await execProbe('vcgencmd version');
  if (!vcgen.err) return { kind: 'vcgencmd' };
  return { kind: 'none' };
}

let displayStrategyPromise = null;
function getDisplayStrategy() {
  if (!displayStrategyPromise) displayStrategyPromise = detectDisplayStrategy();
  return displayStrategyPromise;
}

async function setDisplayPower(on) {
  console.log(`[power] Setting display power: ${on ? 'ON' : 'OFF'}`);
  const strat = await getDisplayStrategy();
  let cmd = null;
  if (strat.kind === 'wlr-randr') {
    cmd = `wlr-randr --output ${strat.output} ${on ? '--on' : '--off'}`;
  } else if (strat.kind === 'xset') {
    cmd = `xset dpms force ${on ? 'on' : 'off'}`;
  } else if (strat.kind === 'vcgencmd') {
    cmd = `vcgencmd display_power ${on ? 1 : 0}`;
  } else {
    console.log('[power] No hardware display control available; relying on web overlay.');
    return;
  }
  exec(cmd, { env: sessionEnv() }, (err, _stdout, stderr) => {
    if (err) console.warn(`[power] ${cmd} failed: ${(stderr || err.message).trim()}`);
  });
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Sun altitude from latitude, local solar hour and day of year — the same
// approximation public/solar.js uses, so liveIsDay agrees with the display.
function sunAltitudeDeg(latDeg, tod, dateISO) {
  const d = new Date(dateISO || Date.now());
  const ok = Number.isFinite(d.getTime()) ? d : new Date();
  const doy = Math.floor((ok.getTime() - Date.UTC(ok.getUTCFullYear(), 0, 0)) / 86400000);
  const dec = (23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365.24)) * Math.PI / 180;
  const lat = (Number(latDeg) || 0) * Math.PI / 180;
  const H = ((Number(tod) || 0) - 12) * 15 * Math.PI / 180;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;
}
function isSunUp() {
  return sunAltitudeDeg(environmentState.liveLocationLat, environmentState.timeOfDay, environmentState.liveDateISO) >= 0;
}

function clampRange(v, min, max, fallback = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeAzimuthOffsetDeg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return ((n + 180) % 360 + 360) % 360 - 180;
}

function normalizeSeason(v) {
  const s = String(v || '').toLowerCase();
  return ['auto', 'spring', 'summer', 'fall', 'winter'].includes(s) ? s : null;
}

function applyRemoteEnvPatch(data = {}) {
  const weather = String(data.currentWeather || '').toLowerCase();
  const season = normalizeSeason(data.season);
  let changed = false;
  let forceManual = false;

  const setNumeric = (key, min, max, opts = {}) => {
    if (data[key] === undefined) return;
    const fallback = Number.isFinite(environmentState[key]) ? environmentState[key] : min;
    const next = clampRange(data[key], min, max, fallback);
    if (opts.round) {
      const rounded = Math.round(next);
      if (environmentState[key] !== rounded) {
        environmentState[key] = rounded;
        changed = true;
      }
    } else if (environmentState[key] !== next) {
      environmentState[key] = next;
      changed = true;
    }
    if (opts.manual) forceManual = true;
  };

  if (environmentState.journeyActive && data.timeOfDay !== undefined) {
    // While journeying, a time-of-day edit scrubs the journey clock instead of
    // fighting it. Keep the same calendar day, move the solar hour.
    const tod = clampRange(data.timeOfDay, 0, 24, environmentState.timeOfDay);
    journeySetSolarHour(tod);
    changed = true;
    delete data.timeOfDay;
  }
  setNumeric('timeOfDay', 0, 24, { manual: true });
  setNumeric('windSpeed', 0, 1, { manual: true });
  setNumeric('cloudCover', 0, 1, { manual: true });
  setNumeric('starBrightness', 0, 2);
  setNumeric('treeFrameDensity', 4, 16, { round: true });
  setNumeric('treeSkyOpen', 1, 1.5);
  setNumeric('treeFoliageMass', 0, 1);
  setNumeric('treeBranchReach', 0, 1);
  setNumeric('canopyEdgeLushness', 0, 1.5);
  setNumeric('treeBranchChaos', 0, 1);
  setNumeric('soundMaster', 0, 1);
  setNumeric('soundRain', 0, 1);
  setNumeric('soundWind', 0, 1);
  setNumeric('soundThunder', 0, 1);
  setNumeric('soundBirds', 0, 1);
  setNumeric('soundCrickets', 0, 1);
  setNumeric('soundNightBirds', 0, 1);
  setNumeric('brightness', 0.05, 1);
  setNumeric('overlayRotationDeg', 0, 359, { round: true });

  const setBool = (key) => {
    if (data[key] === undefined) return;
    const next = data[key] === true || data[key] === 1 || data[key] === '1' || data[key] === 'true';
    if (environmentState[key] !== next) { environmentState[key] = next; changed = true; }
  };
  setBool('overlayDual');
  setBool('showClock');
  if (data.showMap !== undefined) {
    const m = String(data.showMap).toLowerCase();
    if (['off', 'auto', 'always'].includes(m) && environmentState.showMap !== m) {
      environmentState.showMap = m; changed = true;
    }
  }
  if (data.sceneAudio !== undefined) {
    const a = normalizeSceneAudio(data.sceneAudio);
    if (environmentState.sceneAudio !== a) { environmentState.sceneAudio = a; changed = true; }
  }

  if (weather && ['clear', 'rain', 'storm'].includes(weather) && environmentState.currentWeather !== weather) {
    environmentState.currentWeather = weather;
    changed = true;
    forceManual = true;
  }
  if (season && environmentState.season !== season) {
    environmentState.season = season;
    changed = true;
  }
  if (forceManual && environmentState.journeyActive) {
    // Manual wind/cloud/weather while journeying: hold it, keep the clock running.
    if (!environmentState.journeyWeatherHold) {
      environmentState.journeyWeatherHold = true;
      environmentState.journeyWeatherSource = 'hold';
      changed = true;
    }
    forceManual = false;
  }
  if (forceManual && environmentState.simulationMode !== 'manual') {
    environmentState.simulationMode = 'manual';
    changed = true;
  }
  if (changed) refreshDerivedLiveFields();
  return changed;
}

function normalizeSceneAudio(v) {
  const s = String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return s;
}

function setApproxLocalTimeFromLon(lon) {
  if (!Number.isFinite(lon)) return;
  const utcNow = new Date();
  const localMs = utcNow.getTime() + lon * 240000; // 1° lon ~= 4 minutes
  const d = new Date(localMs);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  environmentState.timeOfDay = hh + mm / 60 + ss / 3600;
  environmentState.liveDateISO = d.toISOString();
}

function mapWeatherCode(code = 0) {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'clear';
}

function fracHash(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function deriveSeasonLabel(dateISO, lat, seasonMode = 'auto') {
  const forced = String(seasonMode || 'auto').toLowerCase();
  if (forced === 'spring' || forced === 'summer' || forced === 'fall' || forced === 'winter') {
    return forced[0].toUpperCase() + forced.slice(1);
  }
  const dRaw = dateISO ? new Date(dateISO) : new Date();
  const d = Number.isFinite(dRaw.getTime()) ? dRaw : new Date();
  const hemiSouth = Number.isFinite(lat) && lat < 0;
  let m = d.getMonth() + 1;
  let day = d.getDate();
  if (hemiSouth) {
    m += 6;
    if (m > 12) m -= 12;
  }
  const season = (m === 12 || m <= 2)
    ? 'Winter'
    : (m <= 5 ? 'Spring' : (m <= 8 ? 'Summer' : 'Fall'));
  let phase = 'Mid';
  if (day <= 10) phase = 'Early';
  else if (day >= 21) phase = 'Late';
  return `${phase} ${season}`;
}

function applyLocationBaselineClimate() {
  const lat = Number(environmentState.liveLocationLat);
  const lon = Number(environmentState.liveLocationLon);
  const tod = Number(environmentState.timeOfDay);
  const absLat = Math.abs(Number.isFinite(lat) ? lat : 0);
  const dateISO = environmentState.liveDateISO || new Date().toISOString();
  const dRaw = new Date(dateISO);
  const d = Number.isFinite(dRaw.getTime()) ? dRaw : new Date();
  const month = d.getUTCMonth() + 1;
  const hemiSouth = Number.isFinite(lat) && lat < 0;
  const seasonalCos = Math.cos((((month - (hemiSouth ? 1 : 7)) / 12) * Math.PI * 2));
  const seasonal = seasonalCos * (10 + absLat * 0.08);
  const baseline = 27 - absLat * 0.48;
  const daily = Number.isFinite(tod) ? Math.sin(((tod - 7) / 24) * Math.PI * 2) * 4.5 : 0;
  const noise = (fracHash((lat || 0) * 17.7 + (lon || 0) * 9.2 + d.getUTCDate() * 1.31) - 0.5) * 2.2;
  environmentState.liveTemperatureC = baseline + seasonal + daily + noise;
  const windBase = 7 + absLat * 0.17;
  const windNoise = (fracHash((lat || 0) * 3.1 + (lon || 0) * 1.7 + d.getUTCDate() * 0.71) - 0.5) * 5.0;
  environmentState.liveWindKph = Math.max(1, windBase + windNoise);
  environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveIsDay = isSunUp();
}

function refreshDerivedLiveFields() {
  if (!Number.isFinite(environmentState.liveTemperatureC)) environmentState.liveTemperatureC = 8;
  if (!Number.isFinite(environmentState.liveWindKph)) environmentState.liveWindKph = Math.max(1, environmentState.windSpeed * 45);
  if (!Number.isFinite(environmentState.liveCloudCoverPct)) environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveIsDay = isSunUp();
  environmentState.liveSeasonLabel = deriveSeasonLabel(
    environmentState.liveDateISO,
    Number(environmentState.liveLocationLat),
    environmentState.season,
  );
}

async function fetchLiveWeather() {
  const lat = environmentState.liveLocationLat;
  const lon = environmentState.liveLocationLon;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,is_day&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`live weather fetch failed: ${res.status}`);
  const data = await res.json();
  // A slower response from the previous place must not overwrite a newer
  // location or a manual preview selected while the request was in flight.
  if (environmentState.simulationMode !== 'live' || environmentState.journeyActive
    || environmentState.liveLocationLat !== lat || environmentState.liveLocationLon !== lon) return;
  const cur = data.current || {};
  environmentState.lightningIntensity = mapWeatherCode(cur.weather_code ?? 0) === 'storm' ? 0.8 : 0.0;

  if (typeof cur.time === 'string' && cur.time.length >= 16) {
    const hh = Number(cur.time.slice(11, 13));
    const mm = Number(cur.time.slice(14, 16));
    const tod = (Number.isFinite(hh) ? hh : 0) + (Number.isFinite(mm) ? mm / 60 : 0);
    if (Number.isFinite(tod)) environmentState.timeOfDay = tod;
    environmentState.liveDateISO = `${cur.time}:00`;
  }
  environmentState.cloudCover = clamp01((cur.cloud_cover ?? 30) / 100);
  environmentState.liveCloudCoverPct = Math.round(cur.cloud_cover ?? (environmentState.cloudCover * 100));
  environmentState.windSpeed = clamp01((cur.wind_speed_10m ?? 8) / 45);
  environmentState.liveWindKph = Number.isFinite(cur.wind_speed_10m) ? cur.wind_speed_10m : Math.round(environmentState.windSpeed * 45);
  environmentState.liveTemperatureC = Number.isFinite(cur.temperature_2m) ? cur.temperature_2m : environmentState.liveTemperatureC;
  environmentState.liveIsDay = (cur.is_day ?? 0) === 1;
  environmentState.currentWeather = mapWeatherCode(cur.weather_code ?? 0);
  refreshDerivedLiveFields();
  if (environmentState.currentWeather === 'storm') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.75);
  }
}

async function geocodeLocation(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('empty location');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error('location not found');
  const hit = data.results[0];
  environmentState.liveLocationName = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
  environmentState.liveLocationLat = hit.latitude;
  environmentState.liveLocationLon = hit.longitude;
}

function tickRandomSimulation() {
  const baseDate = environmentState.liveDateISO ? new Date(environmentState.liveDateISO) : new Date();
  const month = (Number.isFinite(baseDate.getTime()) ? baseDate : new Date()).getMonth() + 1;
  const season = (() => {
    const s = String(environmentState.season || 'auto').toLowerCase();
    if (s === 'spring' || s === 'summer' || s === 'fall' || s === 'winter') return s;
    if (month === 12 || month <= 2) return 'winter';
    if (month <= 5) return 'spring';
    if (month <= 10) return 'summer';
    return 'fall';
  })();

  environmentState.timeOfDay = (environmentState.timeOfDay + 0.12) % 24;
  const windDelta = season === 'winter' ? 0.16 : (season === 'summer' ? 0.10 : 0.12);
  const cloudDelta = season === 'winter' ? 0.20 : (season === 'summer' ? 0.14 : 0.18);
  environmentState.windSpeed = clamp01(environmentState.windSpeed + (Math.random() - 0.5) * windDelta);
  environmentState.cloudCover = clamp01(environmentState.cloudCover + (Math.random() - 0.5) * cloudDelta);
  environmentState.liveCloudCoverPct = Math.round(environmentState.cloudCover * 100);
  environmentState.liveWindKph = Math.round(environmentState.windSpeed * 45);
  environmentState.liveIsDay = isSunUp();
  const dailyHeat = Math.sin(((environmentState.timeOfDay - 6) / 24) * Math.PI * 2) * 5;
  const seasonBase = season === 'winter' ? 2 : (season === 'spring' ? 10 : (season === 'fall' ? 11 : 22));
  environmentState.liveTemperatureC = seasonBase + dailyHeat + (Math.random() * 1.4 - 0.7);

  const roll = Math.random();
  const stormP = season === 'summer' ? 0.07 : (season === 'winter' ? 0.03 : 0.05);
  const rainP = season === 'spring' ? 0.26 : (season === 'fall' ? 0.24 : (season === 'winter' ? 0.18 : 0.20));
  if (roll < stormP) environmentState.currentWeather = 'storm';
  else if (roll < rainP) environmentState.currentWeather = 'rain';
  else if (roll > (season === 'summer' ? 0.68 : 0.75)) environmentState.currentWeather = 'clear';

  if (environmentState.currentWeather === 'storm') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.7);
    environmentState.windSpeed = Math.max(environmentState.windSpeed, 0.45);
  } else if (environmentState.currentWeather === 'rain') {
    environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.5);
    environmentState.windSpeed = Math.max(environmentState.windSpeed, 0.25);
  }
  refreshDerivedLiveFields();
}

function applyScenePreset(preset) {
  if (preset === 'wooded') {
    environmentState.treeSkyOpen = 1.0;
    environmentState.treeFrameDensity = 14;
    environmentState.treeFoliageMass = 1.0;
    environmentState.treeBranchReach = 0.56;
    environmentState.treeBranchChaos = 0.74;
    environmentState.canopyEdgeLushness = 1.25;
    environmentState.branchDepth = 5;
    return true;
  }
  if (preset === 'clearing') {
    environmentState.treeSkyOpen = 1.48;
    environmentState.treeFrameDensity = 4;
    environmentState.treeFoliageMass = 0.08;
    environmentState.treeBranchReach = 0.24;
    environmentState.treeBranchChaos = 0.42;
    environmentState.canopyEdgeLushness = 0.0;
    environmentState.branchDepth = 3;
    return true;
  }
  return false;
}

function randomizeSceneSliders() {
  environmentState.treeSkyOpen = 1 + Math.random() * 0.5;
  environmentState.treeFrameDensity = Math.round(4 + Math.random() * 12);
  environmentState.treeFoliageMass = clamp01(0.1 + Math.random() * 0.9);
  environmentState.treeBranchReach = clamp01(0.1 + Math.random() * 0.9);
  environmentState.treeBranchChaos = clamp01(0.05 + Math.random() * 0.95);
  environmentState.canopyEdgeLushness = 0.1 + Math.random() * 1.4;
  environmentState.branchDepth = 3 + Math.floor(Math.random() * 3);
  environmentState.windSpeed = clamp01(Math.random());
  environmentState.cloudCover = clamp01(Math.random());
  environmentState.currentWeather = ['clear', 'rain', 'storm'][Math.floor(Math.random() * 3)];
  environmentState.timeOfDay = Math.random() * 24;
}

function estimateLocationWoodedness(lat, lon, name = '') {
  const absLat = Math.abs(Number(lat) || 0);
  let wooded = 0.56;
  const q = String(name || '').toLowerCase();

  // Polar cap / arctic stations should be effectively treeless.
  if (absLat >= 72 || q.includes('north pole')) return 0.0;

  if (absLat < 12) wooded = 0.84;
  else if (absLat < 23) wooded = 0.74;
  else if (absLat < 35) wooded = 0.52;
  else if (absLat < 50) wooded = 0.62;
  else if (absLat < 62) wooded = 0.54;
  else wooded = 0.42;
  const aridHints = ['phoenix', 'las vegas', 'doha', 'cairo', 'riyadh', 'dubai', 'abu dhabi', 'marrakesh', 'sahara'];
  const humidHints = ['rainforest', 'manaus', 'singapore', 'quito', 'vancouver', 'seattle', 'portland', 'honolulu'];
  if (aridHints.some((k) => q.includes(k))) wooded -= 0.20;
  if (humidHints.some((k) => q.includes(k))) wooded += 0.14;

  if (Number.isFinite(lon)) {
    // Small stable noise by coordinates so nearby regions vary subtly.
    const n = Math.sin((lat * 12.9898) + (lon * 78.233)) * 43758.5453;
    const frac = n - Math.floor(n);
    wooded += (frac - 0.5) * 0.08;
  }
  return clamp01(wooded);
}

function randomizeCanopyForLocation(woodedOverride = null) {
  const lat = Number(environmentState.liveLocationLat);
  const lon = Number(environmentState.liveLocationLon);
  const wooded = Number.isFinite(woodedOverride)
    ? clamp01(woodedOverride)
    : estimateLocationWoodedness(lat, lon, environmentState.liveLocationName);
  const winterK = (() => {
    const s = String(environmentState.season || 'auto').toLowerCase();
    if (s === 'winter') return 0.62;
    if (s === 'fall') return 0.84;
    if (s === 'spring') return 0.92;
    return 1.0;
  })();
  const w = wooded * winterK;
  const treeless = w <= 0.03;

  environmentState.forceTreeless = treeless;
  if (treeless) {
    environmentState.treeFrameDensity = 4;
    environmentState.treeFoliageMass = 0;
    environmentState.treeBranchReach = 0;
    environmentState.treeSkyOpen = 1.5;
    environmentState.canopyEdgeLushness = 0;
    environmentState.treeBranchChaos = 0.35;
    environmentState.branchDepth = 3;
    return;
  }

  environmentState.treeFrameDensity = Math.max(4, Math.min(16, Math.round(4 + w * 12 + (Math.random() * 2 - 1))));
  environmentState.treeFoliageMass = clamp01(0.18 + w * 0.78 + (Math.random() * 0.14 - 0.07));
  environmentState.treeBranchReach = clamp01(0.26 + w * 0.34 + (Math.random() * 0.10 - 0.05));
  environmentState.treeSkyOpen = Math.max(1.0, Math.min(1.5, 1.42 - w * 0.34 + (Math.random() * 0.10 - 0.05)));
  environmentState.canopyEdgeLushness = Math.max(0, Math.min(1.5, w * 1.18 + (Math.random() * 0.18 - 0.09)));
  environmentState.treeBranchChaos = clamp01(0.42 + Math.random() * 0.46);
}

function normalizeForcedTreeType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'conifer' || s === 'palm') return s;
  return '';
}

async function simulationTick() {
  try {
    if (environmentState.journeyActive) return; // journeyTick owns the clock + weather
    if (environmentState.simulationMode === 'random') {
      tickRandomSimulation();
      io.emit('env:sync', environmentState);
      return;
    }

    if (environmentState.simulationMode === 'live') {
      const now = Date.now();
      if (now - lastLiveFetchAt >= LIVE_FETCH_MS) {
        await fetchLiveWeather();
        lastLiveFetchAt = now;
        io.emit('env:sync', environmentState);
      }
    }
  } catch (err) {
    console.warn(`[sim] ${err.message}`);
  }
}


// ----------------------------------------------------------
// Journey mode — time travel
//
// The canonical clock is environmentState.journeyEpochMs (UTC). Every
// JOURNEY_TICK_MS it advances by journeyRate simulated seconds per real second
// (negative runs backwards, 0 pauses). timeOfDay / liveDateISO are derived from
// it as local *solar* time (longitude / 15°), which is what the sky needs.
//
// Weather while journeying comes from, in order of preference:
//   'hold'     — a manual edit from the remote froze it
//   'archive'  — Open-Meteo archive (1940 → ~1 week ago), hourly, cached per day
//   'forecast' — Open-Meteo forecast (past 90 days → +16 days), hourly
//   'model'    — deterministic procedural weather seeded by place + hour, so
//                scrubbing back and forth replays the same sky
// Hourly APIs are only consulted when |rate| ≤ 2 h/s; faster than that a day
// flashes by in seconds and the model is used.
// ----------------------------------------------------------
const JOURNEY_TICK_MS = 500;
const JOURNEY_BROADCAST_MS = 1000;
const JOURNEY_API_MAX_RATE = 7200;
const DAY_MS = 86400000;

const JOURNEY_RATES = {
  realtime: 1,
  minute: 60,      // 1 simulated minute per second
  hour: 3600,      // 1 hour per second  (a day in 24 s)
  day: 86400,      // 1 day per second   (a year in ~6 min)
};

// Curated destinations. `epoch` is an ISO string in UTC. Years before 1 CE use
// the expanded ISO form (-002500 = 2501 BC, since year 0 = 1 BC).
// `wooded` overrides the location-mix guess; `sceneAudio` picks a client-side
// synth bed (fire, drone) or a loop file dropped in public/audio/scenes/.
const JOURNEY_DESTINATIONS = [
  { id: 'home-now',      name: 'New Haven, CT',                lat: 41.3083,  lon: -72.9279, epoch: 'now',                        label: 'Home, right now' },
  { id: 'stonehenge',    name: 'Stonehenge, Salisbury Plain',  lat: 51.1789,  lon: -1.8262,  epoch: '-002499-06-21T03:55:00Z',    label: 'Stonehenge, midsummer sunrise, 2500 BC', wooded: 0.12, sceneAudio: 'drone', weather: 'clear' },
  { id: 'lascaux',       name: 'Lascaux, Vézère valley',       lat: 45.0538,  lon: 1.1700,   epoch: '-016999-01-14T20:30:00Z',    label: 'Ice-age hearth outside Lascaux, 17,000 BC', wooded: 0.30, sceneAudio: 'fire', weather: 'clear', forceTreeType: 'conifer' },
  { id: 'giza',          name: 'Giza plateau',                 lat: 29.9792,  lon: 31.1342,  epoch: '-002559-10-03T16:40:00Z',    label: 'Giza, the pyramids rising, 2560 BC', wooded: 0.05, forceTreeType: 'palm', weather: 'clear' },
  { id: 'rome-ides',     name: 'Rome, Campus Martius',         lat: 41.8986,  lon: 12.4768,  epoch: '-000043-03-15T10:00:00Z',    label: 'Rome, the Ides of March, 44 BC', wooded: 0.35 },
  { id: 'angkor',        name: 'Angkor, Cambodia',             lat: 13.4125,  lon: 103.8670, epoch: '1150-04-12T23:00:00Z',        label: 'Angkor at night, 1150', wooded: 0.85, forceTreeType: 'palm' },
  { id: 'machu-picchu',  name: 'Machu Picchu, Peru',           lat: -13.1631, lon: -72.5450, epoch: '1450-06-24T10:30:00Z',        label: 'Machu Picchu, Inti Raymi dawn, 1450', wooded: 0.55 },
  { id: 'kyoto-sakura',  name: 'Kyoto, Japan',                 lat: 35.0116,  lon: 135.7681, epoch: '1600-04-05T05:30:00Z',        label: 'Kyoto under cherry blossom, spring 1600', wooded: 0.7 },
  { id: 'sherwood',      name: 'Sherwood Forest, England',     lat: 53.2050,  lon: -1.0750,  epoch: '1190-10-14T17:30:00Z',        label: 'Sherwood Forest, autumn dusk, 1190', wooded: 0.95 },
  { id: 'black-forest',  name: 'Black Forest, Germany',        lat: 48.1500,  lon: 8.2000,   epoch: '1812-12-20T22:30:00Z',        label: 'Black Forest, a winter night, 1812', wooded: 0.95, forceTreeType: 'conifer' },
  { id: 'woodstock',     name: 'Bethel, New York',             lat: 41.7013,  lon: -74.8808, epoch: '1969-08-18T00:30:00Z',        label: 'Woodstock, Sunday evening, 1969 (real weather)', wooded: 0.7 },
  { id: 'moon-landing',  name: 'Cocoa Beach, Florida',         lat: 28.3200,  lon: -80.6076, epoch: '1969-07-21T02:56:00Z',        label: 'Night of the first moonwalk, July 1969 (real weather)', wooded: 0.4, forceTreeType: 'palm' },
  { id: 'serengeti',     name: 'Serengeti, Tanzania',          lat: -2.3333,  lon: 34.8333,  epoch: 'now',                        label: 'Serengeti, tonight', wooded: 0.25, tod: 21.5 },
  { id: 'manaus',        name: 'Manaus, Amazon',               lat: -3.1190,  lon: -60.0217, epoch: 'now',                        label: 'Amazon rainforest, now', wooded: 0.98 },
  { id: 'tromso-aurora', name: 'Tromsø, Norway',               lat: 69.6492,  lon: 18.9553,  epoch: '2025-12-21T21:45:00Z',        label: 'Tromsø, polar night, midwinter', forceTreeType: 'conifer', wooded: 0.4 },
  { id: 'mauna-kea',     name: 'Mauna Kea summit, Hawaii',     lat: 19.8207,  lon: -155.4681, epoch: 'now',                       label: 'Mauna Kea, under the Milky Way', tod: 1.0, wooded: 0.0, weather: 'clear' },
  { id: 'antarctica',    name: 'McMurdo Station, Antarctica',  lat: -77.8460, lon: 166.6680, epoch: '2025-12-21T13:20:00Z',        label: 'Antarctica, midnight sun, midsummer', wooded: 0.0 },
  { id: 'halley-1986',   name: 'Alice Springs, Australia',     lat: -23.6980, lon: 133.8807, epoch: '1986-04-11T14:30:00Z',        label: 'Outback night, April 1986 (Halley\'s Comet year)', wooded: 0.15 },
];

let journeyLastTickAt = Date.now();
let journeyLastBroadcastAt = 0;
const journeyWeatherCache = new Map(); // key → { hours: [...] } | null (failed)
const journeyWeatherInflight = new Set();

function journeyEpoch() {
  const e = Number(environmentState.journeyEpochMs);
  return Number.isFinite(e) ? e : Date.now();
}

function isoFromMs(ms) {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function journeyLocalMs() {
  const lon = Number(environmentState.liveLocationLon) || 0;
  return journeyEpoch() + lon * 240000; // 1° of longitude = 4 minutes of solar time
}

// Derive timeOfDay + liveDateISO (local solar) from the journey clock.
function applyJourneyClock() {
  const local = journeyLocalMs();
  const dayMs = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  environmentState.timeOfDay = dayMs / 3600000;
  environmentState.liveDateISO = isoFromMs(local);
  environmentState.journeySyncAtMs = Date.now();
  environmentState.liveIsDay = isSunUp();
}

function journeySetEpoch(ms) {
  if (!Number.isFinite(ms)) return false;
  // JS Date range is ±8.64e15 ms (~±273,000 years). Clamp well inside.
  const lim = 8.0e15;
  environmentState.journeyEpochMs = Math.max(-lim, Math.min(lim, ms));
  applyJourneyClock();
  return true;
}

function journeySetSolarHour(tod) {
  const local = journeyLocalMs();
  const dayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  const lon = Number(environmentState.liveLocationLon) || 0;
  journeySetEpoch(dayStart + tod * 3600000 - lon * 240000);
}

function parseEpochInput(v) {
  if (v === 'now') return Date.now();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v.trim());
    if (Number.isFinite(d.getTime())) return d.getTime();
  }
  if (v && typeof v === 'object') {
    // { year, month, day, hour, minute } — proleptic Gregorian, UTC. Year may be
    // negative or zero (astronomical numbering: 0 = 1 BC, -1 = 2 BC).
    const y = Number(v.year), mo = Number(v.month ?? 1), d = Number(v.day ?? 1);
    const h = Number(v.hour ?? 12), mi = Number(v.minute ?? 0);
    if (Number.isFinite(y) && Math.abs(y) <= 200000) {
      const dt = new Date(0);
      dt.setUTCFullYear(y, Math.max(0, Math.min(11, (mo || 1) - 1)), Math.max(1, Math.min(31, d || 1)));
      dt.setUTCHours(Math.max(0, Math.min(23, h || 0)), Math.max(0, Math.min(59, mi || 0)), 0, 0);
      const local = dt.getTime();
      // Inputs are in local solar time of the current location → convert to UTC.
      const lon = Number(environmentState.liveLocationLon) || 0;
      if (Number.isFinite(local)) return local - lon * 240000;
    }
  }
  return null;
}

function journeyStart(rate, skipWeather = false) {
  if (!environmentState.journeyActive) {
    // Seed the clock from whatever the scene currently shows so nothing jumps.
    const base = environmentState.liveDateISO ? new Date(environmentState.liveDateISO) : new Date();
    const baseMs = Number.isFinite(base.getTime()) ? base.getTime() : Date.now();
    const lon = Number(environmentState.liveLocationLon) || 0;
    // liveDateISO is local-solar-ish (see setApproxLocalTimeFromLon); undo the offset.
    const dayStart = baseMs - (((baseMs % DAY_MS) + DAY_MS) % DAY_MS);
    const tod = Number(environmentState.timeOfDay) || 0;
    environmentState.journeyEpochMs = dayStart + tod * 3600000 - lon * 240000;
    environmentState.journeyActive = true;
    environmentState.journeyWeatherHold = false;
    environmentState.simulationMode = 'journey';
    journeyLastTickAt = Date.now();
  }
  if (rate !== undefined) environmentState.journeyRate = clampRange(rate, -86400 * 30, 86400 * 30, 0);
  applyJourneyClock();
  if (!skipWeather) journeyApplyWeather(true);
}

function journeyStop() {
  environmentState.journeyActive = false;
  environmentState.journeyRate = 0;
  environmentState.journeyLabel = '';
  environmentState.journeyWeatherHold = false;
  environmentState.journeyWeatherSource = 'model';
  environmentState.sceneAudio = '';
  environmentState.simulationMode = 'live';
  setApproxLocalTimeFromLon(environmentState.liveLocationLon);
  lastLiveFetchAt = 0; // next simulationTick refreshes live weather
}

// ---- weather while journeying ----

function journeyDayKey(lat, lon, epochMs) {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const dateStr = `${String(y).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { key: `${lat.toFixed(2)},${lon.toFixed(2)},${dateStr}`, dateStr, year: y };
}

function journeyApiForDate(epochMs) {
  const now = Date.now();
  const ageDays = (now - epochMs) / DAY_MS;
  if (epochMs < Date.UTC(1940, 0, 2)) return null;
  if (ageDays > 8) return 'archive';
  if (ageDays > -15) return 'forecast';
  return null;
}

async function fetchJourneyDay(lat, lon, epochMs) {
  const { key, dateStr } = journeyDayKey(lat, lon, epochMs);
  if (journeyWeatherCache.has(key) || journeyWeatherInflight.has(key)) return;
  const api = journeyApiForDate(epochMs);
  if (!api) { journeyWeatherCache.set(key, null); return; }
  journeyWeatherInflight.add(key);
  const host = api === 'archive' ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const url = `${host}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
    + `&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,cloud_cover,wind_speed_10m,weather_code&timezone=UTC`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const h = data.hourly || {};
    const n = Array.isArray(h.time) ? h.time.length : 0;
    if (n < 24) throw new Error('short hourly payload');
    const hours = [];
    for (let i = 0; i < n; i++) {
      hours.push({
        temp: Number(h.temperature_2m?.[i]),
        cloud: clamp01(Number(h.cloud_cover?.[i] ?? 30) / 100),
        wind: clamp01(Number(h.wind_speed_10m?.[i] ?? 8) / 45),
        code: Number(h.weather_code?.[i] ?? 0),
      });
    }
    journeyWeatherCache.set(key, { hours, source: api });
    console.log(`[journey] ${api} weather cached for ${dateStr} @ ${lat.toFixed(2)},${lon.toFixed(2)}`);
  } catch (err) {
    console.warn(`[journey] weather fetch failed for ${dateStr}: ${err.message}`);
    journeyWeatherCache.set(key, null);
  } finally {
    journeyWeatherInflight.delete(key);
  }
  if (journeyWeatherCache.size > 400) {
    // Drop the oldest entries.
    const it = journeyWeatherCache.keys();
    for (let i = 0; i < 100; i++) journeyWeatherCache.delete(it.next().value);
  }
}

// Smooth deterministic noise in "hours since epoch" space.
function journeyModelNoise(seed, hourF, periodH) {
  const t = hourF / periodH;
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = fracHash(seed + i * 12.9898);
  const b = fracHash(seed + (i + 1) * 12.9898);
  return a + (b - a) * u;
}

function journeyModelWeather(lat, lon, epochMs) {
  const hourF = epochMs / 3600000;
  const seed = Math.round(lat * 10) * 0.173 + Math.round(lon * 10) * 0.0731;
  const absLat = Math.abs(lat);
  const slow = journeyModelNoise(seed + 1.1, hourF, 18);   // frontal systems
  const fast = journeyModelNoise(seed + 7.7, hourF, 5);    // afternoon build-ups
  let cloud = clamp01(0.08 + slow * 0.72 + (fast - 0.5) * 0.28);
  if (absLat < 12) cloud = clamp01(cloud * 0.85 + 0.12);   // tropics: hazy, convective
  const wind = clamp01(0.08 + journeyModelNoise(seed + 3.3, hourF, 9) * 0.5 + (slow - 0.5) * 0.2);
  const d = new Date(epochMs);
  const month = d.getUTCMonth() + 1;
  const hemiSouth = lat < 0;
  const summerK = Math.max(0, Math.cos(((month - (hemiSouth ? 1 : 7)) / 12) * Math.PI * 2)); // 1 in summer
  const stormRoll = journeyModelNoise(seed + 9.9, hourF, 4);
  let weather = 'clear';
  if (cloud > 0.62 && stormRoll > 0.93 - summerK * 0.08 - (absLat < 15 ? 0.05 : 0)) weather = 'storm';
  else if (cloud > 0.58 && stormRoll > 0.62) weather = 'rain';
  return { cloud, wind, weather, temp: null };
}

function journeyApplyWeather(force = false) {
  if (!environmentState.journeyActive || environmentState.journeyWeatherHold) return;
  const lat = Number(environmentState.liveLocationLat);
  const lon = Number(environmentState.liveLocationLon);
  const epochMs = journeyEpoch();
  const rate = Number(environmentState.journeyRate) || 0;
  let applied = null;
  let source = 'model';

  if (Math.abs(rate) <= JOURNEY_API_MAX_RATE && Number.isFinite(lat) && Number.isFinite(lon)) {
    const { key } = journeyDayKey(lat, lon, epochMs);
    const day = journeyWeatherCache.get(key);
    if (day === undefined) fetchJourneyDay(lat, lon, epochMs);
    // Prefetch the neighbouring day in the direction of travel.
    if (rate !== 0) fetchJourneyDay(lat, lon, epochMs + Math.sign(rate) * DAY_MS);
    if (day && day.hours) {
      const d = new Date(epochMs);
      const hf = d.getUTCHours() + d.getUTCMinutes() / 60;
      const i0 = Math.floor(hf), i1 = Math.min(23, i0 + 1), f = hf - i0;
      const a = day.hours[i0], b = day.hours[i1];
      applied = {
        cloud: a.cloud + (b.cloud - a.cloud) * f,
        wind: a.wind + (b.wind - a.wind) * f,
        temp: Number.isFinite(a.temp) && Number.isFinite(b.temp) ? a.temp + (b.temp - a.temp) * f : null,
        weather: mapWeatherCode(f < 0.5 ? a.code : b.code),
      };
      source = day.source;
    }
  }
  if (!applied) applied = journeyModelWeather(lat || 0, lon || 0, epochMs);

  environmentState.cloudCover = applied.cloud;
  environmentState.windSpeed = applied.wind;
  environmentState.currentWeather = applied.weather;
  environmentState.lightningIntensity = applied.weather === 'storm' ? 0.7 : 0;
  environmentState.liveCloudCoverPct = Math.round(applied.cloud * 100);
  environmentState.liveWindKph = Math.round(applied.wind * 45);
  if (applied.weather === 'storm') environmentState.cloudCover = Math.max(environmentState.cloudCover, 0.75);
  if (Number.isFinite(applied.temp)) environmentState.liveTemperatureC = applied.temp;
  else applyLocationBaselineClimate();
  environmentState.journeyWeatherSource = source;
  refreshDerivedLiveFields();
}

function journeyTick() {
  const now = Date.now();
  const dt = now - journeyLastTickAt;
  journeyLastTickAt = now;
  if (!environmentState.journeyActive) return;
  const rate = Number(environmentState.journeyRate) || 0;
  if (rate !== 0) {
    journeySetEpoch(journeyEpoch() + rate * dt);
  }
  journeyApplyWeather();
  if (rate !== 0 && now - journeyLastBroadcastAt >= JOURNEY_BROADCAST_MS) {
    journeyLastBroadcastAt = now;
    io.emit('env:sync', environmentState);
  }
}

function journeyGoto(id) {
  const dest = JOURNEY_DESTINATIONS.find((d) => d.id === id);
  if (!dest) return false;
  environmentState.liveLocationName = dest.name;
  environmentState.liveLocationLat = dest.lat;
  environmentState.liveLocationLon = dest.lon;
  environmentState.forceTreeType = normalizeForcedTreeType(dest.forceTreeType);
  environmentState.journeyLabel = dest.label || dest.name;
  environmentState.sceneAudio = normalizeSceneAudio(dest.sceneAudio);
  journeyStart(undefined, true); // weather is applied below, once the clock is set
  let epoch = parseEpochInput(dest.epoch);
  if (epoch === null) epoch = Date.now();
  journeySetEpoch(epoch);
  if (Number.isFinite(dest.tod)) journeySetSolarHour(dest.tod);
  environmentState.journeyWeatherHold = false;
  randomizeCanopyForLocation(Number.isFinite(dest.wooded) ? dest.wooded : null);
  journeyApplyWeather(true);
  if (dest.weather && ['clear', 'rain', 'storm'].includes(dest.weather)) {
    environmentState.currentWeather = dest.weather;
    if (dest.weather === 'clear') environmentState.cloudCover = Math.min(environmentState.cloudCover, 0.25);
    environmentState.journeyWeatherHold = true;
    environmentState.journeyWeatherSource = 'hold';
  }
  refreshDerivedLiveFields();
  return true;
}

function journeyBroadcast() {
  journeyLastBroadcastAt = Date.now();
  io.emit('env:sync', environmentState);
}

setInterval(journeyTick, JOURNEY_TICK_MS);

// ----------------------------------------------------------
// Static file serving
// All files inside /public are served at the root URL.
// index.html, sketch.js, and any future assets live here.
// ----------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

let autoSleepTimeout = null;

app.get('/trigger_motion', (req, res) => {
  const durationSec = parseInt(req.query.duration) || 300; // default 5 min
  console.log(`[motion] Motion detected! Waking for ${durationSec}s...`);

  if (autoSleepTimeout) clearTimeout(autoSleepTimeout);

  if (environmentState.sleeping) {
    environmentState.sleeping = false;
    setDisplayPower(true);
    io.emit('env:sync', environmentState);
    io.emit('remote:command', { command: 'toggle_sleep', data: { value: false } });
  }

  autoSleepTimeout = setTimeout(() => {
    console.log('[motion] Timeout reached. Returning to sleep.');
    environmentState.sleeping = true;
    setDisplayPower(false);
    io.emit('env:sync', environmentState);
    io.emit('remote:command', { command: 'toggle_sleep', data: { value: true } });
  }, durationSec * 1000);

  res.json({ status: 'waking', duration: durationSec });
});

// ---- Journey HTTP API — for a rotary encoder / ESP32 / shell script in the room ----
// GET /journey/destinations            → curated list (used by remote.html)
// GET /journey/scrub?sec=600           → nudge the clock (negative = back)
// GET /journey/rate?value=3600         → set speed (0 pauses); or ?preset=hour|day|minute|realtime|pause
// GET /journey/toggle                  → play/pause
// GET /journey/goto?id=stonehenge      → jump to a destination
// GET /journey/state                   → current journey fields
app.get('/journey/destinations', (_req, res) => {
  res.json(JOURNEY_DESTINATIONS.map(({ id, name, label, lat, lon, epoch }) => ({ id, name, label, lat, lon, epoch })));
});
app.get('/journey/state', (_req, res) => {
  const { journeyActive, journeyRate, journeyEpochMs, journeyLabel, journeyWeatherSource, timeOfDay, liveDateISO, liveLocationName } = environmentState;
  res.json({ journeyActive, journeyRate, journeyEpochMs, journeyLabel, journeyWeatherSource, timeOfDay, liveDateISO, liveLocationName });
});
app.get('/journey/scrub', (req, res) => {
  const sec = Number(req.query.sec);
  if (!Number.isFinite(sec)) return res.status(400).json({ error: 'sec required' });
  if (!environmentState.journeyActive) journeyStart(0);
  journeySetEpoch(journeyEpoch() + sec * 1000);
  journeyApplyWeather(true);
  journeyBroadcast();
  res.json({ ok: true, journeyEpochMs: environmentState.journeyEpochMs, timeOfDay: environmentState.timeOfDay });
});
app.get('/journey/rate', (req, res) => {
  let rate = Number(req.query.value);
  const preset = String(req.query.preset || '').toLowerCase();
  if (preset === 'pause') rate = 0;
  else if (JOURNEY_RATES[preset] !== undefined) rate = JOURNEY_RATES[preset];
  if (!Number.isFinite(rate)) return res.status(400).json({ error: 'value or preset required' });
  journeyStart(rate);
  journeyBroadcast();
  res.json({ ok: true, journeyRate: environmentState.journeyRate });
});
app.get('/journey/toggle', (_req, res) => {
  if (!environmentState.journeyActive) journeyStart(1);
  else environmentState.journeyRate = environmentState.journeyRate === 0 ? 1 : 0;
  journeyBroadcast();
  res.json({ ok: true, journeyRate: environmentState.journeyRate });
});
app.get('/journey/goto', (req, res) => {
  if (!journeyGoto(String(req.query.id || ''))) return res.status(404).json({ error: 'unknown destination' });
  io.emit('remote:command', { command: 'journey_goto', data: { id: String(req.query.id) } });
  journeyBroadcast();
  res.json({ ok: true, journeyLabel: environmentState.journeyLabel });
});

// ----------------------------------------------------------
// Socket.io — WebSocket layer
// Each browser tab that loads the page opens one socket.
// ----------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[socket] Client connected    → id: ${socket.id}`);

  // Send current canonical environment snapshot on connect.
  socket.emit('env:sync', environmentState);

  // Local panel controls can still push full environment updates.
  socket.on('env:update', (nextState = {}) => {
    Object.assign(environmentState, nextState);
    io.emit('env:sync', environmentState);
  });

  socket.on('sim:setMode', (payload = {}) => {
    const mode = payload.mode;
    if (!['manual', 'random', 'live'].includes(mode)) return;
    environmentState.simulationMode = mode;
    io.emit('env:sync', environmentState);
  });

  socket.on('sim:setLocation', async (payload = {}) => {
    if (typeof payload.query !== 'string') return;
    try {
      const lat = Number(payload.lat);
      const lon = Number(payload.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        environmentState.liveLocationName = String(payload.name || payload.query || environmentState.liveLocationName);
        environmentState.liveLocationLat = lat;
        environmentState.liveLocationLon = lon;
        environmentState.forceTreeType = normalizeForcedTreeType(payload.forceTreeType);
        setApproxLocalTimeFromLon(lon);
        applyLocationBaselineClimate();
      } else {
        await geocodeLocation(payload.query);
        environmentState.forceTreeType = '';
        setApproxLocalTimeFromLon(environmentState.liveLocationLon);
        applyLocationBaselineClimate();
      }
      environmentState.simulationMode = 'live';
      randomizeCanopyForLocation();
      refreshDerivedLiveFields();
      // Always push new location immediately so clients rerender stars/season by location.
      if (!environmentState.liveDateISO) environmentState.liveDateISO = new Date().toISOString();
      io.emit('env:sync', environmentState);

      await fetchLiveWeather();
      lastLiveFetchAt = Date.now();
      io.emit('env:sync', environmentState);
    } catch (err) {
      socket.emit('sim:error', { message: err.message });
      // Still broadcast location state in case weather fetch failed but location changed.
      io.emit('env:sync', environmentState);
    }
  });

  // Mobile remote commands are normalized here and rebroadcast.
  socket.on('sky:status', (data = {}) => {
    io.emit('sky:status', { text: String(data.text || '').slice(0, 1000) });
  });
  socket.on('remote:command', async (payload = {}) => {
    const command = typeof payload === 'string' ? payload : payload.command;
    const data = payload && typeof payload === 'object' ? (payload.data || {}) : {};
    if (!command) return;

    switch (command) {
      case 'sky_experience':
        if (!['ambient','explore','cape','cape_pause','apollo','apollo_pause','apollo_sky','voyager','launch','telescope','telescope_close','body','narration'].includes(data.action)) return;
        break;
      case 'toggle_sleep':
        const nextSleep = data.value !== undefined ? !!data.value : !environmentState.sleeping;
        environmentState.sleeping = nextSleep;
        setDisplayPower(!nextSleep);
        break;
      case 'set_location': {
        try {
          const lat = Number(data.lat);
          const lon = Number(data.lon);
          const query = String(data.query || data.name || '').trim();
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            environmentState.liveLocationName = String(data.name || query || environmentState.liveLocationName);
            environmentState.liveLocationLat = lat;
            environmentState.liveLocationLon = lon;
            environmentState.forceTreeType = normalizeForcedTreeType(data.forceTreeType);
            setApproxLocalTimeFromLon(lon);
            applyLocationBaselineClimate();
          } else if (query) {
            await geocodeLocation(query);
            environmentState.forceTreeType = '';
            setApproxLocalTimeFromLon(environmentState.liveLocationLon);
            applyLocationBaselineClimate();
          } else {
            return;
          }
          if (environmentState.journeyActive) {
            environmentState.journeyLabel = environmentState.liveLocationName;
            applyJourneyClock();
            randomizeCanopyForLocation();
            journeyApplyWeather(true);
            io.emit('remote:command', { command, data });
            journeyBroadcast();
            return;
          }
          environmentState.simulationMode = 'live';
          randomizeCanopyForLocation();
          refreshDerivedLiveFields();
          io.emit('remote:command', { command, data });
          io.emit('env:sync', environmentState);
          await fetchLiveWeather();
          lastLiveFetchAt = Date.now();
          io.emit('env:sync', environmentState);
        } catch (err) {
          socket.emit('sim:error', { message: err.message });
          io.emit('env:sync', environmentState);
        }
        return;
      }
      case 'trigger_storm':
        environmentState.currentWeather = 'storm';
        break;
      case 'clear_weather':
        environmentState.currentWeather = 'clear';
        break;
      case 'day_mode':
        environmentState.timeOfDay = 12;
        break;
      case 'night_mode':
        environmentState.timeOfDay = 23;
        break;
      case 'reseed_trees':
        break;
      case 'preset_wooded':
        applyScenePreset('wooded');
        break;
      case 'preset_clearing':
        applyScenePreset('clearing');
        break;
      case 'randomize_scene':
        randomizeSceneSliders();
        break;
      case 'toggle_constellations':
        environmentState.showConstellations = !!data.value;
        break;
      case 'toggle_sky_labels':
        environmentState.showConstellations = !!data.value;
        environmentState.showConstellationLabels = !!data.value;
        environmentState.showPlantLabels = !!data.value;
        break;
      case 'toggle_labels':
        environmentState.showConstellationLabels = !!data.value;
        environmentState.showPlantLabels = !!data.value;
        break;
      case 'toggle_compass':
        environmentState.showCompassDirections = !!data.value;
        break;
      case 'set_compass_offset':
        environmentState.skyAzimuthOffsetDeg = normalizeAzimuthOffsetDeg(data.value);
        break;
      case 'set_env_values':
        if (!applyRemoteEnvPatch(data)) return;
        break;
      case 'lightning_flash':
        break;
      case 'journey_start':
        journeyStart(data.rate !== undefined ? Number(data.rate) : 1);
        break;
      case 'journey_stop':
        journeyStop();
        lastLiveFetchAt = 0;
        try { await fetchLiveWeather(); lastLiveFetchAt = Date.now(); } catch (err) { console.warn(`[journey] live refresh failed: ${err.message}`); }
        break;
      case 'journey_set_rate': {
        let rate = Number(data.rate);
        const preset = String(data.preset || '').toLowerCase();
        if (preset === 'pause') rate = 0;
        else if (JOURNEY_RATES[preset] !== undefined) rate = JOURNEY_RATES[preset];
        if (!Number.isFinite(rate)) return;
        journeyStart(rate);
        break;
      }
      case 'journey_toggle':
        if (!environmentState.journeyActive) journeyStart(1);
        else environmentState.journeyRate = environmentState.journeyRate === 0 ? 1 : 0;
        break;
      case 'journey_scrub': {
        const sec = Number(data.sec);
        if (!Number.isFinite(sec)) return;
        if (!environmentState.journeyActive) journeyStart(0);
        journeySetEpoch(journeyEpoch() + sec * 1000);
        journeyApplyWeather(true);
        break;
      }
      case 'journey_set_epoch': {
        const epoch = parseEpochInput(data.epoch !== undefined ? data.epoch : data);
        if (epoch === null) return;
        if (!environmentState.journeyActive) journeyStart(data.rate !== undefined ? Number(data.rate) : 1);
        journeySetEpoch(epoch);
        environmentState.journeyLabel = String(data.label || environmentState.journeyLabel || '').slice(0, 80);
        environmentState.journeyWeatherHold = false;
        journeyApplyWeather(true);
        break;
      }
      case 'journey_now':
        if (!environmentState.journeyActive) journeyStart(1);
        journeySetEpoch(Date.now());
        environmentState.journeyLabel = '';
        environmentState.journeyWeatherHold = false;
        journeyApplyWeather(true);
        break;
      case 'journey_goto':
        if (!journeyGoto(String(data.id || ''))) return;
        break;
      case 'journey_weather_auto':
        environmentState.journeyWeatherHold = false;
        journeyApplyWeather(true);
        break;
      default:
        console.log(`[socket] Unknown remote command: ${command}`);
        return;
    }

    io.emit('remote:command', { command, data });
    io.emit('env:sync', environmentState);
  });

  // Physical-effects hook. The display emits this for every close/distant
  // strike with { intensity 0..1, distance 0..1 }. Thunder on the display is
  // delayed by distance*6.25 s (see atmosphere.js _scheduleThunder), so a room
  // light wash (WLED, relay, DMX) should fire immediately and any physical
  // thunder device should wait the same delay. Nothing is wired here yet.
  socket.on('lightning_strike', (payload = {}) => {
    const d = Number(payload.distance);
    console.log(`[fx] lightning_strike intensity=${Number(payload.intensity ?? 1).toFixed(2)} distance=${Number.isFinite(d) ? d.toFixed(2) : '?'}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] Client disconnected  → id: ${socket.id} | reason: ${reason}`);
  });
});

// ----------------------------------------------------------
// Start listening
// ----------------------------------------------------------
server.listen(PORT, () => {
  console.log(`[server] Nature Canopy Vibes running → http://localhost:${PORT}`);
});

setInterval(simulationTick, TICK_MS);
simulationTick();
