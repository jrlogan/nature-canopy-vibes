const socket = window.io();

const urlParams = new URLSearchParams(window.location.search);
const roomParam = String(urlParams.get('room') || '').trim();

const statusEl = document.getElementById('status');
const remoteTitleEl = document.getElementById('remote-title');
const logEl = document.getElementById('log');
const cityBtnEls = Array.from(document.querySelectorAll('.city-btn'));
const weatherBtnEls = Array.from(document.querySelectorAll('.weather-btn'));
const btnSkyLabels = document.getElementById('btn-sky-labels');
const btnSleep = document.getElementById('btn-sleep');
const btnCompass = document.getElementById('btn-compass');
const btnLightning = document.getElementById('btn-lightning');
const btnCopyCalUrl = document.getElementById('btn-copy-cal-url');
const advancedRowEl = document.getElementById('advanced-row');
const compassOffsetSlider = document.getElementById('compass-offset');
const compassOffsetReadoutEl = document.getElementById('compass-offset-readout');
const liveLocInputEl = document.getElementById('live-loc-input');
const btnLiveLocSetEl = document.getElementById('btn-live-loc-set');
const seasonSelectEl = document.getElementById('season-select');
const copyRoomInputEl = document.getElementById('copy-room-input');

const infoTimeEl = document.getElementById('info-time');
const infoSeasonEl = document.getElementById('info-season');
const infoWeatherEl = document.getElementById('info-weather');
const infoMoonEl = document.getElementById('info-moon');
const infoTempEl = document.getElementById('info-temp');
const infoWindEl = document.getElementById('info-wind');
const infoCloudEl = document.getElementById('info-cloud');
const infoRainEl = document.getElementById('info-rain');

// Journey panel
const jn = {
  time: document.getElementById('jn-time'),
  date: document.getElementById('jn-date'),
  where: document.getElementById('jn-where'),
  rate: document.getElementById('jn-rate'),
  toggle: document.getElementById('jn-toggle'),
  now: document.getElementById('jn-now'),
  stop: document.getElementById('jn-stop'),
  rateBtns: Array.from(document.querySelectorAll('.jn-rate')),
  scrubBtns: Array.from(document.querySelectorAll('.jn-scrub')),
  year: document.getElementById('jn-year'),
  month: document.getElementById('jn-month'),
  day: document.getElementById('jn-day'),
  hour: document.getElementById('jn-hour'),
  label: document.getElementById('jn-label'),
  goDate: document.getElementById('jn-go-date'),
  destCard: document.getElementById('jn-dest-card'),
  dests: document.getElementById('jn-dests'),
  clock: document.getElementById('jn-clock'),
  map: document.getElementById('jn-map'),
  rot: document.getElementById('jn-rot'),
  dual: document.getElementById('jn-dual'),
  scene: document.getElementById('jn-scene'),
  weatherAuto: document.getElementById('jn-weather-auto'),
};

let skyLabelsOn = false;
let compassOn = false;
let compassOffsetDeg = 0;
let currentSleep = false;
let activeLocationName = '';
let advancedTapCount = 0;
let advancedTapResetTimer = null;
let advancedUnlocked = false;
let advancedHoldTimer = null;
let latestState = {};

const persistedUrlFields = {
  qr: document.getElementById('inc-qr'),
  room: document.getElementById('inc-room'),
  compassOffset: document.getElementById('inc-compass-offset'),
  time: document.getElementById('inc-time'),
  wind: document.getElementById('inc-wind'),
  weather: document.getElementById('inc-weather'),
  season: document.getElementById('inc-season'),
  star: document.getElementById('inc-star'),
  cloud: document.getElementById('inc-cloud'),
  treeCount: document.getElementById('inc-tree-count'),
  skyOpen: document.getElementById('inc-sky-open'),
  foliage: document.getElementById('inc-foliage'),
  branchLen: document.getElementById('inc-branch-len'),
  edgeLush: document.getElementById('inc-edge-lush'),
  branchChaos: document.getElementById('inc-branch-chaos'),
  audio: document.getElementById('inc-audio'),
};

const controls = {
  timeOfDay: {
    slider: document.getElementById('time-slider'),
    readout: document.getElementById('time-readout'),
    fmt: (v) => {
      const minutes = Math.round((Number(v) || 0) * 60) % 1440;
      const hour = Math.floor(minutes / 60);
      return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
    },
    parse: (v) => clampRange(v, 0, 24),
  },
  windSpeed: {
    slider: document.getElementById('wind-slider'),
    readout: document.getElementById('wind-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  cloudCover: {
    slider: document.getElementById('cloud-slider'),
    readout: document.getElementById('cloud-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  starBrightness: {
    slider: document.getElementById('star-slider'),
    readout: document.getElementById('star-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 2),
  },
  treeFrameDensity: {
    slider: document.getElementById('tree-count-slider'),
    readout: document.getElementById('tree-count-readout'),
    fmt: (v) => String(Math.round(Number(v) || 0)),
    parse: (v) => Math.round(clampRange(v, 4, 16)),
  },
  treeSkyOpen: {
    slider: document.getElementById('sky-open-slider'),
    readout: document.getElementById('sky-open-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 1, 1.5),
  },
  treeFoliageMass: {
    slider: document.getElementById('foliage-slider'),
    readout: document.getElementById('foliage-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  treeBranchReach: {
    slider: document.getElementById('branch-len-slider'),
    readout: document.getElementById('branch-len-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  canopyEdgeLushness: {
    slider: document.getElementById('edge-lush-slider'),
    readout: document.getElementById('edge-lush-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1.5),
  },
  treeBranchChaos: {
    slider: document.getElementById('branch-chaos-slider'),
    readout: document.getElementById('branch-chaos-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundMaster: {
    slider: document.getElementById('snd-master-slider'),
    readout: document.getElementById('snd-master-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundRain: {
    slider: document.getElementById('snd-rain-slider'),
    readout: document.getElementById('snd-rain-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundWind: {
    slider: document.getElementById('snd-wind-slider'),
    readout: document.getElementById('snd-wind-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundThunder: {
    slider: document.getElementById('snd-thunder-slider'),
    readout: document.getElementById('snd-thunder-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundBirds: {
    slider: document.getElementById('snd-birds-slider'),
    readout: document.getElementById('snd-birds-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundCrickets: {
    slider: document.getElementById('snd-crickets-slider'),
    readout: document.getElementById('snd-crickets-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  soundNightBirds: {
    slider: document.getElementById('snd-nightbirds-slider'),
    readout: document.getElementById('snd-nightbirds-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0, 1),
  },
  brightness: {
    slider: document.getElementById('bright-slider'),
    readout: document.getElementById('bright-readout'),
    fmt: (v) => (Number(v) || 0).toFixed(2),
    parse: (v) => clampRange(v, 0.05, 1),
  },
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function journeyRateText(rate) {
  const r = Number(rate) || 0;
  if (r === 0) return 'Paused';
  const a = Math.abs(r);
  let unit;
  if (a < 30) unit = a === 1 ? 'real time' : `${a}×`;
  else if (a < 1800) unit = `${Math.round(a / 60)} min per second`;
  else if (a < 43200) unit = `${Math.round(a / 3600)} hour per second`;
  else unit = `${Math.round(a / 86400)} day per second`;
  return (r < 0 ? 'Rewinding, ' : 'Playing, ') + unit;
}

function updateJourneyPanel(state = {}) {
  document.getElementById('flow-status').textContent = state.journeyActive ? journeyRateText(state.journeyRate) : 'Normal scene time';
  document.querySelectorAll('[data-flow-rate]').forEach(b => b.setAttribute('aria-pressed',String(!!state.journeyActive && Number(b.dataset.flowRate) === Number(state.journeyRate))));
  if (!jn.time) return;
  const active = !!state.journeyActive;
  const d = new Date(state.liveDateISO || Date.now());
  const ok = Number.isFinite(d.getTime());
  const y = ok ? d.getUTCFullYear() : NaN;
  const yearLabel = y > 0 ? String(y) : `${1 - y} BC`;
  jn.time.textContent = fmtClock(Number(state.timeOfDay));
  jn.date.textContent = ok ? `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${yearLabel}` : '--';
  jn.where.textContent = state.journeyLabel || state.liveLocationName || '--';
  const src = state.journeyWeatherSource;
  const srcTxt = !active ? '' : (src === 'archive' || src === 'forecast' ? ' · real weather for this day'
    : (src === 'hold' ? ' · weather held' : ' · modelled weather'));
  jn.rate.textContent = active ? journeyRateText(state.journeyRate) + srcTxt : 'Journey off — following live weather';
  const rate = Number(state.journeyRate) || 0;
  jn.toggle.textContent = active && rate !== 0 ? 'Pause' : 'Play';
  jn.toggle.classList.toggle('on', active && rate !== 0);
  jn.rateBtns.forEach((b) => b.classList.toggle('active', active && Number(b.dataset.rate) === rate));
  jn.clock.textContent = `Clock On Ceiling: ${state.showClock ? 'ON' : 'OFF'}`;
  jn.clock.classList.toggle('on', !!state.showClock);
  if (typeof state.showMap === 'string') jn.map.value = state.showMap;
  if (Number.isFinite(state.overlayRotationDeg)) {
    const snapped = String(Math.round(state.overlayRotationDeg / 90) * 90 % 360);
    jn.rot.value = snapped;
  }
  jn.dual.textContent = `Mirror Text 180°: ${state.overlayDual ? 'ON' : 'OFF'}`;
  jn.dual.classList.toggle('on', !!state.overlayDual);
  if (typeof state.sceneAudio === 'string') {
    const opt = Array.from(jn.scene.options).find((o) => o.value === state.sceneAudio);
    jn.scene.value = opt ? state.sceneAudio : '';
  }
  jn.weatherAuto.style.display = active && state.journeyWeatherHold ? '' : 'none';
  Array.from(jn.dests.querySelectorAll('.jn-dest')).forEach((b) => {
    b.classList.toggle('active', active && !!state.journeyLabel && b.dataset.label === state.journeyLabel);
  });
}

function initJourneyPanel() {
  document.querySelectorAll('[data-flow-rate]').forEach(b => b.addEventListener('click', () => sendCommand('journey_set_rate', 'Time flow', {rate:Number(b.dataset.flowRate)})));
  document.getElementById('flow-live').addEventListener('click', () => sendCommand('journey_stop','Back to live time'));
  if (!jn.time) return;
  jn.toggle.addEventListener('click', () => sendCommand('journey_toggle', 'Journey play/pause'));
  jn.now.addEventListener('click', () => sendCommand('journey_now', 'Journey → now'));
  jn.stop.addEventListener('click', () => sendCommand('journey_stop', 'Journey off, back to live'));
  jn.rateBtns.forEach((b) => b.addEventListener('click', () => {
    const rate = Number(b.dataset.rate);
    sendCommand('journey_set_rate', `Speed: ${journeyRateText(rate)}`, { rate });
  }));
  jn.scrubBtns.forEach((b) => b.addEventListener('click', () => {
    const sec = Number(b.dataset.sec);
    sendCommand('journey_scrub', `Nudge ${sec > 0 ? '+' : ''}${sec / 3600} h`, { sec });
  }));
  jn.goDate.addEventListener('click', () => {
    const year = Number(jn.year.value);
    if (!Number.isFinite(year)) { setLog('Enter a year (negative for BC)'); return; }
    const payload = {
      epoch: {
        year,
        month: Number(jn.month.value) || 1,
        day: Number(jn.day.value) || 1,
        hour: jn.hour.value === '' ? 12 : Number(jn.hour.value),
      },
      label: String(jn.label.value || '').trim(),
      rate: 1,
    };
    sendCommand('journey_set_epoch', `Journey → ${payload.epoch.day}/${payload.epoch.month}/${year}`, payload);
  });
  jn.clock.addEventListener('click', () => sendEnvPatch({ showClock: !latestState.showClock }, 'Clock'));
  jn.map.addEventListener('change', () => sendEnvPatch({ showMap: jn.map.value }, `Map ${jn.map.value}`));
  jn.rot.addEventListener('change', () => sendEnvPatch({ overlayRotationDeg: Number(jn.rot.value) }, `Text rotation ${jn.rot.value}°`));
  jn.dual.addEventListener('click', () => sendEnvPatch({ overlayDual: !latestState.overlayDual }, 'Mirror text'));
  jn.scene.addEventListener('change', () => sendEnvPatch({ sceneAudio: jn.scene.value }, `Scene sound: ${jn.scene.value || 'none'}`));
  jn.weatherAuto.addEventListener('click', () => sendCommand('journey_weather_auto', 'Weather follows journey'));

  // Destinations are server-defined; static hosting has none.
  fetch('journey/destinations').then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((list) => {
    jn.dests.innerHTML = '';
    for (const d of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'city-btn jn-dest';
      b.dataset.id = d.id;
      b.dataset.label = d.label || d.name;
      b.innerHTML = `${escapeHtml(d.label || d.name)}<small>${escapeHtml(d.name)}</small>`;
      b.addEventListener('click', () => sendCommand('journey_goto', `Journey → ${d.label || d.name}`, { id: d.id }));
      jn.dests.appendChild(b);
    }
  }).catch(() => {
    jn.dests.textContent = 'GitHub Pages: continuous sky time supports 1700–2200. Weather stays as configured; archive weather and destination presets require the server.';
    jn.weatherAuto.hidden = true;
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clampRange(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeOffsetDeg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const wrapped = ((n + 180) % 360 + 360) % 360 - 180;
  return Math.round(wrapped);
}

function normalizeRoomId(raw) {
  const v = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(v)) return '';
  return v;
}

function updateCompassOffsetUI() {
  if (compassOffsetReadoutEl) compassOffsetReadoutEl.textContent = `${compassOffsetDeg}°`;
  if (compassOffsetSlider) compassOffsetSlider.value = String(compassOffsetDeg);
}

function setAdvancedUnlocked(unlocked) {
  advancedUnlocked = !!unlocked;
  if (advancedRowEl) advancedRowEl.classList.toggle('visible', advancedUnlocked);
}

function initAdvancedUnlock() {
  // Always start hidden on each page load so public users only see basic controls.
  setAdvancedUnlocked(false);

  if (remoteTitleEl) {
    remoteTitleEl.addEventListener('click', (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      advancedTapCount += 1;
      if (advancedTapResetTimer) clearTimeout(advancedTapResetTimer);
      advancedTapResetTimer = setTimeout(() => { advancedTapCount = 0; }, 4000);
      if (advancedTapCount >= 5) {
        advancedTapCount = 0;
        setAdvancedUnlocked(!advancedUnlocked);
        setLog(advancedUnlocked ? 'Advanced unlocked' : 'Advanced hidden');
      }
    });
  }

  if (statusEl) {
    const startHold = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (advancedHoldTimer) clearTimeout(advancedHoldTimer);
      advancedHoldTimer = setTimeout(() => {
        advancedHoldTimer = null;
        setAdvancedUnlocked(!advancedUnlocked);
        setLog(advancedUnlocked ? 'Advanced unlocked' : 'Advanced hidden');
      }, 1200);
    };
    const cancelHold = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (!advancedHoldTimer) return;
      clearTimeout(advancedHoldTimer);
      advancedHoldTimer = null;
    };
    statusEl.addEventListener('pointerdown', startHold);
    statusEl.addEventListener('pointerup', cancelHold);
    statusEl.addEventListener('pointerleave', cancelHold);
    statusEl.addEventListener('pointercancel', cancelHold);
    statusEl.addEventListener('touchstart', startHold);
    statusEl.addEventListener('touchend', cancelHold);
    statusEl.addEventListener('touchcancel', cancelHold);
    statusEl.addEventListener('mousedown', startHold);
    statusEl.addEventListener('mouseup', cancelHold);
  }
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setLog(msg) {
  logEl.textContent = msg;
}

function sendCommand(command, label, data = {}) {
  socket.emit('remote:command', { command, data });
  setLog(`Sent: ${label}`);
}

function sendEnvPatch(patch, label = 'Update') {
  sendCommand('set_env_values', label, patch);
}

function syncActiveCityButton() {
  for (const btn of cityBtnEls) {
    const isActive = activeLocationName && btn.dataset.name === activeLocationName;
    btn.classList.toggle('active', !!isActive);
  }
}

function setActiveWeatherButton(weather) {
  weatherBtnEls.forEach((btn) => {
    btn.classList.toggle('active', String(btn.dataset.weather || '') === weather);
  });
}

function fmtClock(hourFloat) {
  if (!Number.isFinite(hourFloat)) return '--:--';
  let h = Math.floor(hourFloat) % 24;
  if (h < 0) h += 24;
  const m = Math.floor((hourFloat % 1) * 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function moonPhaseLabel() {
  const date = new Date();
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  let days = (date.getTime() - knownNewMoon) / 86400000;
  days = ((days % synodic) + synodic) % synodic;
  const frac = days / synodic;
  const illum = (1 - Math.cos(frac * Math.PI * 2)) * 0.5;
  const pct = Math.round(illum * 100);
  let label = 'New Moon';
  if (frac < 0.03 || frac >= 0.97) label = 'New Moon';
  else if (frac < 0.22) label = 'Waxing Crescent';
  else if (frac < 0.28) label = 'First Quarter';
  else if (frac < 0.47) label = 'Waxing Gibbous';
  else if (frac < 0.53) label = 'Full Moon';
  else if (frac < 0.72) label = 'Waning Gibbous';
  else if (frac < 0.78) label = 'Last Quarter';
  else label = 'Waning Crescent';
  return `${label} (${pct}%)`;
}

function updateInfoCard(state = {}) {
  const weather = String(state.currentWeather || 'clear');
  const tempC = Number.isFinite(state.liveTemperatureC) ? Number(state.liveTemperatureC) : null;
  let precip = 'None';
  if (weather === 'storm') precip = 'Thunderstorm';
  else if (weather === 'rain') {
    if (tempC !== null && tempC <= 0) precip = 'Snow';
    else if (tempC !== null && tempC <= 2) precip = 'Sleet';
    else precip = 'Rain';
  }
  const weatherLabel = weather === 'storm'
    ? 'THUNDERSTORM'
    : (weather === 'rain' ? 'RAIN' : weather.toUpperCase());
  infoTimeEl.textContent = fmtClock(Number(state.timeOfDay));
  infoSeasonEl.textContent = String(state.liveSeasonLabel || state.season || '--');
  infoWeatherEl.textContent = weatherLabel;
  infoMoonEl.textContent = moonPhaseLabel();
  if (tempC !== null) {
    const f = tempC * 9 / 5 + 32;
    infoTempEl.textContent = `${f.toFixed(1)} F (${tempC.toFixed(1)} C)`;
  } else {
    infoTempEl.textContent = '--';
  }
  if (Number.isFinite(state.liveWindKph)) {
    const mph = Number(state.liveWindKph) * 0.621371;
    infoWindEl.textContent = `${Math.round(mph)} mph`;
  } else {
    infoWindEl.textContent = '--';
  }
  infoCloudEl.textContent = Number.isFinite(state.liveCloudCoverPct)
    ? `${Math.round(state.liveCloudCoverPct)}%`
    : (Number.isFinite(state.cloudCover) ? `${Math.round(state.cloudCover * 100)}%` : '--');
  infoRainEl.textContent = precip;
}

function readControlValue(key) {
  const cfg = controls[key];
  if (!cfg || !cfg.slider) return undefined;
  return cfg.parse(cfg.slider.value);
}

function syncControlValue(key, stateValue) {
  const cfg = controls[key];
  if (!cfg || !cfg.slider) return;
  const next = cfg.parse(stateValue);
  cfg.slider.value = String(next);
  if (cfg.readout) cfg.readout.textContent = cfg.fmt(next);
}

function bindSliderPatch(key, label) {
  const cfg = controls[key];
  if (!cfg || !cfg.slider) return;
  cfg.slider.addEventListener('input', () => {
    const v = cfg.parse(cfg.slider.value);
    if (cfg.readout) cfg.readout.textContent = cfg.fmt(v);
  });
  cfg.slider.addEventListener('change', () => {
    const v = cfg.parse(cfg.slider.value);
    if (cfg.readout) cfg.readout.textContent = cfg.fmt(v);
    sendEnvPatch({ [key]: v }, `${label} ${cfg.fmt(v)}`);
  });
}

function buildCalibrationUrl() {
  const hostUrl = new URL('index.html', window.location.href);
  const roomFromInput = normalizeRoomId(copyRoomInputEl ? copyRoomInputEl.value : roomParam);

  if (persistedUrlFields.qr && persistedUrlFields.qr.checked) hostUrl.searchParams.set('qr', '1');
  if (persistedUrlFields.room && persistedUrlFields.room.checked && roomFromInput) {
    hostUrl.searchParams.set('room', roomFromInput);
  }
  if (persistedUrlFields.compassOffset && persistedUrlFields.compassOffset.checked) {
    hostUrl.searchParams.set('skyAzOffset', String(compassOffsetDeg));
  }

  const addIf = (fieldKey, paramName, stateKey) => {
    if (!persistedUrlFields[fieldKey] || !persistedUrlFields[fieldKey].checked) return;
    const v = latestState[stateKey];
    if (v === undefined || v === null || v === '') return;
    hostUrl.searchParams.set(paramName, String(v));
  };

  addIf('time', 'tod', 'timeOfDay');
  addIf('wind', 'wind', 'windSpeed');
  addIf('weather', 'weather', 'currentWeather');
  addIf('season', 'season', 'season');
  addIf('star', 'star', 'starBrightness');
  addIf('cloud', 'cloud', 'cloudCover');
  addIf('treeCount', 'trees', 'treeFrameDensity');
  addIf('skyOpen', 'skyOpen', 'treeSkyOpen');
  addIf('foliage', 'foliage', 'treeFoliageMass');
  addIf('branchLen', 'branchLen', 'treeBranchReach');
  addIf('edgeLush', 'edgeLush', 'canopyEdgeLushness');
  addIf('branchChaos', 'branchChaos', 'treeBranchChaos');

  if (persistedUrlFields.audio && persistedUrlFields.audio.checked) {
    addIf('audio', 'sndMaster', 'soundMaster');
    addIf('audio', 'sndRain', 'soundRain');
    addIf('audio', 'sndWind', 'soundWind');
    addIf('audio', 'sndThunder', 'soundThunder');
    addIf('audio', 'sndBirds', 'soundBirds');
    addIf('audio', 'sndCrickets', 'soundCrickets');
    addIf('audio', 'sndNightBirds', 'soundNightBirds');
  }

  return hostUrl.toString();
}

let lastDisplaySync = 0;
socket.on('connect', () => {
  setStatus('Looking for display…');
});

socket.on('disconnect', () => {
  lastDisplaySync = 0;
  setStatus('Reconnecting to display…');
});

setInterval(() => {
  if (!lastDisplaySync) setStatus('Display not found yet — keep the scene open and scan its current QR code.');
  else if (Date.now() - lastDisplaySync > 90000) setStatus('Waiting for display — connection may have been interrupted.');
}, 15000);

socket.on('env:sync', (state) => {
  lastDisplaySync = Date.now();
  setStatus(`Connected to display · ${state.liveLocationName || 'Canopy'}`);
  latestState = { ...state };

  skyLabelsOn = !!state.showConstellationLabels && !!state.showConstellations;
  compassOn = !!state.showCompassDirections;
  compassOffsetDeg = normalizeOffsetDeg(state.skyAzimuthOffsetDeg);

  btnSkyLabels.classList.toggle('on', skyLabelsOn);
  btnSkyLabels.textContent = `Constellations & Labels: ${skyLabelsOn ? 'ON' : 'OFF'}`;
  if (btnCompass) {
    btnCompass.classList.toggle('on', compassOn);
    btnCompass.textContent = `Compass Directions: ${compassOn ? 'ON' : 'OFF'}`;
  }
  updateCompassOffsetUI();

  currentSleep = !!state.sleeping;
  btnSleep.textContent = currentSleep ? 'Display: OFF' : 'Display: ON';
  btnSleep.style.background = currentSleep
    ? 'linear-gradient(120deg, #6c2121, #511a1a)'
    : 'linear-gradient(120deg, #26425d, #1a3047)';

  activeLocationName = state.liveLocationName || '';
  syncActiveCityButton();
  updateInfoCard(state);

  if (seasonSelectEl && typeof state.season === 'string') seasonSelectEl.value = state.season;
  setActiveWeatherButton(String(state.currentWeather || 'clear'));

  Object.keys(controls).forEach((key) => {
    if (state[key] !== undefined) syncControlValue(key, state[key]);
  });
  updateJourneyPanel(state);

  const hour = Number.isFinite(state.timeOfDay) ? state.timeOfDay.toFixed(1) : 'n/a';
  const loc = state.liveLocationName || 'Unknown';
  const trees = Number.isFinite(state.treeFrameDensity) ? Math.round(state.treeFrameDensity) : 'n/a';
  setLog(`Synced: ${loc} • ${hour}h • trees ${trees}`);
});

btnSleep.addEventListener('click', () => {
  currentSleep = !currentSleep;
  sendCommand('toggle_sleep', `Display ${currentSleep ? 'OFF' : 'ON'}`, { value: currentSleep });
});

cityBtnEls.forEach((btn) => {
  btn.addEventListener('click', () => {
    const lat = parseFloat(btn.dataset.lat || '');
    const lon = parseFloat(btn.dataset.lon || '');
    const name = String(btn.dataset.name || '').trim();
    const forceTreeType = String(btn.dataset.forceTree || '').trim().toLowerCase();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return;
    activeLocationName = name;
    syncActiveCityButton();
    sendCommand('set_location', `Location → ${name}`, {
      lat,
      lon,
      name,
      query: name,
      forceTreeType,
    });
  });
});

btnSkyLabels.addEventListener('click', () => {
  skyLabelsOn = !skyLabelsOn;
  btnSkyLabels.classList.toggle('on', skyLabelsOn);
  btnSkyLabels.textContent = `Constellations & Labels: ${skyLabelsOn ? 'ON' : 'OFF'}`;
  sendCommand('toggle_sky_labels', `Sky Labels ${skyLabelsOn ? 'ON' : 'OFF'}`, { value: skyLabelsOn });
});

if (btnCompass) {
  btnCompass.addEventListener('click', () => {
    compassOn = !compassOn;
    btnCompass.classList.toggle('on', compassOn);
    btnCompass.textContent = `Compass Directions: ${compassOn ? 'ON' : 'OFF'}`;
    sendCommand('toggle_compass', `Compass ${compassOn ? 'ON' : 'OFF'}`, { value: compassOn });
  });
}

if (btnLightning) {
  btnLightning.addEventListener('click', () => {
    sendCommand('lightning_flash', 'Lightning flash', {});
    socket.emit('lightning_strike', { source: 'remote_manual' });
    setLog('Sent: Lightning flash');
  });
}

if (compassOffsetSlider) {
  compassOffsetSlider.addEventListener('input', () => {
    compassOffsetDeg = normalizeOffsetDeg(compassOffsetSlider.value);
    updateCompassOffsetUI();
  });
  compassOffsetSlider.addEventListener('change', () => {
    compassOffsetDeg = normalizeOffsetDeg(compassOffsetSlider.value);
    updateCompassOffsetUI();
    sendCommand('set_compass_offset', `Compass Offset ${compassOffsetDeg}°`, { value: compassOffsetDeg });
  });
}

weatherBtnEls.forEach((btn) => {
  btn.addEventListener('click', () => {
    const weather = String(btn.dataset.weather || '').trim();
    if (!weather) return;
    setActiveWeatherButton(weather);
    sendEnvPatch({ currentWeather: weather }, `Weather ${weather.toUpperCase()}`);
  });
});

if (seasonSelectEl) {
  seasonSelectEl.addEventListener('change', () => {
    const season = String(seasonSelectEl.value || 'auto').toLowerCase();
    sendEnvPatch({ season }, `Season ${season}`);
  });
}

if (btnLiveLocSetEl && liveLocInputEl) {
  const applyLiveLocation = () => {
    const query = String(liveLocInputEl.value || '').trim();
    if (!query) return;
    sendCommand('set_location', `Location → ${query}`, { query, name: query });
  };
  btnLiveLocSetEl.addEventListener('click', applyLiveLocation);
  liveLocInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLiveLocation();
    }
  });
}

bindSliderPatch('timeOfDay', 'Time');
bindSliderPatch('windSpeed', 'Wind');
bindSliderPatch('cloudCover', 'Cloud');
bindSliderPatch('starBrightness', 'Stars');
bindSliderPatch('treeFrameDensity', 'Tree Count');
bindSliderPatch('treeSkyOpen', 'Sky Opening');
bindSliderPatch('treeFoliageMass', 'Foliage');
bindSliderPatch('treeBranchReach', 'Branch Length');
bindSliderPatch('canopyEdgeLushness', 'Edge Lushness');
bindSliderPatch('treeBranchChaos', 'Branch Chaos');
bindSliderPatch('soundMaster', 'Audio Master');
bindSliderPatch('soundRain', 'Audio Rain');
bindSliderPatch('soundWind', 'Audio Wind');
bindSliderPatch('soundThunder', 'Audio Thunder');
bindSliderPatch('soundBirds', 'Audio Birds');
bindSliderPatch('soundCrickets', 'Audio Crickets');
bindSliderPatch('soundNightBirds', 'Audio Night Birds');
bindSliderPatch('brightness', 'Brightness');
initJourneyPanel();

if (copyRoomInputEl) {
  const savedRoom = (() => {
    try {
      return String(localStorage.getItem('ncv-copy-room') || '').trim();
    } catch (e) {
      return '';
    }
  })();
  copyRoomInputEl.value = normalizeRoomId(savedRoom) || normalizeRoomId(roomParam) || '';
  copyRoomInputEl.addEventListener('input', () => {
    try {
      localStorage.setItem('ncv-copy-room', String(copyRoomInputEl.value || '').trim());
    } catch (e) {}
  });
}

if (btnCopyCalUrl) {
  btnCopyCalUrl.addEventListener('click', async () => {
    const url = buildCalibrationUrl();
    try {
      await navigator.clipboard.writeText(url);
      setLog('Copied URL with selected settings');
    } catch (e) {
      setLog(url);
    }
  });
}

initAdvancedUnlock();
