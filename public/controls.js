// ============================================================
// controls.js — Floating HTML control panel
// Toggle with C key.  Injects its own DOM + CSS.
// ============================================================

(function buildControlPanel() {

  // ----------------------------------------------------------
  // CSS
  // ----------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #ncv-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 290px;
      background: rgba(8, 14, 22, 0.84);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(120, 180, 255, 0.18);
      border-radius: 12px;
      padding: 18px 20px 20px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #c8daf0;
      z-index: 9999;
      user-select: none;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      transition: opacity 0.25s, transform 0.25s;
      max-height: 90vh;
      overflow-y: auto;
    }
    #ncv-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(12px);
    }
    #ncv-panel h2 {
      margin: 0 0 12px;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(140, 190, 255, 0.70);
    }
    #ncv-panel .ncv-section-title {
      font-size: 10px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: rgba(120, 170, 220, 0.50);
      margin: 14px 0 8px;
      border-top: 1px solid rgba(80, 130, 200, 0.15);
      padding-top: 10px;
    }
    .ncv-row { margin-bottom: 12px; }
    .ncv-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 5px;
    }
    .ncv-label span:first-child { color: #8ab4d8; }
    .ncv-label .ncv-val         { color: #f0d080; font-weight: bold; }
    input[type=range] {
      width: 100%;
      -webkit-appearance: none;
      height: 4px;
      border-radius: 2px;
      background: rgba(80, 130, 200, 0.30);
      outline: none;
      cursor: pointer;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #5ab0ff;
      cursor: pointer;
      box-shadow: 0 0 6px #5ab0ff88;
    }
    .ncv-weather-row {
      display: flex;
      gap: 6px;
    }
    .ncv-weather-row button {
      flex: 1;
      padding: 5px 4px;
      border: 1px solid rgba(80, 130, 200, 0.30);
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      color: #8ab4d8;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .ncv-weather-row button.active {
      background: rgba(80, 130, 200, 0.25);
      color: #f0f8ff;
      border-color: rgba(80, 160, 255, 0.55);
    }
    .ncv-weather-row button:hover { background: rgba(80, 130, 200, 0.15); }
    .ncv-depth-row {
      display: flex;
      gap: 6px;
    }
    .ncv-depth-row button {
      flex: 1;
      padding: 5px 4px;
      border: 1px solid rgba(80, 130, 200, 0.25);
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      color: #8ab4d8;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .ncv-depth-row button.active {
      background: rgba(80, 180, 100, 0.22);
      color: #c8f0c8;
      border-color: rgba(80, 200, 100, 0.45);
    }
    .ncv-btn-row {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .ncv-btn {
      flex: 1;
      padding: 7px 0;
      border-radius: 7px;
      border: 1px solid rgba(80, 130, 200, 0.30);
      background: rgba(255,255,255,0.05);
      color: #8ab4d8;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      letter-spacing: 0.06em;
      transition: background 0.15s;
    }
    .ncv-btn:hover    { background: rgba(80, 130, 200, 0.18); color: #ddeeff; }
    .ncv-btn.rebuild  { border-color: rgba(80, 200, 100, 0.35); }
    .ncv-btn.rebuild:hover { background: rgba(80, 200, 100, 0.18); color: #c8f0c8; }
    .ncv-hint {
      margin-top: 12px;
      font-size: 10px;
      color: rgba(120, 160, 200, 0.40);
      text-align: center;
    }
    #ncv-socket-dot {
      display: inline-block;
      width: 6px; height: 6px;
      border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
      background: #ff5555;
    }
    #ncv-socket-dot.connected { background: #55dd88; box-shadow: 0 0 5px #55dd88; }
  `;
  document.head.appendChild(style);

  // ----------------------------------------------------------
  // HTML
  // ----------------------------------------------------------
  const panel = document.createElement('div');
  panel.id = 'ncv-panel';
  panel.innerHTML = `
    <h2><span id="ncv-socket-dot"></span>Environment Controls</h2>

    <!-- ── Environment ── -->
    <div class="ncv-row">
      <div class="ncv-label">
        <span>Time of Day</span>
        <span class="ncv-val" id="ncv-time-val">12:00</span>
      </div>
      <input type="range" id="ncv-time" min="0" max="24" step="0.05" value="12">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Wind Speed</span>
        <span class="ncv-val" id="ncv-wind-val">0.10</span>
      </div>
      <input type="range" id="ncv-wind" min="0" max="1" step="0.01" value="0.1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label"><span>Weather</span></div>
      <div class="ncv-weather-row" id="ncv-weather-btns">
        <button data-w="clear"  class="active">Clear</button>
        <button data-w="rain"              >Rain</button>
        <button data-w="storm"             >Storm</button>
      </div>
    </div>

    <!-- ── Tree Configuration ── -->
    <div class="ncv-section-title">Tree Configuration</div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Tree Coverage</span>
        <span class="ncv-val" id="ncv-coverage-val">0.70</span>
      </div>
      <input type="range" id="ncv-coverage" min="0" max="1" step="0.05" value="0.7">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Leaf Density</span>
        <span class="ncv-val" id="ncv-density-val">0.60</span>
      </div>
      <input type="range" id="ncv-density" min="0" max="1" step="0.05" value="0.6">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Branch Spread</span>
        <span class="ncv-val" id="ncv-spread-val">0.50</span>
      </div>
      <input type="range" id="ncv-spread" min="0" max="1" step="0.05" value="0.5">
    </div>

    <div class="ncv-row">
      <div class="ncv-label"><span>Branch Depth</span></div>
      <div class="ncv-depth-row" id="ncv-depth-btns">
        <button data-d="3">Sparse</button>
        <button data-d="4" class="active">Normal</button>
        <button data-d="5">Dense</button>
      </div>
    </div>

    <button class="ncv-btn rebuild" id="ncv-rebuild-btn">Rebuild Trees</button>

    <!-- ── Actions ── -->
    <div class="ncv-btn-row">
      <button class="ncv-btn" id="ncv-rand-btn">Randomise</button>
      <button class="ncv-btn" id="ncv-const-btn">Constellations: OFF</button>
      <button class="ncv-btn" id="ncv-debug-btn">Debug: ON</button>
    </div>

    <div class="ncv-hint">C — toggle panel &nbsp;|&nbsp; Space — randomise</div>
  `;
  document.body.appendChild(panel);

  // ----------------------------------------------------------
  // Element references
  // ----------------------------------------------------------
  const timeSlider    = document.getElementById('ncv-time');
  const windSlider    = document.getElementById('ncv-wind');
  const coverageSlider = document.getElementById('ncv-coverage');
  const densitySlider  = document.getElementById('ncv-density');
  const spreadSlider   = document.getElementById('ncv-spread');
  const timeVal        = document.getElementById('ncv-time-val');
  const windVal        = document.getElementById('ncv-wind-val');
  const coverageVal    = document.getElementById('ncv-coverage-val');
  const densityVal     = document.getElementById('ncv-density-val');
  const spreadVal      = document.getElementById('ncv-spread-val');
  const weatherBtns   = document.querySelectorAll('[data-w]');
  const depthBtns     = document.querySelectorAll('[data-d]');
  const socketDot     = document.getElementById('ncv-socket-dot');

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function fmtTime(h) {
    const hh = Math.floor(h) % 24;
    const mm = Math.floor((h % 1) * 60);
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }

  function emitState() {
    if (typeof socket !== 'undefined' && socket.connected) {
      socket.emit('env:update', env.snapshot());
    }
  }

  // ----------------------------------------------------------
  // Environment sliders
  // ----------------------------------------------------------
  timeSlider.addEventListener('input', () => {
    env.timeOfDay = parseFloat(timeSlider.value);
    timeVal.textContent = fmtTime(env.timeOfDay);
    emitState();
  });

  windSlider.addEventListener('input', () => {
    env.windSpeed = parseFloat(windSlider.value);
    windVal.textContent = env.windSpeed.toFixed(2);
    emitState();
  });

  weatherBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      env.currentWeather = btn.dataset.w;
      weatherBtns.forEach(b => b.classList.toggle('active', b === btn));
      emitState();
    });
  });

  // ----------------------------------------------------------
  // Tree configuration sliders — changes take effect live for
  // density (leaf count scales immediately).
  // Spread and depth need a rebuild to restructure the tree.
  // ----------------------------------------------------------
  coverageSlider.addEventListener('input', () => {
    env.canopyCoverage = parseFloat(coverageSlider.value);
    coverageVal.textContent = env.canopyCoverage.toFixed(2);
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  });

  densitySlider.addEventListener('input', () => {
    env.canopyDensity = parseFloat(densitySlider.value);
    densityVal.textContent = env.canopyDensity.toFixed(2);
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
  });

  spreadSlider.addEventListener('input', () => {
    env.branchSpread = parseFloat(spreadSlider.value);
    spreadVal.textContent = env.branchSpread.toFixed(2);
    // Spread changes branch structure — mark dirty, rebuild on button press
    // (immediate rebuild on every slider tick would be janky)
    spreadVal.style.color = '#ff9955'; // orange hint: press Rebuild
  });

  depthBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      env.branchDepth = parseInt(btn.dataset.d, 10);
      depthBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  document.getElementById('ncv-rebuild-btn').addEventListener('click', () => {
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
    spreadVal.style.color = ''; // reset orange hint
  });

  // ----------------------------------------------------------
  // Misc buttons
  // ----------------------------------------------------------
  document.getElementById('ncv-rand-btn').addEventListener('click', () => {
    window._ncvRandomise && _ncvRandomise();
  });

  document.getElementById('ncv-const-btn').addEventListener('click', function () {
    window._ncvShowConstellations = !window._ncvShowConstellations;
    this.textContent = window._ncvShowConstellations ? 'Constellations: ON' : 'Constellations: OFF';
    this.style.borderColor = window._ncvShowConstellations
      ? 'rgba(100, 160, 255, 0.6)' : '';
    this.style.color = window._ncvShowConstellations ? '#c8e8ff' : '';
  });

  document.getElementById('ncv-debug-btn').addEventListener('click', function () {
    window._ncvToggleDebug && _ncvToggleDebug();
    this.textContent = window._ncvDebugVisible ? 'Debug: ON' : 'Debug: OFF';
  });

  // ----------------------------------------------------------
  // Sync env → panel (called after socket sync or randomise)
  // ----------------------------------------------------------
  window._ncvSyncPanel = function () {
    timeSlider.value       = env.timeOfDay;
    timeVal.textContent    = fmtTime(env.timeOfDay);
    windSlider.value       = env.windSpeed;
    windVal.textContent    = env.windSpeed.toFixed(2);
    coverageSlider.value    = env.canopyCoverage;
    coverageVal.textContent = env.canopyCoverage.toFixed(2);
    densitySlider.value     = env.canopyDensity;
    densityVal.textContent  = env.canopyDensity.toFixed(2);
    spreadSlider.value      = env.branchSpread;
    spreadVal.textContent  = env.branchSpread.toFixed(2);
    spreadVal.style.color  = '';
    weatherBtns.forEach(b => b.classList.toggle('active', b.dataset.w === env.currentWeather));
    depthBtns.forEach(b   => b.classList.toggle('active', parseInt(b.dataset.d) === env.branchDepth));
  };

  // ----------------------------------------------------------
  // Socket status dot
  // ----------------------------------------------------------
  window._ncvSetSocketStatus = function (connected) {
    socketDot.classList.toggle('connected', connected);
  };

  // ----------------------------------------------------------
  // Toggle visibility
  // ----------------------------------------------------------
  window._ncvTogglePanel = function () {
    panel.classList.toggle('hidden');
  };

})();
