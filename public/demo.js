// Small-screen demo controls; opt in on a desktop with ?demo=1.
(function () {
  const params = new URLSearchParams(location.search);
  const enabled = params.get('demo') === '1' || (params.get('demo') !== '0'
    && matchMedia('(pointer: coarse) and (max-width: 1000px)').matches);
  const places = [
    { name: 'New Haven, CT', lat: 41.3083, lon: -72.9279 },
    { name: 'Honolulu, HI', lat: 21.3069, lon: -157.8583 },
    { name: 'Anchorage, AK', lat: 61.2181, lon: -149.9003 },
    { name: 'Lisbon, Portugal', lat: 38.7223, lon: -9.1393 },
  ];
  // Restore shared coordinates before applying the existing visual URL options.
  let restored = false;
  socket.on('connect', () => {
    if (restored || !params.has('lat') || !params.has('lon')) return;
    const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    restored = true;
    socket.emit('env:update', { ...startupEnvOverrides, liveLocationLat: lat,
      liveLocationLon: lon, liveLocationName: (params.get('place') || 'Shared location').slice(0, 120),
      simulationMode: 'manual', journeyActive: false });
  });
  if (!enabled) return;
  document.body.classList.add('demo-mode');
  const style = document.createElement('style');
  style.textContent = `
    #demo-bar { position:fixed; bottom:max(10px,env(safe-area-inset-bottom));
      left:max(10px,env(safe-area-inset-left)); right:max(10px,env(safe-area-inset-right));
      z-index:10000; display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
    #demo-bar button { min-height:44px; padding:8px 12px; border:1px solid #8cb7cd66;
      border-radius:22px; background:#071420dd; color:#effaff; font:14px sans-serif; touch-action:manipulation; }
    #demo-caption { position:fixed; top:max(16px,env(safe-area-inset-top)); left:16px; right:16px;
      color:white; text-align:center; font:14px/1.5 sans-serif; text-shadow:0 1px 5px black;
      pointer-events:none; z-index:9000; transition:opacity 1s; }
    #demo-caption.faded { opacity:0; }
    .demo-mode #ncv-panel { bottom:calc(112px + env(safe-area-inset-bottom)); max-height:calc(100dvh - 144px); }
    .demo-mode #ncv-panel select, .demo-mode #ncv-panel input[type=text] { font-size:16px !important; }
    body:has(#qr-overlay.visible) #demo-bar { visibility:hidden; }
  `;
  document.head.appendChild(style);
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  caption.setAttribute('role', 'status');
  document.body.appendChild(caption);
  const bar = document.createElement('nav');
  bar.id = 'demo-bar';
  bar.setAttribute('aria-label', 'Scene demo');
  bar.innerHTML = '<button type="button" id="demo-place">Another place</button>'
    + '<button type="button" id="demo-controls" aria-controls="ncv-panel" aria-expanded="false">Controls</button>'
    + '<button type="button" id="demo-share">Share scene</button>';
  document.body.appendChild(bar);
  let fadeTimer;
  function announce(text) {
    caption.textContent = text;
    caption.classList.remove('faded');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => caption.classList.add('faded'), 5500);
  }
  let lastPlace;
  window.addEventListener('ncv:state', ({ detail }) => {
    if (lastPlace !== detail.liveLocationName) {
      lastPlace = detail.liveLocationName;
      announce(`${lastPlace} · ${detail.simulationMode === 'live' ? 'Live scene' : 'Scene preview'}`);
    }
  });
  announce(`${env.liveLocationName} · Tap Another place to explore`);
  document.getElementById('demo-place').onclick = () => {
    const index = places.findIndex(p => Math.abs(p.lat - env.liveLocationLat) < 0.1);
    const place = places[(index + 1) % places.length];
    socket.emit('remote:command', { command: 'set_location', data: place });
    window._ncvEnableAudio?.();
  };
  const controls = document.getElementById('demo-controls');
  controls.onclick = () => window._ncvTogglePanel?.();
  new MutationObserver(() => {
    const open = !document.getElementById('ncv-panel').classList.contains('hidden');
    controls.textContent = open ? 'Close controls' : 'Controls';
    controls.setAttribute('aria-expanded', String(open));
  }).observe(document.getElementById('ncv-panel'), { attributes: true, attributeFilter: ['class'] });
  document.getElementById('demo-share').onclick = async () => {
    const url = new URL('index.html', location.href);
    const fields = { lat: 'liveLocationLat', lon: 'liveLocationLon', place: 'liveLocationName',
      tod: 'timeOfDay', weather: 'currentWeather', wind: 'windSpeed', cloud: 'cloudCover',
      season: 'season', trees: 'treeFrameDensity', skyOpen: 'treeSkyOpen', foliage: 'treeFoliageMass',
      branchLen: 'treeBranchReach', branchChaos: 'treeBranchChaos', edgeLush: 'canopyEdgeLushness', star: 'starBrightness' };
    for (const [param, key] of Object.entries(fields)) url.searchParams.set(param, String(env[key]));
    url.searchParams.set('demo', '1');
    try {
      if (navigator.share) await navigator.share({ title: 'Nature Canopy Vibes', url: url.href });
      else { await navigator.clipboard.writeText(url.href); announce('Scene link copied'); }
    } catch (error) {
      if (error.name !== 'AbortError') window.prompt('Copy this scene link:', url.href);
    }
  };
})();
