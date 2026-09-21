const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try {
    const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.BASE_URL||'http://localhost:3091';
    await page.goto(base);await page.waitForFunction(()=>window._ncvDidFirstSync&&window.NCV_CONVERSATIONS);
    const result=await page.evaluate(()=>{
      const originalDt=window._ncvAnimDt;
      function simulate(dt) {
        randomSeed(42);const bird=new Bird(100,200,{x:800,y:200});
        for(let i=0;i<60/dt;i++){window._ncvAnimDt=dt;bird.update();}
        return {x:bird.x,y:bird.y,phase:bird.flapPhase};
      }
      const a=simulate(1),b=simulate(2);
      const rotations=[],oldRotate=window.rotate;
      window.rotate=angle=>rotations.push(angle);
      try {for(const [x,y] of [[1,0],[0,1],[-1,0],[0,-1]]){const bird=new Bird(0,0,null);bird.vel={x,y};bird._drawFlying(255);}} finally {window.rotate=oldRotate;}
      const departing=new Bird(width/2,height/2,null);departing._scatter();
      for(let i=0;i<2400&&!departing.shouldRemove;i++){window._ncvAnimDt=1;departing.update();}
      const swarm=new _MurmSwarm();swarm.boids=swarm.boids.slice(0,80);swarm._flock();
      const finite=swarm.boids.every(b=>Number.isFinite(b.ax)&&Number.isFinite(b.ay));
      window._ncvAnimDt=originalDt;
      const p=NCV_CONVERSATIONS.profile;
      const e={liveLocationLat:41,liveLocationName:'New Haven',treeFrameDensity:12,currentWeather:'clear'};
      return {a,b,rotations,departed:departing.shouldRemove,finite,profiles:[p(e,{isNight:false}),p(e,{isNight:true}),p({...e,liveLocationName:'Yellowstone'},{isNight:true}),p({...e,forceTreeless:true},{isNight:false})]};
    });
    assert(Math.abs(result.a.x-result.b.x)<1e-7);assert(Math.abs(result.a.y-result.b.y)<1e-7);
    assert(Math.abs(result.a.phase-result.b.phase)<1e-7);
    result.rotations.forEach((angle,i)=>assert(Math.abs(Math.cos(angle-Math.PI/2-[0,Math.PI/2,Math.PI,-Math.PI/2][i])-1)<1e-10));
    assert(result.departed);assert(result.finite);assert.deepEqual(result.profiles,['birds','owls','wolves','']);
    await page.mouse.click(100,100);await page.evaluate(()=>{_ncvEnableAudio();socket.emit('remote:command',{command:'wildlife_preview',data:{profile:'owls'}});});
    await page.waitForFunction(()=>NCV_CONVERSATIONS.state().current==='owls');
    const sound=await page.evaluate(()=>({state:atmosphere.audio.ctx.state,...NCV_CONVERSATIONS.state(),now:atmosphere.audio.ctx.currentTime}));
    assert.equal(sound.state,'running');assert(sound.end>sound.now);assert(sound.next>sound.end+30);
    await page.evaluate(()=>socket.emit('remote:command',{command:'set_env_values',data:{soundConversations:0}}));
    await page.waitForFunction(()=>NCV_CONVERSATIONS.state().current==='');
    assert.deepEqual(errors,[]);
    console.log('PASS: four flight headings, 30/60 Hz equivalence, departure, flock forces, habitat selection, stereo exchange scheduling, mute cancellation');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
