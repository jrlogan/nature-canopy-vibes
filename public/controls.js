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
    #ncv-panel select {
      background: rgba(5, 12, 20, 0.92) !important;
      color: #f5fbff !important;
      border: 1px solid rgba(180, 220, 255, 0.62) !important;
      font-size: 12px !important;
      font-weight: 600;
    }
    #ncv-panel select option {
      background: #0a1624;
      color: #f5fbff;
    }
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
  panel.classList.add('hidden');
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

    <div class="ncv-row">
      <div class="ncv-label"><span>Weather Mode</span></div>
      <div class="ncv-weather-row" id="ncv-sim-mode-btns">
        <button data-sm="manual">Manual</button>
        <button data-sm="random">Random</button>
        <button data-sm="live" class="active">Live</button>
      </div>
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Live Location</span>
        <span class="ncv-val" id="ncv-live-loc-val">New Haven, CT</span>
      </div>
      <div class="ncv-weather-row">
        <input id="ncv-live-loc-input" type="text" value="New Haven, CT" style="flex:1;min-width:0;padding:4px 6px;background:rgba(255,255,255,.05);border:1px solid rgba(80,130,200,.3);border-radius:6px;color:#c8daf0;font-family:inherit;font-size:11px;">
        <button id="ncv-live-loc-apply" class="ncv-btn" style="max-width:82px;">Set</button>
      </div>
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>City Preset</span>
      </div>
      <div class="ncv-weather-row">
        <select id="ncv-city-select" style="flex:1;min-width:0;padding:4px 6px;border-radius:6px;font-family:inherit;">
          <option value="">Custom…</option>
          <option value="New Haven, CT" data-match="new haven" data-lat="41.3083" data-lon="-72.9279">New Haven, CT</option>
          <option value="New York, NY" data-match="new york" data-lat="40.7128" data-lon="-74.0060">New York, NY</option>
          <option value="Chicago, IL" data-match="chicago" data-lat="41.8781" data-lon="-87.6298">Chicago, IL</option>
          <option value="Denver, CO" data-match="denver" data-lat="39.7392" data-lon="-104.9903">Denver, CO</option>
          <option value="Los Angeles, CA" data-match="los angeles" data-lat="34.0522" data-lon="-118.2437">Los Angeles, CA</option>
          <option value="Seattle, WA" data-match="seattle" data-lat="47.6062" data-lon="-122.3321">Seattle, WA</option>
          <option value="Miami, FL" data-match="miami" data-lat="25.7617" data-lon="-80.1918">Miami, FL</option>
          <option value="Anchorage, AK" data-match="anchorage" data-lat="61.2181" data-lon="-149.9003">Anchorage, AK</option>
          <option value="Honolulu, HI" data-match="honolulu" data-lat="21.3069" data-lon="-157.8583">Honolulu, HI</option>
          <option value="Reykjavik, Iceland" data-match="reykjavik" data-lat="64.1466" data-lon="-21.9426">Reykjavik, Iceland</option>
          <option value="Tromso, Norway" data-match="tromso" data-lat="69.6492" data-lon="18.9553">Tromso, Norway</option>
          <option value="London, United Kingdom" data-match="london" data-lat="51.5074" data-lon="-0.1278">London, United Kingdom</option>
          <option value="Paris, France" data-match="paris" data-lat="48.8566" data-lon="2.3522">Paris, France</option>
          <option value="Cape Town, South Africa" data-match="cape town" data-lat="-33.9249" data-lon="18.4241">Cape Town, South Africa</option>
          <option value="Nairobi, Kenya" data-match="nairobi" data-lat="-1.2921" data-lon="36.8219">Nairobi, Kenya</option>
          <option value="Lagos, Nigeria" data-match="lagos" data-lat="6.5244" data-lon="3.3792">Lagos, Nigeria</option>
          <option value="Quito, Ecuador" data-match="quito" data-lat="-0.1807" data-lon="-78.4678">Quito, Ecuador</option>
          <option value="Manaus, Brazil" data-match="manaus" data-lat="-3.1190" data-lon="-60.0217">Manaus, Brazil</option>
          <option value="Santiago, Chile" data-match="santiago" data-lat="-33.4489" data-lon="-70.6693">Santiago, Chile</option>
          <option value="Ushuaia, Argentina" data-match="ushuaia" data-lat="-54.8019" data-lon="-68.3030">Ushuaia, Argentina</option>
          <option value="Singapore, Singapore" data-match="singapore" data-lat="1.3521" data-lon="103.8198">Singapore, Singapore</option>
          <option value="Tokyo, Japan" data-match="tokyo" data-lat="35.6762" data-lon="139.6503">Tokyo, Japan</option>
          <option value="Sydney, Australia" data-match="sydney" data-lat="-33.8688" data-lon="151.2093">Sydney, Australia</option>
        </select>
      </div>
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Season</span>
      </div>
      <div class="ncv-weather-row">
        <select id="ncv-season-select" style="flex:1;min-width:0;padding:4px 6px;border-radius:6px;font-family:inherit;">
          <option value="auto">Auto</option>
          <option value="spring">Spring</option>
          <option value="summer">Summer</option>
          <option value="fall">Fall</option>
          <option value="winter">Winter</option>
        </select>
      </div>
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Star Brightness</span>
        <span class="ncv-val" id="ncv-star-brightness-val">1.00</span>
      </div>
      <input type="range" id="ncv-star-brightness" min="0" max="2" step="0.05" value="1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Constellation Brightness</span>
        <span class="ncv-val" id="ncv-const-brightness-val">1.00</span>
      </div>
      <input type="range" id="ncv-const-brightness" min="0" max="2" step="0.05" value="1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Milky Way</span>
        <span class="ncv-val" id="ncv-milky-way-val">1.00</span>
      </div>
      <input type="range" id="ncv-milky-way" min="0" max="2" step="0.05" value="1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Milky Blur</span>
        <span class="ncv-val" id="ncv-milky-blur-val">1.00</span>
      </div>
      <input type="range" id="ncv-milky-blur" min="0" max="2" step="0.05" value="1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Cloud Cover</span>
        <span class="ncv-val" id="ncv-cloud-cover-val">0.20</span>
      </div>
      <input type="range" id="ncv-cloud-cover" min="0" max="1" step="0.05" value="0.2">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Leaf Softness</span>
        <span class="ncv-val" id="ncv-leaf-softness-val">0.60</span>
      </div>
      <input type="range" id="ncv-leaf-softness" min="0" max="4" step="0.1" value="0.6">
    </div>

    <!-- ── Tree Configuration ── -->
    <div class="ncv-section-title">Tree Configuration</div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Sky Opening</span>
        <span class="ncv-val" id="ncv-coverage-val">1.10</span>
      </div>
      <input type="range" id="ncv-coverage" min="1" max="1.5" step="0.05" value="1.1">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Tree Count</span>
        <span class="ncv-val" id="ncv-tree-count-val">10</span>
      </div>
      <input type="range" id="ncv-tree-count" min="4" max="16" step="1" value="10">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Foliage Density</span>
        <span class="ncv-val" id="ncv-density-val">0.85</span>
      </div>
      <input type="range" id="ncv-density" min="0" max="1" step="0.05" value="0.85">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Branch Length</span>
        <span class="ncv-val" id="ncv-perspective-val">0.40</span>
      </div>
      <input type="range" id="ncv-perspective" min="0" max="1" step="0.05" value="0.4">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Edge Lushness</span>
        <span class="ncv-val" id="ncv-edge-lush-val">1.00</span>
      </div>
      <input type="range" id="ncv-edge-lush" min="0" max="1.5" step="0.05" value="1.0">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Branch Chaos</span>
        <span class="ncv-val" id="ncv-spread-val">0.62</span>
      </div>
      <input type="range" id="ncv-spread" min="0" max="1" step="0.05" value="0.62">
    </div>

    <div class="ncv-row">
      <div class="ncv-label"><span>Branch Depth</span></div>
      <div class="ncv-depth-row" id="ncv-depth-btns">
        <button data-d="3">Simple</button>
        <button data-d="4">Layered</button>
        <button data-d="5" class="active">Complex</button>
      </div>
    </div>

    <button class="ncv-btn rebuild" id="ncv-rebuild-btn">Reseed Trees</button>
    <button class="ncv-btn" id="ncv-flock-btn" style="margin-top:8px;width:100%;">Trigger Flock</button>

    <div class="ncv-section-title">Audio Atmosphere</div>

    <button class="ncv-btn" id="ncv-audio-enable-btn">Enable Audio</button>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Master Volume</span>
        <span class="ncv-val" id="ncv-snd-master-val">0.50</span>
      </div>
      <input type="range" id="ncv-snd-master" min="0" max="1" step="0.05" value="0.5">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Crickets</span>
        <span class="ncv-val" id="ncv-snd-crickets-val">0.40</span>
      </div>
      <input type="range" id="ncv-snd-crickets" min="0" max="1" step="0.05" value="0.4">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Thunder</span>
        <span class="ncv-val" id="ncv-snd-thunder-val">0.60</span>
      </div>
      <input type="range" id="ncv-snd-thunder" min="0" max="1" step="0.05" value="0.6">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Birds (Day)</span>
        <span class="ncv-val" id="ncv-snd-birds-val">0.35</span>
      </div>
      <input type="range" id="ncv-snd-birds" min="0" max="1" step="0.05" value="0.35">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Rain</span>
        <span class="ncv-val" id="ncv-snd-rain-val">0.40</span>
      </div>
      <input type="range" id="ncv-snd-rain" min="0" max="1" step="0.05" value="0.4">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Wind</span>
        <span class="ncv-val" id="ncv-snd-wind-val">0.35</span>
      </div>
      <input type="range" id="ncv-snd-wind" min="0" max="1" step="0.05" value="0.35">
    </div>

    <div class="ncv-row">
      <div class="ncv-label">
        <span>Night Birds</span>
        <span class="ncv-val" id="ncv-snd-night-birds-val">0.25</span>
      </div>
      <input type="range" id="ncv-snd-night-birds" min="0" max="1" step="0.05" value="0.25">
    </div>

    <!-- ── Actions ── -->
    <div class="ncv-btn-row">
      <button class="ncv-btn" id="ncv-rand-btn">Randomise</button>
      <button class="ncv-btn" id="ncv-const-btn">Constellations: OFF</button>
      <button class="ncv-btn" id="ncv-debug-btn">Debug: OFF</button>
    </div>

    <div class="ncv-hint">C — toggle panel &nbsp;|&nbsp; Space — randomise</div>
  `;
  document.body.appendChild(panel);

  // ----------------------------------------------------------
  // Element references
  // ----------------------------------------------------------
  const timeSlider    = document.getElementById('ncv-time');
  const windSlider    = document.getElementById('ncv-wind');
  const starBrightnessSlider = document.getElementById('ncv-star-brightness');
  const constBrightnessSlider = document.getElementById('ncv-const-brightness');
  const milkyWaySlider = document.getElementById('ncv-milky-way');
  const milkyBlurSlider = document.getElementById('ncv-milky-blur');
  const cloudCoverSlider = document.getElementById('ncv-cloud-cover');
  const leafSoftnessSlider = document.getElementById('ncv-leaf-softness');
  const sndMasterSlider = document.getElementById('ncv-snd-master');
  const sndCricketsSlider = document.getElementById('ncv-snd-crickets');
  const sndThunderSlider = document.getElementById('ncv-snd-thunder');
  const sndBirdsSlider = document.getElementById('ncv-snd-birds');
  const sndRainSlider = document.getElementById('ncv-snd-rain');
  const sndWindSlider = document.getElementById('ncv-snd-wind');
  const sndNightBirdsSlider = document.getElementById('ncv-snd-night-birds');
  const coverageSlider = document.getElementById('ncv-coverage');
  const treeCountSlider = document.getElementById('ncv-tree-count');
  const densitySlider  = document.getElementById('ncv-density');
  const perspectiveSlider = document.getElementById('ncv-perspective');
  const edgeLushSlider = document.getElementById('ncv-edge-lush');
  const spreadSlider   = document.getElementById('ncv-spread');
  const timeVal        = document.getElementById('ncv-time-val');
  const windVal        = document.getElementById('ncv-wind-val');
  const starBrightnessVal = document.getElementById('ncv-star-brightness-val');
  const constBrightnessVal = document.getElementById('ncv-const-brightness-val');
  const milkyWayVal = document.getElementById('ncv-milky-way-val');
  const milkyBlurVal = document.getElementById('ncv-milky-blur-val');
  const cloudCoverVal = document.getElementById('ncv-cloud-cover-val');
  const leafSoftnessVal = document.getElementById('ncv-leaf-softness-val');
  const sndMasterVal = document.getElementById('ncv-snd-master-val');
  const sndCricketsVal = document.getElementById('ncv-snd-crickets-val');
  const sndThunderVal = document.getElementById('ncv-snd-thunder-val');
  const sndBirdsVal = document.getElementById('ncv-snd-birds-val');
  const sndRainVal = document.getElementById('ncv-snd-rain-val');
  const sndWindVal = document.getElementById('ncv-snd-wind-val');
  const sndNightBirdsVal = document.getElementById('ncv-snd-night-birds-val');
  const coverageVal    = document.getElementById('ncv-coverage-val');
  const treeCountVal   = document.getElementById('ncv-tree-count-val');
  const densityVal     = document.getElementById('ncv-density-val');
  const perspectiveVal = document.getElementById('ncv-perspective-val');
  const edgeLushVal = document.getElementById('ncv-edge-lush-val');
  const spreadVal      = document.getElementById('ncv-spread-val');
  const weatherBtns   = document.querySelectorAll('[data-w]');
  const simModeBtns   = document.querySelectorAll('[data-sm]');
  const liveLocVal    = document.getElementById('ncv-live-loc-val');
  const liveLocInput  = document.getElementById('ncv-live-loc-input');
  const liveLocApply  = document.getElementById('ncv-live-loc-apply');
  const citySelect    = document.getElementById('ncv-city-select');
  const seasonSelect  = document.getElementById('ncv-season-select');
  const depthBtns     = document.querySelectorAll('[data-d]');
  const socketDot     = document.getElementById('ncv-socket-dot');
  const constBtn      = document.getElementById('ncv-const-btn');

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

  starBrightnessSlider.addEventListener('input', () => {
    env.starBrightness = parseFloat(starBrightnessSlider.value);
    starBrightnessVal.textContent = env.starBrightness.toFixed(2);
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    emitState();
  });

  constBrightnessSlider.addEventListener('input', () => {
    env.constellationBrightness = parseFloat(constBrightnessSlider.value);
    constBrightnessVal.textContent = env.constellationBrightness.toFixed(2);
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    emitState();
  });

  milkyWaySlider.addEventListener('input', () => {
    env.milkyWayIntensity = parseFloat(milkyWaySlider.value);
    milkyWayVal.textContent = env.milkyWayIntensity.toFixed(2);
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    emitState();
  });

  milkyBlurSlider.addEventListener('input', () => {
    env.milkyWayBlur = parseFloat(milkyBlurSlider.value);
    milkyBlurVal.textContent = env.milkyWayBlur.toFixed(2);
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    emitState();
  });

  cloudCoverSlider.addEventListener('input', () => {
    env.cloudCover = parseFloat(cloudCoverSlider.value);
    cloudCoverVal.textContent = env.cloudCover.toFixed(2);
    emitState();
  });

  leafSoftnessSlider.addEventListener('input', () => {
    env.leafSoftness = parseFloat(leafSoftnessSlider.value);
    leafSoftnessVal.textContent = env.leafSoftness.toFixed(2);
    emitState();
  });

  weatherBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      env.currentWeather = btn.dataset.w;
      weatherBtns.forEach(b => b.classList.toggle('active', b === btn));
      emitState();
    });
  });

  simModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      env.simulationMode = btn.dataset.sm;
      simModeBtns.forEach(b => b.classList.toggle('active', b === btn));
      if (typeof socket !== 'undefined' && socket.connected) {
        socket.emit('sim:setMode', { mode: env.simulationMode });
      }
      emitState();
    });
  });

  function emitLocationQuery(query) {
    const q = String(query || '').trim();
    if (!q || typeof socket === 'undefined' || !socket.connected) return;
    window._ncvBeginLocationTransition && _ncvBeginLocationTransition();
    const opt = Array.from(citySelect.options).find(o => o.value && o.value.toLowerCase() === q.toLowerCase());
    const lat = opt?.dataset?.lat ? parseFloat(opt.dataset.lat) : NaN;
    const lon = opt?.dataset?.lon ? parseFloat(opt.dataset.lon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      socket.emit('sim:setLocation', { query: q, lat, lon, name: opt.value });
    } else {
      socket.emit('sim:setLocation', { query: q });
    }
  }

  liveLocApply.addEventListener('click', () => {
    emitLocationQuery(liveLocInput.value);
  });

  citySelect.addEventListener('change', () => {
    const q = citySelect.value.trim();
    if (!q) return;
    liveLocInput.value = q;
    emitLocationQuery(q);
  });

  seasonSelect.addEventListener('change', () => {
    env.season = seasonSelect.value || 'auto';
    emitState();
  });

  if (typeof socket !== 'undefined') {
    socket.on('sim:error', (payload = {}) => {
      liveLocVal.textContent = `Location error: ${payload.message || 'unknown'}`;
    });
  }

  // ----------------------------------------------------------
  // Tree configuration sliders — mapped to intuitive tree semantics.
  // ----------------------------------------------------------
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function syncDerivedTreeParams() {
    // No longer needed: we use direct tree* properties now.
  }

  let treeRebuildTimer = null;
  function scheduleTreeRebuild() {
    if (treeRebuildTimer) clearTimeout(treeRebuildTimer);
    treeRebuildTimer = setTimeout(() => {
      window._ncvRebuildCanopy && _ncvRebuildCanopy();
      treeRebuildTimer = null;
    }, 80);
  }

  coverageSlider.addEventListener('input', () => {
    env.treeSkyOpen = parseFloat(coverageSlider.value);
    coverageVal.textContent = env.treeSkyOpen.toFixed(2);
    // No rebuild — runtime length multiplier pulls trees toward edges smoothly.
    emitState();
  });

  treeCountSlider.addEventListener('input', () => {
    env.treeFrameDensity = parseInt(treeCountSlider.value, 10);
    treeCountVal.textContent = treeCountSlider.value;
    // Incremental add/remove — existing trees stay in place.
    window._ncvUpdateTreeCount && _ncvUpdateTreeCount();
    emitState();
  });

  densitySlider.addEventListener('input', () => {
    env.treeFoliageMass = parseFloat(densitySlider.value);
    densityVal.textContent = env.treeFoliageMass.toFixed(2);
    syncDerivedTreeParams();
    emitState();
  });

  perspectiveSlider.addEventListener('input', () => {
    env.treeBranchReach = parseFloat(perspectiveSlider.value);
    perspectiveVal.textContent = env.treeBranchReach.toFixed(2);
    // No rebuild — runtime length multiplier scales existing branches live.
    emitState();
  });

  edgeLushSlider.addEventListener('input', () => {
    env.canopyEdgeLushness = parseFloat(edgeLushSlider.value);
    edgeLushVal.textContent = env.canopyEdgeLushness.toFixed(2);
    emitState();
  });

  spreadSlider.addEventListener('input', () => {
    env.treeBranchChaos = parseFloat(spreadSlider.value);
    spreadVal.textContent = env.treeBranchChaos.toFixed(2);
    // No rebuild — outer branch chaos jitter applied live at runtime.
    // Decreasing chaos below built value has no visual effect until next reseed.
    emitState();
  });

  depthBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      env.branchDepth = parseInt(btn.dataset.d, 10);
      // Depth presets tuned for the requested starting looks.
      if (env.branchDepth === 5) { // Complex
        env.treeSkyOpen = 1.10;
        env.treeFrameDensity = 10;
        env.treeFoliageMass = 0.85;
        env.treeBranchReach = 0.40;
        env.canopyEdgeLushness = 1.0;
      } else if (env.branchDepth === 4) { // Layered
        env.treeSkyOpen = 1.20;
        env.treeFrameDensity = 14;
        env.treeFoliageMass = 0.70;
      }
      window._ncvUpdateTreeCount && _ncvUpdateTreeCount();
      window._ncvSyncPanel && _ncvSyncPanel();
      depthBtns.forEach(b => b.classList.toggle('active', b === btn));
      scheduleTreeRebuild();
      emitState();
    });
  });

  document.getElementById('ncv-rebuild-btn').addEventListener('click', () => {
    window._ncvRebuildCanopy && _ncvRebuildCanopy();
    emitState();
  });

  document.getElementById('ncv-flock-btn').addEventListener('click', () => {
    window._ncvTriggerFlock && _ncvTriggerFlock();
  });

  document.getElementById('ncv-audio-enable-btn').addEventListener('click', function () {
    window._ncvEnableAudio && _ncvEnableAudio();
    this.textContent = 'Audio Enabled';
  });

  function bindSoundSlider(slider, label, key) {
    slider.addEventListener('input', () => {
      env[key] = parseFloat(slider.value);
      label.textContent = env[key].toFixed(2);
      emitState();
    });
  }

  bindSoundSlider(sndMasterSlider, sndMasterVal, 'soundMaster');
  bindSoundSlider(sndCricketsSlider, sndCricketsVal, 'soundCrickets');
  bindSoundSlider(sndThunderSlider, sndThunderVal, 'soundThunder');
  bindSoundSlider(sndBirdsSlider, sndBirdsVal, 'soundBirds');
  bindSoundSlider(sndRainSlider, sndRainVal, 'soundRain');
  bindSoundSlider(sndWindSlider, sndWindVal, 'soundWind');
  bindSoundSlider(sndNightBirdsSlider, sndNightBirdsVal, 'soundNightBirds');

  // ----------------------------------------------------------
  // Misc buttons
  // ----------------------------------------------------------
  document.getElementById('ncv-rand-btn').addEventListener('click', () => {
    window._ncvRandomise && _ncvRandomise();
  });

  constBtn.addEventListener('click', function () {
    env.showConstellations = !env.showConstellations;
    window._ncvShowConstellations = !!env.showConstellations;
    this.textContent = window._ncvShowConstellations ? 'Constellations: ON' : 'Constellations: OFF';
    this.style.borderColor = window._ncvShowConstellations
      ? 'rgba(100, 160, 255, 0.6)' : '';
    this.style.color = window._ncvShowConstellations ? '#c8e8ff' : '';
    window._ncvInvalidateSkyCache && _ncvInvalidateSkyCache();
    emitState();
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
    starBrightnessSlider.value = env.starBrightness;
    starBrightnessVal.textContent = env.starBrightness.toFixed(2);
    constBrightnessSlider.value = env.constellationBrightness;
    constBrightnessVal.textContent = env.constellationBrightness.toFixed(2);
    milkyWaySlider.value = env.milkyWayIntensity ?? 1.0;
    milkyWayVal.textContent = (env.milkyWayIntensity ?? 1.0).toFixed(2);
    milkyBlurSlider.value = env.milkyWayBlur ?? 1.0;
    milkyBlurVal.textContent = (env.milkyWayBlur ?? 1.0).toFixed(2);
    cloudCoverSlider.value = env.cloudCover;
    cloudCoverVal.textContent = env.cloudCover.toFixed(2);
    leafSoftnessSlider.value = env.leafSoftness;
    leafSoftnessVal.textContent = env.leafSoftness.toFixed(2);
    sndMasterSlider.value = env.soundMaster;
    sndMasterVal.textContent = env.soundMaster.toFixed(2);
    sndCricketsSlider.value = env.soundCrickets;
    sndCricketsVal.textContent = env.soundCrickets.toFixed(2);
    sndThunderSlider.value = env.soundThunder;
    sndThunderVal.textContent = env.soundThunder.toFixed(2);
    sndBirdsSlider.value = env.soundBirds;
    sndBirdsVal.textContent = env.soundBirds.toFixed(2);
    sndRainSlider.value = env.soundRain;
    sndRainVal.textContent = env.soundRain.toFixed(2);
    sndWindSlider.value = env.soundWind;
    sndWindVal.textContent = env.soundWind.toFixed(2);
    sndNightBirdsSlider.value = env.soundNightBirds;
    sndNightBirdsVal.textContent = env.soundNightBirds.toFixed(2);

    coverageSlider.value    = env.treeSkyOpen ?? 1.0;
    coverageVal.textContent = (env.treeSkyOpen ?? 1.0).toFixed(2);
    treeCountSlider.value    = Math.round(env.treeFrameDensity ?? 10);
    treeCountVal.textContent = treeCountSlider.value;
    densitySlider.value     = env.treeFoliageMass ?? 0.85;
    densityVal.textContent  = (env.treeFoliageMass ?? 0.85).toFixed(2);
    perspectiveSlider.value = env.treeBranchReach ?? 0.40;
    perspectiveVal.textContent = (env.treeBranchReach ?? 0.40).toFixed(2);
    edgeLushSlider.value = env.canopyEdgeLushness ?? 1.0;
    edgeLushVal.textContent = (env.canopyEdgeLushness ?? 1.0).toFixed(2);
    spreadSlider.value      = env.treeBranchChaos ?? 0.52;
    spreadVal.textContent  = (env.treeBranchChaos ?? 0.52).toFixed(2);
    
    weatherBtns.forEach(b => b.classList.toggle('active', b.dataset.w === env.currentWeather));
    simModeBtns.forEach(b => b.classList.toggle('active', b.dataset.sm === (env.simulationMode || 'manual')));
    liveLocVal.textContent = env.liveLocationName || 'New Haven, CT';
    if (env.liveLocationName) liveLocInput.value = env.liveLocationName;
    const loc = (env.liveLocationName || '').toLowerCase();
    const match = Array.from(citySelect.options).find(o => o.dataset.match && loc.includes(o.dataset.match));
    citySelect.value = match ? match.value : '';
    seasonSelect.value = env.season || 'auto';
    depthBtns.forEach(b   => b.classList.toggle('active', parseInt(b.dataset.d) === env.branchDepth));
    window._ncvShowConstellations = !!env.showConstellations;
    constBtn.textContent = window._ncvShowConstellations ? 'Constellations: ON' : 'Constellations: OFF';
    constBtn.style.borderColor = window._ncvShowConstellations ? 'rgba(100, 160, 255, 0.6)' : '';
    constBtn.style.color = window._ncvShowConstellations ? '#c8e8ff' : '';
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

  (function tryInitialSync() {
    if (typeof env !== 'undefined' && window._ncvSyncPanel) {
      window._ncvSyncPanel();
      return;
    }
    setTimeout(tryInitialSync, 60);
  })();

})();
