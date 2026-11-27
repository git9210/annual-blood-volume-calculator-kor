// Real Chromium regression. Run with PLAYWRIGHT_MODULE pointing to playwright's index.mjs.
// Android storage is a test double; no device/Keystore claims are made here.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_RULES} from '../assets/engine.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../assets/',import.meta.url));
const evidence=process.env.PICKER_EVIDENCE_DIR;
if(evidence)await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html',path=resolve(root,name);
    if(!path.startsWith(root))throw Error('path');
    let body=await readFile(path);
    if(name==='app.mjs'){
      // Count calls without changing the calculation engine or shipping test hooks.
      const imports='assess,simulate,simulateChoices,earliestWithoutPlans';
      assert.ok(body.includes(imports),'engine imports changed; verify picker test instrumentation');
      body=body.toString().replace(imports,'assess,simulate,simulateChoices as originalChoices,earliestWithoutPlans')
        .replace("const ONBOARDING_KEY=","const simulateChoices=(...args)=>{window.__qa.calculations++;return originalChoices(...args);};\nconst ONBOARDING_KEY=")
        .replace('function render(){','function render(){window.__qa.renders++;')
        +'\nwindow.__pickerState=()=>({selected,calendarMonth,picker:calendarPicker?{...calendarPicker}:null,state:clone(state)});';
    }
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(path)]||'text/plain'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try{
  for(const theme of ['blood','pastel','initial'])for(const [width,height] of [[320,740],[360,800],[412,915],[768,1024],[760,460]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:1});
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
    const initial={version:1,rules:DEFAULT_RULES,complete:true,theme,startPage:'planner',appliedImports:[],
      records:[{id:'r1',date:'2026-10-22',type:'mixed'},{id:'r2',date:'2026-09-20',type:'plasma'}],
      plans:[{id:'p1',date:'2026-12-03',type:'plasma'},{id:'p2',date:'2026-12-24',type:'mixed'}],
      plannerSections:{plans:false,restrictions:false},dashboardSections:{recent:false},restrictions:[]};
    await page.addInitScript(seed=>{
      window.__qa={writes:0,renders:0,calculations:0};
      let vault=JSON.stringify({version:1,values:{'blood-note-v1':JSON.stringify(seed),'blood-note-onboarding-v1':'seen'}});
      window.BloodNoteAndroid={readSecureData:()=>JSON.stringify({ok:true,data:vault}),writeSecureData:text=>{window.__qa.writes++;vault=text;return JSON.stringify({ok:true});},clearLegacyStorage(){}};
    },initial);
    await page.goto(origin+'/index.html#planner');
    await page.waitForFunction(()=>!!window.__pickerState);
    const snapshot=()=>page.evaluate(()=>({view:window.__pickerState(),counts:{...window.__qa}}));
    const action=name=>page.locator(`[data-action="${name}"]`);
    const mode=name=>page.locator(`[data-action="calendar-picker-mode"][data-mode="${name}"]`).click();
    const part=value=>page.locator(`[data-action="calendar-picker-part"][data-part="${value}"]`).click();
    const open=async value=>{
      await action('calendar-date').click();
      assert.equal((await view()).picker.part,'month','every new dialog starts on month');
      assert.equal(await page.locator('[data-action="calendar-picker-part"][data-part="month"]').getAttribute('aria-pressed'),'true');
      if(value==='year')await part('year');
    };
    const waitClosed=()=>page.waitForFunction(()=>!document.querySelector('#dialog').open&&window.__pickerState().picker===null);
    const close=async()=>{await page.locator('#dialog .close').click();await waitClosed();};
    const apply=async()=>{await page.locator('#calendar-picker-apply').click();await waitClosed();};
    const goto=async date=>{await page.locator('#sim-date').fill(date);await page.locator('#sim-date').dispatchEvent('change');};
    const view=()=>page.evaluate(()=>window.__pickerState());
    assert.equal(await action('calendar-date').count(),1,'one full-date entry button');
    assert.equal(await action('calendar-year').count()+await action('calendar-month').count(),0,'no separate outside year/month buttons');
    await goto('2028-02-29');
    const original=await snapshot();
    await open('year');
    assert.equal(await page.locator('.calendar-picker-option').count(),300);
    const selected=await page.locator('.calendar-picker-option.is-selected').boundingBox(),list=await page.locator('.calendar-picker-list').boundingBox();
    assert.ok(selected.y>=list.y-1&&selected.y+selected.height<=list.y+list.height+1,'selected year visible');
    await page.locator('.calendar-picker-option[data-value="2027"]').click();
    const draft=await snapshot();assert.deepEqual(draft.counts,original.counts,'draft must not render/calculate/write');
    await apply();assert.equal((await view()).selected,'2027-02-28');
    assert.equal((await snapshot()).counts.renders,original.counts.renders+1,'one render when applied');
    assert.deepEqual((await view()).state,original.view.state);
    await open('month');await mode('scroll');
    assert.equal(await page.locator('.calendar-picker-option').count(),12);
    await page.locator('.calendar-picker-option[data-value="8"]').click();await apply();
    assert.equal((await view()).selected,'2027-08-28');
    await open('year');await mode('wheel');
    const wheel=page.locator('#calendar-picker-wheel');
    await wheel.press('Home');assert.equal(await wheel.getAttribute('aria-valuenow'),'1900');
    await wheel.press('End');assert.equal(await wheel.getAttribute('aria-valuenow'),'2199');
    await wheel.press('ArrowUp');assert.equal(await wheel.getAttribute('aria-valuenow'),'2198');
    await wheel.press('PageUp');assert.equal(await wheel.getAttribute('aria-valuenow'),'2188');
    if(width===412&&theme==='blood'){
      // Native browser wheel scrolling and a touch drag, not synthetic scroll events.
      await wheel.press('Home');await wheel.press('PageDown');
      await wheel.hover();await page.mouse.wheel(0,192);
      await page.waitForFunction(()=>Number(document.querySelector('#calendar-picker-wheel').getAttribute('aria-valuenow'))>1910);
      const beforeTouch=Number(await wheel.getAttribute('aria-valuenow')),box=await wheel.boundingBox(),cdp=await context.newCDPSession(page);
      const x=box.x+box.width/2,y=box.y+180;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*18}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForFunction(value=>Number(document.querySelector('#calendar-picker-wheel').getAttribute('aria-valuenow'))>value,beforeTouch);
      // Let native inertia/snap finish before the next independent scroll test.
      await wheel.evaluate(el=>new Promise(done=>{
        let timer;const settle=()=>{clearTimeout(timer);timer=setTimeout(()=>{el.removeEventListener('scroll',settle);done();},150);};
        el.addEventListener('scroll',settle);settle();
      }));
      assert.ok(await wheel.evaluate(el=>Math.abs(el.scrollTop/48-Math.round(el.scrollTop/48))<.01),'touch wheel snaps to a row');
      await cdp.detach();
    }
    await wheel.evaluate(el=>{el.scrollTop=(2032-1900)*48;});
    await page.waitForFunction(()=>document.querySelector('#calendar-picker-wheel').getAttribute('aria-valuenow')==='2032');
    await mode('number');assert.equal(await page.locator('#calendar-picker-number').inputValue(),'2032');
    const beforeInvalid=await snapshot();
    for(const bad of ['', '1899','2200','2e3','2.5','-1']){
      await page.locator('#calendar-picker-number').fill(bad);await page.locator('#calendar-picker-apply').click();
      assert.equal(await page.locator('#dialog').evaluate(el=>el.open),true);
      assert.equal(await page.locator('#calendar-picker-error').isVisible(),true);
      assert.deepEqual((await snapshot()).counts,beforeInvalid.counts);
    }
    await part('month');assert.equal((await view()).picker.part,'year','invalid numeric entry blocks changing parts');
    await mode('scroll');assert.equal((await view()).picker.mode,'number','invalid numeric entry blocks changing modes');
    assert.equal(await page.locator('#calendar-picker-error').isVisible(),true);
    await page.locator('#calendar-picker-number').fill('2028');await page.locator('#calendar-picker-number').press('Enter');
    assert.equal((await view()).selected,'2028-08-28');
    await open('month');await mode('wheel');
    await page.locator('#calendar-picker-wheel').evaluate(el=>{el.scrollTop=48;document.querySelector('#calendar-picker-form').requestSubmit();});
    await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    assert.equal((await view()).selected,'2028-02-28','apply reads wheel position even before scroll callback');
    await goto('2028-01-31');await open('month');await mode('number');
    for(const bad of ['', '0','13','1e1','1.5']){
      await page.locator('#calendar-picker-number').fill(bad);await page.locator('#calendar-picker-apply').click();
      assert.equal(await page.locator('#dialog').evaluate(el=>el.open),true);
    }
    await page.locator('#calendar-picker-number').fill('02');await apply();
    assert.equal((await view()).selected,'2028-02-29');
    // Cancel, X, Escape, backdrop and Android back all discard the draft.
    for(const dismissal of ['cancel','x','escape','backdrop','android']){
      await open('year');await mode('number');await page.locator('#calendar-picker-number').fill('2035');
      if(dismissal==='cancel')await page.locator('#calendar-picker-form [data-action="close-dialog"]').click();
      else if(dismissal==='x')await close();
      else if(dismissal==='escape')await page.keyboard.press('Escape');
      else if(dismissal==='backdrop')await page.mouse.click(2,2);
      else await page.evaluate(()=>window.bloodNoteHandleBack());
      await page.waitForFunction(()=>!document.querySelector('#dialog').open);
      assert.equal((await view()).selected,'2028-02-29');
      await page.waitForFunction(()=>document.activeElement?.dataset.action==='calendar-date');
    }
    const noop=await snapshot();await open('year');await apply();
    assert.deepEqual((await snapshot()).counts,noop.counts,'unchanged apply has no calculations or writes');
    // The two parts share a single draft and preserve the original day until apply.
    for(const method of ['scroll','wheel','number']){
      await goto('2026-01-31');const beforeCombined=await snapshot();
      await open('month');await mode(method);
      const choose=async (field,value)=>{
        await part(field);
        if(method==='scroll')await page.locator(`.calendar-picker-option[data-value="${value}"]`).click();
        else if(method==='wheel'){
          await page.locator('#calendar-picker-wheel').evaluate((el,{field,value})=>{el.scrollTop=(value-(field==='year'?1900:1))*48;},{field,value});
          await page.waitForFunction(value=>document.querySelector('#calendar-picker-wheel').getAttribute('aria-valuenow')===String(value),value);
        }else await page.locator('#calendar-picker-number').fill(String(value));
      };
      await choose('month',2);await choose('year',2028);
      await choose('month',3);await part('year');
      assert.equal((await view()).picker.value,2028,'year choice survives month changes');
      await part('month');assert.equal((await view()).picker.value,3,'month choice survives year changes');
      assert.equal(await page.locator('#calendar-picker-preview').innerText(),'2028년 3월로 이동');
      assert.deepEqual((await snapshot()).counts,beforeCombined.counts,'switching parts/modes only changes draft UI');
      assert.deepEqual((await view()).state,beforeCombined.view.state);
      await apply();assert.equal((await view()).selected,'2028-03-31','intermediate February must not trim day 31');
      assert.equal((await snapshot()).counts.renders,beforeCombined.counts.renders+1);
      assert.equal((await snapshot()).counts.writes,beforeCombined.counts.writes);
    }
    // A pending wheel frame is cancelled when the current year/month view changes.
    await open('month');await mode('wheel');
    await page.locator('#calendar-picker-wheel').evaluate(el=>{
      el.scrollTop=48;document.querySelector('[data-action="calendar-picker-part"][data-part="year"]').click();
    });
    assert.equal((await view()).picker.month,2);
    await part('month');assert.equal(await page.locator('#calendar-picker-wheel').getAttribute('aria-valuenow'),'2');
    await close();assert.equal((await view()).picker,null);
    // Range navigation and layout. No year/month selection adds a record or plan.
    await goto('1900-01-01');assert.equal(await action('calendar-prev').isDisabled(),true);
    await open('month');await mode('number');await close();
    await open('year');await page.locator('#calendar-picker-number').fill('2199');await apply();
    await open('month');await page.locator('#calendar-picker-number').fill('12');await apply();
    assert.equal((await view()).calendarMonth,'2199-12');assert.equal(await action('calendar-next').isDisabled(),true);
    assert.deepEqual((await view()).state,original.view.state);
    assert.equal((await snapshot()).counts.writes,original.counts.writes);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page horizontal overflow');
    // All modes must fit the dialog width; short landscape uses vertical scrolling.
    await goto('2026-11-15');await open('month');
    for(const p of ['month','year'])for(const m of ['scroll','wheel','number']){
      await part(p);await mode(m);
      assert.ok(await page.locator('#dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no dialog horizontal overflow');
      assert.ok(await page.locator('#dialog').evaluate(el=>el.getBoundingClientRect().height<=innerHeight),'dialog fits screen height');
      const contrast=await page.locator('.calendar-picker-modes [aria-pressed="true"]').evaluate(el=>{
        const linear=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
        const lum=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(linear).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const css=getComputedStyle(el),a=lum(css.color),b=lum(css.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(contrast>=4.5,`selected mode contrast ${contrast}`);
      const activePart=page.locator('.calendar-picker-parts [aria-pressed="true"]');
      assert.equal(await activePart.innerText(),p==='month'?'월':'연도');
      assert.ok(await activePart.evaluate(el=>el.getBoundingClientRect().height>=44),'header selector touch height');
      if(evidence&&width===412)await page.screenshot({path:resolve(evidence,`${theme}-${p}-${m}.png`),animations:'disabled'});
    }
    await close();
    // Open the selected date: existing preview toggle/deselection cannot double-count.
    await action('month-today').click();
    const current=(await view()).selected;
    await page.locator(`[data-calendar-date="${current}"]`).click();
    const initialPreview=await page.locator('#dialog-content').innerText();
    await action('day-type').filter({hasText:'혈장'}).first().click();
    await action('day-type').filter({hasText:'혈장'}).first().click();
    assert.equal(await page.locator('#dialog-content').innerText(),initialPreview);
    assert.deepEqual((await view()).state,original.view.state);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    results.push({theme,width,height,passed:true});console.log(`PASS: ${theme} ${width}×${height}`);
    await context.close();
  }
  if(evidence)await writeFile(resolve(evidence,'results.json'),JSON.stringify(results,null,2));
  console.log(`PASS: ${results.length} theme/viewport combinations; no extra writes or external requests.`);
}finally{await browser.close();await new Promise(done=>server.close(done));}
