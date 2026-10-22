import * as licenses from '../assets/licenses.mjs';
import * as backupCrypto from '../assets/backup-crypto.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as calendar from '../assets/calendar-view.mjs';
import * as certificate from '../assets/certificate-import.mjs';
import {createHolidayStore,HOLIDAY_CACHE_KEY,HOLIDAY_URL} from '../assets/holidays.mjs';
import {HOLIDAY_SNAPSHOT} from '../assets/holiday-snapshot.mjs';

const assets=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',assets),'utf8').replace(/^import .*;\n/gm,'');
const fixture=count=>({version:1,rules:engine.clone(engine.DEFAULT_RULES),complete:true,plans:[],appliedImports:['kept-receipt'],
  records:Array.from({length:count},(_,i)=>({id:'record-'+i,date:engine.addDays('2020-01-01',i),type:['whole','mixed','plasma'][i%3]}))});
function harness(count=201,{savedState,date='2026-10-18'}={}){
  const initial=savedState??fixture(count),events={},elements=new Map(),prompts=[],finished=[],requests=[],exports=[],timers=new Map();let timerId=0,currentDate=date;
  let networkFailure=false,release=null;
  const node=key=>({innerHTML:'',textContent:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
    addEventListener:(event,fn)=>events[key+':'+event]=fn,removeEventListener(){},setAttribute(){},querySelectorAll:()=>[],
    scrollIntoView(){},focus(){},showModal(){this.open=true;},close(){this.open=false;events[key+':close']?.();}});
  for(const match of readFileSync(new URL('index.html',assets),'utf8').matchAll(/id="([^"]+)"/g))elements.set('#'+match[1],node('#'+match[1]));
  for(const key of ['#records-list','#record-page','#holiday-status','[data-action="refresh-holidays"]','#backup-current','#confirm-restore','#backup-password-form','#backup-password-status'])elements.set(key,node(key));
  const form=elements.get('#backup-password-form');form.elements={password:{value:''},confirm:{value:''}};
  form.querySelector=()=>({disabled:false});form.reset=()=>{form.elements.password.value='';form.elements.confirm.value='';};
  const cache=new Map([['blood-note-v1',JSON.stringify(initial)]]);
  const storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)};
  const document={querySelector:key=>elements.get(key)||null,querySelectorAll:()=>[],addEventListener:(event,fn,capture)=>events['document:'+event+(capture?':capture':'')]=fn};
  const window={localStorage:storage,matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){},scrollTo(){},BloodNoteAndroid:{
    requestHolidayConsent:id=>prompts.push(id),finishHolidayRefresh:id=>finished.push(id),saveText:(name,mime,text)=>exports.push({name,mime,text})}};
  const payload=engine.clone(HOLIDAY_SNAPSHOT.years);payload[2026]['2026-10-20']=['임시공휴일 테스트'];
  const context=vm.createContext({...licenses,...backupCrypto,createProtectedStorage:({legacyStorage})=>legacyStorage,...engine,...calendar,...certificate,today:()=>currentDate,
    createHolidayStore:opts=>createHolidayStore({...opts,fetcher:async(url,options)=>{
      requests.push({url,options});await new Promise(resolve=>release=resolve);
      if(networkFailure)throw Error('offline');return {ok:true,text:async()=>JSON.stringify(payload)};
    }}),window,document,localStorage:storage,navigator:{},URL,location:{hash:'#records',href:'https://appassets.androidplatform.net/assets/index.html#records',origin:'https://appassets.androidplatform.net'},crypto:webcrypto,
    setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {initial,events,elements,prompts,finished,requests,exports,window,run,storage,timers,
    setToday:value=>{currentDate=value;run('refreshLocalDay()');},
    relaunch:()=>harness(count,{savedState:JSON.parse(storage.getItem('blood-note-v1')),date:currentDate}),
    html:()=>elements.get('#app').innerHTML,read:()=>JSON.parse(storage.getItem('blood-note-v1')),
    ids:()=>[...elements.get('#app').innerHTML.matchAll(/data-action="edit-record" data-id="([^"]+)"/g)].map(match=>match[1]),
    click:(action,data={})=>{const button={dataset:{action,...data},disabled:false};events['document:click']({target:{closest:selector=>selector==='[data-action]'?button:null},preventDefault(){}});},
    change:(id,value)=>events['#app:change']({target:{id,value,dataset:{}}}),
    password:async(value,confirm=value)=>{form.elements.password.value=value;form.elements.confirm.value=confirm;await events['#backup-password-form:submit']({preventDefault(){}});},
    consent:(allowed,id=prompts.at(-1))=>window.bloodNoteHolidayConsent(id,allowed),
    release:async(fail=false)=>{networkFailure=fail;release();await new Promise(resolve=>setImmediate(resolve));}
  };
}

test('Dashboard always uses today after relaunch and Korean midnight, without changing records or using network',()=>{
  const h=harness();h.click('dashboard');const saved=h.read();
  assert.doesNotMatch(h.html(),/anchor-mode|anchor-date|dashboard-controls|잔여량 계산 기준일/);
  assert.equal(h.run('anchorDate()'),'2026-10-18');
  h.run("Date.now=()=>Date.parse('2026-10-18T14:59:59.000Z');refreshLocalDay()");
  assert.equal(h.timers.get(h.run('dayRefreshTimer')).delay,1100);
  let reopened=h.relaunch();reopened.click('dashboard');
  assert.equal(reopened.run('anchorDate()'),'2026-10-18');
  reopened.setToday('2026-10-19');assert.equal(reopened.run('anchorDate()'),'2026-10-19');
  assert.match(reopened.html(),/2026\. 10\. 19\. 월요일 기준/);
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
  h.click('settings');assert.match(h.html(),/계산 기준과 보관/);assert.match(h.html(),/안드로이드 2.0.3/);
  assert.equal(h.requests.length,0);
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


test('Plan/record notices expire after exactly three seconds and discard the undo action',()=>{
  const h=harness(1);h.click('delete-record',{id:'record-0'});
  const timer=h.timers.get(h.run('toastTimer'));assert.equal(timer.delay,3000);
  assert.equal(typeof h.run('undoAction'),'function');timer.fn();assert.equal(h.run('undoAction'),null);
  assert.equal(h.read().records.length,0);
  h.run("toast('계획을 추가했습니다.',()=>{})");assert.equal(h.timers.get(h.run('toastTimer')).delay,3000);
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
