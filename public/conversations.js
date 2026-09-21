// Quiet procedural call-and-response sketches, not species-authentic recordings.
// The audio clock deliberately does not follow journey/time-lapse speed.
(() => {
  let next=0, key='', nodes=[], end=0, current='';
  const rand=(a,b)=>a+Math.random()*(b-a);
  const report=text=>window.NCV_EXPERIENCES?.report?.(text);
  function profile(e,sky) {
    const lat=Math.abs(Number(e.liveLocationLat)||0);
    if(e.forceTreeless || Number(e.treeFrameDensity)===0 || lat>67 || e.currentWeather==='storm') return '';
    if(sky.isNight) {
      // Restrict automatic wolf sketches to the named curated wilderness;
      // never infer wolves merely because a city is at a northern latitude.
      if(/yellowstone/i.test(e.liveLocationName||'')) return 'wolves';
      return lat>=24 && lat<=55 ? 'owls' : '';
    }
    return lat<24 ? 'tropical' : 'birds';
  }
  function cancel() {
    for(const n of nodes){try{n.stop();}catch(_){}try{n.disconnect();}catch(_){}}
    nodes=[];end=0;current='';
  }
  function exchange(owner,kind) {
    cancel();
    const ctx=owner.ctx, level=Math.max(0,Math.min(1,Number(env.soundConversations)||0));
    if(!level || !ctx || ctx.state!=='running') return false;
    current=kind;
    const start=ctx.currentTime+.03, side=Math.random()<.5?-1:1;
    const notes=kind==='wolves' ? [[0,3.7,310],[4.6,2.7,280]]
      : kind==='owls' ? [[0,.26,410],[.42,.28,410],[.9,.65,365]]
      : kind==='tropical' ? [[0,.24,1550],[.36,.32,1940],[.87,.22,1630],[1.18,.4,2100]]
      : [[0,.16,2450],[.28,.2,2920],[.64,.3,2580]];
    const duration=notes[notes.length-1][0]+notes[notes.length-1][1];
    const gap=kind==='wolves'?rand(2,4):rand(1.1,2.8);
    const voices=[{delay:0,pan:side*.65,pitch:rand(.96,1.04),gain:1},{delay:duration+gap,pan:-side*.75,pitch:rand(.84,.94),gain:.65}];
    const out=ctx.createGain(), filter=ctx.createBiquadFilter();
    out.gain.value=level*.16;filter.type='lowpass';filter.frequency.value=kind==='wolves'?1400:kind==='owls'?1700:5000;
    filter.connect(out);out.connect(owner.bus);nodes.push(filter,out);
    let last=start;
    for(const v of voices) {
      const pan=owner._panner(v.pan);pan.connect(filter);nodes.push(pan);
      for(const [offset,duration,freq] of notes) {
        const t=start+v.delay+offset,d=duration*rand(.94,1.06),f=freq*v.pitch;
        const osc=ctx.createOscillator(), gain=ctx.createGain();
        osc.type=kind==='owls'?'triangle':'sine';
        osc.frequency.setValueAtTime(f*.82,t);
        osc.frequency.exponentialRampToValueAtTime(f*(kind==='wolves'?1.28:1.15),t+d*.35);
        osc.frequency.exponentialRampToValueAtTime(f*.90,t+d);
        gain.gain.setValueAtTime(.0001,t);gain.gain.linearRampToValueAtTime(v.gain,t+Math.min(.25,d*.2));
        gain.gain.exponentialRampToValueAtTime(.0001,t+d);
        osc.connect(gain);gain.connect(pan);osc.start(t);osc.stop(t+d+.02);
        nodes.push(osc,gain);last=Math.max(last,t+d);
      }
    }
    end=last+.2;next=end+rand(35,90);
    // Avoid layering the old random solo calls over the paired exchange.
    owner.nextBird=owner.nextNightBird=millis()+(end-ctx.currentTime+4)*1000;
    return true;
  }
  function update(owner) {
    const now=owner.ctx.currentTime, kind=profile(env,NCV_SKY.phase());
    const nextKey=[env.liveLocationLat,env.liveLocationLon,kind].join('|');
    const blocked=env.sleeping || document.hidden || !env.soundConversations || !env.soundMaster || window.NCV_EXPERIENCES?.busy();
    if(nextKey!==key || blocked) {cancel();key=nextKey;next=now+rand(12,25);}
    if(blocked)return;
    if(end && now>end)cancel();
    if(kind && now>=next)exchange(owner,kind);
  }
  window.NCV_CONVERSATIONS={update,cancel,profile,state:()=>({current,end,next})};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  window.addEventListener('load',()=>{
    socket.on('remote:command',({command,data={}})=>{
      if(command!=='wildlife_preview')return;
      window._ncvEnableAudio?.();
      const owner=atmosphere?.audio;
      if(!owner?.ctx)return;
      if(owner.ctx.state!=='running') report('Tap the display once to enable sound, then preview again.');
      owner.ctx.resume().then(()=>{
        // Prime the location key so the next animation frame won't cancel it.
        key=[env.liveLocationLat,env.liveLocationLon,profile(env,NCV_SKY.phase())].join('|');
        const ok=exchange(owner,data.profile);
        report(ok?'Playing synthesized '+data.profile+' conversation (preview).':'Conversations muted. Raise their level and enable display audio.');
      }).catch(()=>report('Tap the display once to enable sound, then preview again.'));
    });
  });
})();
