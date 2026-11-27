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
function timelineFacts(events,date,rules,entries,excludeId){
  const lower=yearStart(date),include=rules.boundary==='include';
  let used=0,whole=0,components=0,previous,duplicate=false;
  for(const e of events){
    if(e.date>date||(excludeId!==undefined&&e.id===excludeId))continue;
    // An earlier donation outside the annual window can still impose a custom wait.
    if(e.date===date)duplicate=true;
    else if(!previous||e.date>previous.date)previous=e;
    if(e.date<lower||(!include&&e.date===lower))continue;
    used+=amount(e,rules);
    if(e.type==='whole')whole++;else components++;
    if(entries)entries.push(e);
  }
  return {used,whole,components,previous,duplicate,lower,include};
}
export function stats(events,date,rules=DEFAULT_RULES){
  const entries=[],{used,whole,components,lower,include}=timelineFacts(events,date,rules,entries);
  return {entries,used,remaining:rules.cap-used,whole,components,start:include?lower:addDays(lower,1),end:date};
}
export function usedInWindow(events,date,rules=DEFAULT_RULES){return timelineFacts(events,date,rules).used;}
function waitIssue(previous,date,rules){
  if(!previous)return undefined;
  const wait=rules.waits[previous.type],next=addDays(previous.date,wait);
  return date<next?{code:'interval',text:`${previous.date} ${TYPES[previous.type].label} 이후 ${wait}일 간격 필요 · ${next}부터`}:undefined;
}
function assessmentFacts(events,date,rules,restrictions,excludeId){
  const facts=timelineFacts(events,date,rules,undefined,excludeId),common=[];
  for(const item of restrictions)if(item.start<=date&&date<=item.end)common.push({code:'manual-restriction',text:`직접 등록한 헌혈 제한 · ${item.start} ~ ${item.end}${item.reason?' · '+item.reason:''}`});
  if(facts.duplicate)common.push({code:'duplicate',text:'같은 날짜에 다른 기록 또는 계획이 있습니다.'});
  facts.common=common;facts.wait=waitIssue(facts.previous,date,rules);
  return facts;
}
const VOLUME_LIMIT=1,WHOLE_LIMIT=2,COMPONENT_LIMIT=4;
function limitFlags(type,recent,rules,projected){
  return (projected>rules.cap?VOLUME_LIMIT:0)
    | (type==='whole'&&recent.whole>=rules.wholeLimit?WHOLE_LIMIT:0)
    | ((type==='platelet'||type==='mixed')&&recent.components>=rules.componentLimit?COMPONENT_LIMIT:0);
}
function assessType(type,recent,rules){
  const issues=recent.common.slice();
  if(recent.wait)issues.push(recent.wait);
  const projected=recent.used+rules.volumes[type],limits=limitFlags(type,recent,rules,projected);
  if(limits&VOLUME_LIMIT)issues.push({code:'volume',text:`연간 계산량 ${projected.toLocaleString()}mL · 한도보다 ${(projected-rules.cap).toLocaleString()}mL 초과`});
  if(limits&WHOLE_LIMIT)issues.push({code:'whole-count',text:`직전 1년 전혈 ${recent.whole+1}회 · ${rules.wholeLimit}회 한도 초과`});
  if(limits&COMPONENT_LIMIT)issues.push({code:'component-count',text:`직전 1년 성분헌혈 ${recent.components+1}회 · ${TYPES[type].label} ${rules.componentLimit}회 조건 초과`});
  return {ok:issues.length===0,issues,used:recent.used,projected,remaining:rules.cap-projected,previous:recent.previous};
}
export function assess(event,others,rules=DEFAULT_RULES,restrictions=[]){return assessType(event.type,assessmentFacts(others,event.date,rules,restrictions),rules);}
export function inspectPlan(records,plans,rules=DEFAULT_RULES,restrictions=[]){
  const all=[...records,...plans];
  return [...plans].sort((a,b)=>a.date.localeCompare(b.date)).map(event=>({event,...assessType(event.type,assessmentFacts(all,event.date,rules,restrictions,event.id),rules)}));
}
const typeKeys=Object.keys(TYPES);
function simulateTypes(date,id,types,records,plans,rules,restrictions){
  let baseline=records;
  if(plans.length){baseline=records.slice();for(const plan of plans)if(plan.id!==id)baseline.push(plan);}
  const facts=assessmentFacts(baseline,date,rules,restrictions);
  const choices=types.map(type=>({type,result:{...assessType(type,facts,rules),conflicts:[]}}));
  if(!plans.length)return choices;
  const candidates=choices.filter(({result})=>result.ok).map(({type,result})=>({type,result,waitEnd:addDays(date,rules.waits[type])}));
  if(!candidates.length)return choices;
  const lastWait=candidates.reduce((end,c)=>c.waitEnd>end?c.waitEnd:end,date);
  for(const later of plans){
    if(later.id===id||later.date<=date)continue;
    const lower=yearStart(later.date),inAnnualWindow=date>lower||(date===lower&&rules.boundary==='include');
    if(!inAnnualWindow&&later.date>=lastWait)continue;
    const beforeFacts=assessmentFacts(baseline,later.date,rules,restrictions,later.id);
    const becomesPrevious=!beforeFacts.previous||date>beforeFacts.previous.date;
    if(!inAnnualWindow&&!becomesPrevious)continue;
    const before=assessType(later.type,beforeFacts,rules).issues;
    for(const {type,result,waitEnd} of candidates){
      if(!inAnnualWindow&&later.date>=waitEnd)continue;
      const afterFacts={...beforeFacts};
      if(inAnnualWindow){afterFacts.used+=rules.volumes[type];if(type==='whole')afterFacts.whole++;else afterFacts.components++;}
      if(becomesPrevious){afterFacts.wait=waitIssue({date,type},later.date,rules);}
      const after=assessType(later.type,afterFacts,rules).issues;
      const added=after.filter(issue=>!before.some(prev=>prev.code===issue.code&&prev.text===issue.text));
      if(added.length){result.conflicts.push({event:later,issues:added});result.ok=false;}
    }
  }
  return choices;
}
export function simulate(event,records,plans,rules=DEFAULT_RULES,restrictions=[]){return simulateTypes(event.date,event.id,[event.type],records,plans,rules,restrictions)[0].result;}
export function simulateChoices(date,id,records,plans,rules=DEFAULT_RULES,restrictions=[]){return simulateTypes(date,id,typeKeys,records,plans,rules,restrictions);}
export function availabilityForDate(date,records,plans=[],rules=DEFAULT_RULES,restrictions=[]){
  const record=records.find(e=>e.date===date)||null,plan=plans.find(e=>e.date===date)||null;
  return {record,plan,choices:simulateChoices(date,plan?.id||'__candidate__',records,plans,rules,restrictions)};
}
function blockedThrough(date,restrictions){
  let through;
  for(const item of restrictions)if(item.start<=date&&date<=item.end&&(!through||item.end>through))through=item.end;
  return through;
}
export function earliest(type,from,records,plans=[],rules=DEFAULT_RULES,days=1098,restrictions=[]){
  for(let i=0;i<=days;i++){
    const date=addDays(from,i),through=blockedThrough(date,restrictions);
    if(through){i=daysBetween(from,through);continue;}
    const event={id:'__candidate__',date,type},result=plans.length?simulate(event,records,plans,rules,restrictions):assess(event,records,rules);
    if(result.ok)return date;
  }return null;
}
export function earliestWithoutPlans(from,records,rules=DEFAULT_RULES,days=1098,restrictions=[]){
  const dates=typeKeys.map(type=>({type,date:null}));let remaining=dates.length;
  for(let i=0;i<=days&&remaining;i++){
    const date=addDays(from,i),through=blockedThrough(date,restrictions);
    if(through){i=daysBetween(from,through);continue;}
    const facts=timelineFacts(records,date,rules);
    if(facts.duplicate||(facts.previous&&date<addDays(facts.previous.date,rules.waits[facts.previous.type])))continue;
    for(const item of dates){
      const type=item.type;
      if(item.date||limitFlags(type,facts,rules,facts.used+rules.volumes[type]))continue;
      item.date=date;remaining--;
    }
  }
  return dates;
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
