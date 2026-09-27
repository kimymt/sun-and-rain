// Prototype-only browser verification. Uses an existing Playwright installation.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const out=path.resolve(__dirname,'../docs/verification/ui-prototype-20260927');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const allowed={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js'};
  if(!allowed[name]){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname,allowed[name])));
});
(async()=>{
  let browser;
  const results=[],errors=[];
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true});
    for(const width of [320,390,768,1280]){
      const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<500});
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      const response=await page.goto(url);
      assert.equal(response.status(),200);
      await page.getByRole('heading',{name:'東京の、これから。'}).waitFor();
      const snapshot=await page.locator('body').ariaSnapshot();
      fs.writeFileSync(path.join(out,`initial-${width}.txt`),snapshot);
      assert(snapshot.includes('次の12時間'));
      assert.equal(await page.locator('#selected-heading').textContent(),'16–17時');
      await page.getByRole('button',{name:'次の時間'}).click();
      assert.equal(await page.locator('#selected-heading').textContent(),'17–18時');
      await page.getByRole('button',{name:'前の時間'}).click();
      assert.equal(await page.locator('#selected-heading').textContent(),'16–17時');
      const slider=page.getByRole('slider',{name:'表示する時間帯'});
      await slider.focus();await page.keyboard.press('Home');
      assert.equal(await page.locator('#selected-heading').textContent(),'10–11時');
      assert(await page.getByRole('button',{name:'前の時間'}).isDisabled());
      assert((await page.locator('.interval-note').textContent()).includes('全体の予報'));
      await page.keyboard.press('End');
      assert(await page.getByRole('button',{name:'次の時間'}).isDisabled());
      assert.equal(await page.locator('#selected-heading').textContent(),'22–23時');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('#selected-heading').textContent(),'21–22時');
      for(const scenario of ['rain','sun','night','missing','stale']){
        await page.getByLabel('表示例',{exact:true}).selectOption(scenario);
        assert.equal(await page.getByLabel('表示例',{exact:true}).inputValue(),scenario);
        if(scenario==='missing'){
          assert((await page.locator('#selection-content').textContent()).includes('データなし'));
          assert(await page.locator('[data-missing]').count()>0);
        }
        if(scenario==='night') assert((await page.locator('#period').textContent()).includes('翌日'));
        if(scenario==='stale') assert(await page.locator('#stale-notice').isVisible());
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
        assert.equal(overflow,false,`overflow ${width} ${scenario}`);
        await page.evaluate(()=>scrollTo(0,0));
        if(width===390 || scenario==='rain')await page.screenshot({path:path.join(out,`${scenario}-${width}.png`),fullPage:true});
        results.push({width,scenario,horizontalOverflow:false});
      }
      await page.getByLabel('表示例',{exact:true}).selectOption('rain');
      const plot=page.locator('.plot[data-metric="sun"]');
      await plot.scrollIntoViewIfNeeded();
      const rect=await plot.boundingBox();
      // 12:30 is the centre of the 12–13 interval in the 10:35–22:35 window.
      const targetX=rect.x+(2.5-35/60)/12*(rect.width-22);
      if(width<500)await page.touchscreen.tap(targetX,rect.y+20);
      else await page.mouse.click(targetX,rect.y+20);
      assert.equal(await page.locator('#selected-heading').textContent(),'12–13時');
      await page.getByText('数値の読み方',{exact:true}).click();
      assert(await page.getByText('は3時間の元予報を1時間間隔に補間した参考値です。',{exact:false}).isVisible());
      await page.getByText('時間別の数値を一覧で見る',{exact:true}).click();
      assert.equal(await page.locator('.hourly-entry').count(),13);
      assert(await page.locator('.hourly-entry').last().isVisible());
      // CSS font-size emulation, not iOS accessibility text-size verification.
      await page.addStyleTag({content:':root{font-size:32px!important}'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`font overflow ${width}`);
      if(width===320)await page.screenshot({path:path.join(out,'font-200-320.png'),fullPage:true});
      await context.close();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',browser:browser.version(),time:new Date().toISOString(),url,results,errors,checks:['real button clicks','range keyboard Home/End/ArrowLeft','chart click/tap','five scenarios','missing state','stale state','day boundary','13 interval list','no page overflow','CSS 200% font size'],unverified:['iPhone Safari','VoiceOver','OS text size','human five-second comprehension','API integration','PWA lifecycle']},null,2));
    console.log(`PASS: ${results.length} viewport/scenario pairs and interactions. ${out}`);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
