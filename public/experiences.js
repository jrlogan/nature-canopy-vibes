// Local, opt-in layers over the shared environment. Never overwrite room settings.
(() => {
  let mode = 'ambient', audio, panel, launcher, historical, launchStart = null, roar;
  const landingStart = Date.parse('1969-07-20T20:17:40Z'); // Touchdown; highlights are edited, not a continuous clock.
  const $ = id => document.getElementById(id);
  function stopLaunch() {
    launchStart = null;
    if (roar) { const old = roar; roar = null; old.close().catch(() => {}); }
    if ($('launch-stop')) $('launch-stop').disabled = true;
  }
  function stop() {
    if ($('record-projection')) $('record-projection').hidden = true;
    window.NCV_CAPE?.stop();
    audio?.pause(); stopLaunch(); window.speechSynthesis?.cancel();
    if (historical) historical.checked = false;
  }
  function setMode(value) {
    stop(); mode = value;
    document.body.dataset.skyMode = mode;
    document.querySelectorAll('[data-sky-mode-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skyModeChoice === mode)));
    window.NCV_PLANETARIUM.setOpen(mode === 'explore');
    panel.hidden = mode !== 'experiences';
    launcher.textContent = mode === 'ambient' ? 'Sky · Ambient' : mode === 'explore' ? 'Sky · Explore' : 'Sky · Experiences';
    $('sky-modes').hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    $('telescope-view').hidden = true;
  }
  function date() {
    const capeDate = window.NCV_CAPE?.date();
    if (capeDate) return capeDate;
    if (mode !== 'experiences' || !historical?.checked) return null;
    return new Date(landingStart);
  }
  async function startLaunch() {
    window.NCV_CAPE?.stop();
    stopLaunch(); audio.pause(); window.speechSynthesis?.cancel();
    launchStart = performance.now(); $('launch-stop').disabled = false;
    $('launch-status').textContent = 'Launch running for 35 seconds. You can hide this panel or stop at any time.';
    if (!$('launch-sound').checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); roar = ctx;
      await ctx.resume();
      if (roar !== ctx) return;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const data = buffer.getChannelData(0); let smooth = 0;
      for (let i = 0; i < data.length; i++) { smooth = (smooth + (Math.random() * 2 - 1) * .04) / 1.04; data[i] = smooth * 6; }
      const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      noise.buffer = buffer; noise.loop = true; filter.type = 'lowpass'; filter.frequency.value = 420;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(.22, ctx.currentTime + 5);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 33);
      noise.connect(filter).connect(gain).connect(ctx.destination); noise.start(); noise.stop(ctx.currentTime + 35);
    } catch (_) { stopLaunch(); $('launch-status').textContent = 'Audio unavailable. Turn off launch sound to try a silent launch.'; }
  }
  function drawLaunch() {
    if (launchStart === null) return;
    const t = (performance.now() - launchStart) / 1000;
    if (t > 35) { stopLaunch(); $('launch-status').textContent = 'Launch complete.'; return; }
    const u = Math.min(1, t / 32), x = width * (.55 + .23 * u * u), y = height * (1.03 - 1.15 * u * u);
    const fade = Math.min(1, t / 3, (35 - t) / 5), size = Math.max(1.3, 5 * (1 - u));
    push(); noStroke();
    for (let i = 8; i > 0; i--) { fill(255, 157, 64, fade * 5); ellipse(x, y, size * i * 3, size * i * 4); }
    fill(255, 188, 89, 200 * fade); triangle(x - size, y, x + size, y, x - size * u, y + size * 8);
    fill(255, 249, 224, 255 * fade); ellipse(x, y, size, size * 3); pop();
  }
  function telescope() {
    const name = window.NCV_PLANETARIUM.selection();
    const p = window.NCV_PLANETARIUM.body(name), view = $('telescope-view');
    view.hidden = false;
    $('telescope-title').textContent = name + ' · illustrative telescope';
    const canvas = $('telescope-canvas'), ctx = canvas.getContext('2d'), n = 300, r = name === 'Saturn' ? 62 : 105;
    ctx.clearRect(0, 0, n, n); ctx.fillStyle = '#02060b'; ctx.fillRect(0, 0, n, n);
    if (!['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].includes(name)) {
      $('telescope-note').textContent = 'Choose the Moon or a planet using Previous / Next first.'; return;
    }
    if (!p.supported) { $('telescope-note').textContent = 'Date outside the supported 1700–2200 interval.'; return; }
    const ring = () => { ctx.save(); ctx.translate(150, 150); ctx.rotate(-.3); ctx.scale(1, .34); ctx.strokeStyle = '#c5b797'; ctx.lineWidth = 24; ctx.beginPath(); ctx.arc(0, 0, 111, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#514d42'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
    if (name === 'Saturn') ring();
    const base = {Moon:[190,190,184], Mercury:[173,162,144], Venus:[239,222,171], Mars:[204,112,73], Jupiter:[218,190,150], Saturn:[222,202,157]}[name];
    const pixels = ctx.getImageData(0, 0, n, n);
    const zLight = 2 * p.illumination - 1, xLight = Math.sqrt(Math.max(0, 1 - zLight * zLight)) * (name === 'Moon' && p.phase > .5 ? -1 : 1);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const xx = x/r, yy = y/r, rr = xx*xx + yy*yy; if (rr > 1) continue;
      const zz = Math.sqrt(1-rr), light = .035 + .965 * Math.pow(Math.max(0, xx*xLight + zz*zLight), .55);
      let texture = .94;
      if (name === 'Jupiter' || name === 'Saturn') texture = .82 + .14 * Math.sin(yy * 24 + Math.sin(xx * 8) * .3);
      if (name === 'Moon' || name === 'Mercury' || name === 'Mars') texture = .78 + .18 * Math.sin(xx*13 + Math.sin(yy*9)) * Math.cos(yy*17);
      const i = ((y+150)*n+x+150)*4;
      for (let c=0;c<3;c++) pixels.data[i+c] = base[c]*light*texture;
      pixels.data[i+3] = 255;
    }
    ctx.putImageData(pixels,0,0);
    if (name === 'Saturn') { ctx.save(); ctx.beginPath(); ctx.rect(0,150,300,150); ctx.clip(); ring(); ctx.restore(); }
    $('telescope-note').textContent = `${p.visible ? 'Above' : 'Below'} your horizon. Phase follows the scene date. Surface patterns and ring orientation are artistic, not a photographic or exact telescopic prediction.`;
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = `#planetarium-open{display:none!important} .sky-sheet{box-sizing:border-box;position:fixed;right:12px;top:68px;width:min(380px,calc(100vw - 24px));max-height:calc(100dvh - 170px);overflow:auto;overscroll-behavior:contain;padding:18px;border:1px solid #8ebbd366;border-radius:16px;background:#07131ff5;color:#e7eef8;font:15px/1.55 sans-serif;z-index:10002}.sky-sheet[hidden],#sky-modes[hidden]{display:none}.sky-sheet h2{margin:0 0 12px}.sky-sheet button,#sky-launcher,#sky-modes button{min-height:44px;padding:8px 12px;background:#142b3e;color:#eef6ff;border:1px solid #89aabb88;border-radius:10px;font:inherit;cursor:pointer}.sky-sheet button:disabled{opacity:.5}.sky-sheet a{color:#a4d9ff}.sky-sheet audio,.sky-sheet img,.sky-sheet canvas{width:100%;max-width:100%}.sky-sheet canvas{display:block;max-width:300px;margin:auto}.sky-sheet summary{cursor:pointer;padding:12px 0;font-weight:600}.sky-sheet label{display:block;margin:12px 0}.sky-sheet input{margin-right:8px}.sky-sheet small{display:block}#sky-launcher{position:fixed;right:12px;top:max(12px,env(safe-area-inset-top));z-index:10003;font:14px sans-serif}#sky-modes{position:fixed;right:12px;top:64px;z-index:10004;padding:10px;background:#07131ff5;border-radius:12px;max-width:calc(100vw - 24px);box-sizing:border-box}#sky-modes button{display:block;width:100%;text-align:left;margin:4px 0}#sky-modes button[aria-pressed=true]{border-color:#c1e3ad;background:#284438}body:has(#qr-overlay.visible) #sky-launcher,body:has(#qr-overlay.visible) .sky-sheet{display:none}#telescope-view{z-index:10005}`;
    document.head.append(style);
    launcher = document.createElement('button'); launcher.id='sky-launcher'; launcher.setAttribute('aria-controls','sky-modes');
    const modes = document.createElement('nav'); modes.id='sky-modes'; modes.hidden=true; modes.setAttribute('aria-label','Sky mode');
    modes.innerHTML='<button data-sky-mode-choice="ambient">Ambient · simply be here</button><button data-sky-mode-choice="explore">Explore · learn at your pace</button><button data-sky-mode-choice="experiences">Experiences · stories and sound</button>';
    panel=document.createElement('section'); panel.id='experiences-panel'; panel.className='sky-sheet'; panel.setAttribute('aria-label','Sky experiences');
    panel.innerHTML=`<h2>Experiences</h2><p>Choose a story, or just listen beneath the sky. Nothing plays automatically.</p><button id="experience-hide">Hide panel · keep listening</button>
      <details open><summary>Apollo 11 · the landing</summary><p>July 20, 1969. Original NASA day-five audio highlights, including the lunar landing. This is an edited archive, not a continuous real-time recording.</p><audio id="experience-audio" controls preload="none" aria-label="Apollo 11 landing archive"></audio><p id="audio-status" role="status"></p><label><input type="checkbox" id="experience-history">Show the sky at touchdown</label><small>Local viewing only. Holds July 20, 1969 at 20:17:40 UTC at your current location; the Moon may be below your horizon. Not synchronized to edited audio. Weather stays as configured, not historical. Ambient restores your normal clock.</small><p><a href="https://www.nasa.gov/history/apollo-11-audio-highlights/" target="_blank" rel="noopener">NASA audio source</a> · <a href="https://apolloinrealtime.org/11/" target="_blank" rel="noopener">Longer mission listening ↗</a></p></details>
      <details><summary>Voyager · a message from Earth</summary><p>Imagine choosing a small collection of sounds and images to represent life on Earth. What would you hope a stranger might understand about us?</p><p>A quiet, text-led reflection for now. The Carl Sagan / Ann Druyan archival conversation is not included until we identify the recording.</p><details><summary>Show the Golden Record cover</summary><img loading="lazy" src="https://science.nasa.gov/wp-content/uploads/2024/03/voyager-record-cover-446eb9.jpg" alt="Golden Record cover, engraved with playback instructions and diagrams"><small>NASA/JPL. The diagrams describe playback, a time reference, and the Sun’s location using pulsars.</small></details><p><a href="https://science.nasa.gov/mission/voyager/golden-record-cover/" target="_blank" rel="noopener">Read the cover with NASA</a></p></details>
      <details><summary>Launch · from Earth to the sky</summary><p>A 35-second artistic launch, not a reconstruction of a particular mission or trajectory. A warm light rises beyond the trees; no flashing effects.</p><label><input id="launch-sound" type="checkbox">Include synthesized rocket roar</label><p>Start with a low device volume.</p><button id="launch-start">Start launch</button> <button id="launch-stop" disabled>Stop launch</button><p id="launch-status" role="status"></p></details><p><button id="experience-exit">Return to Ambient · stop audio</button></p>`;
    const telescopePanel=document.createElement('section'); telescopePanel.id='telescope-view'; telescopePanel.className='sky-sheet'; telescopePanel.hidden=true;
    telescopePanel.innerHTML='<h2 id="telescope-title"></h2><canvas id="telescope-canvas" width="300" height="300" role="img" aria-label="Illustrative magnified celestial body"></canvas><p id="telescope-note"></p><button id="telescope-close">Back to Explore</button>';
    document.body.append(launcher,modes,panel,telescopePanel);
    audio=$('experience-audio'); historical=$('experience-history');
    audio.src='https://www.nasa.gov/wp-content/uploads/2015/03/Apollo-11_Day-05-Highlights.mp3'; audio.volume=.65;
    // NASA's legacy continuous-loop media links currently return 404. Use its
    // working day-five highlights, and explicitly avoid claiming synchronization.
    audio.addEventListener('error',()=>{$('audio-status').textContent='Archive audio could not load. Try the NASA source link below.';});
    audio.addEventListener('loadedmetadata',()=>{$('audio-status').textContent=`Original NASA archive · ${Math.round(audio.duration/60)} minutes. Silence and radio noise are part of the recording.`;});
    audio.addEventListener('play',()=>{window.NCV_CAPE?.stop(); stopLaunch(); window.speechSynthesis?.cancel();});
    historical.onchange = () => { if (historical.checked) window.NCV_CAPE?.stop(); };
    const flow = document.createElement('details');
    flow.innerHTML = '<summary>Watch time flow</summary><p>Watch the Sun and stars move continuously. These controls also work from the QR remote.</p><div id="display-flow"></div><p id="display-flow-status" role="status"></p>';
    panel.insertBefore(flow, panel.querySelector('details'));
    for (const [label,rate] of [['Rewind',-600],['Pause',0],['Gentle · 60×',60],['Flow · 600×',600],['Sweep · 3600×',3600],['Live time',null]]) {
      const b = document.createElement('button'); b.textContent=label;
      b.onclick=()=>{ window.NCV_CAPE?.stop(); historical.checked=false; socket.emit('remote:command',{command:rate===null?'journey_stop':'journey_set_rate',data:{rate}}); };
      $('display-flow').append(b);
    }
    setInterval(()=>{if(typeof env !== 'undefined') $('display-flow-status').textContent=env.journeyActive ? `${env.journeyRate === 0 ? 'Paused' : env.journeyRate+'×'} · ${NCV_PLANETARIUM.time().toLocaleString()} · weather not necessarily historical` : 'Normal scene time';},500);
    launcher.onclick=()=>{if(mode==='experiences' && panel.hidden){panel.hidden=false;return;} if(mode==='explore')window.NCV_PLANETARIUM.setOpen(true); modes.hidden=!modes.hidden;launcher.setAttribute('aria-expanded',String(!modes.hidden));};
    modes.querySelectorAll('button').forEach(b=>b.onclick=()=>setMode(b.dataset.skyModeChoice));
    $('experience-hide').onclick=()=>{panel.hidden=true;launcher.focus();};
    $('experience-exit').onclick=()=>{setMode('ambient');launcher.focus();};
    $('launch-start').onclick=startLaunch; $('launch-stop').onclick=()=>{stopLaunch();$('launch-status').textContent='Launch stopped.';};
    $('launch-sound').onchange=()=>{if(!$('launch-sound').checked && roar){roar.close().catch(()=>{});roar=null;}};
    const telescopeButton=document.createElement('button');telescopeButton.textContent='Look through telescope';telescopeButton.id='telescope-open';telescopeButton.onclick=telescope;
    $('planetarium-panel').append(telescopeButton);
    $('telescope-close').onclick=()=>{telescopePanel.hidden=true;telescopeButton.focus();};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){modes.hidden=true;launcher.setAttribute('aria-expanded','false');panel.hidden=true;telescopePanel.hidden=true;window.NCV_PLANETARIUM.setOpen(false);launcher.focus();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopLaunch();});
    window.addEventListener('pagehide',stop);
    const localMenus = new URLSearchParams(location.search).get('demo') === '1';
    if (!localMenus) {
      const clean=document.createElement('style');
      clean.textContent='#sky-launcher,#sky-modes,#experiences-panel,#planetarium-panel,#demo-bar,#demo-caption,#ncv-panel{display:none!important} #telescope-view{top:50%;left:50%;right:auto;transform:translate(-50%,-50%);max-height:90dvh} #telescope-view button{display:none!important}';
      document.head.append(clean);
      const pair=document.createElement('button');pair.id='display-pair';pair.textContent='Phone remote · QR';
      pair.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10004;padding:10px;border-radius:10px;background:#07131fbb;color:#dce7ed;border:1px solid #8ebbd344';
      pair.onclick=()=>showQRFallbackOverlay();document.body.append(pair);
    }
    const record=document.createElement('img');record.id='record-projection';record.hidden=true;
    record.src='https://science.nasa.gov/wp-content/uploads/2024/03/voyager-record-cover-446eb9.jpg';
    record.alt='Voyager Golden Record cover — NASA/JPL';
    record.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:75vw;max-height:80dvh;z-index:9500';
    document.body.append(record);
    let status='Ambient';
    function report(text) {status=text;socket.emit('sky:status',{text});}
    window.NCV_EXPERIENCES.report=report;
    socket.on('remote:command',payload=>{
      const command=payload?.command, data=payload?.data||{};
      if($('display-pair')) $('display-pair').hidden=true;
      if(command!=='sky_experience') {
        if(command && !['toggle_compass','set_compass_offset','toggle_sky_labels','toggle_labels','toggle_constellations'].includes(command)) {setMode('ambient');report('Ambient · previous experience stopped');}
        return;
      }
      const action=data.action;
      if(['ambient','explore','cape','voyager','launch','body','telescope'].includes(action)) setMode(action==='ambient'?'ambient':action==='explore'||action==='body'||action==='telescope'?'explore':'experiences');
      switch(action) {
        case 'cape': window.NCV_CAPE.start(data.index);break;
        case 'cape_pause': $('cape-pause').click();break;
        case 'apollo':
          { const keepDate=historical.checked;setMode('experiences');historical.checked=keepDate; }
          audio.play().catch(()=>report('Audio blocked or unavailable. Tap the display once, then press Play again.'));break;
        case 'apollo_pause': audio.pause();break;
        case 'apollo_sky':
          window.NCV_CAPE?.stop(); mode='experiences';historical.checked=!!data.value;break;
        case 'voyager': record.hidden=false;break;
        case 'launch': $('launch-sound').checked=!!data.sound;startLaunch();break;
        case 'body': case 'explore': window.NCV_PLANETARIUM.select(data.body || 'Moon');break;
        case 'telescope': window.NCV_PLANETARIUM.select(data.body || 'Moon');telescope();break;
        case 'telescope_close': $('telescope-view').hidden=true;break;
        case 'narration': narrationControl(!!data.value);break;
      }
      report(action==='ambient'?'Ambient · all experience playback stopped':'Selected: '+action.replaceAll('_',' '));
    });
    function narrationControl(value) {const check=$('tour-narration');check.checked=value;check.dispatchEvent(new Event('change'));}
    setInterval(()=>socket.emit('sky:status',{text:window.NCV_CAPE?.date() ? $('cape-status').textContent : mode==='explore' ? $('tour-heading').textContent+': '+$('tour-content').textContent : status}),1500);
    // Opening a different local experience also takes ownership of playback.
    panel.addEventListener('toggle',e=>{if(e.target.tagName==='DETAILS' && e.target.open && e.target.parentElement===panel) {stop();}},true);
    // Local location/mode edits (as well as remote commands) end local replays.
    let previousScene='';
    window.addEventListener('ncv:state',({detail})=>{const key=[detail.liveLocationLat,detail.liveLocationLon,detail.simulationMode].join('|');if(previousScene && key!==previousScene){setMode('ambient');report('Ambient · scene changed');}previousScene=key;});
    setMode('ambient');
  }
  window.NCV_EXPERIENCES={date,drawLaunch,busy:()=>!!(audio && !audio.paused) || launchStart!==null || !!window.NCV_CAPE?.date()};
  window.addEventListener('load',init);
})();
