import test from 'node:test';
import assert from 'node:assert/strict';
import {TYPES,DEFAULT_RULES,clone,migrateLegacyTypes,availabilityForDate,parseLines,stats,addDays} from '../assets/engine.mjs';
// Synthetic fortnightly fixture; no personal donation history is bundled.
const history=Array.from({length:22},(_,i)=>({id:'fixture-'+i,date:addDays('2026-10-08',-14*(21-i)),type:'mixed'}));

test('이전 혈소판 기록·계획은 ID·날짜·종류를 유지',()=>{
  const old={version:1,rules:{...clone(DEFAULT_RULES),volumes:{...DEFAULT_RULES.volumes,platelet:90},waits:{...DEFAULT_RULES.waits,platelet:14}},records:[{id:'past',date:'2026-10-08',type:'platelet'}],plans:[{id:'future',date:'2026-10-23',type:'platelet'}],complete:true,appliedImports:['screenshots-2026-10-17-22']};
  const normalized=migrateLegacyTypes(old);
  assert.deepEqual(normalized.records,[{id:'past',date:'2026-10-08',type:'platelet'}]);
  assert.deepEqual(normalized.plans,[{id:'future',date:'2026-10-23',type:'platelet'}]);
  assert.equal(stats(normalized.records,'2026-10-17',normalized.rules).used,90);
  assert.deepEqual(normalized.appliedImports,old.appliedImports);
  assert.equal(normalized.complete,true);
  assert.equal(Object.hasOwn(normalized.rules.volumes,'platelet'),true);
  assert.equal(Object.hasOwn(normalized.rules.waits,'platelet'),true);
  assert.equal(old.records[0].type,'platelet');
  assert.deepEqual(migrateLegacyTypes(normalized),normalized);
});
test('이전 백업에 혈소판 설정만 있는 경우에도 계산값 보존',()=>{
  const normalized=migrateLegacyTypes({records:[],plans:[],rules:{volumes:{whole:430,platelet:90,plasma:45},waits:{whole:56,platelet:14,plasma:14}}});
  assert.equal(normalized.rules.volumes.mixed,90);
  assert.equal(normalized.rules.waits.mixed,14);
  assert.deepEqual(Object.keys(TYPES),['whole','plasma','platelet','mixed']);
  const rows=parseLines('2026-10-08 혈소판\n2026-09-23 platelet\n2026-08-28 혈소판 혈장').rows;
  assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.type),['platelet','platelet','mixed']);
});
test('가상 기록을 적용한 날짜에서 전혈 제한·성분 가능을 각각 계산',()=>{
  const options=availabilityForDate('2026-10-22',history).choices;
  assert.deepEqual(options.map(x=>x.type),['whole','plasma','platelet','mixed']);
  assert.deepEqual(options.map(x=>x.result.ok),[false,true,true,true]);
  assert.deepEqual(options.map(x=>x.result.projected),[2410,2025,2070,2070]);
  assert.ok(availabilityForDate('2026-10-21',history).choices.every(x=>!x.result.ok));
  assert.ok(availabilityForDate('2027-02-01',history).choices.every(x=>x.result.ok));
});
test('계획이 있는 날짜는 중복 추가가 아닌 기존 계획 변경으로 계산',()=>{
  const plans=[{id:'chosen',date:'2026-10-22',type:'mixed'}];
  const day=availabilityForDate('2026-10-22',history,plans);
  assert.equal(day.plan.id,'chosen');
  assert.deepEqual(day.choices.map(x=>x.result.ok),[false,true,true,true]);
  assert.deepEqual(day.choices.map(x=>x.result.projected),[2410,2025,2070,2070]);
  assert.ok(day.choices.every(x=>!x.result.issues.some(i=>i.code==='duplicate')));
  assert.equal(availabilityForDate('2026-10-08',history,plans).record.type,'mixed');
});
