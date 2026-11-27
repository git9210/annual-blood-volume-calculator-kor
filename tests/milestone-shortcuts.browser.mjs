import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_RULES,addDays,today,stats} from '../assets/engine.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../assets/',import.meta.url)),evidence=process.env.MILESTONE_EVIDENCE_DIR;
if(evidence)await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html',path=resolve(root,name);
    if(!path.startsWith(root))throw Error('path');
    let body=await readFile(path);
    if(name==='app.mjs')body=body.toString().replace('function render(){','function render(){window.qa.renders++;')
      +'\nwindow.qaData=()=>clone(state);';
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(path)]||'text/plain'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const configs=[[320,740],[360,800],[412,915],[768,1024],[1023,768],[1280,900],[760,460]];
const results=[];
try{
  for(const theme of ['initial','blood','pastel'])for(const [width,height] of configs){
    const ctx=await browser.newContext({viewport:{width,height},hasTouch:true}),p=await ctx.newPage();
    const errors=[],external=[],failed=[];
    p.on('pageerror',error=>errors.push(error.message));
    p.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
    await p.route('**/*',route=>{
      if(route.request().url().startsWith(origin+'/'))return route.continue();
      external.push(route.request().url());return route.abort();
    });
    const now=today(),records=Array.from({length:400},(_,i)=>({id:'r'+i,date:addDays('2017-01-01',i*6),type:i<100?'whole':'plasma'}));
    for(let i=0;i<4;i++)records[396+i]={id:'r'+(396+i),date:addDays(now,-56*(i+1)),type:'whole'};
    const seed={version:1,rules:DEFAULT_RULES,records,plans:[{id:'p',date:addDays(now,10),type:'plasma'}],complete:true,theme,appliedImports:[],displayOptions:{redConnectCalendar:true,redConnectPlan:true}};
    await p.addInitScript(seed=>{
      const KEY='qa-test-vault';
      window.qa={renders:0,writes:0,web:[],donation:[]};
      let vault=localStorage.getItem(KEY)||JSON.stringify({version:1,values:{'blood-note-v1':JSON.stringify(seed),'blood-note-onboarding-v1':'seen'}});
      window.BloodNoteAndroid={
        readSecureData:()=>JSON.stringify({ok:true,data:vault}),
        writeSecureData:value=>{if(window.qa.fail)throw Error('no space');window.qa.writes++;vault=value;localStorage.setItem(KEY,vault);return JSON.stringify({ok:true});},
        clearLegacyStorage(){},
        openLink:(...args)=>window.qa.web.push(args),
        requestDonationService:(...args)=>window.qa.donation.push(args)
      };
    },seed);
    await p.goto(origin+'/index.html#dashboard');
    await p.waitForFunction(()=>!!window.qaData);
    await p.waitForFunction(theme=>{
      const icon=document.getElementById('brand-icon');
      return icon.getAttribute('src')==='./brand-'+theme+'.webp'&&icon.complete&&icon.naturalWidth===144&&icon.naturalHeight===144;
    },theme);
    const action=name=>p.locator('[data-action="'+name+'"]');
    const shortcut=p.locator('.header-shortcuts');
    const popup=p.locator('#dialog');
    const badge=p.locator('#dashboard-milestone');
    const current=()=>badge.locator('.milestone-art').getAttribute('data-milestone-art');
    const pick=id=>p.locator('[data-action="pick-milestone"][data-id="'+id+'"]');
    const close=()=>p.waitForFunction(()=>!document.getElementById('dialog').open&&!document.getElementById('milestone-title'));
    const count=()=>p.evaluate(()=>({writes:qa.writes,renders:qa.renders}));
    const visibleHeader=await shortcut.locator('.header-shortcut').evaluateAll(items=>items.map(el=>({
      x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.offsetWidth,h:el.offsetHeight,
      label:el.getAttribute('aria-label'),font:parseFloat(getComputedStyle(el).fontSize)
    })));
    assert.deepEqual(visibleHeader.map(s=>s.label),['헌혈 예약하기','전자문진 · 인터넷 연결','봉사실적연계 · VMS 인터넷 연결']);
    assert.ok(visibleHeader.every(s=>s.y===visibleHeader[0].y&&s.w===44&&s.h===44));
    assert.ok(visibleHeader[0].x<visibleHeader[1].x&&visibleHeader[1].x<visibleHeader[2].x);
    assert.ok(visibleHeader[2].font<visibleHeader[1].font);
    const headerBox=await shortcut.boundingBox(),dateBox=await p.locator('#date-label').boundingBox();
    assert.ok(dateBox.x+dateBox.width<=headerBox.x,'date label does not overlap the shortcuts');
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    await p.waitForFunction(()=>document.querySelector('#dashboard-milestone img')?.naturalWidth===220);
    const loadedArt=()=>p.evaluate(()=>performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname).filter(path=>/^\/milestone-[a-z]+\.webp$/.test(path)));
    assert.deepEqual(await loadedArt(),['/milestone-house.webp'],'only the displayed badge was loaded');
    assert.equal(await current(),'house');
    const meter=await p.locator('.balance-card [role="meter"]').getAttribute('aria-valuenow');
    const target=Math.min(100,Math.max(0,stats(records,now,DEFAULT_RULES).used/DEFAULT_RULES.cap*100)).toFixed(1);
    assert.equal(meter,target);
    const remaining=await p.locator('.balance-number').innerText();
    const balanceBox=await p.locator('.balance-number').boundingBox(),artBox=await badge.boundingBox();
    assert.ok(balanceBox.x+balanceBox.width<=artBox.x,'art stays beside the remaining amount');
    const before=await count();
    if(evidence&&width===412)await p.screenshot({path:resolve(evidence,theme+'-dashboard.png'),animations:'disabled'});
    await badge.click();
    assert.equal(await popup.getAttribute('aria-labelledby'),'milestone-title');
    assert.equal(await p.locator('.milestone-choice').count(),6);
    assert.equal(await pick('auto').getAttribute('aria-pressed'),'true');
    assert.equal(await pick('none').getAttribute('aria-pressed'),'false');
    await p.waitForFunction(()=>[...document.querySelectorAll('#milestone-choices img')].every(img=>img.naturalWidth===220&&img.naturalHeight===220));
    assert.ok(await popup.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'gallery width');
    assert.deepEqual(await count(),before,'gallery opens without writes or full redraw');
    if(evidence&&width===412)await p.screenshot({path:resolve(evidence,theme+'-gallery.png'),animations:'disabled'});
    await pick('gold').click();await close();
    assert.equal(await current(),'gold');assert.equal(await p.locator('.balance-number').innerText(),remaining);
    assert.deepEqual(await count(),{writes:before.writes+1,renders:before.renders},'select saves once without redrawing the dashboard');
    assert.equal(await p.evaluate(()=>document.activeElement?.id),'dashboard-milestone');
    const selection=await p.evaluate(()=>qaData());assert.deepEqual(selection.records,records);assert.deepEqual(selection.plans,seed.plans);
    await p.reload();await p.waitForFunction(()=>!!window.qaData);assert.equal(await current(),'gold');
    await badge.click();await p.evaluate(()=>{qa.fail=true;});await pick('silver').click();
    assert.equal(await current(),'gold');assert.equal(await p.locator('#milestone-feedback').isVisible(),true);
    await p.evaluate(()=>{qa.fail=false;});await pick('auto').click();await close();assert.equal(await current(),'house');
    const beforeHide=await count();
    await badge.click();await pick('none').click();await close();
    assert.equal(await badge.count(),0);assert.equal(await p.locator('.balance-reading.has-milestone').count(),0);
    assert.equal(await p.locator('.balance-number').innerText(),remaining);
    assert.equal(await p.locator('.balance-card [role="meter"]').getAttribute('aria-valuenow'),meter);
    assert.equal(await p.evaluate(()=>document.activeElement?.id),'dashboard-balance-title');
    assert.deepEqual(await count(),{writes:beforeHide.writes+1,renders:beforeHide.renders},'hide does not rerender or recalculate the dashboard');
    await p.reload();await p.waitForFunction(()=>!!window.qaData);
    assert.equal(await badge.count(),0);assert.deepEqual(await loadedArt(),[]);
    await p.locator('#header-reservation').click();
    await p.locator('.questionnaire-link').click();await p.locator('.vms-shortcut').click();
    const handoffs=await p.evaluate(()=>({donation:qa.donation,links:qa.web}));
    assert.deepEqual(handoffs.donation,[['redconnect']]);
    assert.deepEqual(handoffs.links,[['https://emi.bloodinfo.net/emi4.do?lang=ko'],['https://www.vms.or.kr/auth/blood.do']]);
    await p.locator('.sidebar [data-page="planner"]').click();
    assert.equal(await p.locator('#app').getByRole('button',{name:'헌혈 예약하기'}).count(),0);
    assert.equal(await p.getByRole('button',{name:'월별 초안 만들기'}).count(),0);
    await action('month-today').click();
    await p.locator('[data-calendar-date="'+now+'"]').click();
    assert.equal(await popup.getByRole('button',{name:'헌혈 예약하기'}).count(),0);
    assert.ok(await popup.locator('[data-action="day-type"]').count()>0);
    await popup.getByRole('button',{name:'날짜 상세 닫기'}).click();
    await p.waitForFunction(()=>!document.getElementById('dialog-content').hasChildNodes());
    await p.locator('#settings-toggle').click();
    assert.equal(await p.getByText('헌혈 예약하기 · 캘린더',{exact:true}).count(),0);
    assert.equal(await p.getByText('헌혈 예약하기 · 장기 계획',{exact:true}).count(),0);
    assert.equal(await p.getByRole('heading',{name:'헌혈증명서 발급 연결'}).count(),1);
    const settingsBadge=p.locator('#settings-milestone');
    assert.match(await settingsBadge.innerText(),/표시 안 함/);
    const beforeRestoreArt=await count();
    await settingsBadge.click();assert.equal(await pick('none').getAttribute('aria-pressed'),'true');
    assert.equal(await p.locator('#milestone-choices [aria-pressed="true"]').count(),1);
    await pick('auto').click();await close();
    assert.equal(await p.evaluate(()=>document.activeElement?.id),'settings-milestone');
    assert.deepEqual(await count(),{writes:beforeRestoreArt.writes+1,renders:beforeRestoreArt.renders},'changing the setting preserves the current form');
    await p.locator('.sidebar button[data-page="dashboard"]').click();assert.equal(await current(),'house');
    const after=await p.evaluate(()=>qaData());assert.deepEqual(after.records,records);assert.deepEqual(after.plans,seed.plans);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
    results.push({theme,width,height,pass:true});console.log('PASS',theme,width,height);
    await ctx.close();
  }
  if(evidence)await writeFile(resolve(evidence,'results.json'),JSON.stringify(results));
}finally{await browser.close();await new Promise(done=>server.close(done));}
