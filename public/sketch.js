// ============================================================
// sketch.js — Nature Canopy Vibes | Main Orchestrator
// ============================================================

// ----------------------------------------------------------
// Socket.io client
// ----------------------------------------------------------
const socket = io();

socket.on('connect', () => {
  console.log('[socket] Connected →', socket.id);
  window._ncvSetSocketStatus && _ncvSetSocketStatus(true);
});
socket.on('disconnect', () => {
  console.log('[socket] Disconnected');
  window._ncvSetSocketStatus && _ncvSetSocketStatus(false);
});
socket.on('env:sync', (state) => {
  env.apply(state);
  window._ncvSyncPanel && _ncvSyncPanel();
});


// ----------------------------------------------------------
// EnvironmentManager
// ----------------------------------------------------------
const EnvironmentManager = {
  timeOfDay:      12,
  windSpeed:      0.10,
  currentWeather: 'clear',

  // Tree configuration — changes take effect after canopy.rebuild()
  canopyCoverage: 0.7,   // 0–1: 0=no trees, 1=full canopy cover
  canopyDensity:  0.6,   // 0–1: 0=bare branches, 1=overwhelming leaves
  branchSpread:   0.5,   // 0–1: 0=tight/columnar, 1=wide/spreading
  branchDepth:    4,     // 3–5: recursion levels

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
      canopyCoverage: this.canopyCoverage,
      canopyDensity:  this.canopyDensity,
      branchSpread:   this.branchSpread,
      branchDepth:    this.branchDepth,
    };
  },
};

const env = EnvironmentManager;


// ----------------------------------------------------------
// Globals — subsystems
// ----------------------------------------------------------
let starField, canopy, flock;
let showDebug = true;

// Callbacks for controls.js
window._ncvRandomise    = () => { env.randomise(); window._ncvSyncPanel && _ncvSyncPanel(); };
window._ncvDebugVisible = true;
window._ncvToggleDebug  = () => { showDebug = !showDebug; window._ncvDebugVisible = showDebug; };
// Called by controls.js when branch config changes require a canopy rebuild
window._ncvRebuildCanopy = () => { canopy && canopy.rebuild(); };


// ----------------------------------------------------------
// p5 setup
// ----------------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(RGB, 255, 255, 255, 255);
  textFont('monospace');

  starField = new StarField();
  canopy    = new Canopy();
  flock     = new CreatureFlock();
}


// ----------------------------------------------------------
// p5 draw — update order matters:
//   canopy first (builds perchNodes) → flock (reads perchNodes)
//   → then all rendering in visual layer order
// ----------------------------------------------------------
function draw() {
  background(skyColor());

  // --- Update phase ---
  canopy.update();   // must precede flock.update() — provides perchNodes
  flock.update();

  // --- Render phase (back → front) ---
  starField.draw();  // sky layer
  canopy.draw();     // branches + leaves
  flock.draw();      // birds + bats on top

  if (showDebug) drawDebugHUD();
}


// ----------------------------------------------------------
// Resize
// ----------------------------------------------------------
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  canopy.resize();
}


// ----------------------------------------------------------
// Keyboard shortcuts
// ----------------------------------------------------------
function keyPressed() {
  if      (key === ' ')              { env.randomise(); window._ncvSyncPanel && _ncvSyncPanel(); }
  else if (key === 'c' || key === 'C') { window._ncvTogglePanel  && _ncvTogglePanel(); }
  else if (key === 'd' || key === 'D') { window._ncvToggleDebug  && _ncvToggleDebug(); }
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
  fill(0, 0, 0, 145); noStroke();
  rect(PAD - 8, PAD - 8, 330, LINE * 8 + 18, 7);
  textSize(12);

  const rows = [
    ['EnvironmentManager', '',                           true ],
    ['timeOfDay',          _fmtTime(env.timeOfDay)           ],
    ['windSpeed',          env.windSpeed.toFixed(3)           ],
    ['currentWeather',     env.currentWeather                 ],
    ['canopyDensity',      env.canopyDensity.toFixed(2)       ],
    ['branchSpread',       env.branchSpread.toFixed(2)        ],
    ['branchDepth',        String(env.branchDepth)            ],
    ['',                   ''                                 ],
    ['[SPC] rnd  [C] panel  [D] debug', '', false, true       ],
  ];

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
