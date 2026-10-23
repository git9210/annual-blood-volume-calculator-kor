import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as calendar from '../assets/calendar-view.mjs';
import * as licenses from '../assets/licenses.mjs';

test('Restriction editor replaces the date popup, keeps only the date range card and preserves an unsaved choice',()=>{
  const h=harness(),before=h.read();
  h.click('day',{date:'2026-10-23'});h.click('day-type',{type:'plasma'});h.click('restriction-new');
  assert.match(h.html(),/헌혈 제한 설정/);assert.match(h.html(),/제한 적용 기간/);
  assert.doesNotMatch(h.html(),/14일간 모든 헌혈 제한|기존 조건 재계산|제한 종료 후 예시/);
  assert.equal(h.restrictionForm().elements.days.value,'14');
  assert.equal(h.nodes.get('#restriction-range').textContent,'2026. 10. 23. ~ 2026. 11. 5.');
  h.click('restriction-more');assert.equal(h.restrictionForm().elements.days.value,'15');
  h.click('restriction-less');h.restrictionForm({reason:'약 복용'});
  h.click('restriction-back');assert.match(h.html(),/data-type="plasma" aria-pressed="true"/);
  assert.deepEqual(h.read(),before);
  h.click('restriction-new');h.restrictionForm({reason:'약 복용'}).onsubmit({preventDefault(){}});
  const saved=h.read();assert.equal(saved.restrictions.length,1);
  assert.deepEqual(saved.records,before.records);assert.deepEqual(saved.plans,before.plans);
  assert.equal(saved.restrictions[0].end,'2026-11-05');assert.match(h.html(),/직접 등록한 헌혈 제한/);
  assert.match(h.html(),/data-type="plasma" aria-pressed="true"/);
  assert.match(h.app(),/manually-restricted/);assert.match(h.app(),/헌혈 제한 기간/);
  h.run("setPage('dashboard')");h.today('2026-10-23',true);assert.match(h.app(),/등록한 헌혈 제한이 적용 중/);
  assert.equal(h.requests(),0);
});
test('Restriction edit/delete/undo retain records, plans and settings across a relaunch',()=>{
  const initial={records:[{id:'done',date:'2026-09-01',type:'whole'}],plans:[{id:'plan',date:'2026-11-01',type:'plasma'}],restrictions:[{id:'pause',start:'2026-10-23',end:'2026-11-05',reason:'약 복용'}]};
  const h=harness(initial);h.click('restriction-edit',{id:'pause'});
  assert.equal(h.restrictionForm().elements.reason.value,'약 복용');
  h.restrictionForm({days:1,reason:''}).onsubmit({preventDefault(){}});
  assert.deepEqual(h.read().restrictions,[{id:'pause',start:'2026-10-23',end:'2026-10-23',reason:''}]);
  assert.match(h.html(),/사유 미입력/);
  const saved=h.read(),restarted=harness(saved);assert.deepEqual(restarted.read(),saved);
  restarted.click('restriction-delete',{id:'pause'});assert.deepEqual(restarted.read().restrictions,[]);
  assert.deepEqual(restarted.read().records,initial.records);assert.deepEqual(restarted.read().plans,initial.plans);
  restarted.run('undoAction()');assert.deepEqual(restarted.read(),saved);
  const encrypted=h.run("JSON.stringify(validateState(state))");assert.equal(JSON.parse(encrypted).restrictions[0].id,'pause');
});
test('Invalid reasons/durations, failed writes, stale editors and outside taps never partly save a restriction',()=>{
  const h=harness(),before=h.read();h.click('day',{date:'2026-10-23'});h.click('restriction-new');
  for(const values of [{reason:'💊'},{reason:'가'.repeat(21)},{reason:'',days:'0'},{days:'1.5'},{days:'1e3'},{days:'3651'},{days:'14',start:'2199-12-31'}]){
    h.restrictionForm(values).onsubmit({preventDefault(){}});
    assert.deepEqual(h.read(),before);assert.equal(h.nodes.get('#restriction-feedback').hidden,false);
  }
  h.restrictionForm({start:'2026-10-23',days:'14',reason:''});h.fail(true);
  h.restrictionForm().onsubmit({preventDefault(){}});assert.deepEqual(h.read(),before);
  h.fail(false);h.restrictionForm().onsubmit({preventDefault(){}});assert.equal(h.read().restrictions.length,1);
  h.click('restriction-new');h.run("state.restrictions.push({id:'other',start:'2026-12-01',end:'2026-12-01',reason:''})");
  const saved=h.read();h.restrictionForm().onsubmit({preventDefault(){}});assert.deepEqual(h.read(),saved);
  assert.match(h.nodes.get('#restriction-feedback').textContent,/바뀌었습니다/);
  h.pointer('pointerdown');h.pointer('click');assert.equal(h.open(),false);assert.equal(h.run('restrictionEditor'),null);
  h.run('saveRestriction()');assert.deepEqual(h.read(),saved);assert.equal(h.requests(),0);
});
test('A restriction never replaces actual completed markers; conflicts stay editable assumptions',()=>{
  const h=harness({records:[{id:'done',date:'2026-10-22',type:'plasma'}],restrictions:[{id:'pause',start:'2026-10-22',end:'2026-11-05',reason:''}]});
  h.click('day',{date:'2026-10-22'});assert.match(h.html(),/완료/);assert.match(h.html(),/등록한 헌혈 제한/);
  h.click('day',{date:'2026-10-23'});h.click('day-type',{type:'plasma'});h.click('day-confirm');
  assert.equal(h.read().plans.length,1);assert.equal(h.read().records.length,1);assert.match(h.app(),/조정 필요/);
});
import * as backupCrypto from '../assets/backup-crypto.mjs';
import {createHolidayStore} from '../assets/holidays.mjs';
const root=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',root),'utf8').replace(/^import .*;\n/gm,'');
function harness({records=[],plans=[],restrictions}={}){
  let date='2026-10-22',requests=0,writes=0,fail=false;
  const events={},nodes=new Map(),cache=new Map();
  const node=key=>({innerHTML:'',textContent:'',dataset:{},style:{},open:false,
    classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],querySelector:()=>null,focus(){},
    getBoundingClientRect:()=>({left:20,right:380,top:200,bottom:700}),
    addEventListener:(type,fn)=>events[key+':'+type]=fn,removeEventListener(){},
    showModal(){this.open=true;},close(){this.open=false;events[key+':close']?.();}});
  for(const m of readFileSync(new URL('index.html',root),'utf8').matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],node('#'+m[1]));
  for(const key of ['#holiday-status','[data-action="refresh-holidays"]','#date-popup-title','#event-form','#event-feedback','#restriction-form','#restriction-range','#restriction-feedback'])nodes.set(key,node(key));
  nodes.get('#restriction-form').elements={start:{value:''},reason:{value:''},days:{value:''}};
  let dialogHTML='';
  Object.defineProperty(nodes.get('#dialog-content'),'innerHTML',{get:()=>dialogHTML,set:html=>{
    dialogHTML=html;
    if(html.includes('id="restriction-form"'))for(const name of ['start','reason','days']){
      const match=html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
      nodes.get('#restriction-form').elements[name].value=(match?.[1]||'').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    }
  }});
  const form=nodes.get('#event-form');form.elements={date:{value:'2026-10-01'},type:{value:'plasma'}};
  cache.set('blood-note-v1',JSON.stringify({version:1,rules:engine.clone(engine.DEFAULT_RULES),records,plans,complete:true,appliedImports:[],...(restrictions?{restrictions}:{})}));
  const storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>{if(fail)throw Error('full');cache.set(key,value);writes++;}};
  const document={querySelector:key=>nodes.get(key)||null,querySelectorAll:()=>[],addEventListener:(type,fn,capture)=>events['doc:'+type+(capture?':capture':'')]=fn};
  const window={localStorage:storage,addEventListener(){},scrollTo(){}};
  const context=vm.createContext({...engine,...calendar,...licenses,...backupCrypto,today:()=>date,
    createProtectedStorage:({legacyStorage})=>legacyStorage,createHolidayStore:opts=>createHolidayStore({...opts,fetcher:async()=>{requests++;throw Error('Unexpected network');}}),
    window,document,navigator:{},location:{hash:'#planner',origin:'https://appassets.androidplatform.net',href:'https://appassets.androidplatform.net/assets/index.html#planner'},URL,crypto:webcrypto,
    setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(source,context);
  const click=(action,data={})=>events['doc:click']({target:{closest:s=>s==='[data-action]'?{dataset:{action,...data},disabled:false}:null},preventDefault(){}});
  return {nodes,click,run:code=>vm.runInContext(code,context),read:()=>JSON.parse(storage.getItem('blood-note-v1')),
    pointer:(event,{x=10,y=100,inside=false,button=0,isPrimary=true}={})=>{let prevented=false,stopped=false;events['#dialog:'+event]?.({target:nodes.get(inside?'#dialog-content':'#dialog'),clientX:x,clientY:y,button,isPrimary,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});return {prevented,stopped};},
    html:()=>nodes.get('#dialog-content').innerHTML,app:()=>nodes.get('#app').innerHTML,
    restrictionForm:(values={})=>{const form=nodes.get('#restriction-form');for(const [key,value] of Object.entries(values))form.elements[key].value=String(value);events['#restriction-form:input']?.();return form;},
    open:()=>nodes.get('#dialog').open,requests:()=>requests,writes:()=>writes,fail:value=>fail=value,
    today:(value,refresh=false)=>{date=value;if(refresh)window.bloodNoteRefreshDay();}};
}
test('Date tap opens four ordered choices and holiday title; selection/cancel never writes records or plans',()=>{
  const h=harness(),before=h.read(),writes=h.writes();
  h.click('day',{date:'2027-02-06'});assert.equal(h.open(),true);
  assert.match(h.html(),/2월 6일 <span>토요일/);assert.match(h.html(),/설날/);
  assert.deepEqual([...h.html().matchAll(/data-action="day-type" data-type="([^"]+)"/g)].map(m=>m[1]),['whole','plasma','platelet','mixed']);
  assert.match(h.html(),/data-action="day-confirm" disabled/);
  h.click('day-confirm');assert.deepEqual(h.read(),before);
  h.click('day-type',{type:'whole'});assert.match(h.html(),/430/);assert.match(h.html(),/1,730/);
  h.click('close-dialog');assert.equal(h.open(),false);assert.deepEqual(h.read(),before);
  assert.equal(h.writes(),writes);assert.equal(h.requests(),0);
});
test('Confirm saves once; reopening preselects existing type and changing preserves ID',()=>{
  const h=harness();h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'plasma'});h.click('day-confirm');
  const first=h.read();assert.equal(first.plans.length,1);assert.equal(first.records.length,0);
  h.click('day-confirm');assert.deepEqual(h.read(),first);
  h.click('day',{date:'2027-02-19'});assert.match(h.html(),/data-type="plasma" aria-pressed="true"/);
  h.click('day-type',{type:'mixed'});assert.deepEqual(h.read(),first);h.click('day-confirm');
  assert.deepEqual(h.read().plans,[{...first.plans[0],type:'mixed'}]);
  h.click('day',{date:'2027-02-19'});const writes=h.writes();h.click('day-confirm');assert.equal(h.writes(),writes);
});
test('Reopen and cancel plan removes only that plan; undo restores it',()=>{
  const plans=[{id:'one',date:'2027-02-19',type:'plasma'},{id:'two',date:'2027-03-19',type:'whole'}];
  const h=harness({plans}),before=h.read();h.click('day',{date:plans[0].date});assert.match(h.html(),/계획 취소/);
  h.click('day-delete');assert.equal(h.open(),false);assert.deepEqual(h.read().plans,[plans[1]]);
  h.run('undoAction()');assert.deepEqual(h.read(),before);
});
test('Restriction and impact on later plans are shown before explicit simulation save',()=>{
  const h=harness({records:[{id:'record',date:'2026-10-20',type:'whole'}]});
  h.click('day',{date:'2026-10-23'});h.click('day-type',{type:'plasma'});
  assert.match(h.html(),/제한 있는 가정으로 저장/);assert.match(h.html(),/56일 간격 필요/);
  assert.equal(h.read().plans.length,0);h.click('day-confirm');assert.equal(h.read().plans.length,1);
  const next=harness({plans:[{id:'later',date:'2027-02-20',type:'plasma'}]});
  next.click('day',{date:'2027-02-19'});next.click('day-type',{type:'whole'});
  assert.match(next.html(),/계획에 영향/);assert.match(next.html(),/제한 있는 가정으로 저장/);
  assert.equal(next.read().plans.length,1);assert.equal(next.requests(),0);
});
test('Changed records require review again instead of saving stale calculations',()=>{
  const h=harness();h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'whole'});
  h.run("state.plans.push({id:'new',date:'2027-02-18',type:'plasma'});persist()");
  h.click('day-confirm');assert.equal(h.read().plans.length,1);assert.equal(h.open(),true);
  assert.match(h.html(),/14일 간격 필요/);h.click('day-confirm');assert.equal(h.read().plans.length,2);
});
test('Rollover never creates a past plan; due popup changes to record conversion',()=>{
  const h=harness();h.click('day',{date:'2026-10-22'});h.click('day-type',{type:'plasma'});
  h.today('2026-10-23');h.click('day-confirm');assert.equal(h.read().plans.length,0);
  assert.match(h.html(),/data-action="day-add-record"/);
  const due=harness({plans:[{id:'due',date:'2026-10-23',type:'mixed'}]});
  due.click('day',{date:'2026-10-23'});due.today('2026-10-24',true);
  assert.match(due.html(),/data-action="day-complete"/);due.click('day-complete');
  assert.deepEqual(due.read().records,[{id:'due',date:'2026-10-23',type:'mixed'}]);assert.equal(due.read().plans.length,0);
  due.click('day-complete');assert.equal(due.read().records.length,1);
});
test('Storage failure leaves popup retryable and keeps saved history intact',()=>{
  const h=harness(),before=h.read();h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'whole'});
  h.fail(true);h.click('day-confirm');assert.deepEqual(h.read(),before);assert.equal(h.open(),true);
  h.fail(false);h.click('day-confirm');assert.equal(h.read().plans.length,1);assert.equal(h.open(),false);
  h.click('day',{date:'2027-02-19'});h.fail(true);h.click('day-delete');assert.equal(h.read().plans.length,1);assert.equal(h.open(),true);
  h.fail(false);h.click('day-delete');assert.equal(h.read().plans.length,0);
});
test('Actual records stay read-only in the date popup; edit/add open the normal record editor',()=>{
  const h=harness({records:[{id:'actual',date:'2026-10-01',type:'plasma'}]}),before=h.read();
  h.click('day',{date:'2026-10-01'});assert.match(h.html(),/data-action="day-edit-record"/);
  assert.equal((h.html().match(/aria-pressed="(?:true|false)" disabled/g)||[]).length,4);
  h.click('day-type',{type:'whole'});h.click('day-confirm');assert.deepEqual(h.read(),before);
  h.click('day-edit-record');assert.match(h.html(),/data-kind="record" data-id="actual"/);
  h.click('close-dialog');h.click('day',{date:'2026-09-30'});h.click('day-add-record');
  assert.match(h.html(),/value="2026-09-30"/);assert.deepEqual(h.read(),before);
});
test('Android back-style dialog close cancels unsaved selection and clears transient popup state',()=>{
  const h=harness(),before=h.read();h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'platelet'});
  h.nodes.get('#dialog').close();assert.equal(h.run('dayPopup'),null);h.click('day-confirm');assert.deepEqual(h.read(),before);
  assert.equal(h.requests(),0);
});

test('One outside tap dismisses record choices, manual editor and date popup without saving or passing the tap through',()=>{
  const h=harness({plans:[{id:'kept',date:'2027-02-19',type:'plasma'}]}),before=h.read(),writes=h.writes();
  for(const open of [()=>h.nodes.get('#quick-add').onclick(),()=>h.click('add-record'),()=>{h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'whole'});}]){
    open();assert.equal(h.open(),true);h.pointer('pointerdown');
    assert.deepEqual(h.pointer('click'),{prevented:true,stopped:true});
    assert.equal(h.open(),false);assert.equal(h.run('dayPopup'),null);
    assert.deepEqual(h.read(),before);assert.equal(h.writes(),writes);
  }
  h.click('day-confirm');assert.deepEqual(h.read(),before);assert.equal(h.requests(),0);
});

test('Inner content, dialog padding, interrupted gestures and inside-to-outside drags never dismiss the popup',()=>{
  const h=harness();h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'platelet'});
  const selected=h.html();
  for(const position of [{x:100,y:300,inside:true},{x:21,y:201},{x:380,y:700}]){
    h.pointer('pointerdown',position);h.pointer('click',position);assert.equal(h.open(),true);
  }
  h.pointer('pointerdown',{x:100,y:300,inside:true});h.pointer('click');assert.equal(h.open(),true);
  h.pointer('pointerdown');h.pointer('pointercancel');h.pointer('click');assert.equal(h.open(),true);
  h.pointer('pointerdown',{button:2});h.pointer('click');assert.equal(h.open(),true);
  h.pointer('pointerdown',{isPrimary:false});h.pointer('click');assert.equal(h.open(),true);
  h.pointer('pointerdown');h.pointer('click',{x:100,y:300,inside:true});assert.equal(h.open(),true);
  assert.equal(h.html(),selected);assert.equal(h.read().plans.length,0);
  h.pointer('pointerdown');h.pointer('click');assert.equal(h.open(),false);
  h.click('day',{date:'2027-02-19'});h.pointer('click');assert.equal(h.open(),true);
  assert.match(h.html(),/data-action="day-confirm" disabled/);
});

test('Backdrop dismissal runs existing PDF and backup cancellation cleanup and allows subsequent dialogs',()=>{
  const h=harness(),before=h.read();
  h.run("window.cancelledImports=0;window.BloodNoteAndroid={cancelCertificateImport(){window.cancelledImports++;}};certificateStage={phase:'reading'};openDialog('PDF','', '<p>Reading</p>')");
  const previous=h.run('backupTask');h.pointer('pointerdown');h.pointer('click');
  assert.equal(h.run('window.cancelledImports'),1);assert.equal(h.run('certificateStage'),null);
  assert.equal(h.run('backupTask'),previous+1);assert.deepEqual(h.read(),before);
  h.nodes.get('#quick-add').onclick();assert.equal(h.open(),true);
  h.click('close-dialog');assert.equal(h.open(),false);
});

function redConnectBridge(h){
  h.run('window.redConnectRequests=[];window.BloodNoteAndroid={requestRedConnect(...args){window.redConnectRequests.push(args);}}');
  return ()=>JSON.parse(h.run('JSON.stringify(window.redConnectRequests)'));
}
test('Red Connect popup shortcut requests native consent only on tap, sends no data and preserves an unsaved choice',()=>{
  const h=harness(),requests=redConnectBridge(h),before=h.read(),writes=h.writes();
  h.click('day',{date:'2027-02-19'});h.click('day-type',{type:'plasma'});
  assert.match(h.html(),/data-action="day-red-connect"/);assert.match(h.html(),/선택 완료.*저장/);
  assert.deepEqual(requests(),[]);h.click('day-red-connect');
  assert.deepEqual(requests(),[[]]);assert.equal(h.open(),true);
  assert.match(h.html(),/data-type="plasma" aria-pressed="true"/);
  assert.deepEqual(h.read(),before);assert.equal(h.writes(),writes);assert.equal(h.requests(),0);
  h.click('day-confirm');assert.equal(h.read().plans.length,1);
  h.click('day',{date:'2027-02-19'});h.click('day-red-connect');
  assert.deepEqual(requests(),[[],[]]);assert.equal(h.read().plans.length,1);
});
test('Exactly the earliest today-or-future plan has a shortcut, and deletion or date rollover moves it',()=>{
  const h=harness({plans:[{id:'later',date:'2027-02-19',type:'whole'},{id:'past',date:'2026-10-01',type:'mixed'},{id:'next',date:'2026-11-06',type:'plasma'},{id:'due',date:'2026-10-22',type:'platelet'}]});
  const requests=redConnectBridge(h),ids=()=>[...h.app().matchAll(/data-action="plan-red-connect" data-id="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids(),['due']);assert.deepEqual(requests(),[]);
  h.click('plan-red-connect',{id:'later'});h.click('plan-red-connect',{id:'past'});assert.deepEqual(requests(),[]);
  const before=h.read();h.click('plan-red-connect',{id:'due'});assert.deepEqual(requests(),[[]]);assert.deepEqual(h.read(),before);
  h.click('delete-plan',{id:'due'});assert.deepEqual(ids(),['next']);
  h.click('plan-red-connect',{id:'due'});assert.equal(requests().length,1);
  h.today('2026-11-07',true);assert.deepEqual(ids(),['later']);
  h.click('plan-red-connect',{id:'next'});assert.equal(requests().length,1);
  h.click('delete-plan',{id:'later'});assert.deepEqual(ids(),[]);assert.equal(h.requests(),0);
});
test('Past dates, completed donations and closed or stale date popups cannot open Red Connect',()=>{
  const h=harness({records:[{id:'done',date:'2026-10-22',type:'plasma'}]}),requests=redConnectBridge(h),before=h.read();
  for(const date of ['2026-10-21','2026-10-22']){
    h.click('day',{date});assert.doesNotMatch(h.html(),/data-action="day-red-connect"/);
    h.click('day-red-connect');h.click('close-dialog');
  }
  h.click('day',{date:'2026-10-23'});h.click('close-dialog');h.click('day-red-connect');
  h.click('day',{date:'2026-10-23'});h.today('2026-10-24');h.click('day-red-connect');
  assert.doesNotMatch(h.html(),/data-action="day-red-connect"/);assert.deepEqual(requests(),[]);
  h.click('day',{date:'2027-02-19'});h.run("state.plans.push({id:'changed',date:'2027-02-18',type:'plasma'})");h.click('day-red-connect');
  assert.match(h.html(),/기록이나 계획이 바뀌었습니다/);assert.deepEqual(requests(),[]);
  assert.deepEqual(h.read(),before);assert.equal(h.requests(),0);
});
test('Unavailable or failing bridge and demo mode keep all data and never fall back to a website',()=>{
  const h=harness({plans:[{id:'upcoming',date:'2026-11-06',type:'plasma'}]}),before=h.read();
  h.click('plan-red-connect',{id:'upcoming'});assert.match(h.nodes.get('#toast').innerHTML,/Android 앱/);
  h.run("window.BloodNoteAndroid={requestRedConnect(){throw Error('unavailable')}}");
  h.click('plan-red-connect',{id:'upcoming'});assert.match(h.nodes.get('#toast').innerHTML,/열지 못했습니다/);
  const requests=redConnectBridge(h);h.run('realState=clone(state);demoMode=true;render()');
  assert.match(h.app(),/data-action="plan-red-connect" data-id="upcoming" disabled/);
  h.click('plan-red-connect',{id:'upcoming'});h.click('day',{date:'2026-11-06'});h.click('day-red-connect');
  assert.deepEqual(requests(),[]);assert.deepEqual(h.read(),before);assert.equal(h.requests(),0);
});

test('Only actual donations get completed-day emphasis; past or due plans do not, and undo restores it',()=>{
  const records=[{id:'whole',date:'2026-10-01',type:'whole'},{id:'plasma',date:'2026-10-03',type:'plasma'},
    {id:'platelet',date:'2026-10-08',type:'platelet'},{id:'mixed',date:'2026-10-22',type:'mixed'}];
  const h=harness({records,plans:[{id:'due',date:'2026-10-20',type:'mixed'},{id:'future',date:'2026-10-30',type:'plasma'}]});
  const cell=date=>h.app().match(new RegExp(`data-calendar-date="${date}"[\\s\\S]*?<\\/button>`))[0];
  const saved=h.read();
  for(const record of records){
    const html=cell(record.date);assert.match(html,/class="day [^"]* recorded /);
    assert.match(html,/day-recorded-mark" aria-hidden="true">✓/);
    assert.match(html,new RegExp(`class="day-status record-status completed-record" data-type="${record.type}"`));
    assert.equal((html.match(/completed-record/g)||[]).length,1);
  }
  assert.match(cell('2026-10-03'),/is-holiday/);assert.match(cell('2026-10-03'),/개천절/);
  for(const date of ['2026-10-02','2026-10-20','2026-10-30'])assert.doesNotMatch(cell(date),/day-recorded-mark|completed-record| recorded /);
  assert.deepEqual(h.read(),saved);
  h.click('delete-record',{id:'platelet'});assert.doesNotMatch(cell('2026-10-08'),/day-recorded-mark|completed-record/);
  h.run('undoAction()');assert.match(cell('2026-10-08'),/completed-record/);assert.deepEqual(h.read(),saved);
  h.click('day',{date:'2026-10-20'});h.click('day-complete');assert.match(cell('2026-10-20'),/completed-record/);
  assert.equal(h.read().records.length,5);assert.equal(h.requests(),0);
});
