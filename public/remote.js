const socket = io();

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const cityBtnEls = Array.from(document.querySelectorAll('.city-btn'));
const btnSkyLabels = document.getElementById('btn-sky-labels');
let skyLabelsOn = false;
let activeLocationName = '';

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

socket.on('connect', () => {
  setStatus(`Connected (${socket.id})`);
});

socket.on('disconnect', () => {
  setStatus('Disconnected');
});

socket.on('env:sync', (state) => {
  skyLabelsOn = !!state.showConstellationLabels && !!state.showConstellations;
  btnSkyLabels.classList.toggle('on', skyLabelsOn);
  btnSkyLabels.textContent = `Constellations & Labels: ${skyLabelsOn ? 'ON' : 'OFF'}`;
  activeLocationName = state.liveLocationName || '';
  syncActiveCityButton();
  const hour = Number.isFinite(state.timeOfDay) ? state.timeOfDay.toFixed(1) : 'n/a';
  const loc = state.liveLocationName || 'Unknown';
  const trees = Number.isFinite(state.treeFrameDensity) ? Math.round(state.treeFrameDensity) : 'n/a';
  setLog(`Synced: ${loc} • ${hour}h • trees ${trees}`);
});

cityBtnEls.forEach((btn) => {
  btn.addEventListener('click', () => {
    const lat = parseFloat(btn.dataset.lat || '');
    const lon = parseFloat(btn.dataset.lon || '');
    const name = String(btn.dataset.name || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return;
    activeLocationName = name;
    syncActiveCityButton();
    sendCommand('set_location', `Location → ${name}`, { lat, lon, name, query: name });
  });
});

btnSkyLabels.addEventListener('click', () => {
  skyLabelsOn = !skyLabelsOn;
  btnSkyLabels.classList.toggle('on', skyLabelsOn);
  btnSkyLabels.textContent = `Constellations & Labels: ${skyLabelsOn ? 'ON' : 'OFF'}`;
  sendCommand('toggle_sky_labels', `Sky Labels ${skyLabelsOn ? 'ON' : 'OFF'}`, { value: skyLabelsOn });
});
