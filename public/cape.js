// A small curated local replay, not an exhaustive launch schedule or trajectory model.
(() => {
  const launches = [
    {name:'Apollo 11 · Saturn V', utc:'1969-07-16T13:32:00Z', pad:'39A', lat:28.6084,lon:-80.6043, strength:1, source:'https://www.nasa.gov/history/apollo-11-mission-overview/'},
    {name:'STS-1 · Columbia', utc:'1981-04-12T12:00:03Z', pad:'39A', lat:28.6084,lon:-80.6043, strength:.8, source:'https://www.nasa.gov/mission/sts-1/'},
    {name:'Artemis I · SLS', utc:'2022-11-16T06:47:00Z', pad:'39B', lat:28.6272,lon:-80.6208, strength:1.1, source:'https://www.nasa.gov/humans-in-space/view-the-best-images-from-nasas-artemis-i-mission/'},
  ];
  // STS-1 was 7 a.m. EST: US daylight saving began April 26 in 1981.
  // Artemis time is minute precision, matching the cited NASA page.
  const viewing = {lat:28.62,lon:-80.80}; // approximate Titusville shoreline
  let active=false, paused=false, index=0, epoch=0, last=0, nextAt=0, section, badge;
  const $=id=>document.getElementById(id);
  function stop() { active=false; if(badge)badge.hidden=true; if($('cape-pause'))$('cape-pause').disabled=true; }
  function start(i=0) {
    index=i; active=true; paused=false; nextAt=0;
    epoch=Date.parse(launches[index].utc)-1800000; last=performance.now();
    $('experience-history').checked=false;
    $('experience-audio').pause();
    $('launch-stop').click();
    window.speechSynthesis?.cancel();
    $('cape-pause').disabled=false; $('cape-pause').textContent='Pause replay';
    badge.hidden=false; update();
  }
  function update() {
    const l=launches[index], sec=(epoch-Date.parse(l.utc))/1000;
    const text=`${l.name} · Pad ${l.pad} · ${new Date(epoch).toISOString().replace('T',' ').slice(0,19)} UTC · ${paused?'Paused':sec< -30?'120× approach':sec<0?'Countdown · 1×':sec<180?'Illustrative ascent · 6×':'Chapter complete'}`;
    $('cape-status').textContent=text; $('cape-caption').textContent=text;
    $('cape-source').href=l.source;
  }
  function tick() {
    if(!active)return;
    const now=performance.now(), dt=Math.min(100,now-last);last=now;
    const launch=Date.parse(launches[index].utc), sec=(epoch-launch)/1000;
    if(!paused) {
      const rate=sec < -30 ? 120 : sec < 0 ? 1 : 6;
      epoch+=dt*rate;
      if(sec < -30) epoch=Math.min(epoch,launch-30000);
      else if(sec < 0) epoch=Math.min(epoch,launch);
      if(epoch>=launch+180000){
        epoch=launch+180000;
        if(!nextAt)nextAt=now+4000;
        if(now>=nextAt){if(index<launches.length-1)start(index+1);else {paused=true;$('cape-pause').textContent='Replay finished';}}
      }
    }
    update();
  }
  function draw() {
    if(!active)return;
    const l=launches[index], t=(epoch-Date.parse(l.utc))/1000;
    if(t<0||t>=180)return;
    const rad=Math.PI/180, a=viewing.lat*rad,b=l.lat*rad,dl=(l.lon-viewing.lon)*rad;
    const bearing=Math.atan2(Math.sin(dl)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(dl))/rad;
    const u=t/180, alt=2+70*u*u, az=(bearing+20*u+(Number(env.skyAzimuthOffsetDeg)||0))*rad;
    const radius=Math.min(width,height)*.5*(90-alt)/90;
    const x=width/2+Math.sin(az)*radius,y=height/2-Math.cos(az)*radius;
    const size=Math.max(1,5*(1-u))*l.strength, opacity=Math.min(1,t/4,(180-t)/20);
    push();noStroke();
    for(let i=7;i>0;i--){fill(255,174,85,opacity*9);circle(x,y,size*i*2);}
    fill(255,193,104,210*opacity);ellipse(x,y+size*3,size*1.5,size*7);
    fill(255,249,229,255*opacity);circle(x,y,size*1.5);pop();
  }
  window.NCV_CAPE={date:()=>active?new Date(epoch):null,observer:()=>active?viewing:null,stop,draw,start:i=>start(Math.max(0,Math.min(2,Math.trunc(Number(i)||0))))};
  window.addEventListener('load',()=>{
    section=document.createElement('details');
    section.innerHTML='<summary>The Cape · three launch eras</summary><p>A silent sky replay from an approximate Titusville shoreline viewpoint: Apollo 11, Columbia’s first flight, then Artemis I.</p><p>Time flows at 120× toward each launch, slows for the countdown, then follows an illustrative ascent at 6×. The years between chapters are skipped.</p><p>Dates and pads are historical. Paths, glow and relative vehicle intensity are artistic—not telemetry. Trees and weather remain your configured environment.</p><div id="cape-choices"></div><p><button id="cape-pause" disabled>Pause replay</button> <button id="cape-stop">End replay</button></p><p id="cape-status" role="status">Choose a launch to begin; later chapters follow automatically.</p><a id="cape-source" target="_blank" rel="noopener">NASA mission source</a>';
    document.getElementById('experiences-panel').insertBefore(section,document.getElementById('experiences-panel').querySelector('details'));
    launches.forEach((l,i)=>{const b=document.createElement('button');b.textContent=l.name;b.onclick=()=>start(i);$('cape-choices').append(b);});
    $('cape-source').href=launches[0].source;
    $('cape-stop').onclick=()=>{stop();$('cape-status').textContent='Replay ended. Your original sky is restored.';};
    $('cape-pause').onclick=()=>{paused=!paused;nextAt=0;last=performance.now();$('cape-pause').textContent=paused?'Continue replay':'Pause replay';};
    badge=document.createElement('div');badge.hidden=true;badge.style.cssText='position:fixed;left:12px;bottom:100px;max-width:min(480px,calc(100vw - 48px));padding:10px;background:#07131fee;color:white;border-radius:10px;font:13px/1.5 sans-serif;z-index:9501;pointer-events:none';
    badge.innerHTML='<span id="cape-caption"></span>';document.body.append(badge);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&active){paused=true;$('cape-pause').textContent='Continue replay';}});
    setInterval(tick,33);
  });
})();
