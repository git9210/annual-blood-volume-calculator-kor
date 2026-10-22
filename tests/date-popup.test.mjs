import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as engine from '../assets/engine.mjs';
import * as calendar from '../assets/calendar-view.mjs';
import * as licenses from '../assets/licenses.mjs';
import * as backupCrypto from '../assets/backup-crypto.mjs';
import {createHolidayStore} from '../assets/holidays.mjs';
const root=new URL('../assets/',import.meta.url);
const source=readFileSync(new URL('app.mjs',root),'utf8').replace(/^import .*;\n/gm,'');
function harness({records=[],plans=[]}={}){
  let date='2026-10-22',requests=0,writes=0,fail=false;
  const events={},nodes=new Map(),cache=new Map();
  const node=key=>({innerHTML:'',textContent:'',dataset:{},style:{},open:false,
    classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},querySelectorAll:()=>[],querySelector:()=>null,focus(){},
    addEventListener:(type,fn)=>events[key+':'+type]=fn,removeEventListener(){},
    showModal(){this.open=true;},close(){this.open=false;events[key+':close']?.();}});
  for(const m of readFileSync(new URL('index.html',root),'utf8').matchAll(/id="([^"]+)"/g))nodes.set('#'+m[1],node('#'+m[1]));
  for(const key of ['#holiday-status','[data-action="refresh-holidays"]','#date-popup-title','#event-form','#event-feedback'])nodes.set(key,node(key));
  const form=nodes.get('#event-form');form.elements={date:{value:'2026-10-01'},type:{value:'plasma'}};
  cache.set('blood-note-v1',JSON.stringify({version:1,rules:engine.clone(engine.DEFAULT_RULES),records,plans,complete:true,appliedImports:[]}));
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
    html:()=>nodes.get('#dialog-content').innerHTML,app:()=>nodes.get('#app').innerHTML,
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
