// ============================================================
// sketch.js — Nature Canopy Vibes | Main Orchestrator
// ============================================================

// ----------------------------------------------------------
// Globals — subsystems (declared here so windowResized can safely reference them
// even if setup() hasn't run yet, avoiding a temporal-dead-zone crash)
// ----------------------------------------------------------
let starField = null, canopy = null, flock = null;
let atmosphere = null, murmuration = null, gooseMigration = null;
const startupUrlParams = new URLSearchParams(window.location.search);

function parseStartupCompassOffsetDeg() {
  const raw = startupUrlParams.get('skyAzOffset')
    || startupUrlParams.get('compassOffset')
    || startupUrlParams.get('azOffset')
    || '0';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return ((n + 180) % 360 + 360) % 360 - 180;
}

function parseStartupEnvOverrides() {
  const readNum = (key, min, max, round = false) => {
    const raw = startupUrlParams.get(key);
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const clamped = Math.max(min, Math.min(max, n));
    return round ? Math.round(clamped) : clamped;
  };
  const out = {};

  const tod = readNum('tod', 0, 24);
  const wind = readNum('wind', 0, 1);
  const cloud = readNum('cloud', 0, 1);
  const star = readNum('star', 0, 2);
  const trees = readNum('trees', 4, 16, true);
  const skyOpen = readNum('skyOpen', 1, 1.5);
  const foliage = readNum('foliage', 0, 1);
  const branchLen = readNum('branchLen', 0, 1);
  const edgeLush = readNum('edgeLush', 0, 1.5);
  const branchChaos = readNum('branchChaos', 0, 1);
  const sndMaster = readNum('sndMaster', 0, 1);
  const sndRain = readNum('sndRain', 0, 1);
  const sndWind = readNum('sndWind', 0, 1);
  const sndThunder = readNum('sndThunder', 0, 1);
  const sndBirds = readNum('sndBirds', 0, 1);
  const sndCrickets = readNum('sndCrickets', 0, 1);
  const sndNightBirds = readNum('sndNightBirds', 0, 1);

  if (tod !== undefined) out.timeOfDay = tod;
  if (wind !== undefined) out.windSpeed = wind;
  if (cloud !== undefined) out.cloudCover = cloud;
  if (star !== undefined) out.starBrightness = star;
  if (trees !== undefined) out.treeFrameDensity = trees;
  if (skyOpen !== undefined) out.treeSkyOpen = skyOpen;
  if (foliage !== undefined) out.treeFoliageMass = foliage;
  if (branchLen !== undefined) out.treeBranchReach = branchLen;
  if (edgeLush !== undefined) out.canopyEdgeLushness = edgeLush;
  if (branchChaos !== undefined) out.treeBranchChaos = branchChaos;
  if (sndMaster !== undefined) out.soundMaster = sndMaster;
  if (sndRain !== undefined) out.soundRain = sndRain;
  if (sndWind !== undefined) out.soundWind = sndWind;
  if (sndThunder !== undefined) out.soundThunder = sndThunder;
  if (sndBirds !== undefined) out.soundBirds = sndBirds;
  if (sndCrickets !== undefined) out.soundCrickets = sndCrickets;
  if (sndNightBirds !== undefined) out.soundNightBirds = sndNightBirds;

  const weather = String(startupUrlParams.get('weather') || '').toLowerCase();
  if (['clear', 'rain', 'storm'].includes(weather)) out.currentWeather = weather;

  // Room / presentation controls.
  const bright = readNum('bright', 0.05, 1);
  const rot = readNum('rot', 0, 359, true);
  if (bright !== undefined) out.brightness = bright;
  if (rot !== undefined) out.overlayRotationDeg = rot;
  const readFlag = (key) => {
    const raw = startupUrlParams.get(key);
    if (raw === null) return undefined;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
  };
  const clock = readFlag('clock');
  const dual = readFlag('dual');
  if (clock !== undefined) out.showClock = clock;
  if (dual !== undefined) out.overlayDual = dual;
  const mapMode = String(startupUrlParams.get('map') || '').toLowerCase();
  if (['off', 'auto', 'always'].includes(mapMode)) out.showMap = mapMode;

  const season = String(startupUrlParams.get('season') || '').toLowerCase();
  if (['auto', 'spring', 'summer', 'fall', 'winter'].includes(season)) out.season = season;

  if (
    out.timeOfDay !== undefined ||
    out.windSpeed !== undefined ||
    out.cloudCover !== undefined ||
    out.currentWeather !== undefined
  ) {
    out.simulationMode = 'manual';
  }
  return out;
}
const startupEnvOverrides = parseStartupEnvOverrides();
let startupOverridesSent = false;

// ----------------------------------------------------------
// Socket.io client
// ----------------------------------------------------------
// Use window.io (property lookup) instead of bare `io` (variable lookup) so that
// a missing global never causes a ReferenceError — only a TypeError at worst.
const socket = window.io();
window._ncvSocket = socket;

socket.on('connect', () => {
  console.log('[socket] Connected →', socket.id);
  window._ncvSetSocketStatus && _ncvSetSocketStatus(true);
  if (!startupOverridesSent && Object.keys(startupEnvOverrides).length > 0) {
    socket.emit('remote:command', { command: 'set_env_values', data: startupEnvOverrides });
    startupOverridesSent = true;
  }
});
socket.on('disconnect', () => {
  console.log('[socket] Disconnected');
  window._ncvSetSocketStatus && _ncvSetSocketStatus(false);
});
socket.on('env:sync', (state) => {
  if (!window._ncvDidFirstSync) window._ncvDidFirstSync = false;
  const prevTreeCount = env.treeFrameDensity;
  const prevDepth = env.branchDepth;
  const prevTreeless = !!env.forceTreeless;
  const prevForceTreeType = String(env.forceTreeType || '');
  const prevConst = !!env.showConstellations;
  const prevConstLabels = !!env.showConstellationLabels;
  const prevPlantLabels = !!env.showPlantLabels;
  const prevSkyOffset = Number(env.skyAzimuthOffsetDeg) || 0;
  const prevLat = env.liveLocationLat, prevLon = env.liveLocationLon;
  const prevLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''}`;
  const prevDate = env.liveDateISO;
  const prevClientEpoch = env.journeyEpochMs;
  if (window._ncvDidFirstSync && ['liveLocationLat', 'liveLocationLon', 'timeOfDay', 'currentWeather', 'season'].some(
    key => state[key] !== undefined && state[key] !== env[key]
  ) && !state.journeyActive) window._ncvBeginLocationTransition();
  env.apply(state);
  window._ncvShowConstellations = !!env.showConstellations;
  // The client extrapolates the journey clock every frame (see draw()). Only
  // accept the server's stamp when it disagrees by more than a sync interval,
  // otherwise the 1 Hz correction would make the sky stutter.
  if (env.journeyActive && Number.isFinite(prevClientEpoch) && Number.isFinite(env.journeyEpochMs)) {
    const tol = Math.abs(Number(env.journeyRate) || 0) * 1500 + 2000;
    if (Math.abs(env.journeyEpochMs - prevClientEpoch) < tol) env.journeyEpochMs = prevClientEpoch;
  }
  const nextLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''}`;
  if (prevTreeCount !== env.treeFrameDensity) {
    window._ncvUpdateTreeCount && _ncvUpdateTreeCount();
  }
  if (prevDepth !== env.branchDepth) {
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  }
  if (prevForceTreeType !== String(env.forceTreeType || '')) {
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  }
  if (prevTreeless !== !!env.forceTreeless) {
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  }
  if (
    prevConst !== !!env.showConstellations ||
    prevConstLabels !== !!env.showConstellationLabels ||
    prevPlantLabels !== !!env.showPlantLabels ||
    prevSkyOffset !== (Number(env.skyAzimuthOffsetDeg) || 0)
  ) {
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
  }
  if (prevLoc !== nextLoc) {
    if (window._ncvDidFirstSync) {
      journeyMap.onLocationChange(prevLat, prevLon);
    }
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  } else if (prevDate !== env.liveDateISO) {
    // Date moved (live tick or journey): stars must re-project. The canopy
    // reads the date every frame for its season, so no rebuild.
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
  }
  window._ncvDidFirstSync = true;
  window._ncvSyncPanel && _ncvSyncPanel();
  window.dispatchEvent(new CustomEvent('ncv:state', { detail: env.snapshot() }));
});
socket.on('remote:command', (payload = {}) => {
  switch (payload.command) {
    case 'toggle_sleep':
      env.sleeping = !!(payload.data && payload.data.value);
      if (env.sleeping) {
        atmosphere && atmosphere.audio && atmosphere.audio.master && (atmosphere.audio.master.gain.value = 0);
      }
      break;
    case 'trigger_storm':
      env.currentWeather = 'storm';
      break;
    case 'clear_weather':
      env.currentWeather = 'clear';
      break;
    case 'day_mode':
      env.timeOfDay = 12;
      break;
    case 'night_mode':
      env.timeOfDay = 23;
      break;
    case 'reseed_trees':
      window._ncvRebuildCanopy && _ncvRebuildCanopy();
      break;
    case 'preset_wooded':
    case 'preset_clearing':
    case 'randomize_scene':
      window._ncvUpdateTreeCount && _ncvUpdateTreeCount();
      window._ncvRebuildCanopy && _ncvRebuildCanopy();
      break;
    case 'toggle_constellations':
      env.showConstellations = !!(payload.data && payload.data.value);
      window._ncvShowConstellations = !!env.showConstellations;
      window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
      break;
    case 'toggle_sky_labels':
      env.showConstellations = !!(payload.data && payload.data.value);
      env.showConstellationLabels = !!(payload.data && payload.data.value);
      env.showPlantLabels = !!(payload.data && payload.data.value);
      window._ncvShowConstellations = !!env.showConstellations;
      window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
      break;
    case 'toggle_labels':
      env.showConstellationLabels = !!(payload.data && payload.data.value);
      env.showPlantLabels = !!(payload.data && payload.data.value);
      window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
      break;
    case 'toggle_compass':
      env.showCompassDirections = !!(payload.data && payload.data.value);
      break;
    case 'set_compass_offset': {
      const n = Number(payload.data && payload.data.value);
      if (Number.isFinite(n)) {
        env.skyAzimuthOffsetDeg = ((n + 180) % 360 + 360) % 360 - 180;
        window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
      }
      break;
    }
    case 'set_env_values': {
      const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
      const prevTreeCount = env.treeFrameDensity;
      const prevDepth = env.branchDepth;
      const prevLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''},${env.liveDateISO ?? ''}`;
      env.apply(data);
      if (prevTreeCount !== env.treeFrameDensity) {
        window._ncvUpdateTreeCount && _ncvUpdateTreeCount();
      }
      if (prevDepth !== env.branchDepth) {
        window._ncvRebuildCanopy && _ncvRebuildCanopy();
      }
      const nextLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''},${env.liveDateISO ?? ''}`;
      if (prevLoc !== nextLoc) {
        window._ncvBeginLocationTransition && _ncvBeginLocationTransition();
      }
      window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
      break;
    }
    case 'lightning_flash':
      if (atmosphere && typeof atmosphere.forceLightningFlash === 'function') {
        atmosphere.forceLightningFlash();
      }
      break;
    case 'set_location':
      window._ncvBeginLocationTransition && _ncvBeginLocationTransition();
      // Phone picked a location; dismiss QR overlay to return focus to the scene.
      if (qrVisible) setQROverlayVisibility(false);
      break;
    default:
      return;
  }
  window._ncvSyncPanel && _ncvSyncPanel();
});


// ----------------------------------------------------------
// EnvironmentManager
// ----------------------------------------------------------
const EnvironmentManager = {
  timeOfDay:      (new Date().getHours() + new Date().getMinutes() / 60),
  windSpeed:      0.22,
  currentWeather: 'clear',
  starBrightness: 1.1,  // 0–2: global night-star intensity
  milkyWayIntensity: 1.0, // 0–2: dedicated Milky Way intensity
  milkyWayBlur: 1.0, // 0–2: dedicated Milky Way blur multiplier
  constellationBrightness: 1.0, // 0–2: constellation line/label intensity
  showConstellations: false,
  showConstellationLabels: false,
  showPlantLabels: false,
  showCompassDirections: false,
  skyAzimuthOffsetDeg: parseStartupCompassOffsetDeg(),
  forceTreeType: '',
  forceTreeless: false,
  cloudCover: 0.28, // 0–1
  skyBlur: 1.0, // 0–6 px blur for moon halo/cloud softness
  leafSoftness: 0.45, // 0–4 soft edge for leaves
  simulationMode: 'live',
  liveLocationName: 'New Haven, CT',
  liveLocationLat: 41.3083,
  liveLocationLon: -72.9279,
  liveDateISO: new Date().toISOString(),
  performanceMode: 'auto',
  season: 'auto', // auto | spring | summer | fall | winter
  soundMaster: 0.5, // 0–1
  soundCrickets: 0.35,
  soundThunder: 0.9,
  soundBirds: 0.35,
  soundRain: 0.55,
  soundWind: 0.45,
  soundNightBirds: 0.25,
  liveTemperatureC: 16,
  liveWindKph: 10,
  liveSeasonLabel: '',

  // Room / presentation (see CLAUDE.md)
  brightness: 1.0,
  overlayRotationDeg: 0,
  overlayDual: false,
  showClock: false,
  showMap: 'auto',
  sceneAudio: '',

  // Journey mode (server-owned clock; extrapolated locally in draw())
  journeyActive: false,
  journeyRate: 0,
  journeyEpochMs: Date.now(),
  journeySyncAtMs: 0,
  journeyLabel: '',
  journeyWeatherSource: 'model',

  // Tree configuration — changes take effect after canopy.rebuild()
  treeSkyOpen: 1.10,      // 1.0–1.5: open sky in center
  treeFrameDensity: 10,   // integer tree count (4–16)
  treeFoliageMass: 0.85,  // 0–1: amount of foliage per branch network
  treeBranchReach: 0.40,  // 0–1: how far branches reach inward
  treeBranchChaos: 0.62,  // 0–1: straight vs irregular branching
  canopyCoverage: 0.45,  // 0–1: reach from edges toward center
  canopyTreeCount: 0.38, // 0–1: sparse tree count → dense forest count
  canopyDensity:  0.35,   // 0–1: 0=bare branches, 1=overwhelming leaves
  canopyPerspective: 0.72, // 0–1: flat silhouette → strong look-up depth cue
  canopyEdgeLushness: 1.0, // 0–1.5: neutral foliage → lush green edge frame
  branchSpread:   0.62,   // 0–1: 0=tight/columnar, 1=wide/spreading
  branchDepth:    5,     // 3–5: recursion levels

  WEATHER_STATES: ['clear', 'rain', 'storm'],

  apply(state) {
    for (const k of Object.keys(state)) {
      if (this[k] !== undefined) this[k] = state[k];
    }
  },

  randomise() {
    this.timeOfDay      = random(0, 24);
    this.windSpeed      = random(0, 1);
    this.currentWeather = random(this.WEATHER_STATES);
    console.log('[env] Randomised →', this.snapshot());
  },

  snapshot() {
    return {
      timeOfDay:      this.timeOfDay,
      windSpeed:      this.windSpeed,
      currentWeather: this.currentWeather,
      starBrightness: this.starBrightness,
      milkyWayIntensity: this.milkyWayIntensity,
      milkyWayBlur: this.milkyWayBlur,
      constellationBrightness: this.constellationBrightness,
      showConstellations: this.showConstellations,
      showConstellationLabels: this.showConstellationLabels,
      showPlantLabels: this.showPlantLabels,
      showCompassDirections: this.showCompassDirections,
      skyAzimuthOffsetDeg: this.skyAzimuthOffsetDeg,
      forceTreeType: this.forceTreeType,
      forceTreeless: this.forceTreeless,
      cloudCover: this.cloudCover,
      skyBlur: this.skyBlur,
      leafSoftness: this.leafSoftness,
      simulationMode: this.simulationMode,
      liveLocationName: this.liveLocationName,
      liveLocationLat: this.liveLocationLat,
      liveLocationLon: this.liveLocationLon,
      liveDateISO: this.liveDateISO,
      performanceMode: this.performanceMode,
      season: this.season,
      soundMaster: this.soundMaster,
      soundCrickets: this.soundCrickets,
      soundThunder: this.soundThunder,
      soundBirds: this.soundBirds,
      soundRain: this.soundRain,
      soundWind: this.soundWind,
      soundNightBirds: this.soundNightBirds,
      treeSkyOpen: this.treeSkyOpen,
      treeFrameDensity: this.treeFrameDensity,
      treeFoliageMass: this.treeFoliageMass,
      treeBranchReach: this.treeBranchReach,
      treeBranchChaos: this.treeBranchChaos,
      canopyCoverage: this.canopyCoverage,
      canopyTreeCount: this.canopyTreeCount,
      canopyDensity:  this.canopyDensity,
      canopyPerspective: this.canopyPerspective,
      canopyEdgeLushness: this.canopyEdgeLushness,
      branchSpread:   this.branchSpread,
      branchDepth:    this.branchDepth,
    };
  },
};

const env = EnvironmentManager;
if (Object.keys(startupEnvOverrides).length > 0) {
  env.apply(startupEnvOverrides);
}


let showDebug = false;
let projectionEdgeMask = null;
const locationTransition = {
  active: false,
  image: null,
  startMs: 0,
  fadeInMs: 280,
  holdMs: 220,
  fadeOutMs: 640,
};
const perfState = {
  smoothFps: 60,
  qualityScale: 1,
};

// Callbacks for controls.js
window._ncvRandomise    = () => { env.randomise(); window._ncvSyncPanel && _ncvSyncPanel(); };
window._ncvDebugVisible = true;
window._ncvToggleDebug  = () => { showDebug = !showDebug; window._ncvDebugVisible = showDebug; };
// Called by controls.js when branch config changes require a canopy rebuild
window._ncvRebuildCanopy = () => { canopy && canopy.rebuild(); };
// Incremental tree count — adds/removes without full rebuild
window._ncvUpdateTreeCount = () => { canopy && canopy.updateTreeCount(env.treeFrameDensity); };
// Trigger an immediate murmuration flock at a random distance
window._ncvTriggerFlock = () => { murmuration && murmuration.triggerFlock(); };
window._ncvInvalidateSkyCache = () => { starField && starField.invalidateCache(); };
window._ncvEnableAudio = () => { atmosphere && atmosphere.enableAudio(); };
window._ncvBeginLocationTransition = () => {
  if (!canopy || typeof get !== 'function') return;
  // Capture the currently visible frame before applying new scene state.
  // Replacing the one retained image also handles rapid successive selections.
  locationTransition.image = get();
  locationTransition.active = true;
  locationTransition.startMs = millis();
};


// ----------------------------------------------------------
// p5 setup
// ----------------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(RGB, 255, 255, 255, 255);
  textFont('monospace');
  pixelDensity(1);
  // Ambient scene; 30 fps is indistinguishable from 60 to viewers and frees
  // ~half the CPU/GPU budget on Pi-class hardware. Subsystems use _ncvAnimDt
  // (set in draw()) to keep motion speed wall-clock-consistent at any frame
  // rate, so this cap doesn't slow animations down.
  frameRate(30);

  starField    = new StarField();
  murmuration  = new MurmurationSystem();
  gooseMigration = new GooseMigrationSystem();
  atmosphere   = new AtmosphereSystem();
  window.atmosphere = atmosphere;

  // Enable audio on first user interaction (browser autoplay policy requires a gesture).
  const _enableAudioOnce = () => { atmosphere && atmosphere.enableAudio(); };
  document.addEventListener('click',   _enableAudioOnce, { once: true });
  document.addEventListener('keydown', _enableAudioOnce, { once: true });
  canopy    = new Canopy();
  flock     = new CreatureFlock();
  rebuildProjectionEdgeMask();
}


// ----------------------------------------------------------
// p5 draw — update order matters:
//   canopy first (builds perchNodes) → flock (reads perchNodes)
//   → then all rendering in visual layer order
// ----------------------------------------------------------
function draw() {
  // Frame-rate-independent animation time.
  //   _ncvAnimDt — this frame's elapsed time in "60-fps-frames" units
  //                (~1 at 60fps, ~2 at 30fps). Subsystems multiply every
  //                per-frame delta (position +=, timer --, phase accumulator)
  //                by this so the cap in setup() doesn't change motion speed.
  //   _ncvAnimT  — monotonic pseudo-frame counter. Use as the phase argument
  //                for sin()/noise() in place of p5's `frameCount`.
  const _dtMs = (typeof deltaTime === 'number' && deltaTime > 0) ? deltaTime : (1000 / 60);
  // Clamp dt: long stalls (tab backgrounded, GC pause) shouldn't cause one
  // frame to advance animation by seconds.
  window._ncvAnimDt = Math.min(_dtMs / (1000 / 60), 4);
  window._ncvAnimT  = (window._ncvAnimT || 0) + window._ncvAnimDt;

  // Journey clock: advance locally between server syncs so the sky, clock and
  // season move smoothly at any rate (the server corrects us at 1 Hz).
  if (env.journeyActive) {
    const rate = Number(env.journeyRate) || 0;
    if (rate !== 0 && Number.isFinite(env.journeyEpochMs)) {
      env.journeyEpochMs += rate * _dtMs;
      const lon = Number(env.liveLocationLon) || 0;
      const local = env.journeyEpochMs + lon * 240000;
      const dayMs = ((local % 86400000) + 86400000) % 86400000;
      env.timeOfDay = dayMs / 3600000;
      const d = new Date(local);
      if (Number.isFinite(d.getTime())) env.liveDateISO = d.toISOString();
    }
  }

  const fpsNow = frameRate();
  perfState.smoothFps = lerp(perfState.smoothFps, Number.isFinite(fpsNow) ? fpsNow : 30, 0.08);
  if (env.performanceMode === 'auto') {
    // Targets reference the 30-fps cap set in setup(): drop when we miss the
    // cap by more than ~3 fps, recover once we sit comfortably near it.
    if (perfState.smoothFps < 26) perfState.qualityScale = max(0.52, perfState.qualityScale - 0.05);
    else if (perfState.smoothFps > 29) perfState.qualityScale = min(1.0, perfState.qualityScale + 0.02);
  } else {
    perfState.qualityScale = 1;
  }
  window._ncvQualityScale = perfState.qualityScale;
  window._ncvIsStruggling = perfState.qualityScale < 0.82 || perfState.smoothFps < 25;

  background(skyColor());
  starField.updateCache();
  if (starField.isNight()) {
    image(starField.getNightBuffer(), 0, 0, width, height);
  }
  atmosphere.update();
  atmosphere.drawSky();

  // --- Update phase ---
  murmuration.update();  // distant background flocks
  gooseMigration.update();
  canopy.update();       // must precede flock.update() — provides perchNodes
  flock.update();
  window._ncvBirdOccluders = flock.getOccluders();

  // --- Render phase (back → front) ---
  murmuration.draw();    // distant flocks in open sky, behind everything
  gooseMigration.draw(); // seasonal migration V-formations
  flock.drawBackLayer(); // perching birds partially behind foliage
  canopy.draw();         // branches + leaves
  flock.drawFrontLayer();// birds/bats in front
  atmosphere.drawOverlay();
  drawCompassDirectionsOverlay();
  drawProjectionEdgeFade();
  drawLocationTransitionOverlay();
  drawJourneyHud();
  drawSleepOverlay();
  drawBrightnessDimmer();

  // Check if QR code should be generated for the overlay
  handleQROverlay();

  if (showDebug) drawDebugHUD();
}

let qrGenerated = false;
let qrVisible = false;
let qrTimeoutId = null;
let qrFallbackShown = false;
const qrUrlParams = new URLSearchParams(window.location.search);
const qrShowOnStart = ['1', 'true', 'yes', 'on'].includes(
  String(qrUrlParams.get('qr') || '').toLowerCase()
);
const qrPersistent = ['1', 'true', 'yes', 'on'].includes(
  String(qrUrlParams.get('qrPersist') || '').toLowerCase()
);
const qrTimeoutMs = Math.max(
  0,
  Number.parseInt(qrUrlParams.get('qrTimeoutMs') || '30000', 10) || 30000
);

function buildRemoteUrlForQR() {
  const remoteUrl = new URL('remote.html', window.location.href);
  const inStandalone = !!window.__ncvStandaloneMode;
  const supabaseEnabled = !!window.__ncvSupabaseHostEnabled;
  const fixedRoomId = String(window.__ncvFixedRoomId || '').trim();
  let roomId = null;

  if (inStandalone) {
    if (fixedRoomId) {
      roomId = fixedRoomId;
    }
    // Prefer Supabase room only when host-side Supabase relay is active.
    else if (supabaseEnabled && window.__supabaseRoomId) {
      roomId = window.__supabaseRoomId;
    } else if (window.__webrtcHostId) {
      roomId = window.__webrtcHostId;
    }
    // In standalone mode, a room is required for cross-device phone control.
    if (!roomId) return null;
  }

  if (roomId) remoteUrl.searchParams.set('room', roomId);
  return remoteUrl;
}

function setQROverlayVisibility(visible) {
  const overlay = document.getElementById('qr-overlay');
  if (!overlay) return;

  if (visible) {
    overlay.classList.add('visible');
    qrVisible = true;

    if (qrTimeoutId) clearTimeout(qrTimeoutId);
    if (!qrPersistent && qrTimeoutMs > 0) {
      qrTimeoutId = setTimeout(() => {
        setQROverlayVisibility(false);
      }, qrTimeoutMs);
    }
  } else {
    overlay.classList.remove('visible');
    qrVisible = false;
  }
}

function showQRFallbackOverlay() {
  // Allow regeneration if a room ID is now available but wasn't when first shown.
  const _newRoomId = window.__supabaseRoomId || window.__webrtcHostId;
  if (qrFallbackShown && !_newRoomId) return;
  if (qrFallbackShown) {
    // Check if the current QR already has a room param; if so, nothing to do.
    const _existing = document.querySelector('#qr-overlay a, #qr-overlay img');
    if (_existing) {
      const _src = (_existing.href || _existing.src || '');
      if (_src.includes('room=')) { setQROverlayVisibility(true); return; }
    }
  }
  const remoteUrl = buildRemoteUrlForQR();
  if (!remoteUrl) return;
  qrFallbackShown = true;
  qrGenerated = true; // allow 'q' key to toggle the overlay
  const urlStr = remoteUrl.toString();

  const qrContainer = document.getElementById('qr-container');
  if (qrContainer) {
    // Use an image-based QR API — not a script, so unaffected by script-src CSP.
    const apiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=256x256&ecc=M&data='
      + encodeURIComponent(urlStr);
    qrContainer.innerHTML =
      '<img src="' + apiUrl + '" width="256" height="256" alt="QR Code"'
      + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'"'
      + ' style="display:block;border-radius:4px" />'
      + '<div style="display:none;max-width:480px;color:#111;text-align:center;'
      + 'font:600 14px/1.5 monospace;word-break:break-all"><a href="' + urlStr
      + '" target="_blank" rel="noopener noreferrer" style="color:#0b57d0">'
      + urlStr + '</a></div>';
  }

  setQROverlayVisibility(true);

  const sub = document.querySelector('.qr-subtext');
  if (sub) {
    sub.textContent = "Press 'L' to open remote on this device, or click anywhere to dismiss.";
  }
}

function handleQROverlay() {
  // Setup once when QRCode is available.
  // In server mode we use /remote.html; in standalone we append ?room=<peer-id>.
  if (qrGenerated) return;

  // Fall back to image-based QR if the JS library didn't load (e.g. CDN / CSP blocked).
  if (typeof QRCode === 'undefined') {
    if (qrShowOnStart) showQRFallbackOverlay();
    return;
  }

  const remoteUrl = buildRemoteUrlForQR();
  if (!remoteUrl) return;
  qrGenerated = true;

  const canvasElement = document.getElementById('qr-canvas');

  try {
    QRCode.toCanvas(canvasElement, remoteUrl.toString(), {
      width: 256,
      color: { dark: '#000000', light: '#ffffff' }
    }, function (error) {
      if (error) {
        console.warn('[qr] toCanvas failed, using image fallback:', error);
        qrGenerated = false;
        qrFallbackShown = false;
        showQRFallbackOverlay();
      }
    });
  } catch (e) {
    console.warn('[qr] QRCode threw, using image fallback:', e);
    qrGenerated = false;
    qrFallbackShown = false;
    showQRFallbackOverlay();
  }

  // Optional startup QR mode for keyboard-less kiosks, e.g. ?qr=1
  if (qrShowOnStart) setQROverlayVisibility(true);

  // Allow clicking anywhere on the overlay to dismiss it
  const overlay = document.getElementById('qr-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => setQROverlayVisibility(false));
  }
}


function drawSleepOverlay() {
  if (!env.sleeping) return;
  push();
  noStroke();
  fill(0, 0, 0, 255);
  rect(0, 0, width, height);
  pop();
}

function drawCompassDirectionsOverlay() {
  if (!env.showCompassDirections) return;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const scale = min(width, height) * 0.5;
  const tickOuter = scale * 0.985;
  const tickInner = scale * 0.935;
  const textR = scale * 0.895;
  const textSizePx = constrain(min(width, height) * 0.034, 20, 42);
  const dirs = [
    ['N', 0],
    ['E', HALF_PI],
    ['S', PI],
    ['W', -HALF_PI],
  ];
  const offsetRad = radians(Number(env.skyAzimuthOffsetDeg) || 0);

  push();
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(textSizePx);
  stroke(210, 235, 255, 190);
  strokeWeight(max(2, width * 0.0022));
  fill(225, 245, 255, 235);
  for (const [label, baseAz] of dirs) {
    const az = baseAz + offsetRad;
    const sinA = sin(az);
    const cosA = cos(az);
    const x1 = cx + sinA * tickInner;
    const y1 = cy - cosA * tickInner;
    const x2 = cx + sinA * tickOuter;
    const y2 = cy - cosA * tickOuter;
    line(x1, y1, x2, y2);
    const tx = cx + sinA * textR;
    const ty = cy - cosA * textR;
    noStroke();
    fill(8, 18, 30, 190);
    text(label, tx + 2, ty + 2);
    fill(225, 245, 255, 235);
    text(label, tx, ty);
    stroke(210, 235, 255, 190);
  }
  pop();
}


// ----------------------------------------------------------
// Resize
// ----------------------------------------------------------
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  starField   && starField.resize();
  atmosphere  && atmosphere.resize();
  canopy      && canopy.resize();
  rebuildProjectionEdgeMask();
}

function drawProjectionEdgeFade() {
  if (projectionEdgeMask) image(projectionEdgeMask, 0, 0, width, height);
}

function drawLocationTransitionOverlay() {
  if (!locationTransition.active) return;
  const t = millis() - locationTransition.startMs;
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 2200;
  if (t >= duration || !locationTransition.image) {
    locationTransition.active = false;
    locationTransition.image = null;
    return;
  }
  const progress = constrain(t / duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  push();
  tint(255, 255 * (1 - eased));
  image(locationTransition.image, 0, 0, width, height);
  pop();
}

function rebuildProjectionEdgeMask() {
  projectionEdgeMask = createGraphics(width, height);
  projectionEdgeMask.pixelDensity(1);
  projectionEdgeMask.loadPixels();

  const w = projectionEdgeMask.width;
  const h = projectionEdgeMask.height;
  const shortSide = min(w, h);
  const baseBand = shortSide * 0.045;     // tight fade along straight edges
  const cornerBonus = shortSide * 0.09;   // extra depth near corners
  const cornerReach = shortSide * 0.30;
  const jitterAmp = shortSide * 0.012;
  const noiseScale = 0.012;
  const seed = random(10000);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edgeDist = min(x, w - 1 - x, y, h - 1 - y);
      const nearestCorner = min(
        dist(x, y, 0, 0),
        dist(x, y, w - 1, 0),
        dist(x, y, 0, h - 1),
        dist(x, y, w - 1, h - 1)
      );
      const cornerFactor = 1 - constrain(nearestCorner / cornerReach, 0, 1);
      const jitter = map(
        noise(seed + x * noiseScale, seed + y * noiseScale),
        0,
        1,
        -jitterAmp,
        jitterAmp
      );
      const band = max(1, baseBand + cornerFactor * cornerBonus + jitter);
      const t = constrain(edgeDist / band, 0, 1);
      const softness = t * t * (3 - 2 * t); // smoothstep
      const alpha = Math.round(255 * (1 - softness));

      const idx = 4 * (x + y * w);
      projectionEdgeMask.pixels[idx + 0] = 0;
      projectionEdgeMask.pixels[idx + 1] = 0;
      projectionEdgeMask.pixels[idx + 2] = 0;
      projectionEdgeMask.pixels[idx + 3] = alpha;
    }
  }

  projectionEdgeMask.updatePixels();
}


// ----------------------------------------------------------
// Keyboard shortcuts
// ----------------------------------------------------------
// Keys double as the "scrubber in the room": any USB knob that emits arrow
// keys (a Pico/Arduino HID sketch, a PowerMate, a volume-knob HID) works.
const JOURNEY_RATE_STEPS = [-86400, -3600, -60, -1, 0, 1, 60, 3600, 86400];
function sendRemote(command, data = {}) {
  if (socket && socket.emit) socket.emit('remote:command', { command, data });
}
function journeyStepRate(dir) {
  const cur = env.journeyActive ? (Number(env.journeyRate) || 0) : 0;
  let idx = 0, best = Infinity;
  JOURNEY_RATE_STEPS.forEach((r, i) => { const d = Math.abs(r - cur); if (d < best) { best = d; idx = i; } });
  idx = constrain(idx + dir, 0, JOURNEY_RATE_STEPS.length - 1);
  sendRemote('journey_set_rate', { rate: JOURNEY_RATE_STEPS[idx] });
}
function keyPressed() {
  const shift = keyIsDown(SHIFT);
  if (keyCode === LEFT_ARROW)  { sendRemote('journey_scrub', { sec: shift ? -3600 : -600 }); return false; }
  if (keyCode === RIGHT_ARROW) { sendRemote('journey_scrub', { sec: shift ?  3600 :  600 }); return false; }
  if (keyCode === UP_ARROW)    { journeyStepRate(+1); return false; }
  if (keyCode === DOWN_ARROW)  { journeyStepRate(-1); return false; }
  if      (key === ' ')              { sendRemote('journey_toggle'); return false; }
  else if (key === 'r' || key === 'R') { env.randomise(); window._ncvSyncPanel && _ncvSyncPanel(); }
  else if (key === 'n' || key === 'N') { sendRemote('journey_now'); }
  else if (key === 't' || key === 'T') { sendRemote('set_env_values', { showClock: !env.showClock }); }
  else if (key === 'm' || key === 'M') {
    const order = ['off', 'auto', 'always'];
    const next = order[(order.indexOf(String(env.showMap || 'auto')) + 1) % order.length];
    sendRemote('set_env_values', { showMap: next });
    if (next === 'auto') journeyMap.show();
  }
  else if (key === '+' || key === '=') { sendRemote('set_env_values', { brightness: Math.min(1, (Number(env.brightness) || 1) + 0.05) }); }
  else if (key === '-' || key === '_') { sendRemote('set_env_values', { brightness: Math.max(0.05, (Number(env.brightness) || 1) - 0.05) }); }
  else if (key === 'c' || key === 'C') { window._ncvTogglePanel  && _ncvTogglePanel(); }
  else if (key === 'd' || key === 'D') { window._ncvToggleDebug  && _ncvToggleDebug(); }
  else if (key === 'l' || key === 'L') { window.open('remote.html', '_blank'); }
  else if (key === 'q' || key === 'Q') {
    if (qrGenerated && qrVisible) {
      setQROverlayVisibility(false);
    } else {
      // Always regenerate/show — picks up room ID if it arrived after first render
      qrFallbackShown = false;
      qrGenerated = false;
      showQRFallbackOverlay();
    }
  }
}

// ----------------------------------------------------------
// Journey HUD — clock card + globe, drawn for a viewer lying on the floor.
//
// There is no natural "up" on a ceiling, so overlays are drawn in a frame
// rotated by env.overlayRotationDeg (set it to whichever wall people's feet
// point at) and, with env.overlayDual, a second copy 180° around so two rows
// of people can both read it. Everything is placed on the inscribed circle so
// it stays on-screen at any rotation and aspect ratio.
// ----------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function journeyDisplayDate() {
  // Local solar time of the scene. liveDateISO already carries the longitude
  // offset, so read it as UTC fields.
  const d = new Date(env.liveDateISO || Date.now());
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const tod = Number(env.timeOfDay) || 0;
  const hh = Math.floor(tod), mm = Math.floor((tod - hh) * 60);
  const yearLabel = y > 0 ? String(y) : `${1 - y} BC`;
  const weekday = y >= 1583 ? WEEKDAYS[d.getUTCDay()] + ' ' : '';
  return {
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    date: `${weekday}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${yearLabel}`,
    year: y,
  };
}

function journeyRateLabel() {
  if (!env.journeyActive) return '';
  const r = Number(env.journeyRate) || 0;
  if (r === 0) return 'paused';
  const a = Math.abs(r);
  let unit;
  if (a < 30) unit = a === 1 ? 'real time' : `${a}x`;
  else if (a < 1800) unit = `${Math.round(a / 60)} min / s`;
  else if (a < 43200) unit = `${(a / 3600).toFixed(a % 3600 ? 1 : 0)} hr / s`;
  else unit = `${(a / 86400).toFixed(a % 86400 ? 1 : 0)} day / s`;
  return (r < 0 ? '<<  ' : '>>  ') + unit;
}

function withOverlayOrientation(fn) {
  const rot = radians(Number(env.overlayRotationDeg) || 0);
  const rots = env.overlayDual ? [rot, rot + PI] : [rot];
  const R = min(width, height) * 0.5;
  for (const r of rots) {
    push();
    translate(width * 0.5, height * 0.5);
    rotate(r);
    fn(R);
    pop();
  }
}

function drawJourneyHud() {
  const mapAlpha = journeyMap.alpha();
  const showClock = !!env.showClock;
  if (!showClock && mapAlpha <= 0.01) return;
  const info = showClock ? journeyDisplayDate() : null;
  withOverlayOrientation((R) => {
    if (info) drawClockCard(R, info);
    if (mapAlpha > 0.01) journeyMap.draw(R, mapAlpha, !!info);
  });
}

function drawClockCard(R, info) {
  const u = R / 540; // 1 at 1080p-ish
  const cardW = R * 0.86, cardH = R * 0.30;
  const cx = 0, cy = R * 0.80;
  const dim = constrain(Number(env.brightness) || 1, 0.05, 1);
  const sub = env.journeyLabel || env.liveLocationName || '';
  const rate = journeyRateLabel();
  const src = env.journeyWeatherSource;
  const real = env.journeyActive && (src === 'archive' || src === 'forecast') ? '  ·  real weather' : '';

  push();
  rectMode(CENTER);
  noStroke();
  fill(4, 10, 16, 150);
  rect(cx, cy, cardW, cardH, 18 * u);
  textAlign(CENTER, CENTER);
  textFont('monospace');
  // Text gets brighter as the room dims so it stays legible after the dimmer.
  const ink = 235 / Math.max(0.35, Math.pow(dim, 0.5));
  fill(Math.min(255, ink), Math.min(255, ink * 1.02), 255, 235);
  textStyle(BOLD);
  textSize(R * 0.115);
  text(info.time, cx, cy - cardH * 0.24);
  textStyle(NORMAL);
  textSize(R * 0.040);
  text(info.date, cx, cy + cardH * 0.08);
  fill(180, 205, 225, 220);
  textSize(R * 0.032);
  const line3 = sub.length > 46 ? sub.slice(0, 44) + '…' : sub;
  text(line3, cx, cy + cardH * 0.28);
  if (rate) {
    fill(130, 215, 170, 220);
    textSize(R * 0.028);
    text(rate + real, cx, cy + cardH * 0.43);
  }
  pop();
}

// ---- globe ----
const journeyMap = {
  from: null,          // {lat, lon} previous location during a transition
  startMs: 0,
  tweenMs: 3200,
  shownAt: -1e9,
  autoHoldMs: 15000,
  gfx: null,
  gfxKey: '',
  onLocationChange(prevLat, prevLon) {
    if (Number.isFinite(prevLat) && Number.isFinite(prevLon)) this.from = { lat: prevLat, lon: prevLon };
    else this.from = null;
    this.startMs = millis();
    this.show();
  },
  show() { this.shownAt = millis(); },
  alpha() {
    const mode = String(env.showMap || 'auto');
    if (mode === 'off') return 0;
    if (mode === 'always') return 1;
    const t = millis() - this.shownAt;
    if (t < 0 || t > this.autoHoldMs) return 0;
    if (t < 600) return t / 600;
    if (t > this.autoHoldMs - 1500) return (this.autoHoldMs - t) / 1500;
    return 1;
  },
  // Great-circle interpolation of the view centre.
  center() {
    const lat1 = Number(env.liveLocationLat) || 0, lon1 = Number(env.liveLocationLon) || 0;
    if (!this.from) return { lat: lat1, lon: lon1, k: 1 };
    const k = constrain((millis() - this.startMs) / this.tweenMs, 0, 1);
    const e = k * k * (3 - 2 * k);
    if (e >= 1) { this.from = null; return { lat: lat1, lon: lon1, k: 1 }; }
    const p = slerpLatLon(this.from.lat, this.from.lon, lat1, lon1, e);
    return { lat: p.lat, lon: p.lon, k: e };
  },
  draw(R, alpha, besideCard) {
    const r = R * 0.17;
    const cx = besideCard ? -R * 0.66 : 0;
    const cy = besideCard ? R * 0.80 : R * 0.80;
    const c = this.center();
    const key = `${c.lat.toFixed(2)}|${c.lon.toFixed(2)}|${Math.round(r)}`;
    if (!this.gfx || this.gfx.width !== Math.ceil(r * 2 + 8)) {
      if (this.gfx) this.gfx.remove();
      this.gfx = createGraphics(Math.ceil(r * 2 + 8), Math.ceil(r * 2 + 8));
      this.gfx.pixelDensity(1);
      this.gfxKey = '';
    }
    if (key !== this.gfxKey) {
      this.gfxKey = key;
      renderGlobe(this.gfx, r, c.lat, c.lon);
    }
    push();
    imageMode(CENTER);
    tint(255, 255 * alpha);
    image(this.gfx, cx, cy);
    noTint();
    // Markers + travel arc on top (cheap; drawn every frame).
    translate(cx, cy);
    const lat1 = Number(env.liveLocationLat) || 0, lon1 = Number(env.liveLocationLon) || 0;
    const here = orthoProject(lat1, lon1, c.lat, c.lon);
    if (this.from && c.k < 1) {
      stroke(255, 225, 140, 200 * alpha);
      strokeWeight(max(1, r * 0.018));
      noFill();
      beginShape();
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const q = slerpLatLon(this.from.lat, this.from.lon, lat1, lon1, (i / N) * c.k);
        const pp = orthoProject(q.lat, q.lon, c.lat, c.lon);
        if (pp.z > -0.02) vertex(pp.x * r, pp.y * r);
      }
      endShape();
      const fromP = orthoProject(this.from.lat, this.from.lon, c.lat, c.lon);
      if (fromP.z > 0) {
        noStroke();
        fill(255, 225, 140, 160 * alpha);
        circle(fromP.x * r, fromP.y * r, r * 0.06);
      }
    }
    if (here.z > 0) {
      const pulse = 1 + 0.25 * sin(window._ncvAnimT * 0.06);
      noFill();
      stroke(255, 120, 90, 170 * alpha);
      strokeWeight(max(1, r * 0.02));
      circle(here.x * r, here.y * r, r * 0.16 * pulse);
      noStroke();
      fill(255, 120, 90, 255 * alpha);
      circle(here.x * r, here.y * r, r * 0.07);
    }
    pop();
  },
};

function slerpLatLon(lat1, lon1, lat2, lon2, t) {
  const a1 = radians(lat1), b1 = radians(lon1), a2 = radians(lat2), b2 = radians(lon2);
  const p = [cos(a1) * cos(b1), cos(a1) * sin(b1), sin(a1)];
  const q = [cos(a2) * cos(b2), cos(a2) * sin(b2), sin(a2)];
  let d = constrain(p[0] * q[0] + p[1] * q[1] + p[2] * q[2], -1, 1);
  const om = acos(d);
  let v;
  if (om < 1e-6) v = q;
  else {
    const s = sin(om);
    const w1 = sin((1 - t) * om) / s, w2 = sin(t * om) / s;
    v = [p[0] * w1 + q[0] * w2, p[1] * w1 + q[1] * w2, p[2] * w1 + q[2] * w2];
  }
  return { lat: degrees(asin(constrain(v[2], -1, 1))), lon: degrees(atan2(v[1], v[0])) };
}

// Orthographic projection centred on (lat0, lon0). Returns unit-disc x,y (y down)
// and z (>0 = facing us).
function orthoProject(lat, lon, lat0, lon0) {
  const la = radians(lat), lo = radians(lon - lon0), la0 = radians(lat0);
  const x = cos(la) * sin(lo);
  const y = cos(la0) * sin(la) - sin(la0) * cos(la) * cos(lo);
  const z = sin(la0) * sin(la) + cos(la0) * cos(la) * cos(lo);
  return { x, y: -y, z };
}

function renderGlobe(g, r, lat0, lon0) {
  const w = g.width, h = g.height;
  const cx = w * 0.5, cy = h * 0.5;
  g.clear();
  g.push();
  g.translate(cx, cy);
  // Ocean disc with a soft limb.
  g.noStroke();
  g.fill(12, 34, 58, 235);
  g.circle(0, 0, r * 2);
  // Graticule.
  g.noFill();
  g.stroke(120, 160, 200, 45);
  g.strokeWeight(1);
  for (let la = -60; la <= 60; la += 30) drawGeoLine(g, r, lat0, lon0, (t) => ({ lat: la, lon: -180 + 360 * t }), 72);
  for (let lo = -180; lo < 180; lo += 30) drawGeoLine(g, r, lat0, lon0, (t) => ({ lat: -90 + 180 * t, lon: lo }), 36);
  // Land: fill + outline. Back-facing points are pushed to the limb so partly
  // hidden polygons still close sensibly.
  const rings = window.NCV_WORLD_LAND || [];
  g.stroke(150, 205, 170, 210);
  g.strokeWeight(max(1, r * 0.012));
  g.fill(44, 96, 70, 235);
  for (const ring of rings) {
    let any = false;
    for (const [lon, lat] of ring) { if (orthoProject(lat, lon, lat0, lon0).z > 0) { any = true; break; } }
    if (!any) continue;
    g.beginShape();
    for (const [lon, lat] of ring) {
      const p = orthoProject(lat, lon, lat0, lon0);
      let x = p.x, y = p.y;
      if (p.z <= 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
      g.vertex(x * r, y * r);
    }
    g.endShape(CLOSE);
  }
  // Limb.
  g.noFill();
  g.stroke(180, 210, 240, 150);
  g.strokeWeight(max(1, r * 0.02));
  g.circle(0, 0, r * 2);
  g.pop();
}

function drawGeoLine(g, r, lat0, lon0, fn, n) {
  let open = false;
  for (let i = 0; i <= n; i++) {
    const q = fn(i / n);
    const p = orthoProject(q.lat, q.lon, lat0, lon0);
    if (p.z > 0.01) {
      if (!open) { g.beginShape(); open = true; }
      g.vertex(p.x * r, p.y * r);
    } else if (open) { g.endShape(); open = false; }
  }
  if (open) g.endShape();
}

function drawBrightnessDimmer() {
  const b = constrain(Number(env.brightness) || 1, 0.05, 1);
  if (b >= 0.995) return;
  push();
  noStroke();
  fill(0, 0, 0, Math.round((1 - b) * 255));
  rect(0, 0, width, height);
  pop();
}


// ----------------------------------------------------------
// skyColor
// ----------------------------------------------------------
// Sky colour is keyed on the sun's altitude, not the clock, so a polar
// summer midnight stays golden and a polar winter noon is a deep blue dusk.
function skyColor() {
  const alt = NCV_SKY.phase().alt;
  const stops = [
    {h: -18, r:  5, g:   8, b:  30},
    {h: -12, r:  6, g:   9, b:  34},
    {h:  -7, r: 22, g:  20, b:  56},
    {h:  -3, r: 60, g:  42, b:  78},
    {h:   0, r:150, g:  80, b:  72},
    {h:   3, r:225, g: 128, b:  68},
    {h:   7, r:190, g: 160, b: 150},
    {h:  12, r:120, g: 170, b: 230},
    {h:  30, r: 95, g: 160, b: 235},
    {h:  90, r: 85, g: 155, b: 235},
  ];

  let baseColor = [5, 8, 30];
  if (alt >= stops[stops.length - 1].h) {
    const s = stops[stops.length - 1];
    baseColor = [s.r, s.g, s.b];
  } else {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (alt >= a.h && alt <= b.h) {
        const p = (alt - a.h) / (b.h - a.h);
        baseColor = [lerp(a.r, b.r, p), lerp(a.g, b.g, p), lerp(a.b, b.b, p)];
        break;
      }
    }
  }

  if (env.currentWeather === 'rain' || env.currentWeather === 'storm') {
    const dk = env.currentWeather === 'storm' ? 0.55 : 0.35;
    baseColor = baseColor.map(c => lerp(c, 20, dk));
  }
  return color(...baseColor);
}


// ----------------------------------------------------------
// Debug HUD
// ----------------------------------------------------------
function drawDebugHUD() {
  const compact = width < 430 || height < 620;
  const PAD = compact ? 10 : 20;
  const LINE = compact ? 16 : 22;
  const rows = [
    ['EnvironmentManager', '',                           true ],
    ['timeOfDay',          _fmtTime(env.timeOfDay)           ],
    ['sun altitude',       `${NCV_SKY.phase().alt.toFixed(1)}° ${NCV_SKY.phase().isNight ? 'night' : (NCV_SKY.phase().isTwilight ? 'twilight' : 'day')}`],
    ['windSpeed',          env.windSpeed.toFixed(3)           ],
    ['currentWeather',     env.currentWeather                 ],
    ['starBrightness',     env.starBrightness.toFixed(2)      ],
    ['milkyWay',           (env.milkyWayIntensity ?? 1).toFixed(2)],
    ['milkyBlur',          (env.milkyWayBlur ?? 1).toFixed(2)],
    ['constellations',     env.constellationBrightness.toFixed(2) ],
    ['cloudCover',         env.cloudCover.toFixed(2)          ],
    ['skyBlur',           env.skyBlur.toFixed(2)             ],
    ['leafSoftness',      env.leafSoftness.toFixed(2)        ],
    ['skyOpen',            env.treeSkyOpen.toFixed(2)         ],
    ['frameDensity',       env.treeFrameDensity.toFixed(2)    ],
    ['foliageMass',        env.treeFoliageMass.toFixed(2)     ],
    ['branchReach',        env.treeBranchReach.toFixed(2)     ],
    ['branchChaos',        env.treeBranchChaos.toFixed(2)     ],
    ['edgeLushness',       env.canopyEdgeLushness.toFixed(2)  ],
    ['branchDepth',        String(env.branchDepth)            ],
    ['fps',                perfState.smoothFps.toFixed(1)     ],
    ['quality',            perfState.qualityScale.toFixed(2)  ],
    ['',                   ''                                 ],
    ['[SPC] rnd  [C] panel  [D] debug', '', false, true       ],
  ];

  fill(0, 0, 0, 145); noStroke();
  const boxW = min(330, width - PAD * 2);
  rect(PAD - 6, PAD - 6, boxW, min(LINE * rows.length + 14, height - PAD), 7);
  textSize(compact ? 9 : 12);

  rows.forEach(([label, val, isHeader, isDim], i) => {
    const y = PAD + i * LINE;
    if (isHeader)    { fill(150, 220, 150); textStyle(BOLD);   }
    else if (isDim)  { fill(120, 120, 120); textStyle(NORMAL); }
    else             { fill(200, 210, 220); textStyle(NORMAL); }
    text(label, PAD, y);
    if (val) { fill(240, 210, 80); text(val, PAD + boxW * 0.53, y); }
  });
  textStyle(NORMAL);
}

function _fmtTime(h) {
  const hh = floor(h) % 24;
  const mm = floor((h % 1) * 60);
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
