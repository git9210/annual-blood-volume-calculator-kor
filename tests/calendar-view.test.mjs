import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow,calendarPartRange,calendarPartValue,calendarWithPart,calendarWithParts} from '../assets/calendar-view.mjs';

test('같은 창에서 고른 연도·월은 원래 일자를 기준으로 동시에 적용하고 중간 월말 보정을 누적하지 않음',()=>{
  assert.equal(calendarWithParts('2026-01-31',2028,2),'2028-02-29');
  assert.equal(calendarWithParts('2026-01-31',2028,3),'2028-03-31');
  assert.equal(calendarWithParts('2028-02-29',2027,3),'2027-03-29');
  assert.equal(calendarWithParts('2028-02-29',2027,2),'2027-02-28');
  assert.equal(calendarWithParts('2028-02-29',2000,2),'2000-02-29');
  assert.equal(calendarWithParts('2028-02-29',2100,2),'2100-02-28');
  assert.equal(calendarWithParts('2026-01-31',1900,1),'1900-01-31');
  assert.equal(calendarWithParts('2026-01-31',2199,12),'2199-12-31');
  for(const [year,month] of [[1899,1],[2200,12],[2028,0],[2028,13],['2e3',1],[2028,'1.5'],[null,1],[2026,'']]){
    assert.throws(()=>calendarWithParts('2026-01-31',year,month));
  }
});

test('연도·월 변경은 다른 부분을 보존하고 윤년·월말 날짜만 유효한 말일로 보정',()=>{
  assert.equal(calendarWithPart('2028-02-29','year',2027),'2027-02-28');
  assert.equal(calendarWithPart('2028-02-29','year',2000),'2000-02-29');
  assert.equal(calendarWithPart('2028-02-29','year',2100),'2100-02-28');
  assert.equal(calendarWithPart('2026-01-31','month',2),'2026-02-28');
  assert.equal(calendarWithPart('2028-01-31','month','02'),'2028-02-29');
  assert.equal(calendarWithPart('2026-12-31','month',4),'2026-04-30');
  assert.equal(calendarWithPart('2026-11-15','year',1900),'1900-11-15');
  assert.equal(calendarWithPart('2026-11-15','year',2199),'2199-11-15');
  assert.equal(calendarWithPart('2026-11-15','month',1),'2026-01-15');
  assert.equal(calendarWithPart('2026-11-15','month',12),'2026-12-15');
});
test('숫자 입력은 지원 범위의 정수만 허용하고 잘못된 입력을 몰래 보정하지 않음',()=>{
  for(const part of ['year','month']){
    const {min,max}=calendarPartRange(part);
    for(const value of ['',null,undefined,NaN,Infinity,'   ','2.0','2.5','2e3','+2','-2','2026x','２０２６',min-1,max+1]){
      assert.equal(calendarPartValue(part,value),null,`${part}: ${value}`);
      assert.throws(()=>calendarWithPart('2026-11-15',part,value));
    }
    for(const value of [min,max])assert.equal(calendarPartValue(part,String(value)),value);
  }
  assert.equal(calendarPartValue('year',' 2026 '),2026);
  assert.equal(calendarPartValue('month','02'),2);
  assert.throws(()=>calendarWithPart('1899-12-31','year',2026));
  assert.throws(()=>calendarWithPart('2200-01-01','month',2));
  assert.throws(()=>calendarWithPart('2026-02-30','year',2028));
  assert.throws(()=>calendarPartRange('day'));
});

test('주간 보기는 월·연도 경계를 넘어 일요일부터 토요일까지 표시',()=>{
  const range=calendarWindow('2027-01-01','week');
  assert.deepEqual(range.dates,['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
  const next=calendarWindow(range.next,'week');
  assert.equal(next.start,'2027-01-03');
  assert.equal(next.end,'2027-01-09');
  assert.deepEqual(calendarWindow(next.previous,'week').dates,range.dates);
});

test('월간 보기에서 윤년과 연도 이동을 처리하고 같은 날짜의 주간 보기로 전환',()=>{
  const leap=calendarWindow('2028-02-29','month');
  assert.equal(leap.dates.length,29);assert.equal(leap.offset,2);
  assert.equal(leap.end,'2028-02-29');
  assert.ok(calendarWindow('2028-02-29','week').dates.includes('2028-02-29'));
  const december=calendarWindow('2026-12-31','month');
  assert.equal(calendarWindow(december.next,'month').start,'2027-01-01');
  assert.equal(calendarWindow(december.previous,'month').end,'2026-11-30');
});

test('지원 날짜 범위 끝에서는 이동을 막고 범위 밖 날짜를 표시하지 않음',()=>{
  for(const view of ['week','month']){
    const first=calendarWindow('1900-01-01',view),last=calendarWindow('2199-12-31',view);
    assert.equal(first.previous,null);assert.equal(last.next,null);
    assert.equal(first.start,'1900-01-01');assert.equal(last.end,'2199-12-31');
    assert.ok(first.dates.every(d=>d>='1900-01-01'));
    assert.ok(last.dates.every(d=>d<='2199-12-31'));
    assert.equal(calendarWindow(calendarWindow(first.next,view).previous,view).start,first.start);
  }
});
