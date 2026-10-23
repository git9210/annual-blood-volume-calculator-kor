import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RULES,TYPES,clone,assess,earliest,simulate,availabilityForDate,inspectPlan,proposeMonthly,stats,releaseDate,validateRestrictions,normalizeRestrictionReason,restrictionReasonUnits,activeRestrictions,RESTRICTION_MAX_DAYS} from '../assets/engine.mjs';
const ranges=[{id:'pause',start:'2026-10-23',end:'2026-11-05',reason:'약 복용'}];
const event=(date,type='plasma')=>({id:date,date,type});

test('All four kinds are restricted on inclusive endpoints only; dates and records are immutable',()=>{
  const before=clone(ranges);
  for(const type of Object.keys(TYPES))for(const [date,blocked] of [['2026-10-22',false],['2026-10-23',true],['2026-11-05',true],['2026-11-06',false]]){
    const result=assess(event(date,type),[],DEFAULT_RULES,ranges);
    assert.equal(result.ok,!blocked);assert.equal(result.issues.some(i=>i.code==='manual-restriction'),blocked);
    assert.equal(result.used,0);assert.equal(result.projected,DEFAULT_RULES.volumes[type]);
  }
  assert.deepEqual(ranges,before);
});
test('A record expires during a restriction on its original anniversary, not fourteen days later',()=>{
  const rules={...clone(DEFAULT_RULES),cap:480},records=[event('2025-11-02','whole')],original=clone(records);
  assert.equal(stats(records,'2026-11-01',rules).remaining,50);
  assert.equal(stats(records,'2026-11-02',rules).remaining,480);
  assert.equal(releaseDate(records[0],rules),'2026-11-02');
  for(const date of ['2026-10-23','2026-11-01','2026-11-02','2026-11-05','2026-11-06']){
    const normal=simulate(event(date),records,[],rules),blocked=simulate(event(date),records,[],rules,ranges);
    for(const field of ['used','projected','remaining'])assert.equal(blocked[field],normal[field]);
  }
  assert.equal(earliest('whole','2026-10-23',records,[],rules,100,ranges),'2026-11-06');
  const inclusive={...rules,boundary:'include'};
  assert.equal(releaseDate(records[0],inclusive),'2026-11-03');
  assert.equal(assess(event('2026-11-03'),records,inclusive,ranges).used,0);
  assert.deepEqual(records,original);
});
test('Ending a restriction neither adds volume nor resets a previous donation wait',()=>{
  const rules={...clone(DEFAULT_RULES),cap:480},records=[event('2026-09-01','whole')];
  const options=availabilityForDate('2026-11-06',records,[],rules,ranges).choices;
  assert.deepEqual(options.map(c=>[c.type,c.result.ok]),[['whole',false],['plasma',true],['platelet',false],['mixed',false]]);
  assert.equal(stats(records,'2026-11-06',rules).remaining,50);
  const recent=[event('2026-10-20','whole')];
  assert.equal(earliest('plasma','2026-10-23',recent,[],DEFAULT_RULES,100,ranges),'2026-12-15');
});
test('Overlap, adjacency, leap day and the earliest search limit are handled without gaps',()=>{
  const overlapping=[...ranges,{id:'b',start:'2026-11-01',end:'2026-11-10',reason:''},{id:'c',start:'2026-11-11',end:'2026-11-12',reason:''}];
  assert.equal(earliest('plasma','2026-10-23',[],[],DEFAULT_RULES,100,overlapping),'2026-11-13');
  assert.equal(earliest('plasma','2026-10-23',[],[],DEFAULT_RULES,20,overlapping),null);
  const leap=validateRestrictions([{id:'leap',start:'2028-02-28',end:'2028-03-01',reason:''}]);
  assert.equal(activeRestrictions('2028-02-29',leap).length,1);
  assert.equal(earliest('mixed','2028-02-28',[],[],DEFAULT_RULES,10,leap),'2028-03-02');
});
test('Existing plans are flagged without deletion; generated monthly drafts skip restricted days',()=>{
  const plans=[event('2026-10-30')],before=clone(plans);
  assert.equal(inspectPlan([],plans,DEFAULT_RULES,ranges)[0].ok,false);
  assert.deepEqual(plans,before);
  const draft=proposeMonthly([],[],'2026-10-23',3,'plasma',DEFAULT_RULES,ranges);
  assert.deepEqual(draft.skipped,['2026-10']);assert.equal(draft.draft.length,2);
  for(const e of draft.draft)assert.equal(activeRestrictions(e.date,ranges).length,0);
});
test('Optional reasons obey Korean 20 / Latin 40 weighted bounds and reject emoji or markup',()=>{
  for(const text of ['', '약 복용', '가'.repeat(20),'a'.repeat(40),'가'.repeat(10)+'1'.repeat(20),`약 'A' (14)?! “휴식”`])assert.equal(normalizeRestrictionReason(text),text);
  for(const text of ['가'.repeat(21),'a'.repeat(41),'가'.repeat(20)+'1','💊','🙂','^^','<script>','a\nb','a\tb','a\u200bb'])assert.throws(()=>normalizeRestrictionReason(text));
  assert.equal(normalizeRestrictionReason('  약 복용  '),'약 복용');
  assert.equal(normalizeRestrictionReason('가'.normalize('NFD')),'가');
});
test('Standalone Korean jamo and IME prefixes are accepted with the same 20-letter limit, without allowing invisible fillers',()=>{
  for(const text of ['ㄱ','ㄴ','ㅡ','ㅣ','ㅋㅋ','ㄱㄴㅡㅣ','ᄀ','ᅡ','ᆨ','ㄱ'.repeat(20),'ㅣ'.repeat(10)+'1'.repeat(20)])assert.equal(normalizeRestrictionReason(text),text);
  for(let code=0x3131;code<=0x3163;code++)assert.equal(restrictionReasonUnits(String.fromCharCode(code)),2);
  assert.equal(normalizeRestrictionReason('가'),'가');
  for(const text of ['ㄱ'.repeat(21),'ㅣ'.repeat(20)+'1','\u115f','\u1160','\u3164','\uffa0'])assert.throws(()=>normalizeRestrictionReason(text));
  const stored=validateRestrictions([{id:'jamo',start:'2026-10-23',end:'2026-10-23',reason:'ㄱ ㄴ ㅡ ㅣ'}]);
  assert.equal(stored[0].reason,'ㄱ ㄴ ㅡ ㅣ');
});
test('Malformed backups, duplicate IDs, overlong periods and excessive entries are rejected',()=>{
  assert.deepEqual(validateRestrictions(undefined),[]);assert.deepEqual(validateRestrictions(ranges),ranges);
  for(const value of [null,{},[...ranges,...ranges],[{...ranges[0],start:'2026-02-30'}],[{...ranges[0],end:'2026-10-22'}],[{...ranges[0],end:'2200-01-01'}],[{...ranges[0],end:'2038-01-01'}],[{...ranges[0],reason:'🙂'}],Array.from({length:501},(_,i)=>({...ranges[0],id:String(i)}))])assert.throws(()=>validateRestrictions(value));
  assert.equal(RESTRICTION_MAX_DAYS,3650);
});
