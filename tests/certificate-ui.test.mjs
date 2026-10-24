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
import {createHolidayStore} from '../assets/holidays.mjs';
const root=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',root),'utf8').replace(/^import .*;\n/gm,'');
const blank=()=>({version:1,rules:engine.clone(engine.DEFAULT_RULES),records:[],plans:[],complete:false,appliedImports:[]});
const payload=(count=21)=>({pages:Math.ceil(count/10),expected:count,rows:Array.from({length:count},(_,i)=>({date:engine.addDays('2020-01-01',i),type:'mixed',sourceType:'혈소판혈장',page:Math.floor(i/10)+1}))});
function harness(initial=blank(),currentDate='2026-10-18',hash='#records'){
  const events={},elements=new Map();let requests=0,picks=0,cancels=0,failSave=false;
  const node=key=>({innerHTML:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},
    addEventListener:(event,fn)=>events[key+':'+event]=fn,removeEventListener(){},setAttribute(){},querySelectorAll(){return[]},focus(){},
    showModal(){this.open=true;},close(){this.open=false;events[key+':close']?.();}});
  for(const match of readFileSync(new URL('index.html',root),'utf8').matchAll(/id="([^"]+)"/g))elements.set('#'+match[1],node('#'+match[1]));
  for(const key of ['.calendar-scroll','#holiday-status','[data-action="refresh-holidays"]','#certificate-selection','#certificate-progress','#certificate-progress-label','[data-action="certificate-commit"]'])elements.set(key,node(key));
  for(const key of ['#event-form','#event-feedback'])elements.set(key,node(key));
  elements.get('#event-form').elements={date:{value:currentDate},type:{value:'whole'}};
  const cache=new Map([['blood-note-v1',JSON.stringify(initial)]]);
  const storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>{if(failSave){const error=Error('Storage full');error.name='QuotaExceededError';throw error;}cache.set(k,v);}};
  const document={querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],addEventListener:(event,fn,capture)=>events['document:'+event+(capture?':capture':'')]=fn};
  const window={localStorage:storage,BloodNoteAndroid:{importCertificate:()=>picks++,cancelCertificateImport:()=>cancels++},matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){},scrollTo(){}};
  const context=vm.createContext({...licenses,...backupCrypto,createProtectedStorage:({legacyStorage})=>legacyStorage,...engine,...calendar,...screenLayout,...layoutDrag,...certificate,today:()=>currentDate,createHolidayStore:opts=>createHolidayStore({...opts,fetcher:async()=>{requests++;throw Error('Network not allowed');}}),window,document,localStorage:storage,navigator:{},location:{hash,href:'https://appassets.androidplatform.net/assets/index.html'+hash,origin:'https://appassets.androidplatform.net'},URL,crypto:webcrypto,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {events,elements,window,run,fail:()=>{failSave=true;},allow:()=>{failSave=false;},
    read:()=>JSON.parse(storage.getItem('blood-note-v1')),html:()=>elements.get('#dialog-content').innerHTML,
    live:()=>JSON.parse(run('JSON.stringify(state)')),requests:()=>requests,picks:()=>picks,cancels:()=>cancels,
    click:action=>{const button={dataset:{action},disabled:false};events['document:click']({preventDefault(){},target:{closest:selector=>selector==='[data-action]'?button:null}});},
    check:(i,checked)=>events['#dialog:change']({target:{dataset:{certificateIndex:String(i)},checked}}),
    ready:p=>window.bloodNoteCertificateEvent('ready',p)};
}
test('The date header has no add button; the record actions retain manual entry and cancellable PDF import',()=>{
  const h=harness(),before=h.read();
  assert.equal(h.elements.has('#quick-add'),false);
  for(const page of ['dashboard','planner','records','settings']){h.run(`setPage('${page}')`);assert.deepEqual(h.read(),before);}
  h.run("setPage('records')");h.click('add-record');
  assert.match(h.html(),/id="event-form"/);assert.match(h.html(),/기록 저장/);
  assert.equal(h.picks(),0);assert.deepEqual(h.read(),before);h.click('close-dialog');
  h.click('import-certificate');h.click('certificate-choose-file');assert.equal(h.picks(),1);assert.match(h.html(),/파일 선택을 기다리고/);
  h.window.bloodNoteCertificateEvent('cancelled',{});
  assert.equal(h.elements.get('#dialog').open,false);assert.deepEqual(h.read(),before);assert.equal(h.requests(),0);
});
test('PDF UI waits for review and confirmation, pages 20 rows, and preserves individual selections',()=>{
  const h=harness(),before=h.read();h.click('import-certificate');h.click('certificate-choose-file');assert.equal(h.picks(),1);assert.deepEqual(h.read(),before);
  h.window.bloodNoteCertificateEvent('progress',{done:5,total:21});assert.match(h.elements.get('#certificate-progress-label').textContent,/5 \/ 21/);
  h.ready(payload());assert.deepEqual(h.read(),before);assert.equal((h.html().match(/data-certificate-index=/g)||[]).length,20);
  h.check(0,false);assert.equal(h.elements.get('[data-action="certificate-commit"]').textContent,'선택한 20건 등록');
  h.click('certificate-next');assert.equal((h.html().match(/data-certificate-index=/g)||[]).length,1);
  h.click('certificate-prev');assert.doesNotMatch(h.html(),/data-certificate-index="0" checked/);
  h.click('certificate-commit');assert.equal(h.read().records.length,20);assert.equal(h.run('certificateStage'),null);
  assert.ok(!h.read().records.some(row=>row.date==='2020-01-01'));assert.equal(h.requests(),0);
  h.run('undoAction()');assert.deepEqual(h.read(),before);
});
test('PDF UI blocks repeated import and requires explicit selection to correct conflicting record types',()=>{
  const initial=blank();initial.records=[{id:'keep',date:'2020-01-01',type:'plasma'}];
  const h=harness(initial);h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));
  assert.equal(h.elements.get('[data-action="certificate-commit"]').disabled,true);
  h.check(0,true);h.click('certificate-commit');assert.deepEqual(h.read().records,[{id:'keep',date:'2020-01-01',type:'mixed'}]);
  h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));assert.equal(h.elements.get('[data-action="certificate-commit"]').disabled,true);
  assert.match(h.html(),/이미 등록됨/);h.click('certificate-commit');assert.equal(h.read().records.length,1);
});
test('Closing a PDF read cancels native work and discards late results without changing storage',()=>{
  const h=harness(),before=h.read();h.click('import-certificate');h.click('certificate-choose-file');h.click('close-dialog');assert.equal(h.cancels(),1);
  h.ready(payload());assert.deepEqual(h.read(),before);assert.equal(h.run('certificateStage'),null);
  h.click('import-certificate');h.click('certificate-choose-file');h.window.bloodNoteCertificateEvent('cancelled',{});assert.deepEqual(h.read(),before);
});

test('Native PDF password prompts keep JS in read-only review flow and never create a password field or stored value',()=>{
  const h=harness(),before=h.read();h.click('import-certificate');h.click('certificate-choose-file');
  for(let retry=0;retry<2;retry++){
    h.window.bloodNoteCertificateEvent('password',{});
    assert.match(h.elements.get('#certificate-progress-label').textContent,/암호 입력을 기다리고/);
    assert.doesNotMatch(h.html(),/<input[^>]*type="password"/);
    assert.equal(h.run('certificateStage.phase'),'reading');assert.deepEqual(h.read(),before);
    h.window.bloodNoteCertificateEvent('reading',{});
  }
  h.ready(payload(1));assert.deepEqual(h.read(),before);h.click('certificate-commit');
  assert.equal(h.read().records.length,1);assert.doesNotMatch(JSON.stringify(h.read()),/password|생년월일/);
  h.click('import-certificate');h.click('certificate-choose-file');h.window.bloodNoteCertificateEvent('password',{});h.click('close-dialog');
  const saved=h.read();h.ready(payload(2));assert.deepEqual(h.read(),saved);assert.equal(h.requests(),0);
});
test('Corrupt or future-dated PDF results and native failures preserve records and show escaped errors',()=>{
  const h=harness(),before=h.read();h.click('import-certificate');h.click('certificate-choose-file');const p=payload(1);p.rows[0].date='2099-01-01';h.ready(p);
  assert.match(h.html(),/날짜 설정을 확인/);assert.match(h.html(),/2099-01-01/);assert.match(h.html(),/2026-10-18/);assert.deepEqual(h.read(),before);
  h.click('import-certificate');h.click('certificate-choose-file');h.window.bloodNoteCertificateEvent('error',{message:'<script>invalid</script>'});
  assert.match(h.html(),/&lt;script&gt;/);assert.doesNotMatch(h.html(),/<script>/);assert.deepEqual(h.read(),before);
});
test('Storage failure leaves both current and saved records unchanged and a retry succeeds once',()=>{
  const h=harness(),before=h.read();h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));h.fail();h.click('certificate-commit');
  assert.deepEqual(h.read(),before);assert.deepEqual(h.live(),before);assert.equal(h.run('certificateStage.phase'),'review');
  h.allow();h.click('certificate-commit');assert.equal(h.read().records.length,1);h.click('certificate-commit');assert.equal(h.read().records.length,1);
  const reloaded=harness(h.read());assert.equal(reloaded.read().records.length,1);assert.equal(reloaded.requests(),0);
});
test('PDF import and undo preserve legacy metadata without changing the fixed today reference',()=>{
  const initial={...blank(),calculationAnchor:{mode:'custom',customDate:'2025-06-07'}};
  const h=harness(initial);h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));h.click('certificate-commit');
  assert.deepEqual(h.read().calculationAnchor,initial.calculationAnchor);
  assert.equal(h.run('anchorDate()'),'2026-10-18');
  h.run('undoAction()');assert.deepEqual(h.read(),initial);
  const reopened=harness(h.read());assert.equal(reopened.run('anchorDate()'),'2026-10-18');
  assert.equal(h.requests(),0);
});
test('Undoing a PDF import after navigating keeps the actual last screen, including across relaunch and a failed undo write',()=>{
  for(const page of ['planner','settings'])for(const fail of [false,true]){
    const h=harness({...blank(),startPage:'last',lastPage:'records'}),before=h.read();
    h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));h.click('certificate-commit');
    h.click(page);assert.equal(h.read().lastPage,page);assert.equal(h.read().records.length,1);
    const after=h.read();if(fail)h.fail();h.run('undoAction()');
    if(fail){assert.deepEqual(h.read(),after);assert.deepEqual(h.live(),after);}
    else{assert.deepEqual(h.read().records,before.records);assert.deepEqual(h.read().plans,before.plans);}
    assert.equal(h.read().lastPage,page);assert.equal(h.run('page'),page);
    const restarted=harness(h.read(),'2026-10-18','');
    assert.equal(restarted.run('page'),page);assert.equal(h.requests()+restarted.requests(),0);
  }
});
test('Changes made after preview require a refreshed review before overwrite; plans convert only on commit',()=>{
  const initial=blank();initial.plans=[{id:'planned',date:'2020-01-01',type:'mixed'}];
  const h=harness(initial);h.click('import-certificate');h.click('certificate-choose-file');h.ready(payload(1));assert.deepEqual(h.read(),initial);
  h.click('certificate-commit');assert.equal(h.read().plans.length,0);assert.equal(h.read().records[0].id,'planned');
  const other=harness();other.click('import-certificate');other.click('certificate-choose-file');other.ready(payload(1));
  other.run("state.records.push({id:'concurrent',date:'2020-01-01',type:'whole'});persist()");other.click('certificate-commit');
  assert.equal(other.read().records[0].type,'whole');assert.equal(other.elements.get('[data-action="certificate-commit"]').disabled,true);
});

test('PDF picker waits for a separate disclosure confirmation; cancel, late results and double taps cannot read files',()=>{
 const h=harness(),before=h.read();
 h.click('import-certificate');assert.equal(h.picks(),0);assert.match(h.html(),/전체 저장소 접근 권한은 요청하지 않습니다/);assert.match(h.html(),/PDF 선택하기/);
 assert.match(h.html(),/제작자는 증명서의 개인정보를 수집하지 않습니다/);assert.match(h.html(),/주소·성명·헌혈 장소\(기관\)·생년월일·주민등록번호/);assert.match(h.html(),/원문은 기기 메모리에서 일시 처리/);
 h.ready(payload());assert.equal(h.run('certificateStage.phase'),'permission');assert.deepEqual(h.read(),before);
 h.click('close-dialog');h.click('certificate-choose-file');assert.equal(h.picks(),0);
 h.click('import-certificate');h.click('certificate-choose-file');h.click('certificate-choose-file');assert.equal(h.picks(),1);assert.deepEqual(h.read(),before);
 h.ready(payload(1));assert.equal(h.run('certificateStage.phase'),'review');assert.deepEqual(h.read(),before);
 assert.match(h.html(),/증명서 개인정보 안내/);assert.match(h.html(),/별도 항목으로 추출·저장하거나 외부로 전송하지 않습니다/);assert.match(h.html(),/PDF 암호가 생년월일이더라도/);
 h.click('certificate-commit');assert.equal(h.read().records.length,1);assert.equal(h.requests(),0);
});
test('Failing PDF chooser leaves records intact and permits a fresh disclosure and retry',()=>{
 const h=harness(),before=h.read();h.window.BloodNoteAndroid.importCertificate=()=>{throw Error('picker unavailable');};
 h.click('import-certificate');assert.equal(h.picks(),0);h.click('certificate-choose-file');assert.match(h.html(),/파일 선택 중단/);assert.equal(h.run('certificateStage'),null);assert.deepEqual(h.read(),before);
 h.click('close-dialog');let calls=0;h.window.BloodNoteAndroid.importCertificate=()=>calls++;
 h.click('import-certificate');assert.equal(calls,0);h.click('certificate-choose-file');assert.equal(calls,1);assert.equal(h.requests(),0);
});
