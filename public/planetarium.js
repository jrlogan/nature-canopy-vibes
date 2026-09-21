// Astronomy Engine supplies topocentric positions and changing illumination.
// The tour is deliberately local: opening it does not change a shared scene.
(function () {
  const RAD = Math.PI / 180;
  const names = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
  const colors = { Mercury: [205, 195, 180], Venus: [255, 242, 215], Mars: [242, 154, 111], Jupiter: [244, 224, 192], Saturn: [232, 215, 170] };
  let cacheKey = '', bodies = {}, open = false, selected = 'Moon';
  let moonCanvas = null, moonKey = '';
  let iss = null, satelliteStatus = 'Satellite tracking is off.', satelliteEnabled = false;
  let lastSatelliteFetch = 0;
  function time() {
    if (env.journeyActive) return new Date(env.journeyEpochMs);
    if (env.simulationMode === 'live') return new Date();
    // Manual hours are local scene time, approximated by longitude (solar time).
    const base = new Date(env.liveDateISO || Date.now());
    return new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate())
      + (Number(env.timeOfDay) || 0) * 3600000 - (Number(env.liveLocationLon) || 0) * 240000);
  }
  function project(alt, az) {
    const radius = Math.min(width, height) / 2 * (90 - alt) / 90;
    const angle = (az + (Number(env.skyAzimuthOffsetDeg) || 0)) * RAD;
    return { x: width / 2 + Math.sin(angle) * radius, y: height / 2 - Math.cos(angle) * radius };
  }
  function refresh() {
    const date = time();
    const key = [Math.floor(date.getTime() / 10000), env.liveLocationLat, env.liveLocationLon, env.skyAzimuthOffsetDeg, width, height].join('|');
    if (key === cacheKey) return;
    cacheKey = key;
    const observer = new Astronomy.Observer(Number(env.liveLocationLat) || 0, Number(env.liveLocationLon) || 0, 0);
    bodies = {};
    // Outside the engine's documented validation interval, preserve the old
    // ambient sky without presenting precise tour predictions.
    if (date.getUTCFullYear() < 1700 || date.getUTCFullYear() > 2200) return;
    for (const name of ['Sun', 'Moon', ...names]) {
      const eq = Astronomy.Equator(name, date, observer, true, true);
      const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
      const light = Astronomy.Illumination(name, date);
      bodies[name] = { name, supported: true, ...project(hor.altitude, hor.azimuth), visible: hor.altitude > 0,
        altDeg: hor.altitude, azDeg: hor.azimuth, mag: light.mag, illumination: light.phase_fraction,
        phase: name === 'Moon' ? Astronomy.MoonPhase(date) / 360 : 0, distanceAU: eq.dist };
    }
  }
  function body(name) { refresh(); return bodies[name] || { name, visible: false, altDeg: -90, phase: 0 }; }
  function drawMoon(moon, cloud) {
    const sun = body('Sun');
    const phase = moon.phase;
    const key = Math.round(phase * 1000);
    if (!moonCanvas || key !== moonKey) {
      moonKey = key;
      moonCanvas ||= document.createElement('canvas');
      moonCanvas.width = moonCanvas.height = 128;
      const ctx = moonCanvas.getContext('2d');
      const pixels = ctx.createImageData(128, 128);
      const litZ = -Math.cos(phase * Math.PI * 2);
      const litX = Math.sqrt(Math.max(0, 1 - litZ * litZ));
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const nx = (x - 63.5) / 63.5, ny = (y - 63.5) / 63.5;
        const rr = nx * nx + ny * ny;
        if (rr > 1) continue;
        const nz = Math.sqrt(1 - rr);
        const lighting = Math.max(0, nx * litX + nz * litZ);
        // Fixed procedural mare/crater variation; illustrative, not a lunar map.
        const maria = Math.max(0, Math.sin(nx * 8 + Math.sin(ny * 6)) * Math.cos(ny * 9 - nx * 3));
        const texture = 0.84 - maria * 0.25 + Math.sin(x * 2.7 + y * 1.9) * 0.04;
        const value = (12 + 235 * Math.pow(lighting, 0.45)) * texture;
        const i = (y * 128 + x) * 4;
        pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value * 0.98;
        pixels.data[i + 3] = Math.min(255, (1 - Math.sqrt(rr)) * 16000);
      }
      ctx.putImageData(pixels, 0, 0);
    }
    const diameter = Math.max(10, Math.min(width, height) * 0.028);
    const ctx = drawingContext;
    ctx.save();
    ctx.translate(moon.x, moon.y);
    // Bright limb faces the projected Sun, including when it is below horizon.
    ctx.rotate(Math.atan2(sun.y - moon.y, sun.x - moon.x));
    ctx.globalAlpha = (1 - cloud * 0.85) * (sun.visible ? 0.42 : 1);
    ctx.drawImage(moonCanvas, -diameter / 2, -diameter / 2, diameter, diameter);
    ctx.restore();
    if (open) label(moon);
  }
  function label(item) {
    push(); noFill(); stroke(185, 220, 255, 180); strokeWeight(1);
    circle(item.x, item.y, 25); noStroke(); fill(230, 242, 255); textSize(12); textAlign(LEFT, CENTER);
    text(item.name, Math.min(width - 75, item.x + 17), Math.max(14, item.y)); pop();
  }
  function drawPlanets(cloud) {
    const sun = body('Sun');
    for (const name of names) {
      const p = body(name);
      if (!p.visible || sun.altDeg > -3) continue;
      const moon = body('Moon');
      if (moon.visible && Math.hypot(p.x - moon.x, p.y - moon.y) < Math.max(5, Math.min(width, height) * 0.014)) continue;
      const alpha = 230 * (1 - cloud * 0.85) * Math.min(1, Math.max(0, (-sun.altDeg - 3) / 8));
      push(); noStroke(); fill(...colors[name], alpha);
      circle(p.x, p.y, Math.max(1.5, Math.min(5.5, 3.2 - p.mag * 0.55)));
      pop(); if (open) label(p);
    }
  }
  async function fetchSatellite() {
    if (Date.now() - lastSatelliteFetch < 3600000) return;
    lastSatelliteFetch = Date.now(); satelliteStatus = 'Loading current ISS orbit…';
    try {
      const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('Orbit service unavailable');
      const lines = (await response.text()).trim().split(/\r?\n/);
      const first = lines.find(l => l.startsWith('1 25544'));
      const second = lines.find(l => l.startsWith('2 25544'));
      if (!first || !second) throw Error('Invalid orbit data');
      iss = satellite.twoline2satrec(first, second);
      satelliteStatus = 'ISS tracking ready; only sunlit passes above your horizon are shown.';
    } catch (_) { satelliteStatus = 'ISS orbit data unavailable. No satellite is being simulated.'; }
    updateCard();
  }
  function drawSatellites() {
    if (!satelliteEnabled || !iss) return;
    const date = time();
    const epoch = (iss.jdsatepoch - 2440587.5) * 86400000;
    if (Math.abs(date.getTime() - Date.now()) > 86400000 * 3 || Math.abs(date.getTime() - epoch) > 86400000 * 3) {
      satelliteStatus = 'ISS hidden: current orbit data cannot predict this date.'; return;
    }
    const pv = satellite.propagate(iss, date);
    if (!pv?.position || !Number.isFinite(pv.position.x)) return;
    const observer = { latitude: env.liveLocationLat * RAD, longitude: env.liveLocationLon * RAD, height: 0 };
    const look = satellite.ecfToLookAngles(observer, satellite.eciToEcf(pv.position, satellite.gstime(date)));
    const sv = Astronomy.GeoVector('Sun', date, true);
    const length = Math.hypot(sv.x, sv.y, sv.z), r = pv.position;
    const along = (r.x * sv.x + r.y * sv.y + r.z * sv.z) / length;
    const shadow = along < 0 && Math.hypot(r.x, r.y, r.z) ** 2 - along ** 2 < 6378 ** 2;
    const visible = look.elevation > 0 && !shadow && body('Sun').altDeg < -4;
    satelliteStatus = visible ? 'ISS above the horizon now (predicted sunlit pass).' : 'No visible ISS pass at this time.';
    if (!visible) return;
    const point = project(look.elevation / RAD, look.azimuth / RAD);
    push(); noStroke(); fill(245, 247, 255, 230 * (1 - env.cloudCover)); circle(point.x, point.y, 3); pop();
    if (open) label({ name: 'ISS', ...point });
  }
  const descriptions = {
    Moon: 'Watch the boundary between lunar day and night. The phase follows the selected date, and the bright side faces the Sun. Surface texture is illustrative; the disc is enlarged for visibility.',
    Mercury: 'Mercury stays near the Sun in our sky. Look low in twilight when its geometry allows it. Like Venus, it has phases through a telescope.',
    Venus: 'Venus shines by reflected sunlight. Its brilliant cloud cover can make it the brightest planet, seen before sunrise or after sunset.',
    Mars: 'Mars has a warm orange tint. Its brightness changes markedly as the distance between Earth and Mars changes.',
    Jupiter: 'Jupiter is a bright, steady point to the unaided eye. Its cloud belts and four large Galilean moons become visible through optical magnification.',
    Saturn: 'Saturn looks like a pale golden point in the open sky. Its rings need a telescope; they should not look like a giant ring floating over the trees.',
    ISS: 'The space station crosses the sky as a moving, steady light. It is visible when sunlight reaches it while your sky is dark enough. Tracking uses current CelesTrak orbital elements and is disabled for historical dates.',
    History: 'Comets belong in a historical sky, but their paths must be calculated for each apparition. Halley returned in 1986; replaying 1066 needs a different historical orbit solution. This first tour does not invent comet positions. Historical comet rendering is not included yet.',
  };
  let panel, content, heading, narration, voiceSelect;
  function speak() {
    if (!narration?.checked || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(heading.textContent + '. ' + content.textContent);
    const voice = speechSynthesis.getVoices().find(v => v.voiceURI === voiceSelect.value);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.85;
    speechSynthesis.speak(utterance);
  }
  function updateCard() {
    if (!content || !open) return;
    heading.textContent = selected === 'History' ? 'Comets through history' : selected;
    let status = '';
    if (['Moon', ...names].includes(selected)) {
      const p = body(selected);
      status = !bodies[selected] ? 'Position unavailable outside 1700–2200. '
        : `${p.visible ? Math.round(p.altDeg) + '° above the horizon' : 'Below the horizon'} at ${env.liveLocationName}. `;
      if (selected === 'Moon' && bodies.Moon) status += `${Math.round(p.illumination * 100)}% illuminated. `;
    }
    if (selected === 'ISS') status = satelliteStatus + ' ';
    content.textContent = status + descriptions[selected];
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = `#planetarium-open{position:fixed;top:max(12px,env(safe-area-inset-top));right:12px;z-index:9500} #planetarium-panel{position:fixed;top:max(64px,env(safe-area-inset-top));right:12px;width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 190px);overflow:auto;padding:18px;background:#07131fee;color:#e7eef8;border:1px solid #8ebbd366;border-radius:14px;z-index:10001;font:15px/1.6 sans-serif} #planetarium-panel[hidden]{display:none} #planetarium-panel button,#planetarium-open{min-height:44px;border:1px solid #89aabb88;border-radius:12px;background:#13283dee;color:white;padding:8px 12px} #planetarium-panel select{max-width:100%;font-size:16px} #planetarium-panel p{margin:12px 0} body:has(#qr-overlay.visible) #planetarium-open{display:none}`;
    document.head.appendChild(style);
    const button = document.createElement('button'); button.id = 'planetarium-open'; button.textContent = 'Sky tour'; button.setAttribute('aria-expanded', 'false');
    panel = document.createElement('section'); panel.id = 'planetarium-panel'; panel.hidden = true;
    panel.innerHTML = '<h2 id="tour-heading"></h2><p id="tour-content"></p><div><button id="tour-back">Previous</button> <button id="tour-next">Next</button> <button id="tour-close">Close</button></div><p><label><input id="tour-satellite" type="checkbox"> Track the ISS</label></p><p><label><input id="tour-narration" type="checkbox"> Narration</label><br><select id="tour-voice" aria-label="Narration voice"></select></p>';
    document.body.append(button, panel);
    heading = document.getElementById('tour-heading'); content = document.getElementById('tour-content'); narration = document.getElementById('tour-narration'); voiceSelect = document.getElementById('tour-voice');
    const toggle = () => { open = !open; panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (!open) window.speechSynthesis?.cancel(); else { updateCard(); speak(); } };
    button.onclick = toggle; document.getElementById('tour-close').onclick = toggle;
    const steps = Object.keys(descriptions);
    function next(delta) { selected = steps[(steps.indexOf(selected) + delta + steps.length) % steps.length]; updateCard(); speak(); }
    document.getElementById('tour-next').onclick = () => next(1); document.getElementById('tour-back').onclick = () => next(-1);
    document.getElementById('tour-satellite').onchange = e => { satelliteEnabled = e.target.checked; if (satelliteEnabled) fetchSatellite(); else satelliteStatus = 'Satellite tracking is off.'; updateCard(); };
    narration.onchange = () => { if (narration.checked) speak(); else window.speechSynthesis?.cancel(); };
    function voices() {
      const options = window.speechSynthesis?.getVoices() || [];
      voiceSelect.replaceChildren(...options.map(v => new Option(v.name, v.voiceURI)));
      if (!options.length) voiceSelect.add(new Option('No narration voice available', ''));
      narration.disabled = !options.length;
      voiceSelect.disabled = !options.length;
      const english = options.find(v => v.lang.startsWith('en') && v.default) || options.find(v => v.lang.startsWith('en'));
      if (english) voiceSelect.value = english.voiceURI;
    }
    if ('speechSynthesis' in window) { voices(); speechSynthesis.addEventListener('voiceschanged', voices); } else { narration.disabled = true; voiceSelect.hidden = true; }
    voiceSelect.onchange = speak;
    setInterval(() => { if (open && typeof env !== 'undefined') updateCard(); }, 2000);
  }
  window.NCV_PLANETARIUM = { body, drawMoon, drawPlanets, drawSatellites, time };
  window.addEventListener('load', init);
})();
