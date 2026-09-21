const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}}),host=await context.newPage(),errors=[];
    host.on('pageerror',e=>errors.push(e.message));
    const base=process.env.BASE_URL||'http://localhost:3091';
    await host.goto(base);await host.waitForFunction(()=>window._ncvDidFirstSync&&window.NCV_CAPE);
    assert.equal(await host.locator('#sky-launcher').isVisible(),false);
    assert.equal(await host.locator('#experiences-panel').isVisible(),false);
    let remoteContext=context, room='';
    if(process.env.TEST_WEBRTC==='1') {
      await host.waitForFunction(()=>window.__webrtcHostId,null,{timeout:30000});
      room='?room='+encodeURIComponent(await host.evaluate(()=>window.__webrtcHostId));
      remoteContext=await browser.newContext({viewport:{width:390,height:844}});
    }
    const remote=await remoteContext.newPage();remote.on('pageerror',e=>errors.push(e.message));
    await remote.goto(base+'/remote.html'+room);
    await remote.waitForFunction(()=>document.getElementById('status').textContent.includes('Connected'),null,{timeout:30000});
    await remote.locator('summary').filter({hasText:'The Cape ·'}).click();
    await remote.click('[data-cape="2"]');await host.waitForFunction(()=>NCV_CAPE.date()!==null);
    assert.equal(await host.locator('#experiences-panel').isVisible(),false);
    await remote.click('[data-flow-rate="600"]');await host.waitForFunction(()=>NCV_CAPE.date()===null&&env.journeyRate===600);
    await remote.click('[data-cape="0"]');await host.waitForFunction(()=>NCV_CAPE.date()!==null);
    await remote.locator('summary').filter({hasText:'Voyager ·'}).click();await host.waitForFunction(()=>NCV_CAPE.date()===null);
    await remote.click('[data-sky-action="voyager"]');await host.waitForFunction(()=>!document.getElementById('record-projection').hidden);
    await remote.locator('summary').filter({hasText:'Explore /'}).click();
    await remote.selectOption('#remote-sky-body','Saturn');
    await remote.click('[data-sky-action="telescope"]');await host.waitForFunction(()=>!document.getElementById('telescope-view').hidden);
    assert.equal(await host.locator('#telescope-close').isVisible(),false);
    assert.equal(await host.locator('#planetarium-panel').isVisible(),false);
    await remote.click('[data-sky-action="ambient"]');await host.waitForFunction(()=>document.getElementById('telescope-view').hidden);
    await remote.click('[data-cape="1"]');await host.waitForFunction(()=>NCV_CAPE.date()!==null);
    await remote.click('.city-btn[data-name="New Haven, CT, USA"]');await host.waitForFunction(()=>NCV_CAPE.date()===null);
    assert.equal(await remote.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: phone-only menus, Cape cancellation on time/scene/experience changes, projected telescope/record, stop');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
