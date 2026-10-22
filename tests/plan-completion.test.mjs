import * as licenses from '../assets/licenses.mjs';
import * as backupCrypto from '../assets/backup-crypto.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as calendar from '../assets/calendar-view.mjs';
import {createHolidayStore} from '../assets/holidays.mjs';

const root=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',root),'utf8').replace(/^import .*;\n/gm,'');
const initial={version:1,rules:engine.clone(engine.DEFAULT_RULES),complete:true,appliedImports:[],
  records:[{id:'record',date:'2026-09-01',type:'whole'}],
  plans:[{id:'past',date:'2026-10-04',type:'plasma'},{id:'today',date:'2026-10-18',type:'mixed'},{id:'future',date:'2026-10-19',type:'whole'}]};

function harness(){
  let currentDate='2026-10-18',requests=0;
  const stub=()=>({innerHTML:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},removeEventListener(){},setAttribute(){},querySelectorAll(){return[]},focus(){},showModal(){this.open=true},close(){this.open=false}});
  const elements=new Map([...readFileSync(new URL('index.html',root),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],stub()]));
  for(const selector of ['.calendar-scroll','#holiday-status','[data-action="refresh-holidays"]'])elements.set(selector,stub());
  const events={},timers=new Map(),cache=new Map([['blood-note-v1',JSON.stringify(initial)]]);
  let timerId=0;
  const storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)};
  const document={querySelector:s=>elements.get(s)||null,querySelectorAll:()=>[],visibilityState:'visible',addEventListener:(type,fn,capture)=>events['document:'+type+(capture?':capture':'')]=fn};
  const window={localStorage:storage,matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener:(type,fn)=>events['window:'+type]=fn,scrollTo(){}};
  const context=vm.createContext({...licenses,...backupCrypto,createProtectedStorage:({legacyStorage})=>legacyStorage,...engine,...calendar,today:()=>currentDate,createHolidayStore:options=>createHolidayStore({...options,fetcher:async()=>{requests++;throw Error('Unexpected network request')}}),document,window,localStorage:storage,navigator:{},location:{hash:'#planner',href:'https://appassets.androidplatform.net/assets/index.html#planner',origin:'https://appassets.androidplatform.net'},URL,crypto:webcrypto,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source,context);
  return {context,window,events,timers,
    html:()=>elements.get('#app').innerHTML,
    toast:()=>elements.get('#toast').innerHTML,
    read:()=>JSON.parse(storage.getItem('blood-note-v1')),
    requests:()=>requests,
    date:value=>{currentDate=value},
    run:code=>vm.runInContext(code,context),
    click:data=>{const button={dataset:data,disabled:false};events['document:click']({preventDefault(){},target:{closest:s=>s==='[data-page]'?(data.page?button:null):(data.action?button:null)}})}
  };
}

test('오늘·지난 계획은 계획 목록에서 기록/삭제 가능하고 미래 계획에는 완료 버튼이 없음',()=>{
  const h=harness();
  for(const id of ['past','today']){
    assert.equal((h.html().match(new RegExp('data-action="complete-plan" data-id="'+id+'"','g'))||[]).length,1);
    assert.match(h.html(),new RegExp('data-action="delete-plan" data-id="'+id+'"'));
  }
  assert.doesNotMatch(h.html(),/data-action="complete-plan" data-id="future"/);
  assert.match(h.html(),/헌혈 기록으로 남기기/);
  assert.deepEqual(h.read().records,initial.records);
  assert.equal(h.requests(),0);
});

test('기록 남기기는 같은 날짜·종류·ID로 한 번만 이동하고 되돌리기로 복원',()=>{
  const h=harness(),before=h.read();
  h.click({action:'complete-plan',id:'today'});
  let value=h.read();
  assert.deepEqual(value.records.find(e=>e.id==='today'),initial.plans[1]);
  assert.equal(value.records.length,2);assert.equal(value.plans.length,2);
  assert.ok(!value.plans.some(e=>e.id==='today'));
  assert.equal(engine.stats(value.records,'2026-10-18',value.rules).used,520);
  h.click({action:'complete-plan',id:'today'});
  assert.deepEqual(h.read(),value);
  h.run('undoAction()');
  assert.deepEqual(h.read(),before);
  h.click({action:'complete-plan',id:'past'});
  assert.deepEqual(h.read().records.find(e=>e.id==='past'),initial.plans[0]);
  assert.equal(h.requests(),0);
});

test('미래 계획의 기록 전환 및 같은 날짜의 중복 기록 생성 차단',()=>{
  const h=harness(),before=h.read();
  h.click({action:'complete-plan',id:'future'});
  assert.deepEqual(h.read(),before);assert.match(h.toast(),/예정일이 되면/);
  h.run("state.records.push({id:'other',date:'2026-10-18',type:'mixed'});persist()");
  const duplicate=h.read();
  h.click({action:'complete-plan',id:'today'});
  assert.deepEqual(h.read(),duplicate);assert.match(h.toast(),/이미 있습니다/);
});

test('지난 계획 삭제는 실제 기록을 유지하고 되돌리기로 해당 계획 복원',()=>{
  const h=harness(),before=h.read();
  h.click({action:'delete-plan',id:'past'});
  assert.deepEqual(h.read().records,before.records);
  assert.ok(!h.read().plans.some(e=>e.id==='past'));
  h.run('undoAction()');assert.deepEqual(h.read(),before);
});

test('자정·앱 복귀·다시 보기에 날짜만 갱신하여 버튼 전환, 기록 자동 생성이나 통신 없음',()=>{
  for(const trigger of ['midnight','resume','visibility','focus']){
    const h=harness(),before=h.read();
    h.date('2026-10-19');
    if(trigger==='midnight'){
      const timer=[...h.timers.values()].find(x=>x.fn===h.window.bloodNoteRefreshDay);
      assert.ok(timer&&timer.delay>0);timer.fn();
    }else if(trigger==='resume')h.window.bloodNoteRefreshDay();
    else h.events[(trigger==='focus'?'window:focus':'document:visibilitychange')]();
    assert.match(h.html(),/data-action="complete-plan" data-id="future"/);
    assert.deepEqual(h.read(),before);
    assert.equal(h.requests(),0);
  }
});
