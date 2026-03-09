const socket = window.io();

const urlParams = new URLSearchParams(window.location.search);
const roomParam = String(urlParams.get('room') || '').trim();

const statusEl = document.getElementById('status');
const remoteTitleEl = document.getElementById('remote-title');
const logEl = document.getElementById('log');
const cityBtnEls = Array.from(document.querySelectorAll('.city-btn'));
const btnSkyLabels = document.getElementById('btn-sky-labels');
const btnSleep = document.getElementById('btn-sleep');
const btnCompass = document.getElementById('btn-compass');
const btnLightning = document.getElementById('btn-lightning');
const btnCopyCalUrl = document.getElementById('btn-copy-cal-url');
const advancedRowEl = document.getElementById('advanced-row');
const compassOffsetSlider = document.getElementById('compass-offset');
const compassOffsetReadoutEl = document.getElementById('compass-offset-readout');
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

function normalizeOffsetDeg(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const wrapped = ((n + 180) % 360 + 360) % 360 - 180;
  return Math.round(wrapped);
}

function updateCompassOffsetUI() {
  if (compassOffsetReadoutEl) compassOffsetReadoutEl.textContent = `${compassOffsetDeg}°`;
  if (compassOffsetSlider) compassOffsetSlider.value = String(compassOffsetDeg);
}

function setAdvancedUnlocked(unlocked) {
  advancedUnlocked = !!unlocked;
  if (advancedRowEl) advancedRowEl.classList.toggle('visible', advancedUnlocked);
  try {
    localStorage.setItem('ncv-remote-advanced', advancedUnlocked ? '1' : '0');
  } catch (e) {}
}

function initAdvancedUnlock() {
  try {
    if (localStorage.getItem('ncv-remote-advanced') === '1') setAdvancedUnlocked(true);
  } catch (e) {}
  if (!remoteTitleEl) return;
  remoteTitleEl.addEventListener('click', () => {
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

function syncActiveCityButton() {
  for (const btn of cityBtnEls) {
    const isActive = activeLocationName && btn.dataset.name === activeLocationName;
    btn.classList.toggle('active', !!isActive);
  }
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

function buildCalibrationUrl() {
  const hostUrl = new URL('index.html', window.location.href);
  hostUrl.searchParams.set('qr', '1');
  if (roomParam) hostUrl.searchParams.set('room', roomParam);
  hostUrl.searchParams.set('skyAzOffset', String(compassOffsetDeg));
  return hostUrl.toString();
}

socket.on('connect', () => {
  setStatus(`Connected (${socket.id})`);
});

socket.on('disconnect', () => {
  setStatus('Disconnected');
});

socket.on('env:sync', (state) => {
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
    socket.emit('lightning_strike');
    setLog('Sent: Lighting flash');
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

if (btnCopyCalUrl) {
  btnCopyCalUrl.addEventListener('click', async () => {
    const url = buildCalibrationUrl();
    try {
      await navigator.clipboard.writeText(url);
      setLog('Copied calibration URL');
    } catch (e) {
      setLog(url);
    }
  });
}

initAdvancedUnlock();
