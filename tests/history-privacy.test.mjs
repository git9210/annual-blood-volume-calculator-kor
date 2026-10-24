import * as licenses from '../assets/licenses.mjs';
import * as backupCrypto from '../assets/backup-crypto.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as calendar from '../assets/calendar-view.mjs';
import * as screenLayout from '../assets/screen-layout.mjs';
import * as layoutDrag from '../assets/layout-drag.mjs';
import * as certificate from '../assets/certificate-import.mjs';
import {createHolidayStore,HOLIDAY_CACHE_KEY,HOLIDAY_URL} from '../assets/holidays.mjs';
import {HOLIDAY_SNAPSHOT} from '../assets/holiday-snapshot.mjs';

const assets=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',assets),'utf8').replace(/^import .*;\n/gm,'');
const fixture=count=>({version:1,rules:engine.clone(engine.DEFAULT_RULES),complete:true,plans:[],appliedImports:['kept-receipt'],
  records:Array.from({length:count},(_,i)=>({id:'record-'+i,date:engine.addDays('2020-01-01',i),type:['whole','mixed','plasma'][i%3]}))});
function harness(count=201,{savedState,date='2026-10-18',hash='#records'}={}){
  const initial=savedState??fixture(count),events={},elements=new Map(),prompts=[],finished=[],requests=[],exports=[],timers=new Map();let timerId=0,currentDate=date;
  let networkFailure=false,release=null;
  const node=key=>({innerHTML:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
    addEventListener:(event,fn)=>events[key+':'+event]=fn,removeEventListener(){},setAttribute(){},querySelectorAll:()=>[],
    scrollIntoView(){},focus(){},showModal(){this.open=true;},close(){this.open=false;events[key+':close']?.();}});
  for(const match of readFileSync(new URL('index.html',assets),'utf8').matchAll(/id="([^"]+)"/g))elements.set('#'+match[1],node('#'+match[1]));
  for(const key of ['#records-list','#record-page','#holiday-status','[data-action="refresh-holidays"]','#backup-current','#confirm-restore','#backup-password-form','#backup-password-status','#screen-widgets','#event-form','#event-feedback','#import-text','#save-import','#parse-import','#import-preview','#draft-start','#draft-months','#draft-preference','#draft-preview','#generate-draft','#save-draft'])elements.set(key,node(key));
  elements.get('#event-form').elements={date:{value:'2026-10-01'},type:{value:'plasma'}};
  elements.get('#draft-start').value='2026-11-01';elements.get('#draft-months').value='6';elements.get('#draft-preference').value='plasma';
  const form=elements.get('#backup-password-form');form.elements={password:{value:''},confirm:{value:''}};
  form.querySelector=()=>({disabled:false});form.reset=()=>{form.elements.password.value='';form.elements.confirm.value='';};
  const cache=new Map([['blood-note-v1',JSON.stringify(initial)]]);
  const storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)};
  const body={attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
  const document={body,querySelector:key=>elements.get(key)||null,querySelectorAll:()=>[],addEventListener:(event,fn,capture)=>events['document:'+event+(capture?':capture':'')]=fn,removeEventListener(){}};
  const window={localStorage:storage,matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener:(type,fn)=>events['window:'+type]=fn,removeEventListener(){},scrollTo(){},BloodNoteAndroid:{
    requestHolidayConsent:id=>prompts.push(id),finishHolidayRefresh:id=>finished.push(id),saveText:(name,mime,text)=>exports.push({name,mime,text})}};
  const payload=engine.clone(HOLIDAY_SNAPSHOT.years);payload[2026]['2026-10-20']=['임시공휴일 테스트'];
  const context=vm.createContext({...licenses,...backupCrypto,createProtectedStorage:({legacyStorage})=>legacyStorage,...engine,...calendar,...screenLayout,...layoutDrag,...certificate,today:()=>currentDate,
    createHolidayStore:opts=>createHolidayStore({...opts,fetcher:async(url,options)=>{
      requests.push({url,options});await new Promise(resolve=>release=resolve);
      if(networkFailure)throw Error('offline');return {ok:true,text:async()=>JSON.stringify(payload)};
    }}),window,document,localStorage:storage,navigator:{},URL,location:{hash,href:'https://appassets.androidplatform.net/assets/index.html'+hash,origin:'https://appassets.androidplatform.net'},crypto:webcrypto,
    setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {initial,events,elements,prompts,finished,requests,exports,window,run,storage,timers,body,
    setToday:value=>{currentDate=value;run('refreshLocalDay()');},
    relaunch:(hash='')=>harness(count,{savedState:JSON.parse(storage.getItem('blood-note-v1')),date:currentDate,hash}),
    html:()=>elements.get('#app').innerHTML,read:()=>JSON.parse(storage.getItem('blood-note-v1')),
    ids:()=>[...elements.get('#app').innerHTML.matchAll(/data-action="edit-record" data-id="([^"]+)"/g)].map(match=>match[1]),
    click:(action,data={})=>{const button={dataset:{action,...data},disabled:false};events['document:click']({target:{closest:selector=>selector==='[data-action]'?button:null},preventDefault(){}});},
    change:(id,value)=>events['#app:change']({target:{id,value,dataset:{}}}),
    theme:value=>events['#app:change']({target:{value,checked:true,matches:selector=>selector==='[data-theme-option]',dataset:{}}}),
    display:(key,checked)=>events['#app:change']({target:{id:'display-'+key,checked,dataset:{displayOption:key}}}),
    password:async(value,confirm=value)=>{form.elements.password.value=value;form.elements.confirm.value=confirm;await events['#backup-password-form:submit']({preventDefault(){}});},
    consent:(allowed,id=prompts.at(-1))=>window.bloodNoteHolidayConsent(id,allowed),
    release:async(fail=false)=>{networkFailure=fail;release();await new Promise(resolve=>setImmediate(resolve));}
  };
}

test('Calendar avoids unused eligibility work for past/completed/restricted cells, retaining labels and saved data',()=>{
  const initial={...fixture(0),records:[{id:'done',date:'2026-10-18',type:'platelet'}],
    plans:[{id:'past-plan',date:'2026-10-10',type:'plasma'},{id:'next-plan',date:'2026-10-25',type:'plasma'}],
    restrictions:[{id:'pause',start:'2026-10-20',end:'2026-10-21',reason:'薬 / test'}]};
  const h=harness(0,{savedState:initial,hash:'#records'}),before=h.read();
  h.run('let eligibilityCalls=0;const originalAvailability=availabilityForDate,originalSimulate=simulate;availabilityForDate=(...args)=>{eligibilityCalls+=4;return originalAvailability(...args);};simulate=(...args)=>{eligibilityCalls++;return originalSimulate(...args);};');
  const past=h.run("calendarHTML('month',calendarWindow('2026-09-01','month'))");
  assert.equal(h.run('eligibilityCalls'),0);assert.match(past,/>과거</);assert.doesNotMatch(past,/can-donate/);
  const current=h.run("calendarHTML('month',calendarWindow('2026-10-01','month'))");
  // Future cells 19 and 22–31 need eligibility; today's completed cell and 20–21 do not.
  assert.equal(h.run('eligibilityCalls'),44);
  assert.match(current,/data-calendar-date="2026-10-18"[^>]*highlighted-record/);
  assert.match(current,/completed-record[^>]*data-type="platelet"[^]*?<strong>완료<\/strong>/);
  assert.match(current,/data-calendar-date="2026-10-20"[^>]*manually-restricted/);
  assert.match(current,/data-calendar-date="2026-10-25"[^>]*planned/);
  assert.match(current,/chosen-plan[^>]*data-type="plasma"/);
  assert.deepEqual(h.read(),before);assert.equal(h.requests.length,0);
});
test('A restricted calendar date still calculates complete volume and reasons when its popup is opened',()=>{
  const initial={...fixture(0),records:[{id:'last',date:'2026-09-01',type:'whole'}],
    restrictions:[{id:'pause',start:'2026-10-20',end:'2026-10-21',reason:'약 복용'}]};
  const h=harness(0,{savedState:initial,hash:'#records'}),before=h.read();
  h.run('let eligibilityCalls=0;const originalAvailability=availabilityForDate;availabilityForDate=(...args)=>{eligibilityCalls++;return originalAvailability(...args);};');
  const cell=h.run("calendarHTML('month',{offset:0,dates:['2026-10-20']})");
  assert.equal(h.run('eligibilityCalls'),0);assert.equal((cell.match(/<strong>제한<\/strong>/g)||[]).length,4);
  h.click('day',{date:'2026-10-20'});h.click('day-type',{type:'plasma'});
  assert.ok(h.run('eligibilityCalls')>0);
  const popup=h.elements.get('#dialog-content').innerHTML;
  assert.match(popup,/계획 후 연간 계산량/);assert.match(popup,/475/);assert.match(popup,/1,685/);
  assert.match(popup,/약 복용/);assert.match(popup,/간격 필요/);
  assert.match(popup,/제한 있는 가정으로 저장/);assert.deepEqual(h.read(),before);assert.equal(h.requests.length,0);
});
test('Three offline themes save from the settings radio group and preserve all user data across relaunch',()=>{
  const h=harness(),before=h.read();
  assert.equal(h.body.attributes['data-theme'],'initial');assert.equal(h.read().theme,undefined);
  h.click('settings');
  assert.match(h.html(),/role="radiogroup" aria-labelledby="theme-title"/);
  assert.deepEqual([...h.html().matchAll(/data-theme-option value="([^"]+)"/g)].map(m=>m[1]),['blood','pastel','initial']);
  for(const theme of ['blood','pastel','initial']){
    h.theme(theme);assert.equal(h.body.attributes['data-theme'],theme);assert.equal(h.read().theme,theme);
    assert.match(h.html(),new RegExp(`data-theme-option value="${theme}" checked`));
    const stored=h.read();delete stored.theme;assert.deepEqual(stored,before);
    for(const page of ['dashboard','planner','records','settings']){h.click(page);assert.equal(h.body.attributes['data-theme'],theme);}
    const restarted=h.relaunch();assert.equal(restarted.body.attributes['data-theme'],theme);assert.deepEqual(restarted.read(),h.read());
  }
  assert.equal(h.requests.length,0);
});
test('Theme input is allowlisted; failed writes and demo mode preserve the saved theme',()=>{
  const h=harness();h.theme('blood');const before=h.read();
  for(const theme of ['__proto__','constructor','<img src=x>',null,{},['blood']]){
    h.theme(theme);assert.deepEqual(h.read(),before);assert.equal(h.body.attributes['data-theme'],'blood');
  }
  h.storage.setItem=()=>{throw Error('full');};h.theme('pastel');
  assert.deepEqual(h.read(),before);assert.equal(h.body.attributes['data-theme'],'blood');
  const demo=h.relaunch();demo.click('demo');demo.click('settings');
  assert.match(demo.html(),/data-theme-option value="blood" checked disabled/);
  demo.theme('pastel');assert.deepEqual(demo.read(),before);assert.equal(demo.body.attributes['data-theme'],'blood');
  demo.click('demo');assert.equal(demo.body.attributes['data-theme'],'blood');
  assert.equal(demo.requests.length,0);
});
test('Theme is included in encrypted backups; old or invalid-theme backups keep the current choice',async()=>{
  const h=harness();h.theme('pastel');const before=h.read();
  h.click('export-backup');await h.password('theme-backup-test');
  const encrypted=JSON.parse(h.exports.at(-1).text),restored=await backupCrypto.decryptBackup(encrypted,'theme-backup-test');
  assert.equal(JSON.parse(restored).theme,'pastel');
  h.theme('blood');h.run(`confirmBackupRestore(validateState(${restored}))`);h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),before);assert.equal(h.body.attributes['data-theme'],'pastel');
  for(const value of [undefined,'invalid','__proto__',[]]){
    const backup={...before};if(value===undefined)delete backup.theme;else backup.theme=value;
    h.run(`confirmBackupRestore(validateState(${JSON.stringify(backup)}))`);h.elements.get('#confirm-restore').onclick();
    assert.deepEqual(h.read(),before);assert.equal(h.body.attributes['data-theme'],'pastel');
  }
  assert.equal(h.requests.length,0);
});
test('Blood red becomes progressively darker from 39 to 430 mL and every shade has readable text',()=>{
  const h=harness();
  const luminance=rgb=>rgb.map(v=>v/255).reduce((sum,v,i)=>sum+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4),0);
  const parse=color=>color.startsWith('rgb')?color.match(/\d+/g).map(Number):color.slice(1).match(/../g).map(v=>parseInt(v,16));
  let previous=1,minimum=Infinity;
  for(let remaining=39;remaining<=430;remaining+=.25){
    const palette=h.run(`bloodBalancePalette(${remaining})`),background=luminance(parse(palette.surface)),foreground=luminance(parse(palette.ink));
    assert.ok(background<=previous,`Intensity must increase at ${remaining} mL`);previous=background;
    const contrast=(Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05);
    minimum=Math.min(minimum,contrast);assert.ok(contrast>=4.5,`Contrast ${contrast} at ${remaining} mL`);
  }
  assert.equal(h.run('bloodBalancePalette(39).surface'),'rgb(255,240,238)');
  assert.equal(h.run('bloodBalancePalette(430).surface'),'rgb(177,37,66)');
  assert.equal(h.run('bloodBalancePalette(-100).surface'),h.run('bloodBalancePalette(39).surface'));
  assert.equal(h.run('bloodBalancePalette(2160).surface'),h.run('bloodBalancePalette(430).surface'));
  assert.equal(h.run('bloodBalancePalette(NaN).surface'),h.run('bloodBalancePalette(39).surface'));
  h.click('dashboard');h.theme('blood');assert.match(h.html(),/--balance-surface:rgb\(/);
  const saved=h.read();h.display('balanceHighlight',false);assert.doesNotMatch(h.html(),/--balance-surface:rgb\(|class="balance-status"/);
  h.display('balanceHighlight',true);assert.match(h.html(),/--balance-surface:rgb\(/);assert.deepEqual(h.read().rules,saved.rules);
  assert.deepEqual(h.read().records,saved.records);assert.equal(h.requests.length,0);
});
test('Changing themes keeps calendar status, restrictions, completed markers and layout preferences intact',()=>{
  const savedState={...fixture(0),records:[{id:'recent',date:'2026-10-01',type:'plasma'}],plans:[{id:'future',date:'2026-10-26',type:'plasma'}],
    restrictions:[{id:'pause',start:'2026-10-20',end:'2026-10-21',reason:'薬 / test'}],screenHidden:{dashboard:['recent']},screenLayouts:{planner:['plans','calendar','restrictions','annual']}};
  const h=harness(0,{savedState,hash:'#planner'}),baseline=h.html();
  assert.match(baseline,/highlighted-record/);assert.match(baseline,/manually-restricted/);
  for(const theme of ['blood','pastel','initial']){
    h.theme(theme);assert.equal(h.html(),baseline);
    h.click('dashboard');assert.doesNotMatch(h.html(),/data-layout-id="recent"/);
    h.click('planner');assert.equal(h.html(),baseline);
    const persisted=h.read();delete persisted.theme;assert.deepEqual(persisted,savedState);
  }
  assert.equal(h.requests.length,0);
});
test('Dashboard always uses today after relaunch and Korean midnight, without changing records or using network',()=>{
  const h=harness();h.click('dashboard');const saved=h.read();
  assert.doesNotMatch(h.html(),/anchor-mode|anchor-date|dashboard-controls|잔여량 계산 기준일/);
  assert.equal(h.run('anchorDate()'),'2026-10-18');
  h.run("Date.now=()=>Date.parse('2026-10-18T14:59:59.000Z');refreshLocalDay()");
  assert.equal(h.timers.get(h.run('dayRefreshTimer')).delay,1100);
  let reopened=h.relaunch();reopened.click('dashboard');
  assert.equal(reopened.run('anchorDate()'),'2026-10-18');
  reopened.setToday('2026-10-19');assert.equal(reopened.run('anchorDate()'),'2026-10-19');
  assert.doesNotMatch(reopened.html(),/2026\. 10\. 19\. 월요일 기준/);
  assert.match(reopened.html(),/2025-10-20 ~ 2026-10-19/);
  assert.equal(reopened.elements.get('#date-label').textContent,'2026. 10. 19. 월요일');
  reopened.click('settings');reopened.setToday('2026-10-20');
  assert.equal(reopened.elements.get('#date-label').textContent,'2026. 10. 20. 화요일');
  reopened=reopened.relaunch();assert.equal(reopened.run('anchorDate()'),'2026-10-20');
  assert.deepEqual(reopened.read(),saved);assert.equal(h.requests.length+reopened.requests.length,0);
});

test('Previously saved last/custom choices cannot change the today balance or the independent planning date',()=>{
  for(const mode of ['last','custom','today']){
    const initial={...fixture(0),calculationAnchor:{mode,customDate:'2025-06-07'},
      records:[{id:'expired',date:'2025-10-01',type:'whole'},{id:'recent',date:'2026-09-01',type:'mixed'}],
      plans:[{id:'future',date:'2026-10-30',type:'plasma'}]};
    const h=harness(0,{savedState:initial});h.click('dashboard');
    assert.equal(h.run('anchorDate()'),'2026-10-18');assert.match(h.html(),/누적 90mL/);
    assert.match(h.html(),/2,070<span>mL/);assert.match(h.html(),/2025-10-19 ~ 2026-10-18/);
    assert.doesNotMatch(h.html(),/anchor-mode|anchor-date/);assert.deepEqual(h.read(),initial);
    h.click('planner');h.change('sim-date','2027-02-01');assert.equal(h.run('selected'),'2027-02-01');
    h.click('dashboard');assert.equal(h.run('anchorDate()'),'2026-10-18');assert.match(h.html(),/누적 90mL/);
    assert.deepEqual(h.read(),initial);assert.equal(h.requests.length,0);
  }
});

test('Missing or invalid legacy preferences never block today calculations or lose donation data',()=>{
  const h=harness(2);assert.deepEqual(h.read(),h.initial);assert.equal(h.run('anchorDate()'),'2026-10-18');
  for(const calculationAnchor of [null,[],{mode:'invalid',customDate:'2026-02-30'}]){
    const loaded=harness(2,{savedState:{...h.initial,calculationAnchor}});
    assert.equal(loaded.run('anchorDate()'),'2026-10-18');assert.deepEqual(loaded.read().records,h.initial.records);
    assert.equal(loaded.run('storageFailed'),false);
  }
  h.change('anchor-mode','custom');h.change('anchor-date','2025-06-07');
  assert.equal(h.run('anchorDate()'),'2026-10-18');assert.deepEqual(h.read(),h.initial);
});

test('Failed record writes preserve history while the today header and balance remain available',()=>{
  const h=harness(2);h.click('dashboard');const saved=h.read();
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('Storage full');};
  h.click('delete-record',{id:'record-0'});assert.deepEqual(h.read(),saved);
  assert.equal(h.run('anchorDate()'),'2026-10-18');assert.match(h.elements.get('#toast').innerHTML,/저장하지 못했습니다/);
  h.storage.setItem=write;h.setToday('2026-10-19');
  assert.equal(h.elements.get('#date-label').textContent,'2026. 10. 19. 월요일');
  assert.deepEqual(h.read(),saved);
});

test('Demo, record editing and undo keep the today reference and preserve the real saved data',()=>{
  const initial={...fixture(2),calculationAnchor:{mode:'custom',customDate:'2025-06-07'}};
  const h=harness(2,{savedState:initial});const saved=h.read();
  h.click('demo');assert.equal(h.run('anchorDate()'),'2026-10-18');assert.deepEqual(h.read(),saved);
  h.click('demo');assert.equal(h.run('anchorDate()'),'2026-10-18');
  h.click('delete-record',{id:'record-0'});h.run('undoAction()');
  assert.deepEqual(h.read(),saved);assert.equal(h.relaunch().run('anchorDate()'),'2026-10-18');
});

test('Encrypted and legacy backups restore records while previous date preferences remain inactive',async()=>{
  const initial={...fixture(2),calculationAnchor:{mode:'custom',customDate:'2025-06-07'}};
  const h=harness(2,{savedState:initial});h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password')),initial);
  h.click('delete-record',{id:'record-0'});
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),initial);assert.equal(h.relaunch().run('anchorDate()'),'2026-10-18');
  h.run('undoAction()');assert.equal(h.read().records.length,1);assert.equal(h.run('anchorDate()'),'2026-10-18');
  const legacy=fixture(2);
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(JSON.stringify(legacy))}})`);
  h.elements.get('#confirm-restore').onclick();assert.equal(h.relaunch().run('anchorDate()'),'2026-10-18');
  assert.deepEqual(h.read().records,legacy.records);assert.equal(h.requests.length,0);
});

test('Restriction reasons/dates survive encrypted export, restoration and relaunch with existing settings and records',async()=>{
  const saved={...fixture(4),startPage:'planner',displayOptions:{redConnectCalendar:false,balanceHighlight:false},restrictions:[{id:'restriction',start:'2026-10-23',end:'2026-11-05',reason:'약 / 药 & <b>café</b> № 2'}]};
  const h=harness(0,{savedState:saved});h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;assert.doesNotMatch(encrypted,/café|药|2026-10-23/);
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password')),saved);
  h.run('change(()=>{state.restrictions=[];})');assert.deepEqual(h.read().restrictions,[]);
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');assert.match(h.elements.get('#dialog-content').innerHTML,/헌혈 제한 기간 <strong>1건/);
  h.elements.get('#confirm-restore').onclick();assert.deepEqual(h.read(),saved);assert.deepEqual(h.relaunch().read(),saved);
  h.click('demo');h.run("change(()=>{state.restrictions=[{id:'demo',start:'2026-10-01',end:'2026-10-02',reason:''}];})");
  assert.deepEqual(h.read(),saved);h.click('demo');assert.deepEqual(h.read(),saved);assert.equal(h.requests.length,0);
});

test('201 records are reachable once across 41 pages of five; paging and filtering never change saved history',()=>{
  const h=harness(),seen=[];
  assert.match(h.html(),/1 \/ 41 페이지/);
  assert.match(h.html(),/data-action="records-prev" disabled/);
  for(let page=0;page<41;page++){
    const ids=h.ids();assert.equal(ids.length,page===40?1:5);seen.push(...ids);
    h.click('records-next');
  }
  assert.deepEqual(seen,[...h.initial.records].reverse().map(row=>row.id));
  assert.match(h.html(),/data-action="records-next" disabled/);
  assert.equal(h.run('recordPageIndex'),40);
  h.change('record-filter','plasma');
  assert.equal(h.run('recordPageIndex'),0);assert.equal(h.ids().length,5);
  assert.match(h.html(),/선택한 종류 67건 중 1–5건/);
  h.change('record-page','13');assert.equal(h.ids().length,2);
  h.change('record-filter','all');assert.equal(h.run('recordPageIndex'),0);
  h.click('records-prev');assert.equal(h.run('recordPageIndex'),0);
  h.change('record-page','NaN');assert.equal(h.run('recordPageIndex'),0);
  assert.deepEqual(h.read(),h.initial);assert.equal(h.requests.length,0);
});

test('Deleting the final page clamps navigation, undo restores data, and removed export controls stay absent',()=>{
  const h=harness();h.change('record-page','40');h.click('delete-record',{id:'record-0'});
  assert.equal(h.run('recordPageIndex'),39);assert.equal(h.ids().length,5);
  assert.equal(h.read().records.length,200);assert.ok(!h.read().records.some(row=>row.id==='record-0'));
  h.run('undoAction()');assert.deepEqual(h.read(),h.initial);
  assert.doesNotMatch(h.html(),/export-csv|CSV 저장/);h.click('planner');
  assert.doesNotMatch(h.html(),/export-calendar|휴대폰 달력용 파일/);
  assert.deepEqual(h.read(),h.initial);
  assert.equal(h.requests.length,0);
});

test('Empty and exact-five lists stay bounded; restoration resets the page without seeding extra history',async()=>{
  const empty=harness(0);assert.equal(empty.ids().length,0);assert.doesNotMatch(empty.html(),/id="record-page"/);
  const five=harness(5);assert.equal(five.ids().length,5);assert.match(five.html(),/1 \/ 1 페이지/);
  assert.match(five.html(),/data-action="records-next" disabled/);
  const h=harness();h.change('record-page','40');
  await h.run('restoreBackup({size:100,text:async()=>JSON.stringify({...state,records:state.records.slice(0,3)})})');
  h.elements.get('#confirm-restore').onclick();
  assert.equal(h.run('recordPageIndex'),0);assert.equal(h.ids().length,3);assert.equal(h.read().records.length,3);
});

test('Decorative headings and date selector disappear while today and settings remain available',()=>{
  const h=harness(0);
  for(const page of ['dashboard','planner','records']){
    h.click(page);
    assert.doesNotMatch(h.html(),/MY DONATION JOURNAL|PLAN YOUR NEXT|YOUR RECORDS|다음 나눔을, 가볍게|날짜를 바꿔, 미리 확인해요|나눔의 기록/);
    assert.match(h.html(),/<h1 class="sr-only">/);
  }
  h.click('dashboard');assert.doesNotMatch(h.html(),/anchor-mode|anchor-date|dashboard-controls/);
  assert.equal(h.run('anchorDate()'),'2026-10-18');
  assert.match(readFileSync(new URL('index.html',assets),'utf8'),/<strong id="date-label"><\/strong>/);
  h.click('settings');assert.match(h.html(),/계산 기준과 보관/);assert.match(h.html(),/안드로이드 3.0.1/);
  assert.equal(h.requests.length,0);
});

test('App updates are manual, separate from holiday consent and never mutate records or preferences',()=>{
  const h=harness(201);let updates=0;
  h.window.BloodNoteAndroid.requestAppUpdate=()=>updates++;
  const saved=h.read();
  for(const page of ['dashboard','planner','records','settings'])h.click(page);
  assert.equal(updates,0);assert.equal(h.requests.length,0);
  assert.match(h.html(),/data-action="check-update"/);
  assert.match(h.html(),/현재 v3.0.1/);
  assert.match(h.html(),/데이터 사용 안내에 동의/);
  assert.match(h.html(),/보안 설정·앱 설치 제한/);
  assert.match(h.html(),/이용자 본인의 판단과 책임/);
  h.click('check-update');assert.equal(updates,1);
  assert.equal(h.prompts.length,0);assert.equal(h.requests.length,0);
  assert.deepEqual(h.read(),saved);
  const reopened=h.relaunch();assert.deepEqual(reopened.read(),saved);assert.equal(reopened.requests.length,0);
});

test('Demo and absent Android update bridge do not start update work or alter saved data',()=>{
  const h=harness(2);let updates=0;
  h.window.BloodNoteAndroid.requestAppUpdate=()=>updates++;
  const saved=h.read();h.click('demo');h.click('settings');
  assert.match(h.html(),/data-action="check-update" disabled/);
  h.click('check-update');assert.equal(updates,0);assert.deepEqual(h.read(),saved);
  h.click('demo');delete h.window.BloodNoteAndroid.requestAppUpdate;
  h.click('check-update');assert.match(h.elements.get('#toast').innerHTML,/업데이트 기능을 열지 못했습니다/);
  assert.deepEqual(h.read(),saved);assert.equal(h.requests.length,0);
});

test('Holiday requests wait for approval; cancel, stale replies and missing bridge use no network',async()=>{
  const h=harness(0),cached=h.storage.getItem(HOLIDAY_CACHE_KEY);h.click('planner');
  h.click('refresh-holidays');h.click('refresh-holidays');
  assert.equal(h.prompts.length,1);await Promise.resolve();assert.equal(h.requests.length,0);
  h.consent(true,'stale-id');assert.equal(h.requests.length,0);
  h.consent(false);await Promise.resolve();assert.equal(h.requests.length,0);
  assert.equal(h.storage.getItem(HOLIDAY_CACHE_KEY),cached);
  assert.equal(h.elements.get('[data-action="refresh-holidays"]').disabled,false);
  h.click('refresh-holidays');assert.equal(h.prompts.length,2);
  h.consent(true,h.prompts[0]);assert.equal(h.requests.length,0);
  h.consent(false);delete h.window.BloodNoteAndroid.requestHolidayConsent;
  h.click('refresh-holidays');assert.equal(h.requests.length,0);assert.equal(h.prompts.length,2);
});

test('Each approval permits one refresh, repeat taps do not queue requests, and failures preserve the cache',async()=>{
  const h=harness(7);h.click('planner');h.click('refresh-holidays');const id=h.prompts[0];
  h.consent(true);h.consent(true);await Promise.resolve();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,HOLIDAY_URL);
  assert.equal(h.requests[0].options.credentials,'omit');assert.equal(h.requests[0].options.body,undefined);
  h.click('refresh-holidays');assert.equal(h.prompts.length,1);
  await h.release();assert.deepEqual(h.finished,[id]);
  assert.equal(h.run("holidays.day('2026-10-20').names[0]"),'임시공휴일 테스트');
  const cached=h.storage.getItem(HOLIDAY_CACHE_KEY);
  h.click('refresh-holidays');assert.equal(h.prompts.length,2);assert.equal(h.requests.length,1);
  h.consent(true);await Promise.resolve();assert.equal(h.requests.length,2);await h.release(true);
  assert.equal(h.storage.getItem(HOLIDAY_CACHE_KEY),cached);assert.equal(h.finished.length,2);
  assert.equal(h.run('holidays.info().error'),true);assert.deepEqual(h.read(),h.initial);
});


test('Plan/record notices expire after exactly two seconds and discard the undo action',()=>{
  const h=harness(1);h.click('delete-record',{id:'record-0'});
  const timer=h.timers.get(h.run('toastTimer'));assert.equal(timer.delay,2000);
  assert.equal(typeof h.run('undoAction'),'function');timer.fn();assert.equal(h.run('undoAction'),null);
  assert.equal(h.read().records.length,0);
  h.run("toast('계획을 추가했습니다.',()=>{})");assert.equal(h.timers.get(h.run('toastTimer')).delay,2000);
});

test('Encrypted backup UI exports all 201 records and requires password plus confirmation to restore',async()=>{
  const h=harness();h.click('export-backup');assert.equal(h.exports.length,0);
  await h.password('valid-test-password','not-matching');assert.equal(h.exports.length,0);
  await h.password('valid-test-password');assert.equal(h.exports.length,1);
  const envelope=JSON.parse(h.exports[0].text);
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(envelope,'valid-test-password')),h.initial);
  const restored={...h.initial,records:h.initial.records.slice(0,2)};
  const encrypted=await backupCrypto.encryptBackup(JSON.stringify(restored),'valid-test-password');
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('wrong-test-password');assert.deepEqual(h.read(),h.initial);
  assert.match(h.elements.get('#backup-password-status').textContent,/비밀번호/);
  await h.password('valid-test-password');assert.deepEqual(h.read(),h.initial);
  assert.match(h.elements.get('#dialog-content').innerHTML,/백업을 복원할까요/);
  h.elements.get('#confirm-restore').onclick();assert.deepEqual(h.read(),restored);
  assert.equal(h.requests.length,0);
});

test('Closing the password dialog before encryption completes prevents file export',async()=>{
  const h=harness(2);h.click('export-backup');const pending=h.password('valid-test-password');
  h.click('close-dialog');await pending;assert.equal(h.exports.length,0);assert.deepEqual(h.read(),h.initial);
});

test('License menu shows the entire unchanged local notice, closes normally, and never requests network or changes history',()=>{
  const h=harness(201),before=h.storage.getItem('blood-note-v1'),cacheBefore=h.storage.getItem(HOLIDAY_CACHE_KEY);
  h.click('settings');assert.match(h.html(),/data-action="open-licenses"/);
  assert.match(h.html(),/승인·인증을 받은 앱이 아닙니다/);
  h.click('open-licenses');assert.equal(h.elements.get('#dialog').open,true);
  const modal=h.elements.get('#dialog-content').innerHTML;
  const full=readFileSync(new URL('holiday-data-license.txt',assets),'utf8');
  const encoded=full.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  assert.equal(licenses.HOLIDAY_DATA_LICENSE,full);
  assert.ok(modal.includes(encoded));
  assert.match(modal,/Copyright \(c\) 2023 Hyunbin Seo/);
  assert.match(modal,/OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE\./);
  assert.match(modal,/https:\/\/github.com\/hyunbinseo\/holidays-kr/);
  h.click('close-dialog');assert.equal(h.elements.get('#dialog').open,false);
  assert.equal(h.storage.getItem('blood-note-v1'),before);
  assert.equal(h.storage.getItem(HOLIDAY_CACHE_KEY),cacheBefore);
  assert.equal(h.requests.length,0);assert.equal(h.prompts.length,0);
});

test('Calendar always shows one compact month, with seven headings and four status labels per date',()=>{
  const h=harness(7),before=h.storage.getItem('blood-note-v1');h.click('planner');
  const html=h.html();
  assert.match(html,/class="calendar calendar-month"/);
  assert.doesNotMatch(html,/calendar-view-switch|data-action="calendar-view"|calendar-week|quick-plan/);
  assert.equal((html.match(/class="weekday /g)||[]).length,7);
  assert.equal((html.match(/data-calendar-date=/g)||[]).length,31);
  assert.equal((html.match(/class="day-status /g)||[]).length,124);
  const types=[...html.matchAll(/class="day-status [^>]+data-type="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(types.slice(0,4),['whole','plasma','platelet','mixed']);
  h.click('day',{date:'2026-11-01'});assert.equal(h.elements.get('#dialog').open,true);
  assert.match(h.elements.get('#dialog-content').innerHTML,/헌혈 방식을 선택해 주세요/);
  h.click('close-dialog');assert.equal(h.storage.getItem('blood-note-v1'),before);assert.equal(h.requests.length,0);
});

test('Every start-page choice survives a cold launch, navigation and record edits without changing history',()=>{
  const h=harness(7,{hash:''}),initial=h.read();assert.equal(h.run('page'),'dashboard');
  for(const page of ['planner','records','dashboard']){
    h.click('settings');h.change('start-page',page);
    assert.equal(h.run('page'),'settings');assert.equal(h.read().startPage,page);
    assert.deepEqual({...h.read(),startPage:undefined},{...initial,startPage:undefined});
    assert.match(h.html(),new RegExp(`<option value="${page}" selected>`));
    h.click('dashboard');h.click('records');
    h.click('delete-record',{id:'record-0'});h.run('undoAction()');
    const reopened=h.relaunch();assert.equal(reopened.run('page'),page);
    assert.deepEqual(reopened.read(),h.read());assert.equal(reopened.requests.length,0);
    assert.equal(h.relaunch('#settings').run('page'),'settings');
  }
  assert.equal(h.requests.length,0);
});

test('Last screen starts on the actual last main or settings page after a cold launch, with no network',()=>{
  const h=harness(201,{hash:''}),original=h.read();
  h.click('settings');h.change('start-page','last');
  assert.match(h.html(),/<option value="last" selected>마지막 화면<\/option>/);
  assert.match(h.html(),/설정 포함/);
  assert.equal(h.read().lastPage,'settings');
  for(const page of ['dashboard','planner','records','settings']){
    h.click(page);
    const saved=h.read(),reopened=h.relaunch();
    assert.equal(saved.startPage,'last');assert.equal(saved.lastPage,page);
    assert.equal(reopened.run('page'),page);assert.deepEqual(reopened.read(),saved);
    assert.deepEqual(saved.records,original.records);assert.deepEqual(saved.plans,original.plans);
    assert.deepEqual(saved.rules,original.rules);assert.equal(reopened.requests.length,0);
    assert.equal(reopened.elements.get('#dialog').open,undefined);
  }
  assert.equal(h.requests.length,0);
});

test('Last-screen navigation writes only on actual page changes; undo preserves the currently viewed screen',()=>{
  const h=harness(3,{hash:''});h.click('settings');h.change('start-page','last');
  let writes=0;const write=h.storage.setItem;
  h.storage.setItem=(key,value)=>{writes++;write(key,value);};
  h.click('records');assert.equal(writes,1);
  h.click('records');h.run('render();refreshLocalDay()');assert.equal(writes,1);
  h.click('delete-record',{id:'record-0'});h.click('planner');h.run('undoAction()');
  assert.equal(h.read().records.length,3);assert.equal(h.read().lastPage,'planner');
  assert.equal(h.relaunch().run('page'),'planner');
  h.run("location.hash='#records'");h.events['window:hashchange']();
  assert.equal(h.read().lastPage,'records');assert.equal(h.relaunch().run('page'),'records');
  h.click('settings');h.change('start-page','dashboard');const saved=h.read(),previousWrites=writes;
  h.click('records');h.click('planner');assert.equal(writes,previousWrites);
  assert.deepEqual(h.read(),saved);assert.equal(h.relaunch().run('page'),'dashboard');
});

test('Last-screen mode closes dialogs first then exits from the current page instead of forcing a different page',()=>{
  const h=harness(3,{hash:''});h.click('settings');h.change('start-page','last');
  for(const page of ['dashboard','planner','records','settings']){
    h.click(page);h.elements.get('#dialog').showModal();
    assert.equal(h.window.bloodNoteHandleBack(),true);assert.equal(h.elements.get('#dialog').open,false);
    assert.equal(h.window.bloodNoteHandleBack(),false);assert.equal(h.run('page'),page);
    assert.equal(h.relaunch().run('page'),page);
  }
});

test('Missing or unsafe remembered pages fall back safely; failed navigation writes retain existing records',()=>{
  for(const lastPage of [undefined,null,'last','__proto__','https://example.com',{},[]]){
    const h=harness(0,{savedState:{...fixture(3),startPage:'last',lastPage},hash:''});
    assert.equal(h.run('page'),'dashboard');assert.equal(h.read().records.length,3);
    assert.equal(h.read().lastPage,'dashboard');assert.equal(h.run('storageFailed'),false);
  }
  const h=harness(3,{hash:''});h.click('settings');h.change('start-page','last');h.click('planner');
  const saved=h.read(),write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};
  h.click('records');assert.equal(h.run('page'),'records');assert.deepEqual(h.read(),saved);
  assert.equal(h.relaunch().run('page'),'planner');
  assert.equal(h.window.bloodNoteHandleBack(),false);
  h.storage.setItem=write;h.click('records');assert.equal(h.relaunch().run('page'),'records');
  assert.equal(h.read().records.length,3);assert.equal(h.requests.length,0);
});

test('Last-screen preference survives encrypted backup, restore, Activity recreation and isolated demo browsing',async()=>{
  const h=harness(3,{hash:''});h.click('settings');h.change('start-page','last');h.click('planner');
  h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;
  const exported=JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password'));
  assert.equal(exported.startPage,'last');assert.equal(exported.lastPage,'planner');
  h.click('settings');h.change('start-page','records');
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.equal(h.read().startPage,'last');assert.equal(h.read().lastPage,'settings');
  assert.deepEqual(h.read().records,exported.records);assert.equal(h.relaunch().run('page'),'settings');
  const restored=h.relaunch('#records');assert.equal(restored.run('page'),'records');assert.equal(restored.read().lastPage,'records');
  h.click('planner');const saved=h.read();h.click('demo');h.click('records');h.click('settings');
  h.change('start-page','last');assert.deepEqual(h.read(),saved);assert.equal(h.relaunch().run('page'),'planner');
  assert.equal(h.requests.length,0);
});

test('Missing, invalid and failed start-page preferences preserve records and use a safe fallback',()=>{
  const initial=fixture(3);
  for(const startPage of [undefined,null,'invalid','settings','__proto__']){
    const h=harness(0,{savedState:{...initial,startPage},hash:''});
    assert.equal(h.run('page'),'dashboard');assert.deepEqual(h.read().records,initial.records);
    assert.equal(h.run('storageFailed'),false);
  }
  const h=harness(3,{hash:''});h.click('settings');h.change('start-page','planner');const saved=h.read();
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};
  h.change('start-page','records');assert.deepEqual(h.read(),saved);
  assert.equal(h.run('state.startPage'),'planner');assert.equal(h.relaunch().run('page'),'planner');
  assert.match(h.elements.get('#toast').innerHTML,/저장하지 못했습니다/);
  h.storage.setItem=write;h.change('start-page','invalid');assert.deepEqual(h.read(),saved);
  h.click('demo');h.change('start-page','records');h.click('demo');assert.deepEqual(h.read(),saved);
});

test('Start-page preference crosses encrypted backup and restore; pending undo cannot revert a later choice',async()=>{
  const h=harness(3);h.click('settings');h.change('start-page','planner');
  h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;
  const exported=JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password'));
  assert.equal(exported.startPage,'planner');
  h.change('start-page','records');h.click('delete-record',{id:'record-0'});
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),exported);assert.equal(h.relaunch().run('page'),'planner');
  h.click('delete-record',{id:'record-0'});h.click('settings');h.change('start-page','records');
  assert.equal(h.run('undoAction'),undefined);assert.equal(h.relaunch().run('page'),'records');
  assert.equal(h.read().records.length,2);assert.equal(h.requests.length,0);
});

test('Android back closes dialogs, returns to the configured start page, and lets native exit handle that page',()=>{
  const native=readFileSync(new URL('../src/kr/bloodnote/app/MainActivity.java',import.meta.url),'utf8');
  const script=native.match(/web\.evaluateJavascript\("([^"\n]*window\.bloodNoteHandleBack[^"\n]*)"/)[1];
  for(const startPage of ['dashboard','planner','records']){
    const h=harness(0,{savedState:{...fixture(0),startPage},hash:''});
    assert.equal(h.run(script),false);
    h.click('settings');h.elements.get('#dialog').showModal();
    assert.equal(h.run(script),true);assert.equal(h.elements.get('#dialog').open,false);assert.equal(h.run('page'),'settings');
    assert.equal(h.run(script),true);assert.equal(h.run('page'),startPage);
    assert.equal(h.run(script),false);assert.equal(h.requests.length,0);
    h.click('dashboard');assert.equal(h.run('page'),'dashboard');
    assert.equal(h.read().startPage,startPage);
  }
});

test('Balance colors and text switch at 45, 90 and 430 mL; zero/negative balance is low and no-history is neutral',()=>{
  for(const [remaining,tone] of [[-1,'low'],[0,'low'],[44,'low'],[45,'plasma'],[89,'plasma'],[90,'component'],[429,'component'],[430,'whole'],[2160,'whole']]){
    const initial={...fixture(0),rules:{...engine.clone(engine.DEFAULT_RULES),cap:45+remaining},records:[{id:'test',date:'2026-09-01',type:'plasma'}]};
    const h=harness(0,{savedState:initial,hash:''});
    assert.match(h.html(),new RegExp(`balance-card balance-${tone}`));assert.doesNotMatch(h.html(),/balance-band-label|mL 구간/);
    assert.doesNotMatch(h.html(),/계산량 기준 · 간격·횟수 조건은 별도로 확인/);
    assert.deepEqual(h.read(),initial);assert.equal(h.requests.length,0);
  }
  const empty=harness(0,{hash:''});assert.match(empty.html(),/balance-card balance-empty/);
  assert.match(empty.html(),/balance-number">—/);assert.doesNotMatch(empty.html(),/balance-band-label/);
});

test('Volume text respects custom calculation settings and never treats volume alone as donation eligibility',()=>{
  const initial={...fixture(0),rules:{...engine.clone(engine.DEFAULT_RULES),cap:169,volumes:{whole:500,plasma:50,platelet:100,mixed:120}},records:[{id:'today',date:'2026-10-18',type:'plasma'}]};
  const h=harness(0,{savedState:initial,hash:''});
  assert.match(h.html(),/balance-card balance-component/);assert.match(h.html(),/계산량 충족: 혈장 · 혈소판<\/p>/);
  assert.doesNotMatch(h.html(),/간격·횟수 조건은 별도로|오늘부터 계산 조건 충족/);
  h.run('state.rules.cap=170;render()');assert.doesNotMatch(h.html(),/balance-band-label|mL 구간/);
  assert.match(h.html(),/계산량 충족: 혈장 · 혈소판 · 혈소판 혈장/);
  assert.deepEqual(h.read(),initial);assert.equal(h.requests.length,0);
});

test('The two display switches are independent and never change calculations, actual records or plans',()=>{
  const initial={...fixture(0),rules:{...engine.clone(engine.DEFAULT_RULES),cap:270},
    records:[{id:'holiday',date:'2026-10-03',type:'plasma'},{id:'recent',date:'2026-10-08',type:'mixed'}],
    plans:[{id:'future',date:'2026-10-30',type:'plasma'}],startPage:'planner'};
  const h=harness(0,{savedState:initial,hash:''});
  const baseline=h.run('JSON.stringify(stats(state.records,today(),state.rules))');
  for(const [balance,record] of [[true,true],[false,true],[false,false],[true,false],[true,true]]){
    h.click('settings');h.display('balanceHighlight',balance);h.display('recordHighlight',record);
    for(const [key,enabled] of [['balanceHighlight',balance],['recordHighlight',record]]){
      const input=h.html().match(new RegExp(`<input[^>]*id="display-${key}"[^>]*>`))[0];
      assert.match(input,/role="switch"/);assert.equal(/\bchecked\b/.test(input),enabled);
    }
    h.click('dashboard');assert.match(h.html(),/135<span>mL/);
    assert.match(h.html(),new RegExp('balance-card balance-'+(balance?'component':'plain')));
    assert.equal(h.html().includes('class="balance-status"'),balance);
    assert.doesNotMatch(h.html(),/balance-band-label|90~429mL 구간/);
    h.click('planner');
    const actual=h.html().match(/data-calendar-date="2026-10-03"[\s\S]*?<\/button>/)[0];
    const plan=h.html().match(/data-calendar-date="2026-10-30"[\s\S]*?<\/button>/)[0];
    for(const marker of ['highlighted-record','day-recorded-mark','completed-record']){
      assert.equal(actual.includes(marker),record);assert.equal(plan.includes(marker),false);
    }
    assert.match(actual,/개천절/);assert.match(actual,/혈장 완료/);assert.match(actual,/>완료<\/strong>/);
    assert.equal(h.html().includes('<i class="done"'),record);
    assert.equal(h.run('JSON.stringify(stats(state.records,today(),state.rules))'),baseline);
    const {displayOptions,...saved}=h.read();assert.deepEqual(saved,initial);
  }
  assert.equal(h.requests.length,0);
});

test('Disabled display settings survive relaunch, encrypted backup/restore and later record undo',async()=>{
  const h=harness(4);h.click('settings');h.display('balanceHighlight',false);h.display('recordHighlight',false);
  h.change('start-page','records');const saved=h.read();
  let reopened=h.relaunch();assert.deepEqual(reopened.read(),saved);
  for(const key of ['balanceHighlight','recordHighlight'])assert.equal(reopened.run(`displayEnabled('${key}')`),false);
  h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password')),saved);
  h.display('balanceHighlight',true);h.display('recordHighlight',true);
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),saved);
  h.click('delete-record',{id:'record-0'});h.run('undoAction()');assert.deepEqual(h.read(),saved);
  reopened=h.relaunch();assert.equal(reopened.run('page'),'records');assert.deepEqual(reopened.read(),saved);
  assert.equal(h.requests.length+reopened.requests.length,0);
});

test('Legacy display settings default on; invalid values and failed writes cannot corrupt records or preferences',()=>{
  for(const displayOptions of [undefined,null,[],{balanceHighlight:'false',recordHighlight:0},{unexpected:false}]){
    const initial={...fixture(2),displayOptions},h=harness(0,{savedState:initial});
    assert.equal(h.run('storageFailed'),false);
    assert.equal(h.run("displayEnabled('balanceHighlight')"),true);assert.equal(h.run("displayEnabled('recordHighlight')"),true);
    assert.deepEqual(h.read().records,initial.records);assert.deepEqual(h.read().plans,initial.plans);
  }
  const h=harness(2);h.click('settings');h.display('recordHighlight',false);const saved=h.read();
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};h.display('balanceHighlight',false);
  assert.deepEqual(h.read(),saved);assert.equal(h.run("displayEnabled('balanceHighlight')"),true);
  assert.match(h.elements.get('#toast').innerHTML,/저장하지 못했습니다/);
  h.storage.setItem=write;h.display('unrecognized',false);h.display('balanceHighlight','false');assert.deepEqual(h.read(),saved);
  h.click('demo');assert.equal(h.run("displayEnabled('recordHighlight')"),false);
  h.click('settings');assert.match(h.html(),/data-display-option="recordHighlight"[^>]*disabled/);
  h.display('recordHighlight',true);h.click('demo');assert.deepEqual(h.read(),saved);
  h.click('delete-record',{id:'record-0'});h.click('settings');h.display('balanceHighlight',false);
  assert.equal(h.run('undoAction'),undefined);assert.equal(h.read().records.length,1);
  const reopened=h.relaunch();assert.deepEqual(reopened.read().displayOptions,{recordHighlight:false,balanceHighlight:false});
  assert.equal(h.requests.length,0);
});

test('Red Connect calendar and plan switches independently control visible shortcuts and block hidden actions without changing data',()=>{
  const initial={...fixture(2),startPage:'planner',displayOptions:{balanceHighlight:false,recordHighlight:false},
    plans:[{id:'nearest',date:'2026-10-30',type:'plasma'},{id:'later',date:'2026-11-30',type:'mixed'}]};
  const h=harness(0,{savedState:initial,hash:''});
  let launches=0;h.window.BloodNoteAndroid.requestRedConnect=()=>launches++;
  const baseline=h.run('JSON.stringify(inspectPlan(state.records,state.plans,state.rules))');
  for(const [calendar,plan] of [[true,true],[false,true],[false,false],[true,false],[true,true]]){
    const before=launches;
    h.click('settings');h.display('redConnectCalendar',calendar);h.display('redConnectPlan',plan);
    assert.equal(launches,before,'changing a switch must not launch Red Connect');
    for(const [key,enabled] of [['redConnectCalendar',calendar],['redConnectPlan',plan]]){
      const input=h.html().match(new RegExp(`<input[^>]*id="display-${key}"[^>]*>`))[0];
      assert.match(input,/role="switch"/);assert.equal(/\bchecked\b/.test(input),enabled);
    }
    h.click('planner');
    assert.equal((h.html().match(/data-action="plan-red-connect"/g)||[]).length,plan?1:0);
    assert.doesNotMatch(h.html(),/가장 가까운 예정 헌혈|예약은 레드커넥트에서 진행하세요/);
    h.click('plan-red-connect',{id:'later'});assert.equal(launches,before);
    h.click('plan-red-connect',{id:'nearest'});assert.equal(launches,before+Number(plan));
    h.click('day',{date:'2026-10-30'});
    const popup=h.elements.get('#dialog-content').innerHTML;
    assert.equal(popup.includes('data-action="day-red-connect"'),calendar);
    assert.equal(popup.includes('저장된 계획의 예약을 레드커넥트에서'),calendar);
    h.click('day-red-connect');assert.equal(launches,before+Number(plan)+Number(calendar));
    h.click('close-dialog');
    for(const date of ['2026-10-17','2020-01-01']){
      h.click('day',{date});assert.doesNotMatch(h.elements.get('#dialog-content').innerHTML,/day-red-connect/);
      const count=launches;h.click('day-red-connect');assert.equal(launches,count);h.click('close-dialog');
    }
    assert.equal(h.run('JSON.stringify(inspectPlan(state.records,state.plans,state.rules))'),baseline);
    const {displayOptions,...saved}=h.read();const {displayOptions:oldOptions,...original}=initial;
    assert.deepEqual(saved,original);
    for(const [key,enabled] of Object.entries(oldOptions))assert.equal(displayOptions[key],enabled);
  }
  assert.equal(h.requests.length,0);assert.equal(h.prompts.length,0);
});

test('Red Connect shortcut choices survive relaunch, encrypted backup restoration and record undo',async()=>{
  const initial={...fixture(2),startPage:'planner',plans:[{id:'nearest',date:'2026-10-30',type:'plasma'}]};
  const h=harness(0,{savedState:initial});h.click('settings');
  h.display('redConnectCalendar',false);h.display('redConnectPlan',false);const saved=h.read();
  const assertHidden=app=>{
    app.click('planner');assert.doesNotMatch(app.html(),/plan-red-connect/);
    app.click('day',{date:'2026-10-30'});assert.doesNotMatch(app.elements.get('#dialog-content').innerHTML,/day-red-connect/);
    app.click('close-dialog');
  };
  const reopened=h.relaunch();assert.deepEqual(reopened.read(),saved);assertHidden(reopened);
  h.click('export-backup');await h.password('valid-test-password');const encrypted=h.exports[0].text;
  assert.doesNotMatch(encrypted,/redConnectCalendar|redConnectPlan/);
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password')),saved);
  h.display('redConnectCalendar',true);h.display('redConnectPlan',true);
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);
  await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),saved);assertHidden(h);
  h.click('delete-record',{id:'record-0'});h.run('undoAction()');assert.deepEqual(h.read(),saved);
  assertHidden(h.relaunch());assert.equal(h.requests.length+reopened.requests.length,0);
});

test('Old backups default to both Red Connect shortcuts on and failed or demo setting writes preserve saved choices',()=>{
  for(const displayOptions of [undefined,null,[],{recordHighlight:false},{redConnectCalendar:'false',redConnectPlan:0}]){
    const initial={...fixture(2),displayOptions};const h=harness(0,{savedState:initial});
    assert.equal(h.run('storageFailed'),false);
    for(const key of ['redConnectCalendar','redConnectPlan'])assert.equal(h.run(`displayEnabled('${key}')`),true);
    const {displayOptions:loadedOptions,...saved}=h.read();const {displayOptions:oldOptions,...original}=initial;
    assert.deepEqual(saved,original);
    assert.deepEqual(loadedOptions,oldOptions?.recordHighlight===false?{recordHighlight:false}:undefined);
    assert.equal(h.requests.length,0);
  }
  const h=harness(2);h.click('settings');h.display('redConnectCalendar',false);const saved=h.read();
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};
  h.display('redConnectPlan',false);h.display('redConnectCalendar',true);
  assert.deepEqual(h.read(),saved);
  assert.equal(h.run("displayEnabled('redConnectCalendar')"),false);
  assert.equal(h.run("displayEnabled('redConnectPlan')"),true);
  assert.match(h.elements.get('#toast').innerHTML,/저장하지 못했습니다/);
  h.storage.setItem=write;h.click('demo');h.click('settings');
  for(const key of ['redConnectCalendar','redConnectPlan']){
    assert.match(h.html(),new RegExp(`data-display-option="${key}"[^>]*disabled`));
    h.display(key,false);
  }
  h.click('demo');assert.deepEqual(h.read(),saved);
  h.click('delete-record',{id:'record-0'});h.display('redConnectPlan',false);
  assert.equal(h.run('undoAction'),undefined);assert.equal(h.read().records.length,1);
  assert.deepEqual(h.relaunch().read().displayOptions,{redConnectCalendar:false,redConnectPlan:false});
  assert.equal(h.requests.length,0);
});

test('Screen editing is offered only on the two editable pages and requires current-page confirmation',()=>{
  const h=harness(2),before=h.read();
  for(const page of ['records','settings']){h.click(page);assert.equal(h.elements.get('#layout-toggle').hidden,true);h.click('layout-request');assert.equal(h.run('screenEditor'),null);}
  for(const page of ['dashboard','planner']){
    h.click(page);assert.equal(h.elements.get('#layout-toggle').hidden,false);h.click('layout-request');
    assert.match(h.elements.get('#dialog-content').innerHTML,/화면을 편집할까요/);assert.equal(h.run('screenEditor'),null);
    h.click('close-dialog');assert.deepEqual(h.read(),before);
  }
  h.click('dashboard');h.click('layout-request');h.click('settings');h.click('layout-begin',{layoutPage:'dashboard'});assert.equal(h.run('screenEditor'),null);
  h.click('close-dialog');h.run('toggleDemo()');h.click('layout-request');assert.equal(h.run('screenEditor'),null);assert.deepEqual(h.read(),before);
});
test('Draft widget moves never save records; cancel/back restore order and each page saves independently across restart',()=>{
  const h=harness(3),before=h.read(),ids=()=>[...h.html().matchAll(/data-layout-id="([^"]+)"/g)].map(m=>m[1]);
  h.click('dashboard');const original=ids();h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});
  assert.equal(h.elements.get('#layout-toolbar').hidden,false);assert.equal(h.elements.has('#quick-add'),false);
  h.click('layout-up',{id:'recent'});assert.notDeepEqual(ids(),original);assert.deepEqual(h.read(),before);
  h.click('layout-cancel');assert.deepEqual(ids(),original);assert.deepEqual(h.read(),before);
  h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-down',{id:'balance'});
  h.click('records');assert.equal(h.run('page'),'dashboard');assert.equal(h.window.bloodNoteHandleBack(),true);assert.deepEqual(ids(),original);assert.deepEqual(h.read(),before);
  h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-down',{id:'balance'});const dashboard=ids();h.click('layout-save');
  assert.deepEqual(h.read().screenLayouts.dashboard,dashboard);assert.equal(h.run('undoAction'),undefined);assert.equal(h.run('screenEditor'),null);
  h.click('planner');h.click('layout-request');h.click('layout-begin',{layoutPage:'planner'});assert.equal(ids().length,4);
  h.click('layout-up',{id:'annual'});const planner=ids();h.click('layout-save');
  assert.deepEqual(h.read().screenLayouts.planner,planner);assert.deepEqual(h.read().screenLayouts.dashboard,dashboard);
  const reopened=h.relaunch();reopened.click('dashboard');assert.deepEqual([...reopened.html().matchAll(/data-layout-id="([^"]+)"/g)].map(m=>m[1]),dashboard);
  const {screenLayouts,...rest}=h.read();assert.deepEqual(rest,before);assert.equal(h.requests.length,0);
});
test('Layout save failure preserves the previous stored state and leaves the draft retryable',()=>{
  const h=harness(2),before=h.read();h.click('dashboard');h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-down',{id:'balance'});
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};h.click('layout-save');
  assert.deepEqual(h.read(),before);assert.ok(h.run('screenEditor'));assert.match(h.elements.get('#toast').innerHTML,/저장하지 못했습니다/);
  h.storage.setItem=write;h.click('layout-save');assert.equal(h.run('screenEditor'),null);assert.equal(h.read().screenLayouts.dashboard[0],'next');
  assert.deepEqual(h.read().records,before.records);assert.deepEqual(h.read().plans,before.plans);assert.equal(h.requests.length,0);
});
test('Default layout reset requires the edit menu and a second current-page confirmation; cancel/back and stale clicks preserve data',()=>{
  const saved={...fixture(2),screenLayouts:{dashboard:[...screenLayout.layoutOrder('dashboard')].reverse(),planner:[...screenLayout.layoutOrder('planner')].reverse()}};
  const h=harness(2,{savedState:saved,hash:'#dashboard'}),before=h.read();
  h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),before);
  h.click('layout-request');assert.match(h.elements.get('#dialog-content').innerHTML,/layout-reset-row[\s\S]*기본 배치로 초기화/);
  h.click('layout-reset-request',{layoutPage:'dashboard'});
  assert.match(h.elements.get('#dialog-content').innerHTML,/현재 화면의 배치가 즉시 초기화/);assert.deepEqual(h.read(),before);
  h.click('layout-begin',{layoutPage:'dashboard'});assert.equal(h.run('screenEditor'),null);
  h.click('layout-reset-cancel',{layoutPage:'dashboard'});assert.match(h.elements.get('#dialog-content').innerHTML,/화면을 편집할까요/);
  h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),before);
  h.click('layout-reset-request',{layoutPage:'dashboard'});assert.equal(h.window.bloodNoteHandleBack(),true);
  h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),before);
  h.click('layout-request');h.click('layout-reset-request',{layoutPage:'dashboard'});h.click('planner');
  h.click('layout-reset-confirm',{layoutPage:'dashboard'});h.click('layout-reset-confirm',{layoutPage:'planner'});assert.deepEqual(h.read(),before);
  h.click('close-dialog');h.click('records');h.click('layout-reset-request',{layoutPage:'records'});assert.deepEqual(h.read(),before);assert.equal(h.requests.length,0);
});
test('Reset restores only the selected screen, preserves donation data/settings and survives restart and encrypted backup',async()=>{
  const saved={...fixture(3),startPage:'planner',displayOptions:{redConnectCalendar:false,balanceHighlight:false},restrictions:[{id:'pause',start:'2026-10-23',end:'2026-10-24',reason:'ㄱ 약 복용'}],
    screenLayouts:{dashboard:[...screenLayout.layoutOrder('dashboard')].reverse(),planner:[...screenLayout.layoutOrder('planner')].reverse()}};
  const h=harness(3,{savedState:saved,hash:'#dashboard'}),before=h.read();
  h.click('layout-request');h.click('layout-reset-request',{layoutPage:'dashboard'});h.click('layout-reset-confirm',{layoutPage:'dashboard'});
  assert.deepEqual(h.read().screenLayouts.dashboard,screenLayout.layoutOrder('dashboard'));
  assert.deepEqual(h.read().screenLayouts.planner,before.screenLayouts.planner);
  const {screenLayouts:ignored,...after}=h.read(),{screenLayouts:old,...previous}=before;assert.deepEqual(after,previous);
  assert.equal(h.run('screenEditor'),null);assert.equal(h.elements.get('#dialog').open,false);
  let reopened=h.relaunch();assert.equal(reopened.run('page'),'planner');assert.deepEqual(reopened.read(),h.read());
  reopened.click('layout-request');reopened.click('layout-reset-request',{layoutPage:'planner'});reopened.click('layout-reset-confirm',{layoutPage:'planner'});
  assert.deepEqual(reopened.read().screenLayouts.planner,screenLayout.layoutOrder('planner'));
  assert.deepEqual(reopened.read().screenLayouts.dashboard,screenLayout.layoutOrder('dashboard'));
  reopened.click('settings');reopened.click('export-backup');await reopened.password('safe-backup-password');
  const restored=JSON.parse(await backupCrypto.decryptBackup(JSON.parse(reopened.exports[0].text),'safe-backup-password'));
  assert.deepEqual(restored,reopened.read());assert.equal(h.requests.length+reopened.requests.length,0);
});
test('A failed layout reset leaves the saved layout intact and can be retried, while demo and unreadable storage cannot reset',()=>{
  const saved={...fixture(2),screenLayouts:{dashboard:[...screenLayout.layoutOrder('dashboard')].reverse()}},h=harness(2,{savedState:saved,hash:'#dashboard'}),before=h.read();
  h.click('layout-request');h.click('layout-reset-request',{layoutPage:'dashboard'});
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};h.click('layout-reset-confirm',{layoutPage:'dashboard'});
  assert.deepEqual(h.read(),before);assert.equal(h.elements.get('#dialog').open,true);assert.equal(h.run('layoutPrompt.kind'),'reset');
  h.storage.setItem=write;h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read().records,before.records);
  const reset=h.read();h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),reset);
  h.click('demo');h.click('layout-request');h.click('layout-reset-request',{layoutPage:'dashboard'});h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),reset);
  h.click('demo');h.run('storageFailed=true');h.click('layout-request');h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),reset);
});
test('Encrypted backups retain both saved layouts; restoring an old backup preserves existing screen preferences',async()=>{
  const saved={...fixture(2),screenLayouts:{dashboard:screenLayout.layoutOrder('dashboard').reverse(),planner:screenLayout.layoutOrder('planner').reverse()}};
  const h=harness(2,{savedState:saved});h.click('export-backup');await h.password('valid-test-password');
  const envelope=h.exports[0].text;assert.doesNotMatch(envelope,/screenLayouts|component-count/);
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(envelope),'valid-test-password')),saved);
  const legacy=fixture(1);await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(JSON.stringify(legacy))}})`);h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read().screenLayouts,saved.screenLayouts);assert.deepEqual(h.read().records,legacy.records);
  assert.deepEqual(h.relaunch().read().screenLayouts,saved.screenLayouts);assert.equal(h.requests.length,0);
});

const visibleWidgetIds=html=>[...html.matchAll(/data-layout-id="([^"]+)"/g)].map(match=>match[1]);
const hiddenWidgetIdsInHTML=html=>[...html.matchAll(/data-hidden-layout-id="([^"]+)"/g)].map(match=>match[1]);
test('Minus hides draft items below the draggable list, plus restores them at the end, and cancel/back discard both changes',()=>{
  for(const view of ['dashboard','planner']){
    const h=harness(2,{hash:'#'+view}),before=h.read(),original=visibleWidgetIds(h.html()),id=original[0];
    h.click('layout-request');h.click('layout-begin',{layoutPage:view});h.click('layout-hide',{id});
    assert.deepEqual(visibleWidgetIds(h.html()),original.slice(1));assert.deepEqual(hiddenWidgetIdsInHTML(h.html()),[id]);
    assert.ok(h.html().indexOf('layout-hidden-panel')>h.html().lastIndexOf('data-layout-id='));
    assert.match(h.html(),new RegExp(`data-action="layout-show" data-id="${id}"`));assert.deepEqual(h.read(),before);
    h.click('layout-hide',{id});h.click('layout-hide',{id:'<script>'});assert.deepEqual(hiddenWidgetIdsInHTML(h.html()),[id]);
    h.click('layout-show',{id});assert.deepEqual(visibleWidgetIds(h.html()),[...original.slice(1),id]);assert.deepEqual(hiddenWidgetIdsInHTML(h.html()),[]);
    h.click('layout-show',{id});assert.deepEqual(visibleWidgetIds(h.html()),[...original.slice(1),id]);
    h.click('layout-hide',{id});h.click('layout-cancel');assert.deepEqual(visibleWidgetIds(h.html()),original);assert.deepEqual(h.read(),before);
    h.click('layout-request');h.click('layout-begin',{layoutPage:view});h.click('layout-hide',{id});
    assert.equal(h.window.bloodNoteHandleBack(),true);assert.deepEqual(visibleWidgetIds(h.html()),original);assert.deepEqual(h.read(),before);
    assert.equal(h.requests.length,0);
  }
});
test('Hidden items cannot enter arrow/drag targets, and saving each page keeps its visibility across restart without changing data',()=>{
  const saved={...fixture(3),startPage:'planner',displayOptions:{redConnectCalendar:false},restrictions:[{id:'pause',start:'2026-10-18',end:'2026-10-19',reason:'약 / 药'}]};
  const h=harness(3,{savedState:saved,hash:'#dashboard'}),before=h.read();
  h.click('layout-hide',{id:'balance'});assert.deepEqual(h.read(),before);
  h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-hide',{id:'next'});
  const order=visibleWidgetIds(h.html());h.click('layout-up',{id:'next'});h.run("moveScreenWidget('recent',0,'next')");assert.deepEqual(visibleWidgetIds(h.html()),order);
  h.click('layout-down',{id:'balance'});assert.equal(visibleWidgetIds(h.html())[0],'whole-count');h.click('layout-save');
  assert.deepEqual(h.read().screenHidden.dashboard,['next']);assert.doesNotMatch(h.html(),/data-layout-id="next"/);
  assert.match(h.html(),/등록한 헌혈 제한이 적용 중/);
  h.click('planner');h.click('layout-request');h.click('layout-begin',{layoutPage:'planner'});h.click('layout-hide',{id:'calendar'});h.click('layout-save');
  assert.deepEqual(h.read().screenHidden,{dashboard:['next'],planner:['calendar']});assert.doesNotMatch(h.html(),/class="calendar-card"|data-calendar-date=/);
  const reopened=h.relaunch();assert.equal(reopened.run('page'),'planner');assert.deepEqual(reopened.read().screenHidden,h.read().screenHidden);
  assert.doesNotMatch(reopened.html(),/data-layout-id="calendar"/);reopened.click('dashboard');assert.doesNotMatch(reopened.html(),/data-layout-id="next"/);
  const {screenLayouts,screenHidden,...rest}=h.read();assert.deepEqual(rest,before);assert.equal(h.requests.length+reopened.requests.length,0);
});
test('A failed visibility save keeps the previous saved state and the draft can be retried',()=>{
  const saved={...fixture(2),screenHidden:{dashboard:['recent'],planner:['annual']}},h=harness(2,{savedState:saved,hash:'#dashboard'}),before=h.read();
  h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-show',{id:'recent'});h.click('layout-hide',{id:'next'});
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};h.click('layout-save');
  assert.deepEqual(h.read(),before);assert.ok(h.run('screenEditor'));assert.deepEqual(hiddenWidgetIdsInHTML(h.html()),['next']);
  h.storage.setItem=write;h.click('layout-save');assert.equal(h.run('screenEditor'),null);
  assert.deepEqual(h.read().screenHidden,{dashboard:['next'],planner:['annual']});assert.deepEqual(h.read().records,before.records);
  assert.deepEqual(h.relaunch().read(),h.read());assert.equal(h.requests.length,0);
});
test('All widgets may be hidden while editing and restoration remain available on both screens',()=>{
  for(const view of ['dashboard','planner']){
    const h=harness(1,{hash:'#'+view}),before=h.read(),ids=visibleWidgetIds(h.html());
    h.click('layout-request');h.click('layout-begin',{layoutPage:view});for(const id of ids)h.click('layout-hide',{id});
    assert.deepEqual(visibleWidgetIds(h.html()),[]);assert.equal(hiddenWidgetIdsInHTML(h.html()).length,ids.length);
    h.click('layout-save');assert.match(h.html(),/표시 중인 항목이 없습니다/);assert.deepEqual(visibleWidgetIds(h.html()),[]);
    assert.equal(h.elements.get('#layout-toggle').hidden,false);assert.equal(h.elements.has('#quick-add'),false);
    const reopened=h.relaunch();reopened.click(view);assert.deepEqual(visibleWidgetIds(reopened.html()),[]);
    reopened.click('layout-request');reopened.click('layout-begin',{layoutPage:view});assert.equal(hiddenWidgetIdsInHTML(reopened.html()).length,ids.length);
    reopened.click('layout-show',{id:ids[0]});reopened.click('layout-save');assert.deepEqual(visibleWidgetIds(reopened.html()),[ids[0]]);
    assert.deepEqual(reopened.read().records,before.records);assert.deepEqual(reopened.read().plans,before.plans);
    assert.equal(h.requests.length+reopened.requests.length,0);
  }
});
test('Visibility survives encrypted export/restore, and a legacy backup preserves the current hidden choices',async()=>{
  const saved={...fixture(2),screenLayouts:{planner:['annual','calendar','plans','restrictions']},screenHidden:{dashboard:['next','recent'],planner:['calendar']}};
  const h=harness(2,{savedState:saved});h.click('export-backup');await h.password('valid-test-password');
  const encrypted=h.exports[0].text;assert.doesNotMatch(encrypted,/screenHidden|screenLayouts/);
  assert.deepEqual(JSON.parse(await backupCrypto.decryptBackup(JSON.parse(encrypted),'valid-test-password')),saved);
  h.run('change(()=>{state.screenHidden={dashboard:[]};})');
  await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(encrypted)}})`);await h.password('valid-test-password');h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read(),saved);assert.deepEqual(h.relaunch().read(),saved);
  const legacy=fixture(1);await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(JSON.stringify(legacy))}})`);h.elements.get('#confirm-restore').onclick();
  assert.deepEqual(h.read().screenHidden,saved.screenHidden);assert.deepEqual(h.read().screenLayouts,saved.screenLayouts);assert.deepEqual(h.read().records,legacy.records);
  assert.equal(h.requests.length,0);
});
test('Confirmed default reset shows all widgets on that screen only, and failed reset or cancellation preserves hidden choices',()=>{
  const saved={...fixture(2),screenHidden:{dashboard:['balance','next'],planner:['calendar']},screenLayouts:{dashboard:screenLayout.layoutOrder('dashboard').reverse(),planner:screenLayout.layoutOrder('planner').reverse()}};
  const h=harness(2,{savedState:saved,hash:'#dashboard'}),before=h.read();h.click('layout-request');h.click('layout-reset-request',{layoutPage:'dashboard'});
  assert.match(h.elements.get('#dialog-content').innerHTML,/숨긴 항목도 다시 표시/);h.click('layout-reset-cancel',{layoutPage:'dashboard'});assert.deepEqual(h.read(),before);
  h.click('layout-reset-request',{layoutPage:'dashboard'});const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};h.click('layout-reset-confirm',{layoutPage:'dashboard'});assert.deepEqual(h.read(),before);
  h.storage.setItem=write;h.click('layout-reset-confirm',{layoutPage:'dashboard'});
  assert.deepEqual(visibleWidgetIds(h.html()),screenLayout.layoutOrder('dashboard'));assert.deepEqual(h.read().screenHidden,{dashboard:[],planner:['calendar']});
  assert.deepEqual(h.read().screenLayouts.planner,before.screenLayouts.planner);assert.deepEqual(h.read().records,before.records);
  assert.deepEqual(h.relaunch().read(),h.read());assert.equal(h.requests.length,0);
});
test('Hidden choices ignore stale actions outside editing, unknown IDs, example mode and unreadable storage',()=>{
  const h=harness(2),before=h.read();for(const action of ['layout-hide','layout-show'])for(const id of ['balance','calendar','<script>'])h.click(action,{id});assert.deepEqual(h.read(),before);
  h.click('dashboard');h.click('demo');h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-hide',{id:'balance'});assert.deepEqual(h.read(),before);
  h.click('demo');h.run('storageFailed=true');h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});h.click('layout-hide',{id:'balance'});assert.deepEqual(h.read(),before);assert.equal(h.requests.length,0);
});
test('Hidden calendar and next-date widgets skip their expensive render calculations until the editor needs a preview',()=>{
  const saved={...fixture(2),screenHidden:{dashboard:['next'],planner:['calendar','annual']}};
  const h=harness(2,{savedState:saved,hash:'#planner'});
  h.run('let calendarCalls=0;const originalCalendar=calendarHTML;calendarHTML=(...args)=>{calendarCalls++;return originalCalendar(...args)};render()');assert.equal(h.run('calendarCalls'),0);
  h.click('layout-request');h.click('layout-begin',{layoutPage:'planner'});assert.equal(h.run('calendarCalls'),1);h.click('layout-cancel');assert.equal(h.run('calendarCalls'),1);
  h.click('dashboard');h.run('let nextCalls=0;const originalEarliest=earliest;earliest=(...args)=>{nextCalls++;return originalEarliest(...args)};render()');assert.equal(h.run('nextCalls'),0);
  h.click('layout-request');h.click('layout-begin',{layoutPage:'dashboard'});assert.equal(h.run('nextCalls'),4);
  assert.deepEqual(h.read(),saved);assert.equal(h.requests.length,0);
});


test('Failed direct entry keeps the editor and its values available for a successful retry',()=>{
  const h=harness(2),before=h.read();h.click('add-record');
  const form=h.elements.get('#event-form');form.elements.date.value='2026-10-01';form.elements.type.value='platelet';
  const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};
  h.events['#event-form:submit']({preventDefault(){}});
  assert.deepEqual(h.read(),before);assert.equal(h.elements.get('#dialog').open,true);
  assert.equal(form.elements.date.value,'2026-10-01');assert.equal(form.elements.type.value,'platelet');
  h.storage.setItem=write;h.events['#event-form:submit']({preventDefault(){}});
  assert.equal(h.elements.get('#dialog').open,false);assert.equal(h.read().records.length,3);
  assert.equal(h.read().records.at(-1).type,'platelet');assert.deepEqual(h.relaunch().read(),h.read());
});

test('Failed pasted-record and generated-plan commits preserve the reviewed rows for retry',()=>{
  for(const mode of ['text','draft']){
    const h=harness(2),before=h.read();
    if(mode==='text'){
      h.click('import-text');h.elements.get('#import-text').value='2026-10-01 혈장';h.elements.get('#parse-import').onclick();
    }else{h.click('auto-plan');h.elements.get('#generate-draft').onclick();}
    const commit=h.elements.get(mode==='text'?'#save-import':'#save-draft');assert.equal(commit.disabled,false);
    const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};commit.onclick();
    assert.deepEqual(h.read(),before);assert.equal(h.elements.get('#dialog').open,true,mode);
    h.storage.setItem=write;commit.onclick();assert.equal(h.elements.get('#dialog').open,false);
    assert.ok((mode==='text'?h.read().records.length:h.read().plans.length)>(mode==='text'?before.records.length:before.plans.length));
    assert.deepEqual(h.relaunch().read(),h.read());assert.equal(h.requests.length,0);
  }
});

test('Manual and batch additions cannot exceed 3000 events or make the next launch unreadable',()=>{
  for(const mode of ['manual','text','draft']){
    const count=mode==='text'?2999:3000;
    const saved={...fixture(0),records:Array.from({length:count},(_,i)=>({id:'historical-'+i,date:engine.addDays('2010-01-01',i),type:'plasma'}))};
    const h=harness(count,{savedState:saved}),before=h.read();
    if(mode==='manual'){h.click('add-record');h.events['#event-form:submit']({preventDefault(){}});}
    else if(mode==='text'){
      h.click('import-text');h.elements.get('#import-text').value='2026-10-01 혈장\n2026-10-02 혈장';h.elements.get('#parse-import').onclick();h.elements.get('#save-import').onclick();
    }else{h.click('auto-plan');h.elements.get('#generate-draft').onclick();h.elements.get('#save-draft').onclick();}
    assert.deepEqual(h.read(),before,mode);assert.deepEqual(h.relaunch().read(),before);
    assert.equal(h.elements.get('#dialog').open,true,mode);assert.match(h.elements.get('#toast').innerHTML,/3,000/);
  }
});

test('Backups reject inherited object keys and non-string donation types before the restore confirmation',async()=>{
  for(const type of ['constructor','toString','__proto__',['whole']]){
    const h=harness(2),before=h.read(),bad=fixture(1);bad.records[0].type=type;
    await h.run(`restoreBackup({size:1000,text:async()=>${JSON.stringify(JSON.stringify(bad))}})`);
    assert.equal(!!h.elements.get('#dialog').open,false);
    assert.deepEqual(h.read(),before);assert.match(h.elements.get('#toast').innerHTML,/복원하지 못했습니다/);
  }
});


test('Record actions form four ordered entries and the issuance button launches Red Connect only by explicit request without changing records',()=>{
  const saved={...fixture(3),displayOptions:{redConnectCalendar:false,redConnectPlan:false}},h=harness(3,{savedState:saved}),before=h.read();
  assert.equal(h.elements.has('#quick-add'),false);
  const group=h.html().match(/class="record-entry-grid"[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...group.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]),['add-record','issue-certificate','import-text','import-certificate']);
  assert.match(group,/헌혈증명서 발급받기<\/span><small>\(레드커넥트 실행\)<\/small>/);
  assert.match(group,/여러 기록 추가하기/);assert.match(group,/증명서 PDF 등록하기/);
  let launches=0;h.window.BloodNoteAndroid.requestRedConnect=()=>launches++;
  h.click('records');assert.equal(launches,0);h.click('issue-certificate');assert.equal(launches,1);assert.deepEqual(h.read(),before);
  h.window.BloodNoteAndroid.requestRedConnect=()=>{throw Error('unavailable')};h.click('issue-certificate');assert.match(h.elements.get('#toast').innerHTML,/열지 못했습니다/);assert.deepEqual(h.read(),before);
  h.window.BloodNoteAndroid.requestRedConnect=()=>launches++;h.click('demo');h.click('records');
  assert.match(h.html(),/data-action="issue-certificate" disabled/);h.click('issue-certificate');assert.equal(launches,1);assert.deepEqual(h.read(),before);assert.equal(h.requests.length,0);
});
