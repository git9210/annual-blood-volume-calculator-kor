import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow} from '../assets/calendar-view.mjs';

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
