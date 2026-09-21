// Run against a static server or Node server with Playwright installed externally:
// BASE_URL=http://localhost:3091 PLAYWRIGHT_MODULE=/path/to/playwright node tests/sky-experiences.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox'] });
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.BASE_URL || 'http://localhost:3091';
    await page.goto(base);
    await page.waitForFunction(()=>window._ncvDidFirstSync && window.NCV_CAPE);
    const remote=await context.newPage();
    remote.on('pageerror',e=>errors.push(e.message));
    await remote.goto(base+'/remote.html');
    await remote.waitForTimeout(1500);
    await remote.click('[data-flow-rate="3600"]');
    await page.waitForFunction(()=>env.journeyActive && env.journeyRate===3600);
    const before=await page.evaluate(()=>({t:NCV_PLANETARIUM.time().getTime(),sun:NCV_PLANETARIUM.body('Sun').azDeg,lst:starField._getLST()}));
    await page.waitForTimeout(1800);
    const after=await page.evaluate(()=>({t:NCV_PLANETARIUM.time().getTime(),sun:NCV_PLANETARIUM.body('Sun').azDeg,lst:starField._getLST()}));
    assert(after.t-before.t>2000000,'clock advances continuously');
    assert.notEqual(after.sun,before.sun,'Sun moves'); assert.notEqual(after.lst,before.lst,'stars turn');
    await remote.click('[data-flow-rate="0"]');
    await page.waitForFunction(()=>env.journeyRate===0);
    const paused=await page.evaluate(()=>env.journeyEpochMs);
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(()=>env.journeyEpochMs),paused,'pause holds clock');
    await remote.click('[data-flow-rate="-600"]');
    await page.waitForTimeout(1300);
    assert((await page.evaluate(()=>env.journeyEpochMs))<paused,'rewind works');
    await remote.click('#flow-live');
    await page.waitForFunction(()=>!env.journeyActive);
    await page.click('#sky-launcher'); await page.click('[data-sky-mode-choice="explore"]');
    await page.click('#telescope-open'); assert(await page.locator('#telescope-view').isVisible());
    await page.click('#telescope-close'); await page.click('#sky-launcher');
    await page.click('[data-sky-mode-choice="experiences"]');
    await page.locator('summary').filter({hasText:'The Cape ·'}).click();
    await page.locator('#cape-choices button').nth(2).click();
    assert.equal(await page.evaluate(()=>NCV_PLANETARIUM.time().getUTCFullYear()),2022);
    assert.equal(await page.evaluate(()=>NCV_CAPE.observer().lat),28.62);
    await page.click('#cape-pause'); const held=await page.evaluate(()=>NCV_CAPE.date().getTime());
    await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>NCV_CAPE.date().getTime()),held);
    await page.click('#cape-stop');assert.equal(await page.evaluate(()=>NCV_CAPE.date()),null);
    await page.check('#experience-history'); assert.equal(await page.evaluate(()=>NCV_PLANETARIUM.time().getUTCFullYear()),1969);
    await page.click('#experience-exit'); assert.equal(await page.evaluate(()=>NCV_EXPERIENCES.date()),null);
    for(const width of [360,390,1280]) {
      await page.setViewportSize({width,height:720});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: remote time flow, Sun/stars, pause/rewind/live, telescope, Cape replay, restoration, responsive layout');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
