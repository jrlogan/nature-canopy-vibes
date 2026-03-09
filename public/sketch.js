// ============================================================
// sketch.js — Nature Canopy Vibes | Main Orchestrator
// ============================================================

// ----------------------------------------------------------
// Socket.io client
// ----------------------------------------------------------
const socket = io();
window._ncvSocket = socket;

socket.on('connect', () => {
  console.log('[socket] Connected →', socket.id);
  window._ncvSetSocketStatus && _ncvSetSocketStatus(true);
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
  const prevLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''},${env.liveDateISO ?? ''}`;
  env.apply(state);
  window._ncvShowConstellations = !!env.showConstellations;
  const nextLoc = `${env.liveLocationLat ?? ''},${env.liveLocationLon ?? ''},${env.liveDateISO ?? ''}`;
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
    prevPlantLabels !== !!env.showPlantLabels
  ) {
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
  }
  if (prevLoc !== nextLoc) {
    if (window._ncvDidFirstSync) window._ncvBeginLocationTransition && _ncvBeginLocationTransition();
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  }
  window._ncvDidFirstSync = true;
  window._ncvSyncPanel && _ncvSyncPanel();
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
    case 'set_location':
      window._ncvBeginLocationTransition && _ncvBeginLocationTransition();
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


// ----------------------------------------------------------
// Globals — subsystems
// ----------------------------------------------------------
let starField, canopy, flock, atmosphere, murmuration, gooseMigration;
let showDebug = false;
let projectionEdgeMask = null;
const locationTransition = {
  active: false,
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
  const fpsNow = frameRate();
  perfState.smoothFps = lerp(perfState.smoothFps, Number.isFinite(fpsNow) ? fpsNow : 60, 0.08);
  if (env.performanceMode === 'auto') {
    if (perfState.smoothFps < 24) perfState.qualityScale = max(0.52, perfState.qualityScale - 0.05);
    else if (perfState.smoothFps > 45) perfState.qualityScale = min(1.0, perfState.qualityScale + 0.02);
  } else {
    perfState.qualityScale = 1;
  }
  window._ncvQualityScale = perfState.qualityScale;
  window._ncvIsStruggling = perfState.qualityScale < 0.82 || perfState.smoothFps < 30;

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
  drawProjectionEdgeFade();
  drawLocationTransitionOverlay();
  drawSleepOverlay();

  // Subtle note for opening the remote
  drawRemoteHint();

  if (showDebug) drawDebugHUD();
}

function drawRemoteHint() {
  push();
  noStroke();
  fill(255, 255, 255, 30);
  textAlign(RIGHT, BOTTOM);
  textSize(10);
  // Ensure the hint uses a generic font and stays fully subtle
  textFont('monospace');
  text("Press 'L' to open location control", width - 10, height - 10);
  pop();
}

function drawSleepOverlay() {
  if (!env.sleeping) return;
  push();
  noStroke();
  fill(0, 0, 0, 255);
  rect(0, 0, width, height);
  pop();
}


// ----------------------------------------------------------
// Resize
// ----------------------------------------------------------
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  starField.resize();
  atmosphere.resize();
  canopy.resize();
  rebuildProjectionEdgeMask();
}

function drawProjectionEdgeFade() {
  if (projectionEdgeMask) image(projectionEdgeMask, 0, 0, width, height);
}

function drawLocationTransitionOverlay() {
  if (!locationTransition.active) return;
  const t = millis() - locationTransition.startMs;
  const inT = locationTransition.fadeInMs;
  const hold = locationTransition.holdMs;
  const outT = locationTransition.fadeOutMs;
  const total = inT + hold + outT;
  let a = 0;
  if (t <= inT) a = map(t, 0, inT, 0, 255);
  else if (t <= inT + hold) a = 255;
  else if (t <= total) a = map(t, inT + hold, total, 255, 0);
  else {
    locationTransition.active = false;
    return;
  }
  push();
  noStroke();
  fill(0, 0, 0, constrain(a, 0, 255));
  rect(0, 0, width, height);
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
function keyPressed() {
  if      (key === ' ')              { env.randomise(); window._ncvSyncPanel && _ncvSyncPanel(); }
  else if (key === 'c' || key === 'C') { window._ncvTogglePanel  && _ncvTogglePanel(); }
  else if (key === 'd' || key === 'D') { window._ncvToggleDebug  && _ncvToggleDebug(); }
  else if (key === 'l' || key === 'L') { window.open('remote.html', '_blank'); }
}


// ----------------------------------------------------------
// skyColor
// ----------------------------------------------------------
function skyColor() {
  const t = env.timeOfDay;
  const stops = [
    {h:  0, r:  5, g:   8, b:  30},
    {h:  4, r:  5, g:   8, b:  30},
    {h:  5, r: 30, g:  25, b:  60},
    {h:  6, r: 90, g:  60, b:  80},
    {h:  7, r:230, g: 130, b:  70},
    {h:  8, r:120, g: 170, b: 230},
    {h: 12, r: 85, g: 155, b: 235},
    {h: 17, r:100, g: 165, b: 230},
    {h: 19, r:220, g: 120, b:  60},
    {h: 20, r:140, g:  70, b:  80},
    {h: 21, r: 30, g:  20, b:  50},
    {h: 24, r:  5, g:   8, b:  30},
  ];

  let baseColor = [5, 8, 30];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.h && t <= b.h) {
      const p = (t - a.h) / (b.h - a.h);
      baseColor = [lerp(a.r, b.r, p), lerp(a.g, b.g, p), lerp(a.b, b.b, p)];
      break;
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
  const PAD = 20, LINE = 22;
  const rows = [
    ['EnvironmentManager', '',                           true ],
    ['timeOfDay',          _fmtTime(env.timeOfDay)           ],
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
  rect(PAD - 8, PAD - 8, 330, LINE * rows.length + 18, 7);
  textSize(12);

  rows.forEach(([label, val, isHeader, isDim], i) => {
    const y = PAD + i * LINE;
    if (isHeader)    { fill(150, 220, 150); textStyle(BOLD);   }
    else if (isDim)  { fill(120, 120, 120); textStyle(NORMAL); }
    else             { fill(200, 210, 220); textStyle(NORMAL); }
    text(label, PAD, y);
    if (val) { fill(240, 210, 80); text(val, PAD + 175, y); }
  });
  textStyle(NORMAL);
}

function _fmtTime(h) {
  const hh = floor(h) % 24;
  const mm = floor((h % 1) * 60);
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
