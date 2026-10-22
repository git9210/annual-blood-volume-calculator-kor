import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLIDAY_SNAPSHOT} from '../assets/holiday-snapshot.mjs';
import {createHolidayStore,holidayDay,normalizeHolidayYears,HOLIDAY_CACHE_KEY,HOLIDAY_URL} from '../assets/holidays.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const response=data=>({ok:true,text:async()=>JSON.stringify(data)});
const clock=()=>Date.parse(HOLIDAY_SNAPSHOT.checkedAt)+60000;
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};};

test('토요일·일요일·평일을 구분하고 겹치는 공휴일은 공휴일로 표시',()=>{
  const years=normalizeHolidayYears(HOLIDAY_SNAPSHOT.years);
  assert.equal(holidayDay('2026-10-17',years).kind,'saturday');
  assert.equal(holidayDay('2026-10-18',years).kind,'sunday');
  assert.equal(holidayDay('2026-10-19',years).kind,'weekday');
  assert.equal(holidayDay('2026-10-03',years).kind,'holiday');
  assert.deepEqual(holidayDay('2026-10-05',years).names,['대체공휴일(개천절)']);
  assert.deepEqual(holidayDay('2027-02-09',years).names,['대체공휴일(설날)']);
  assert.equal(holidayDay('2027-05-03',years).kind,'holiday');
  assert.equal(holidayDay('2027-07-19',years).kind,'holiday');
  assert.equal(holidayDay('2028-01-01',years).known,false);
  assert.equal(holidayDay('2028-01-01',years).kind,'saturday');
});

test('임시공휴일 추가와 취소를 연도별 교체로 반영하고 다른 연도는 유지',async()=>{
  const storage=memory();storage.setItem('blood-note-v1','private donation records');
  let payload={2026:copy(HOLIDAY_SNAPSHOT.years[2026])};
  payload[2026]['2026-10-20']=['임시공휴일'];
  const store=createHolidayStore({storage,now:clock,fetcher:async(url,options)=>{
    assert.equal(url,HOLIDAY_URL);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
    return response(payload);
  }});
  assert.equal((await store.refresh()).ok,true);
  assert.deepEqual(store.day('2026-10-20').names,['임시공휴일']);
  assert.equal(store.day('2027-02-09').kind,'holiday');
  assert.equal(storage.getItem('blood-note-v1'),'private donation records');
  const offline=createHolidayStore({storage,now:clock});
  assert.equal(offline.day('2026-10-20').kind,'holiday');
  delete payload[2026]['2026-10-20'];
  await store.refresh();
  assert.equal(store.day('2026-10-20').kind,'weekday');
  assert.equal(JSON.parse(storage.getItem(HOLIDAY_CACHE_KEY)).years[2026]['2026-10-20'],undefined);
});

test('자료가 없는 연도는 미제공으로 남고 새 연도 자료가 들어오면 표시',async()=>{
  const fixture={};
  for(const [date,names] of Object.entries(HOLIDAY_SNAPSHOT.years[2027]))fixture[date.replace('2027','2028')]=names;
  const store=createHolidayStore({now:clock,fetcher:async()=>response({2028:fixture})});
  assert.equal(store.day('2028-05-05').known,false);
  await store.refresh();
  assert.equal(store.day('2028-05-05').known,true);
  assert.equal(store.day('2028-05-05').kind,'holiday');
  assert.equal(store.day('2026-10-09').kind,'holiday');
});

test('통신 실패·불완전 자료는 기존 공휴일과 확인 시각을 보존',async()=>{
  let payload=copy(HOLIDAY_SNAPSHOT.years),fail=false;
  const store=createHolidayStore({now:clock,fetcher:async()=>{if(fail)throw Error('offline');return response(payload);}});
  await store.refresh();const checked=store.info().checkedAt;
  for(const invalid of [{},{2026:{}},{2026:{'2026-10-20':['임시공휴일']}},{2026:{...HOLIDAY_SNAPSHOT.years[2026],'2026-02-30':['bad']}}]){
    payload=invalid;assert.equal((await store.refresh()).ok,false);
    assert.equal(store.day('2026-10-05').kind,'holiday');assert.equal(store.info().checkedAt,checked);
  }
  fail=true;await store.refresh();
  assert.equal(store.info().error,true);assert.equal(store.info().loading,false);
  assert.equal(store.day('2027-02-09').kind,'holiday');
});

test('초기 표시·시간 경과·재실행은 조회하지 않고 명시적 갱신만 요청',async()=>{
  let time=clock(),calls=0,release;
  const storage=memory(),fetcher=async()=>{calls++;return new Promise(resolve=>{release=()=>resolve(response(HOLIDAY_SNAPSHOT.years));});};
  const store=createHolidayStore({storage,now:()=>time,fetcher});
  store.day('2026-10-20');store.info();
  await Promise.resolve();assert.equal(calls,0);
  time+=7*24*60*60*1000;
  store.day('2026-10-20');store.info();
  await Promise.resolve();assert.equal(calls,0);
  const first=store.refresh(),second=store.refresh();
  assert.equal(first,second);assert.equal(store.info().loading,true);
  await Promise.resolve();assert.equal(calls,1);release();await first;
  assert.equal(store.info().checkedAt,time);assert.equal(store.info().loading,false);
  const manual=store.refresh();await Promise.resolve();assert.equal(calls,2);release();await manual;
  const reopened=createHolidayStore({storage,now:()=>time,fetcher});
  reopened.day('2026-10-20');reopened.info();
  await Promise.resolve();assert.equal(calls,2);
  assert.equal(reopened.info().checkedAt,time);
});

test('손상된 캐시와 저장 공간 부족에도 기본 표시와 온라인 갱신 가능',async()=>{
  const storage={getItem:()=>'{broken',setItem:()=>{throw Error('quota');}};
  const payload=copy(HOLIDAY_SNAPSHOT.years);payload[2026]['2026-10-20']=['임시공휴일'];
  const store=createHolidayStore({storage,now:clock,fetcher:async()=>response(payload)});
  assert.equal(store.day('2026-10-05').kind,'holiday');
  assert.equal((await store.refresh()).ok,true);assert.equal(store.day('2026-10-20').kind,'holiday');
});

test('저장된 공휴일은 앱 업데이트로 바뀌지 않고 수동 갱신 뒤에만 변경',async()=>{
  const storage=memory(),old=copy(HOLIDAY_SNAPSHOT.years);
  delete old[2026]['2026-05-01'];
  const checkedAt=Date.parse(HOLIDAY_SNAPSHOT.checkedAt)-60000;
  storage.setItem(HOLIDAY_CACHE_KEY,JSON.stringify({version:1,checkedAt,years:old}));
  const store=createHolidayStore({storage,now:clock,fetcher:async()=>response(HOLIDAY_SNAPSHOT.years)});
  assert.equal(store.day('2026-05-01').kind,'weekday');
  assert.equal(store.info().checkedAt,checkedAt);
  await store.refresh();
  assert.equal(store.day('2026-05-01').kind,'holiday');
  assert.equal(store.info().checkedAt,clock());
});

test('한 번도 갱신하지 않은 기본 자료도 저장하고 다음 앱 버전에서 유지',()=>{
  const storage=memory();
  createHolidayStore({storage,now:clock});
  const newer=copy(HOLIDAY_SNAPSHOT);
  newer.checkedAt=new Date(clock()+60000).toISOString();
  newer.years[2026]['2026-10-20']=['임시공휴일'];
  const store=createHolidayStore({storage,now:()=>clock()+120000,snapshot:newer});
  assert.equal(store.day('2026-10-20').kind,'weekday');
  assert.equal(store.info().checkedAt,0);
  assert.equal(store.info().snapshotAt,HOLIDAY_SNAPSHOT.checkedAt);
});
