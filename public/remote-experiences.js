// Phone-only controls; the connected display renders the selected experience.
(() => {
  const section=document.createElement('section');section.className='panel';
  section.innerHTML=`<h2>Sky experiences</h2><p>Controls stay here. The connected display shows the sky.</p>
    <button data-sky-action="ambient">Stop experience · Ambient</button>
    <details><summary>Explore / telescope</summary><p>Learn at your own pace. Telescope imagery is illustrative.</p>
      <select id="remote-sky-body" aria-label="Celestial body">${['Moon','Mercury','Venus','Mars','Jupiter','Saturn','ISS','History'].map(n=>`<option>${n}</option>`).join('')}</select>
      <button data-sky-action="explore">Explore sky</button><button data-sky-action="telescope">Show telescope</button><button data-sky-action="telescope_close">Close telescope</button>
      <label><input id="remote-narration" type="checkbox"> Device-voice narration on display</label></details>
    <details><summary>The Cape · launch eras</summary><p>Historical dates and pads; illustrative ascent and intensity. Silent replay. Years between chapters are skipped.</p><div>
      <button data-cape="0">Apollo 11</button><button data-cape="1">Columbia · STS-1</button><button data-cape="2">Artemis I</button></div><button data-sky-action="cape_pause">Pause / continue Cape</button></details>
    <details><summary>Apollo 11 · listen</summary><p>NASA’s edited day-five highlights, about 61 minutes. Playback is on the display. If its browser blocks audio, tap the display once, then press Play here again.</p><button data-sky-action="apollo">Play archive</button><button data-sky-action="apollo_pause">Pause archive</button><label><input id="remote-apollo-sky" type="checkbox"> Hold sky at touchdown (your current location)</label><p>Not synchronized to edited audio. Weather is not historical.</p><a href="https://www.nasa.gov/history/apollo-11-audio-highlights/" target="_blank" rel="noopener">NASA archive source</a></details>
    <details><summary>Voyager · a message from Earth</summary><p>What sounds would you choose to represent life on Earth? The Sagan / Druyan recording is not included yet.</p><button data-sky-action="voyager">Show Golden Record cover</button></details>
    <details><summary>Artistic rocket launch</summary><label><input id="remote-launch-sound" type="checkbox"> Include synthesized roar</label><p>Start at low volume. This is not a historical trajectory.</p><button data-sky-action="launch">Start launch</button></details>
    <p id="remote-experience-status" role="status">No experience selected on this phone.</p>`;
  document.querySelector('main').insertBefore(section,document.querySelector('main > .panel'));
  const style=document.createElement('style');style.textContent='.panel details{margin:12px 0}.panel summary{padding:12px 0;cursor:pointer}.panel details button{margin:4px 2px;min-height:44px}.panel details select{max-width:100%;font-size:16px;padding:10px}.panel details label{display:block;margin:12px 0}.panel a{color:#a4d9ff}';document.head.append(style);
  function send(action,extra={}) {sendCommand('sky_experience','Experience: '+action,{action,...extra});document.getElementById('remote-experience-status').textContent='Sent: '+action.replaceAll('_',' ');}
  section.querySelectorAll('[data-sky-action]').forEach(b=>b.onclick=()=>send(b.dataset.skyAction,{body:document.getElementById('remote-sky-body').value,sound:document.getElementById('remote-launch-sound').checked}));
  section.querySelectorAll('[data-cape]').forEach(b=>b.onclick=()=>send('cape',{index:Number(b.dataset.cape)}));
  section.addEventListener('toggle',e=>{if(e.target.tagName==='DETAILS' && e.target.open) send('ambient');},true);
  document.getElementById('remote-sky-body').onchange=e=>send('body',{body:e.target.value});
  document.getElementById('remote-narration').onchange=e=>send('narration',{value:e.target.checked});
  document.getElementById('remote-apollo-sky').onchange=e=>send('apollo_sky',{value:e.target.checked});
  socket.on('sky:status',s=>{document.getElementById('remote-experience-status').textContent=String(s?.text||'');});
})();
