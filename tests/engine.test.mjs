import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DEFAULT_RULES,clone,validDate,addDays,yearStart,stats,assess,simulate,earliest,releaseDate,inspectPlan,parseLines,proposeMonthly,weekday} from '../assets/engine.mjs';
const event=(date,type='whole',id=date)=>({id,date,type});
const codes=r=>r.issues.map(i=>i.code);

test('Today is ISO in Korean time regardless of WebView locale data, including midnight and year/leap boundaries',()=>{
  const source=readFileSync(new URL('../assets/engine.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
  let intlCalls=0;
  const legacyIntl={DateTimeFormat:class{constructor(){intlCalls++;}format(){return '10/19/2026';}}};
  for(const [instant,expected] of [
    ['2026-10-18T14:59:59.999Z','2026-10-18'],['2026-10-18T15:00:00.000Z','2026-10-19'],
    ['2026-12-31T15:00:00.000Z','2027-01-01'],['2024-02-28T15:00:00.000Z','2024-02-29'],
    ['2024-02-29T15:00:00.000Z','2024-03-01']
  ]){
    const clock=class extends Date{static now(){return Date.parse(instant);}};
    const actual=vm.runInNewContext(source+'\ntoday()',{Date:clock,Intl:legacyIntl});
    assert.equal(actual,expected);assert.equal(validDate(actual),true);
  }
  assert.equal(intlCalls,0);
});

test('전혈 다음의 모든 종류는 55일에 제한, 56일에 통과',()=>{
  const before=[event('2026-01-01')];
  for(const type of ['whole','mixed','plasma']){
    assert.ok(codes(assess(event(addDays('2026-01-01',55),type),before)).includes('interval'));
    assert.equal(assess(event(addDays('2026-01-01',56),type),before).ok,true);
  }
});
test('모든 성분헌혈 이후 14일 간격을 적용',()=>{
  for(const priorType of ['mixed','plasma'])for(const nextType of ['whole','mixed','plasma']){
    assert.ok(codes(assess(event('2026-01-14',nextType),[event('2026-01-01',priorType)])).includes('interval'));
    assert.equal(assess(event('2026-01-15',nextType),[event('2026-01-01',priorType)]).ok,true);
  }
});
test('달력 1년의 시작일 제외, 종료일 포함, 미래 제외',()=>{
  const rows=[event('2025-10-17'),event('2025-10-18','plasma'),event('2026-10-17','mixed'),event('2026-10-18')];
  assert.equal(stats(rows,'2026-10-17').used,135);
  assert.equal(stats(rows,'2026-10-17').start,'2025-10-18');
  const inclusive=clone(DEFAULT_RULES);inclusive.boundary='include';
  assert.equal(stats(rows,'2026-10-17',inclusive).used,565);
  assert.equal(stats(rows,'2026-10-17',inclusive).start,'2025-10-17');
});
test('달력 연도는 365일 고정이 아니며 윤년을 처리',()=>{
  assert.equal(yearStart('2024-03-01'),'2023-03-01');
  assert.equal(yearStart('2024-02-29'),'2023-02-28');
  assert.equal(stats([event('2023-03-01')],'2024-03-01').used,0);
  assert.equal(stats([event('2023-03-01')],'2024-02-29').used,430);
  assert.equal(validDate('2026-02-29'),false);
  assert.equal(validDate('2024-02-29'),true);
});
test('1년 경계에 기록이 빠지는 날짜 계산',()=>{
  assert.equal(releaseDate(event('2025-10-17')),'2026-10-17');
  assert.equal(releaseDate(event('2024-02-29')),'2025-03-01');
  const r=clone(DEFAULT_RULES);r.boundary='include';
  assert.equal(releaseDate(event('2025-10-17'),r),'2026-10-18');
  assert.equal(releaseDate(event('2023-02-28'),r),'2024-03-01');
});
test('24번째 90mL 헌혈로 2160mL에 정확히 도달하면 통과',()=>{
  const rows=Array.from({length:23},(_,i)=>event(addDays('2026-01-01',i*14),'mixed'));
  const result=assess(event(addDays('2026-01-01',23*14),'mixed'),rows);
  assert.equal(result.ok,true);assert.equal(result.projected,2160);assert.equal(result.remaining,0);
  rows.push(event(addDays('2026-01-01',23*14),'mixed'));
  const over=assess(event(addDays('2026-01-01',24*14),'mixed'),rows);
  assert.deepEqual(codes(over),['volume','component-count']);
});
test('잔여량 80mL일 때 혈장은 통과하고 혈소판혈장은 초과',()=>{
  const rows=['2026-01-01','2026-03-01','2026-05-01','2026-07-01'].map(d=>event(d));
  rows.push(...['2026-08-27','2026-09-10','2026-09-24','2026-10-08'].map(d=>event(d,'mixed')));
  assert.equal(stats(rows,'2026-10-22').remaining,80);
  assert.equal(assess(event('2026-10-22','plasma'),rows).ok,true);
  const result=assess(event('2026-10-22','mixed'),rows);assert.ok(codes(result).includes('volume'));assert.equal(result.remaining,-10);
});
test('전혈 5회 제한은 용량 한도와 별개',()=>{
  const r=clone(DEFAULT_RULES);r.cap=10000;
  const rows=Array.from({length:5},(_,i)=>event(addDays('2026-01-01',i*56)));
  assert.deepEqual(codes(assess(event(addDays('2026-01-01',5*56)),rows,r)),['whole-count']);
});
test('혈소판혈장 요청 시 혈장 횟수도 포함하되 혈장 자체에는 24회 제한 없음',()=>{
  const r=clone(DEFAULT_RULES);r.cap=10000;
  const rows=Array.from({length:24},(_,i)=>event(addDays('2026-01-01',i*14),'plasma'));
  const date=addDays('2026-01-01',24*14);
  assert.equal(assess(event(date,'plasma'),rows,r).ok,true);
  assert.deepEqual(codes(assess(event(date,'mixed'),rows,r)),['component-count']);
  assert.deepEqual(codes(assess(event(date,'mixed'),rows,r)),['component-count']);
});
test('중간 성분헌혈이 뒤 전혈의 연간 용량을 초과시키는 영향 검출',()=>{
  const records=['2026-01-01','2026-03-01','2026-05-01','2026-07-01'].map(d=>event(d));
  const plans=[event('2026-12-15')];
  assert.equal(inspectPlan(records,plans)[0].ok,true);
  const check=simulate(event('2026-11-01','plasma'),records,plans);
  assert.equal(check.issues.length,0);assert.equal(check.ok,false);assert.equal(check.conflicts.length,1);
  assert.equal(check.conflicts[0].issues[0].code,'volume');
});
test('중간 전혈이 뒤 일정의 대기 간격에 미치는 영향 검출',()=>{
  const check=simulate(event('2026-11-20'),[],[event('2026-12-04','mixed')]);
  assert.equal(check.ok,false);assert.equal(check.conflicts[0].issues[0].code,'interval');
});
test('앞선 가상 헌혈도 뒤 일정의 직전 헌혈로 취급',()=>{
  const records=[event('2026-01-01')],plans=[event('2026-03-01','plasma')];
  assert.ok(codes(simulate(event('2026-03-08','mixed'),records,plans)).includes('interval'));
  assert.equal(simulate(event('2026-03-15','mixed'),records,plans).ok,true);
});
test('같은 날의 중복 기록 및 계획 차단',()=>{
  const check=simulate(event('2026-10-17','plasma','candidate'),[event('2026-10-17')],[]);
  assert.ok(codes(check).includes('duplicate'));
});
test('계획 수정 시 자기 자신을 중복 기록으로 처리하지 않음',()=>{
  const e=event('2026-10-17','whole','fixed-id');
  assert.equal(simulate({...e,type:'plasma'},[],[e]).ok,true);
});
test('다음 가능일은 단순 간격이 아닌 연간 용량 회복도 기다림',()=>{
  const records=['2026-01-01','2026-03-01','2026-05-01','2026-07-01'].map(d=>event(d));
  records.push(event('2026-09-01','mixed'));
  assert.equal(earliest('whole','2026-11-01',records),'2027-01-01');
  assert.equal(earliest('plasma','2026-11-01',records),'2026-11-01');
});
test('미래 기록은 과거 기준일 합산에 들어가지 않음',()=>{
  assert.equal(stats([event('2027-01-01'),event('2026-01-01','plasma')],'2026-12-31').used,45);
});
test('일괄 가져오기에서 날짜·종류 추출 및 잘못된 날짜 검출',()=>{
  const parsed=parseLines('날짜,종류\n2026.1.5 전혈\n2026/03/06 혈소판혈장\n2026-03-20 혈장\n2026-02-30 혈소판');
  assert.equal(parsed.rows.length,3);assert.deepEqual(parsed.rows.map(r=>r.type),['whole','mixed','plasma']);
  assert.equal(parsed.rows[0].date,'2026-01-05');assert.equal(parsed.errors.length,1);
});
test('24개월 초안의 모든 새 일정은 간격·횟수·이동연간한도를 지킴',()=>{
  const records=[event('2026-10-08','mixed')],plans=[event('2026-12-28')];
  const result=proposeMonthly(records,plans,'2026-10-17',24,'whole');
  assert.ok(result.draft.length>10);
  assert.ok(result.draft.every(e=>weekday(e.date)>0&&weekday(e.date)<6));
  assert.equal(new Set(result.draft.map(e=>e.date.slice(0,7))).size,result.draft.length);
  assert.ok(inspectPlan(records,[...plans,...result.draft]).every(r=>r.ok));
  assert.equal(result.draft.some(e=>e.date.startsWith('2026-12')),false);
  assert.equal(result.draft.some(e=>e.date.startsWith('2026-10')),false);
});

test('Unordered histories retain annual-boundary totals, exclude future entries and select the latest prior donation without mutation',()=>{
  const history=[event('2026-03-01','whole','future'),event('2025-02-28','mixed','boundary'),event('2025-02-27','whole','expired'),
    event('2026-02-20','whole','latest'),event('2025-03-01','plasma','inside'),event('2026-02-28','platelet','same-day')];
  const before=clone(history),candidate=event('2026-02-28','whole','candidate');
  for(const boundary of ['exclude','include']){
    const rules={...clone(DEFAULT_RULES),boundary},s=stats(history,candidate.date,rules),check=assess(candidate,history,rules);
    assert.equal(s.used,boundary==='include'?655:565);assert.equal(s.whole,1);assert.equal(s.components,boundary==='include'?3:2);
    assert.deepEqual(s.entries.map(row=>row.id),boundary==='include'?['boundary','latest','inside','same-day']:['latest','inside','same-day']);
    assert.equal(s.start,boundary==='include'?'2025-02-28':'2025-03-01');assert.equal(check.previous.id,'latest');
    assert.deepEqual(codes(check),['duplicate','interval']);assert.deepEqual(assess(candidate,[...history].reverse(),rules),check);
  }
  const tie=event('2026-02-20','plasma','tied');
  assert.equal(assess(candidate,[...history,tie]).previous.id,'latest');
  assert.equal(assess(candidate,[tie,...history]).previous.id,'tied');
  assert.deepEqual(history,before);
});
