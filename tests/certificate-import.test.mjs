import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCertificate,mergeCertificate} from '../assets/certificate-import.mjs';
import {DEFAULT_RULES,clone} from '../assets/engine.mjs';
const today='2026-10-18';
const row=(date,type='mixed',sourceType=type==='plasma'?'혈장':type==='whole'?'전혈':'혈소판혈장')=>({date,type,sourceType,page:1});
const payload=rows=>({pages:1,expected:rows.length,rows});
const state=()=>({version:1,rules:clone(DEFAULT_RULES),records:[{id:'actual',date:'2026-10-01',type:'plasma'}],plans:[{id:'plan',date:'2026-10-15',type:'mixed'}],complete:false,appliedImports:[]});
test('PDF review separates new, identical, conflicting, plan and legacy types without changing records',()=>{
  const s=state(),before=clone(s);
  const rows=reviewCertificate(payload([row('2026-10-01','plasma'),row('2026-10-15'),row('2026-09-01','platelet','혈소판')]),s.records,s.plans,today);
  assert.deepEqual(rows.map(r=>r.status),['duplicate','plan','new']);
  assert.deepEqual(rows.map(r=>r.selected),[false,true,true]);assert.deepEqual(s,before);
  assert.equal(reviewCertificate(payload([row('2026-10-01')]),s.records,s.plans,today)[0].selected,false);
  assert.equal(reviewCertificate(payload([row('2026-10-15','whole')]),s.records,s.plans,today)[0].status,'plan-conflict');
});
test('PDF merge adds selected rows once, preserves rules and IDs, and converts matching plans',()=>{
  const s=state(),p=payload([row('2026-10-01','plasma'),row('2026-10-15'),row('2026-09-01')]);
  let counter=0;const result=mergeCertificate(s,p,[0,1,2],today,()=>`new-${++counter}`);
  assert.equal(result.added,2);assert.equal(result.converted,1);assert.equal(result.state.records.length,3);assert.equal(result.state.plans.length,0);
  assert.equal(result.state.records.find(r=>r.date==='2026-10-15').id,'plan');
  assert.deepEqual(result.state.rules,s.rules);assert.equal(result.state.complete,false);assert.equal(s.records.length,1);
  assert.throws(()=>mergeCertificate(result.state,p,[0,1,2],today,()=>''),/등록할/);
  assert.ok(result.state.records.every(r=>Object.keys(r).sort().join(',')==='date,id,type'));
});
test('Conflicting entries change only when explicitly selected and preserve existing record ID',()=>{
  const s=state(),p=payload([row('2026-10-01'),row('2026-09-01')]);
  assert.equal(mergeCertificate(s,p,[1],today,()=>'new').state.records[0].type,'plasma');
  const changed=mergeCertificate(s,p,[0],today,()=>'unused');
  assert.equal(changed.updated,1);assert.deepEqual(changed.state.records[0],{id:'actual',date:'2026-10-01',type:'mixed'});
  assert.deepEqual(changed.state.plans,s.plans);
});
test('Future, malformed, incomplete and conflicting duplicate PDF rows are rejected atomically',()=>{
  const s=state(),before=clone(s);
  for(const p of [payload([row('2026-10-19')]),payload([row('2025-02-29')]),payload([row('2026-01-01','other')]),
    {pages:1,expected:2,rows:[row('2026-01-01')]},payload([row('2026-01-01'),row('2026-01-01','whole')])])
    assert.throws(()=>mergeCertificate(s,p,[0],today,()=>''));
  assert.deepEqual(s,before);
});
test('Identical repeated rows are deduplicated and full history beyond one year can be imported',()=>{
  const p=payload([row('2017-10-24','plasma'),row('2017-10-24','plasma')]),s=state();
  assert.equal(reviewCertificate(p,s.records,s.plans,today)[1].status,'file-duplicate');
  assert.equal(mergeCertificate(s,p,[0,1],today,()=>'old').added,1);
});
test('Size limits and selection bounds prevent invalid merges',()=>{
  assert.throws(()=>reviewCertificate({pages:301,expected:1,rows:[row('2020-01-01')]},[],[],today));
  assert.throws(()=>mergeCertificate(state(),payload([row('2020-01-01')]),[-1],today,()=>''));
  const s=state();s.plans=Array.from({length:3000},(_,i)=>({id:'p'+i,date:'2030-'+i,type:'plasma'}));
  assert.throws(()=>mergeCertificate(s,payload([row('2020-01-01')]),[0],today,()=>'x'),/3,000/);
});
test('PDF review reports clock, row and future-date failures separately without rejecting valid historical records',()=>{
  const p=payload([row('2017-10-24','plasma'),row('2026-10-08')]);
  assert.equal(reviewCertificate(p,[],[],'2026-10-19').length,2);
  for(const date of ['10/19/2026','2026/10/19',undefined,'2026-02-29'])
    assert.throws(()=>reviewCertificate(p,[],[],date),error=>error.code==='current-date'&&/날짜·시간/.test(error.message));
  assert.throws(()=>reviewCertificate(p,[],[],'2025-01-01'),error=>error.code==='future-date'&&/2026-10-08/.test(error.message)&&/2025-01-01/.test(error.message)&&/앱플레이어/.test(error.message));
  const corrupt=payload([row('2020-01-01'),row('2020-02-30')]);
  assert.throws(()=>reviewCertificate(corrupt,[],[],today),error=>error.code==='invalid-row'&&/2번째/.test(error.message));
  const wrongType=payload([row('2020-01-01','mixed','혈소판')]);
  assert.throws(()=>reviewCertificate(wrongType,[],[],today),error=>error.code==='invalid-row');
});
