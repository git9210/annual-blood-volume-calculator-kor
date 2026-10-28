import test from 'node:test';
import assert from 'node:assert/strict';
import {donationHistorySummary,addDays} from '../assets/engine.mjs';
const records=rows=>rows.map(([date,type],i)=>({id:String(i),date,type}));
const types=['whole','plasma','platelet','mixed'];

test('Calendar summaries keep four donation types distinct and apply volunteer hours only from July 1, 2010',()=>{
  const result=donationHistorySummary(records([['2009-12-31','whole'],['2010-06-30','plasma'],['2010-07-01','mixed'],['2026-01-01','whole'],['2026-02-01','plasma'],['2026-03-01','platelet'],['2026-10-28','mixed']]),'2026-10-28');
  assert.deepEqual(result.total,{counts:{whole:2,plasma:2,platelet:1,mixed:2},count:7,hours:20});
  assert.deepEqual(result.byYear['2026'].counts,{whole:1,plasma:1,platelet:1,mixed:1});
  assert.equal(result.byYear['2026'].hours,16);assert.equal(result.byYear['2010'].count,2);assert.equal(result.byYear['2010'].hours,4);
  assert.equal(result.byYear['2010'].months[5].hours,0);assert.equal(result.byYear['2010'].months[6].hours,4);
});

test('Months and years follow calendar boundaries including leap day, December 31 and January 1',()=>{
  const result=donationHistorySummary(records([['2023-12-31','whole'],['2024-01-01','plasma'],['2024-02-28','platelet'],['2024-02-29','mixed'],['2024-03-01','whole'],['2024-12-31','plasma'],['2025-01-01','mixed']]),'2026-10-28');
  assert.equal(result.byYear['2023'].count,1);assert.equal(result.byYear['2024'].count,5);assert.equal(result.byYear['2025'].count,1);assert.equal(result.byYear['2026'].count,0);
  assert.deepEqual(result.byYear['2024'].months.map(x=>x.count),[1,2,1,0,0,0,0,0,0,0,0,1]);
  assert.deepEqual(result.byYear['2024'].months[1].counts,{whole:0,plasma:0,platelet:1,mixed:1});
  assert.equal(result.byYear['2024'].months[1].hours,8);
});

test('Empty years remain selectable with twelve independent zero months; Korean current year comes from the supplied local date',()=>{
  const empty=donationHistorySummary([],'2026-10-28');assert.deepEqual(empty.years,['2026']);assert.equal(empty.total.count,0);assert.equal(empty.byYear['2026'].months.length,12);
  const saved=records([['2024-12-31','plasma']]),before=donationHistorySummary(saved,'2026-12-31'),after=donationHistorySummary(saved,'2027-01-01');
  assert.deepEqual(before.years,['2026','2025','2024']);assert.deepEqual(after.years,['2027','2026','2025','2024']);
  assert.equal(after.byYear['2025'].count,0);assert.equal(after.byYear['2027'].hours,0);assert.deepEqual(before.total,after.total);
  after.byYear['2025'].months[0].counts.whole=99;assert.equal(after.byYear['2025'].months[1].counts.whole,0);assert.equal(after.byYear['2026'].months[0].counts.whole,0);
});

test('Summaries are read-only and ignore malformed, out-of-range and future records without creating invalid year choices',()=>{
  const saved=[...records([['2026-10-28','mixed'],['2026-10-29','whole'],['2026-02-29','plasma'],['1899-12-31','plasma'],['2200-01-01','plasma'],['2025-01-01','constructor']]),null,{date:'<script>',type:'whole'}];
  const before=JSON.stringify(saved),result=donationHistorySummary(saved,'2026-10-28');
  assert.equal(JSON.stringify(saved),before);assert.equal(result.total.count,1);assert.equal(result.total.hours,4);assert.deepEqual(result.years,['2026']);
  assert.throws(()=>donationHistorySummary(saved,'invalid'),/집계 기준일/);
});

test('The maximum 3,000 completed records reconcile between totals, calendar years and all monthly type/hour columns',()=>{
  const saved=Array.from({length:3000},(_,i)=>({id:String(i),date:addDays('2026-10-28',-i),type:types[i%4]})),result=donationHistorySummary(saved,'2026-10-28');
  assert.equal(result.total.count,3000);assert.equal(result.total.hours,12000);
  assert.equal(Object.values(result.byYear).reduce((sum,x)=>sum+x.count,0),3000);
  for(const [year,annual] of Object.entries(result.byYear)){
    const matches=saved.filter(row=>row.date.startsWith(year+'-'));
    assert.equal(annual.count,matches.length);assert.equal(annual.hours,matches.length*4);
    for(const type of types){
      assert.equal(annual.counts[type],matches.filter(row=>row.type===type).length);
      assert.equal(annual.counts[type],annual.months.reduce((sum,x)=>sum+x.counts[type],0));
    }
    annual.months.forEach((month,i)=>{assert.equal(month.count,matches.filter(row=>Number(row.date.slice(5,7))===i+1).length);assert.equal(month.hours,month.count*4);});
  }
});
