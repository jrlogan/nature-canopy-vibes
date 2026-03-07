const socket = io();

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setLog(msg) {
  logEl.textContent = msg;
}

function sendCommand(command, label) {
  socket.emit('remote:command', { command });
  setLog(`Sent: ${label}`);
}

socket.on('connect', () => {
  setStatus(`Connected (${socket.id})`);
});

socket.on('disconnect', () => {
  setStatus('Disconnected');
});

socket.on('env:sync', (state) => {
  const hour = Number.isFinite(state.timeOfDay) ? state.timeOfDay.toFixed(1) : 'n/a';
  setLog(`Synced: ${state.currentWeather || 'clear'} @ ${hour}h`);
});

document.getElementById('btn-storm').addEventListener('click', () => {
  sendCommand('trigger_storm', 'Trigger Storm');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  sendCommand('clear_weather', 'Clear Weather');
});

document.getElementById('btn-day').addEventListener('click', () => {
  sendCommand('day_mode', 'Day Mode');
});

document.getElementById('btn-night').addEventListener('click', () => {
  sendCommand('night_mode', 'Night Mode');
});
