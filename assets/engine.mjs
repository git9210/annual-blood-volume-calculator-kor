export const TYPES = {
  whole: {label:'전혈',short:'전혈',color:'#ce4b43'},
  plasma: {label:'혈장',short:'혈장',color:'#b87929'},
  platelet: {label:'혈소판',short:'혈소판',color:'#52769c'},
  mixed: {label:'혈소판 혈장',short:'혈소판혈장',color:'#718c37'},
};
export const DEFAULT_RULES = {cap:2160,volumes:{whole:430,plasma:45,platelet:90,mixed:90},waits:{whole:56,plasma:14,platelet:14,mixed:14},wholeLimit:5,componentLimit:24,boundary:'exclude'};
export const clone = value => JSON.parse(JSON.stringify(value));
export function migrateLegacyTypes(raw){
  if(!raw||typeof raw!=='object')return raw;
  const settings=(value,defaults)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return value;
    const result={...value};
    if(result.platelet===undefined)result.platelet=result.mixed??defaults.platelet;
    if(result.mixed===undefined)result.mixed=result.platelet;
    return result;
  };
  // Never guess which existing mixed records used to be platelet donations.
  return {...raw,rules:raw.rules?{...raw.rules,volumes:settings(raw.rules.volumes,DEFAULT_RULES.volumes),waits:settings(raw.rules.waits,DEFAULT_RULES.waits)}:raw.rules};
}
export function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s;}
// Calculation dates must be ISO, never locale-formatted display strings.
// Korea uses UTC+09:00; this also works with older WebView locale data, offline.
export function today(){return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);}
// Completed-history summaries use calendar years/months, independent of
// rolling-volume rules, display filters and future plans. No totals are stored.
export const VOLUNTEER_START='2010-07-01',VOLUNTEER_HOURS_PER_DONATION=4;
export function donationHistorySummary(records,currentDate=today()){
  if(!validDate(currentDate))throw Error('집계 기준일을 확인해 주세요.');
  const empty=()=>({counts:{whole:0,plasma:0,platelet:0,mixed:0},count:0,hours:0});
  const emptyYear=()=>({...empty(),months:Array.from({length:12},empty)});
  const total=empty(),byYear={},currentYear=Number(currentDate.slice(0,4));let firstYear=currentYear;
  for(const record of records){
    if(!record||!validDate(record.date)||record.date<'1900-01-01'||record.date>'2199-12-31'||record.date>currentDate||!Object.hasOwn(TYPES,record.type))continue;
    const year=Number(record.date.slice(0,4)),month=Number(record.date.slice(5,7))-1;
    firstYear=Math.min(firstYear,year);
    const annual=byYear[year]??(byYear[year]=emptyYear());
    const hours=record.date>=VOLUNTEER_START?VOLUNTEER_HOURS_PER_DONATION:0;
    for(const period of [total,annual,annual.months[month]]){period.counts[record.type]++;period.count++;period.hours+=hours;}
  }
  const years=Array.from({length:currentYear-firstYear+1},(_,i)=>String(currentYear-i));
  for(const year of years)byYear[year]??=emptyYear();
  return {total,years,byYear};
}
export function addDays(s,n){const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function shiftYear(s,n){const [y,m,d]=s.split('-').map(Number),yy=y+n;const max=new Date(Date.UTC(yy,m,0)).getUTCDate();return `${yy}-${String(m).padStart(2,'0')}-${String(Math.min(d,max)).padStart(2,'0')}`;}
export function yearStart(s){return shiftYear(s,-1);}
export function daysBetween(a,b){return Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000);}
// Personal deferrals affect eligibility only. They are never donations and never
// alter inWindow(), stats(), releaseDate() or a previous donation's wait period.
export const RESTRICTION_MAX_DAYS=3650;
// Keep the existing Korean 20 / other text 40 weighted bound for all scripts.
export function restrictionReasonUnits(value){return Array.from(value).reduce((sum,char)=>sum+(/\p{Script=Hangul}/u.test(char)?2:1),0);}
// Block emoji presentation, flags, skin tones, keycaps and common text faces.
// Default-text symbols such as ©, ™ and arrows remain ordinary text unless
// an emoji presentation selector follows them.
const REASON_EMOJI=/[\p{Emoji_Presentation}\p{Regional_Indicator}\u20e3\ufe0f\u2639-\u263b\u2661\u2665\u2764]/u;
// Text faces have no universal Unicode category. Match common forms without
// blocking ordinary punctuation, URLs or standalone Korean jamo.
const REASON_EMOTICON=/(?:\^{2,}|\^[_ .-]?\^|[Ttㅠㅜಠ][_.-][Ttㅠㅜಠ]|[><][_.-][><]|[Oo0][_.-][Oo0]|[:;=8][-^']?[)(DPp](?![\p{L}\p{N}])|(?:^|\s)[:;=8xX][-^']?[/\\](?=\s|$)|¯\\_|[╯╰][^\n]{0,30}[┻┬]|ʕ[^\n]{0,30}ʔ)/u;
const REASON_HIDDEN=/[\p{Cc}\p{Cs}\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/u;
export function normalizeRestrictionReason(value){
  if(typeof value!=='string')throw Error('헌혈금지사유를 확인해 주세요.');
  const reason=value.normalize('NFC').trim();
  if(REASON_EMOJI.test(reason)||REASON_EMOTICON.test(reason))throw Error('이모지와 이모티콘은 입력할 수 없습니다.');
  if(REASON_HIDDEN.test(reason))throw Error('줄바꿈·제어 문자·보이지 않는 문자는 입력할 수 없습니다.');
  if(restrictionReasonUnits(reason)>40)throw Error('한글 20자 또는 그 밖의 문자 40자 이내로 입력해 주세요. 혼합 입력은 비례 계산합니다.');
  return reason;
}
export function validateRestrictions(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>500)throw Error('헌혈 제한 기간은 최대 500건까지 저장할 수 있습니다.');
  const ids=new Set();
  return value.map(item=>{
    if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||ids.has(item.id))throw Error('헌혈 제한 기간의 식별자를 확인해 주세요.');
    if(!validDate(item.start)||!validDate(item.end)||item.start<'1900-01-01'||item.end>'2199-12-31'||item.end<item.start||daysBetween(item.start,item.end)>=RESTRICTION_MAX_DAYS)throw Error('헌혈 제한 기간의 날짜를 확인해 주세요.');
    ids.add(item.id);return {id:item.id,start:item.start,end:item.end,reason:normalizeRestrictionReason(item.reason??'')};
  });
}
export function activeRestrictions(date,restrictions=[]){return restrictions.filter(item=>item.start<=date&&date<=item.end);}
export function weekday(s){return new Date(s+'T00:00:00Z').getUTCDay();}
export function amount(e,rules=DEFAULT_RULES){return rules.volumes[e.type];}
export function inWindow(e,date,rules=DEFAULT_RULES){const lower=yearStart(date);return e.date<=date&&(rules.boundary==='include'?e.date>=lower:e.date>lower);}
export function stats(events,date,rules=DEFAULT_RULES){const lower=yearStart(date),include=rules.boundary==='include';const entries=events.filter(e=>e.date<=date&&(include?e.date>=lower:e.date>lower));const used=entries.reduce((n,e)=>n+amount(e,rules),0);return {entries,used,remaining:rules.cap-used,whole:entries.filter(e=>e.type==='whole').length,components:entries.filter(e=>e.type!=='whole').length,start:include?lower:addDays(lower,1),end:date};}
export function assess(event,others,rules=DEFAULT_RULES,restrictions=[]){
  let previous;for(const other of others)if(other.date<event.date&&(!previous||other.date>previous.date))previous=other;
  const recent=stats(others,event.date,rules),issues=[];
  for(const item of activeRestrictions(event.date,restrictions))issues.push({code:'manual-restriction',text:`직접 등록한 헌혈 제한 · ${item.start} ~ ${item.end}${item.reason?' · '+item.reason:''}`});
  if(others.some(e=>e.date===event.date))issues.push({code:'duplicate',text:'같은 날짜에 다른 기록 또는 계획이 있습니다.'});
  if(previous){const next=addDays(previous.date,rules.waits[previous.type]);if(event.date<next)issues.push({code:'interval',text:`${previous.date} ${TYPES[previous.type].label} 이후 ${rules.waits[previous.type]}일 간격 필요 · ${next}부터`});}
  const projected=recent.used+amount(event,rules);
  if(projected>rules.cap)issues.push({code:'volume',text:`연간 계산량 ${projected.toLocaleString()}mL · 한도보다 ${(projected-rules.cap).toLocaleString()}mL 초과`});
  if(event.type==='whole'&&recent.whole+1>rules.wholeLimit)issues.push({code:'whole-count',text:`직전 1년 전혈 ${recent.whole+1}회 · ${rules.wholeLimit}회 한도 초과`});
  if(['platelet','mixed'].includes(event.type)&&recent.components+1>rules.componentLimit)issues.push({code:'component-count',text:`직전 1년 성분헌혈 ${recent.components+1}회 · ${TYPES[event.type].label} ${rules.componentLimit}회 조건 초과`});
  return {ok:issues.length===0,issues,used:recent.used,projected,remaining:rules.cap-projected,previous};
}
export function inspectPlan(records,plans,rules=DEFAULT_RULES,restrictions=[]){const all=[...records,...plans];return [...plans].sort((a,b)=>a.date.localeCompare(b.date)).map(event=>({event,...assess(event,all.filter(e=>e.id!==event.id),rules,restrictions)}));}
export function simulate(event,records,plans,rules=DEFAULT_RULES,restrictions=[]){
  const baseline=[...records,...plans.filter(e=>e.id!==event.id)];
  const own=assess(event,baseline,rules,restrictions),conflicts=[];
  if(own.ok){
    const waitEnd=addDays(event.date,rules.waits[event.type]);
    for(const later of plans.filter(e=>e.id!==event.id&&e.date>event.date)){
      // Once both effects expire, this candidate cannot add an annual amount,
      // count or waiting-period issue. Keep custom waits and leap boundaries.
      if(later.date>=waitEnd&&!inWindow(event,later.date,rules))continue;
      const other=baseline.filter(e=>e.id!==later.id),before=assess(later,other,rules,restrictions),after=assess(later,[...other,event],rules,restrictions);
      const added=after.issues.filter(i=>!before.issues.some(b=>b.code===i.code&&b.text===i.text));
      if(added.length)conflicts.push({event:later,issues:added});
    }
  }
  return {...own,ok:own.ok&&conflicts.length===0,conflicts};
}
export function earliest(type,from,records,plans=[],rules=DEFAULT_RULES,days=1098,restrictions=[]){
  for(let i=0;i<=days;i++){
    const date=addDays(from,i),blocked=activeRestrictions(date,restrictions);
    if(blocked.length){i=daysBetween(from,blocked.reduce((end,item)=>item.end>end?item.end:end,date));continue;}
    const result=simulate({id:'__candidate__',date,type},records,plans,rules,restrictions);if(result.ok)return date;
  }return null;
}
export function availabilityForDate(date,records,plans=[],rules=DEFAULT_RULES,restrictions=[]){
  const record=records.find(e=>e.date===date)||null,plan=plans.find(e=>e.date===date)||null;
  const choices=Object.keys(TYPES).map(type=>({type,result:simulate({id:plan?.id||'__candidate__',date,type},records,plans,rules,restrictions)}));
  return {record,plan,choices};
}
export function releaseDate(event,rules=DEFAULT_RULES){let date=shiftYear(event.date,1);while(inWindow(event,date,rules))date=addDays(date,1);while(inWindow(event,addDays(date,-1),rules)===false)date=addDays(date,-1);return date;}
export function parseLines(text){
  const rows=[],errors=[];
  text.split(/\r?\n/).forEach((line,i)=>{line=line.trim();if(!line||/^(날짜|date)[,\t ]/i.test(line))return;
    const match=line.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    const date=match?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:'';
    const normalized=line.replace(/\s/g,'');
    let type=normalized.includes('혈소판혈장')?'mixed':normalized.includes('혈소판')?'platelet':normalized.includes('전혈')?'whole':normalized.includes('혈장')?'plasma':null;
    if(!type){const codes=line.toLowerCase().split(/[,\t ]+/);type=Object.keys(TYPES).find(t=>codes.includes(t))||null;}
    if(!validDate(date)||!type){errors.push(`${i+1}번째 줄: 날짜 또는 헌혈 종류를 확인해 주세요.`);return;}
    rows.push({date,type,line:i+1});
  });return {rows,errors};
}
export function proposeMonthly(records,plans,start,months,preference,rules=DEFAULT_RULES,restrictions=[]){
  const draft=[],skipped=[];const [y,m]=start.split('-').map(Number);
  for(let k=0;k<months;k++){
    const first=new Date(Date.UTC(y,m-1+k,1)).toISOString().slice(0,10),last=new Date(Date.UTC(y,m+k,0)).toISOString().slice(0,10),month=first.slice(0,7);
    if([...records,...plans,...draft].some(e=>e.date.startsWith(month)))continue;
    const dates=[];for(let d=first;d<=last;d=addDays(d,1))if(d>=start)dates.push(d);
    dates.sort((a,b)=>{const rank=d=>weekday(d)===5?0:weekday(d)>0&&weekday(d)<6?1:2;return rank(a)-rank(b)||a.localeCompare(b);});
    const types=preference==='whole'?['whole','mixed','platelet','plasma']:preference==='platelet'?['platelet','plasma']:preference==='mixed'?['mixed','plasma']:['plasma'];
    let found=false;
    for(const type of types){for(const date of dates){if(weekday(date)===0||weekday(date)===6)continue;const e={id:`draft-${k}`,date,type};if(simulate(e,records,[...plans,...draft],rules,restrictions).ok){draft.push(e);found=true;break;}}if(found)break;}
    if(!found)skipped.push(month);
  }return {draft,skipped};
}
