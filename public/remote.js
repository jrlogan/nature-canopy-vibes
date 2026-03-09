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
    fmt: (v) => `${(Number(v) || 0).toFixed(1)}h`,
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
};

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

socket.on('connect', () => {
  setStatus(`Connected (${socket.id})`);
});

socket.on('disconnect', () => {
  setStatus('Disconnected');
});

socket.on('env:sync', (state) => {
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
