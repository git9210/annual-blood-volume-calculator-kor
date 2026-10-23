import {TYPES,DEFAULT_RULES,clone,validDate,today,addDays,shiftYear,weekday,stats,amount,assess,simulate,earliest,releaseDate,inspectPlan,parseLines,proposeMonthly,migrateLegacyTypes,availabilityForDate,activeRestrictions,validateRestrictions,normalizeRestrictionReason,daysBetween,RESTRICTION_MAX_DAYS} from './engine.mjs?v=20261018-bottom-navigation';
import {calendarWindow} from './calendar-view.mjs?v=20261018-bottom-navigation';
import {createHolidayStore} from './holidays.mjs?v=20261018-bottom-navigation';
import {reviewCertificate,mergeCertificate} from './certificate-import.mjs';
import {createProtectedStorage} from './secure-storage.mjs';
import {encryptBackup,decryptBackup,isEncryptedBackup} from './backup-crypto.mjs';
import {HOLIDAY_DATA_LICENSE} from './licenses.mjs';

const KEY='blood-note-v1', $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const APP_PAGES=['dashboard','planner','records','settings'];
const START_PAGES={dashboard:'한눈에 보기',planner:'일정 시뮬레이터',records:'헌혈 기록',last:'마지막 화면'};
const startPageChoiceOf=data=>Object.hasOwn(START_PAGES,data?.startPage)?data.startPage:'dashboard';
const startPageOf=data=>startPageChoiceOf(data)==='last'?(APP_PAGES.includes(data?.lastPage)?data.lastPage:'dashboard'):startPageChoiceOf(data);
const DISPLAY_OPTIONS={
  balanceHighlight:{label:'잔여량 구간별 표시',description:'잔여량에 따라 카드 색과 계산량 충족 설명을 표시합니다.'},
  recordHighlight:{label:'헌혈 완료일 강조',description:'달력의 완료 날짜를 파란 배경과 ✓로 표시합니다.'},
  redConnectCalendar:{label:'레드커넥트 버튼 · 캘린더',description:'달력의 오늘·미래 날짜 팝업에 레드커넥트 열기 버튼을 표시합니다.'},
  redConnectPlan:{label:'레드커넥트 버튼 · 장기 계획',description:'오늘 이후 가장 가까운 헌혈 계획에 레드커넥트 열기 버튼을 표시합니다.'}
};
const displayEnabled=(key,data=demoMode?realState:state)=>data.displayOptions?.[key]!==false;
const fresh=()=>({version:1,rules:clone(DEFAULT_RULES),records:[],plans:[],complete:false,appliedImports:[]});
const validAnchorDate=date=>validDate(date)&&date>='1900-01-01'&&date<='2199-12-31';
const anchorModes=['last','today','custom'];
const fmt=(s,year=false)=>{if(!s)return '—';const [y,m,d]=s.split('-');return `${year?y+'. ':''}${Number(m)}. ${Number(d)}.`;};
const full=s=>s?`${fmt(s,true)} ${'일월화수목금토'[weekday(s)]}요일`:'—';
const num=n=>Number(n).toLocaleString('ko-KR');
let storageFailed=false;
function validateState(raw){
  raw=migrateLegacyTypes(raw);
  if(!raw||raw.version!==1||!Array.isArray(raw.records)||!Array.isArray(raw.plans)||raw.records.length+raw.plans.length>3000)throw Error('연간채혈량 계산기 백업 형식이 아닙니다.');
  const r=raw.rules;if(!r||!r.volumes||!r.waits)throw Error('계산 기준을 찾을 수 없습니다.');
  for(const [key,max] of [['cap',100000],['wholeLimit',1000],['componentLimit',1000]])if(!Number.isInteger(r[key])||r[key]<1||r[key]>max)throw Error('계산 기준 숫자를 확인해 주세요.');
  const rules={cap:r.cap,wholeLimit:r.wholeLimit,componentLimit:r.componentLimit,boundary:r.boundary==='include'?'include':'exclude',volumes:{},waits:{}};
  for(const t of Object.keys(TYPES)){if(!Number.isInteger(r.volumes[t])||r.volumes[t]<1||r.volumes[t]>10000||!Number.isInteger(r.waits[t])||r.waits[t]<1||r.waits[t]>1000)throw Error('헌혈 종류별 계산 기준을 확인해 주세요.');rules.volumes[t]=r.volumes[t];rules.waits[t]=r.waits[t];}
  const seen=new Set(),dates=new Set();
  const clean=(rows,actual)=>rows.map(e=>{if(!e||!validDate(e.date)||e.date<'1900-01-01'||e.date>'2199-12-31'||!TYPES[e.type]||(actual&&e.date>today()))throw Error('유효하지 않은 날짜 또는 종류가 있습니다.');if(typeof e.id!=='string'||seen.has(e.id)||dates.has(e.date))throw Error('중복 날짜 또는 기록이 있습니다.');seen.add(e.id);dates.add(e.date);return {id:e.id,date:e.date,type:e.type};});
  const appliedImports=Array.isArray(raw.appliedImports)?[...new Set(raw.appliedImports.filter(id=>typeof id==='string'&&id.length<=150))]:[];
  const result={version:1,rules,records:clean(raw.records,true),plans:clean(raw.plans,false),complete:raw.complete===true,appliedImports};
  if(raw.restrictions!==undefined)result.restrictions=validateRestrictions(raw.restrictions);
  if(Object.hasOwn(START_PAGES,raw.startPage))result.startPage=raw.startPage;
  if(APP_PAGES.includes(raw.lastPage))result.lastPage=raw.lastPage;
  if(raw.displayOptions&&typeof raw.displayOptions==='object'&&!Array.isArray(raw.displayOptions)){
    const options={};
    for(const key of Object.keys(DISPLAY_OPTIONS))if(typeof raw.displayOptions[key]==='boolean')options[key]=raw.displayOptions[key];
    if(Object.keys(options).length)result.displayOptions=options;
  }
  // Preserve legacy anchor metadata for backup compatibility; dashboard calculations always use today.
  const anchor=raw.calculationAnchor;
  if(anchor&&typeof anchor==='object'&&!Array.isArray(anchor))result.calculationAnchor={mode:anchorModes.includes(anchor.mode)?anchor.mode:'last',customDate:validAnchorDate(anchor.customDate)?anchor.customDate:today()};
  return result;
}
function storageNotice(message){storageFailed=true;$('#storage-warning').textContent=message;$('#storage-warning').hidden=false;}
let appStorage;
try{appStorage=createProtectedStorage({bridge:window.BloodNoteAndroid,legacyStorage:window.localStorage,validateRecords:raw=>validateState(JSON.parse(raw))});}
catch{
  appStorage={getItem:()=>null,setItem:()=>{throw Error('암호화 저장소를 사용할 수 없습니다.');}};
  storageNotice('암호화 저장소를 열지 못했습니다. 기존 데이터는 덮어쓰지 않았습니다. 앱을 다시 시작해 주세요.');
}
let state=fresh();
try{const raw=appStorage.getItem(KEY);if(raw)state=validateState(JSON.parse(raw));}catch{storageNotice('저장된 기록을 읽지 못했습니다. 기존 저장 내용은 덮어쓰지 않습니다. 설정·백업에서 백업을 복원하거나 저장소를 확인해 주세요.');}
// A restored Activity keeps its current page; a fresh launch opens the saved start page.
let realState=null,demoMode=false,page=APP_PAGES.includes(location.hash.slice(1))?location.hash.slice(1):startPageOf(state);
let selected=today(),calendarMonth=today().slice(0,7),recordFilter='all';
const RECORDS_PER_PAGE=5;
let recordPageIndex=0,holidayConsentId=null;
let calendarAnchor=today(),dayPopup=null,restrictionEditor=null;
const restrictions=()=>state.restrictions||[];
const calendarView=()=> 'month';
function moveCalendar(date){calendarAnchor=date;calendarMonth=date.slice(0,7);}
let toastTimer,undoAction,installPrompt,holidayFitFrame;
let dayRefreshTimer,displayedDate=today();
const selectedPlanIds=new Set();
const holidays=createHolidayStore({storage:appStorage,onChange:updateHolidayUI});
const typeOptions=selected=>Object.entries(TYPES).map(([key,t])=>`<option value="${key}" ${key===selected?'selected':''}>${t.label}</option>`).join('');
const typeLabel=t=>`<span class="type-label"><i class="dot" style="background:${TYPES[t].color}"></i>${TYPES[t].label}</span>`;
function toast(message,undo){clearTimeout(toastTimer);undoAction=undo;$('#toast').innerHTML=escape(message)+(undo?'<button id="undo">되돌리기</button>':'');$('#toast').classList.add('visible');toastTimer=setTimeout(()=>{$('#toast').classList.remove('visible');undoAction=null;},3000);}
$('#toast').addEventListener('click',e=>{if(e.target.id==='undo'&&undoAction){const fn=undoAction;undoAction=null;fn();$('#toast').classList.remove('visible');}});
function persist(){
  if(demoMode)return true;
  if(storageFailed){toast('저장소를 열지 못해 변경 내용을 저장하지 않았습니다.');return false;}
  const next=startPageChoiceOf(state)==='last'?{...state,lastPage:page}:state;
  try{appStorage.setItem(KEY,JSON.stringify(next));state=next;$('#storage-warning').hidden=true;return true;}
  catch{$('#storage-warning').textContent='기기에 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.';$('#storage-warning').hidden=false;toast('저장하지 못했습니다. 기존 기록을 유지합니다.');return false;}
}
function change(fn,message){
  const before=clone(state);fn();
  if(!persist()){state=before;render();return false;}
  render();if(message)toast(message,()=>{const current=state;state=before;if(!persist())state=current;render();});return true;
}
function rememberPage(){if(!demoMode&&startPageChoiceOf(state)==='last'&&state.lastPage!==page)persist();}
function setPage(p){if(!APP_PAGES.includes(p))return;page=p;location.hash=p;rememberPage();render();window.scrollTo({top:0});}
window.bloodNoteHandleBack=()=>{
  if(dialog.open){dialog.close();return true;}
  const preference=demoMode?realState:state;
  if(startPageChoiceOf(preference)==='last')return false;
  const home=startPageOf(preference);
  if(page!==home){setPage(home);return true;}
  return false;
};
function saveStartPage(value){
  if(!Object.hasOwn(START_PAGES,value))return;
  if(demoMode){toast('예시 체험을 종료한 뒤 첫 화면을 설정해 주세요.');render();return;}
  if(value===state.startPage)return;
  const before=state;
  state={...state,startPage:value};
  if(!persist())state=before;
  else{
    // A pending record undo must not roll back a subsequently saved preference.
    undoAction=null;
    toast(`첫 화면을 ‘${START_PAGES[value]}’로 저장했습니다.`);
  }
  render();
  $('#start-page')?.focus({preventScroll:true});
}
function saveDisplayOption(key,enabled){
  if(!Object.hasOwn(DISPLAY_OPTIONS,key)||typeof enabled!=='boolean')return;
  if(demoMode){toast('예시 체험을 종료한 뒤 화면 표시를 설정해 주세요.');render();return;}
  if(displayEnabled(key)===enabled)return;
  const before=state;
  state={...state,displayOptions:{...state.displayOptions,[key]:enabled}};
  if(!persist())state=before;
  else toast(`${DISPLAY_OPTIONS[key].label}를 ${enabled?'켰습니다':'껐습니다'}.`);
  render();
  $('#display-'+key)?.focus({preventScroll:true});
}
function refreshLocalDay(){
  const date=today();
  if(date!==displayedDate){
    displayedDate=date;
    if(page==='planner'||page==='dashboard')render();
    else $('#date-label').textContent=full(date);
    if(dayPopup&&dialog.open)renderDayPopup();
  }
  clearTimeout(dayRefreshTimer);
  const midnight=new Date(date+'T00:00:00+09:00').getTime()+86400000;
  dayRefreshTimer=setTimeout(refreshLocalDay,Math.max(1000,midnight-Date.now()+100));
}
function empty(title,body,action='add-record',label='첫 기록 입력하기'){return `<div class="empty"><span class="symbol">+</span><h3>${title}</h3><p>${body}</p>${action?`<button class="primary small" data-action="${action}">${label}</button>`:''}</div>`;}
function heading(kicker,title,desc,right=''){return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div>${right}</div>`;}
function incompleteNotice(){return state.complete?'':`<div class="notice warning">최근 1년 기록을 모두 입력해야 잔여량과 예상 날짜가 정확해집니다. 현재 결과는 <strong>입력된 기록만으로 계산한 값</strong>입니다. <button class="quiet" data-action="records">기록 확인</button></div>`;}
function anchorDate(){return today();}
function render(){
  const calendarScrollLeft=$('.calendar-scroll')?.scrollLeft||0;
  for(const id of selectedPlanIds)if(!state.plans.some(e=>e.id===id))selectedPlanIds.delete(id);
  document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});
  $('#date-label').textContent=full(today());$('#demo-banner').hidden=!demoMode;
  app.innerHTML=page==='dashboard'?dashboard():page==='planner'?planner():page==='records'?recordsPage():settingsPage();
  const calendarScroll=$('.calendar-scroll');if(calendarScroll)calendarScroll.scrollLeft=calendarScrollLeft;
  updatePlanSelectionUI();
  updateHolidayUI();
}
function balanceBand(remaining,rules){
  const types=Object.keys(TYPES).filter(type=>remaining>=rules.volumes[type]);
  const tone=types.includes('whole')?'whole':types.some(type=>type==='platelet'||type==='mixed')?'component':types.includes('plasma')?'plasma':'low';
  return {tone,types,detail:types.length?`계산량 충족: ${types.map(type=>TYPES[type].label).join(' · ')}`:`최소 계산량 ${num(Math.min(...Object.values(rules.volumes)))}mL 미만`};
}
function dashboard(){
  const date=anchorDate(),s=stats(state.records,date,state.rules),has=state.records.length>0;
  const band=has&&displayEnabled('balanceHighlight')?balanceBand(s.remaining,state.rules):null;
  const balanceStatus=band?`<div class="balance-status"><p>${band.detail}</p><small>계산량 기준 · 간격·횟수 조건은 별도로 확인해 주세요.</small></div>`:'';
  const earliestDates=has?Object.keys(TYPES).map(type=>({type,date:earliest(type,today(),state.records,[],state.rules,1098,restrictions())})):[];
  const releases=s.entries.map(e=>({e,date:releaseDate(e,state.rules)})).filter(x=>x.date>date).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  const upcoming=[...state.plans].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3);
  const history=[...state.records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
  return '<h1 class="sr-only">한눈에 보기</h1>'+incompleteNotice()+restrictionNotice(date)+`
    <div class="grid">
      <section class="card balance-card balance-${band?.tone||(has?'plain':'empty')}"><div class="balance-title"><span>연간 잔여 계산량</span><span class="badge">${state.complete?'기록 입력 완료':'입력 기록 기준'}</span></div><div class="balance-number">${has?num(s.remaining):'—'}<span>mL</span></div><p>${has?`${full(date)} 기준`:'헌혈 기록을 입력하면 자동으로 계산해요.'}</p>${balanceStatus}<div class="track" role="meter" aria-label="연간 계산량 사용 비율" aria-valuenow="${Math.min(100,Math.max(0,s.used/state.rules.cap*100)).toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100,s.used/state.rules.cap*100)}%"></span></div><div class="track-labels"><span>누적 ${has?num(s.used):'—'}mL</span><span>설정 한도 ${num(state.rules.cap)}mL</span></div><div class="balance-note">${s.start} ~ ${s.end}<br>이 기간의 완료 기록만 합산 · 미래 계획은 별도 계산</div></section>
      <section class="card next-card"><div class="card-head"><div><h2>다음 헌혈 예상일</h2><p>오늘 이후 · 완료 기록 기준 · 계획 미포함</p></div><span class="badge">${state.complete?'계산상':'예상'}</span></div>${has?earliestDates.map(x=>`<div class="next-row">${typeLabel(x.type)}<div class="next-value">${x.date?full(x.date):'3년 내 날짜 없음'}<small>${x.date===today()?'오늘부터 계산 조건 충족':x.date?'간격·계산량·횟수 조건 반영':''}</small></div></div>`).join(''):empty('마지막 기록부터 시작해요','날짜와 헌혈 종류만 입력하면 다음 일정을 계산할 수 있어요.')}</section>
    </div>
    <div class="metric-grid"><div class="metric"><small>직전 1년 전혈</small><strong>${has?s.whole:'—'}<span>/ ${state.rules.wholeLimit}회</span></strong></div><div class="metric"><small>직전 1년 성분헌혈</small><strong>${has?s.components:'—'}<span>회</span></strong></div><div class="metric"><small>세워 둔 계획</small><strong>${state.plans.length}<span>건</span></strong></div></div>
    <div class="grid"><section class="card"><div class="card-head"><div><h2>다가오는 계획</h2><p>실제 기록에 영향을 주지 않는 가상 일정</p></div><button class="quiet" data-action="planner">일정 짜기 ↗</button></div>${upcoming.length?upcoming.map(e=>{const check=assess(e,[...state.records,...state.plans].filter(x=>x.id!==e.id),state.rules,restrictions());return `<div class="list-row"><div class="date">${full(e.date)}<p>${TYPES[e.type].label} · ${num(amount(e,state.rules))}mL</p></div><span class="badge" style="${check.ok?'':'background:#fff0e8;color:#a45c39'}">${check.ok?'계산 조건 충족':'조정 필요'}</span></div>`;}).join(''):empty('다음 헌혈을 미리 그려보세요','날짜와 종류를 바꾸며 앞으로의 잔여량을 비교할 수 있어요.','planner','일정 시뮬레이터 열기')}</section>
    <section class="card"><div class="card-head"><div><h2>계산에서 빠지는 기록</h2><p>기준일 이후, 1년 범위를 벗어나는 순서</p></div></div>${releases.length?releases.map(x=>`<div class="timeline-row"><div class="timeline-time">${fmt(x.date,true)}</div><div class="timeline-info">${TYPES[x.e.type].label}<strong>+ ${num(amount(x.e,state.rules))}mL</strong><small>${x.e.date} 기록이 합산에서 제외</small></div></div>`).join(''):empty('아직 표시할 기록이 없어요','헌혈 내역을 입력하면 여유가 생기는 날짜를 알려드려요.','','')}<p class="hint">그사이 헌혈을 추가하면 실제 잔여량도 함께 달라집니다.</p></section></div>
    <section class="card section-gap"><div class="card-head"><h2>최근 헌혈 기록</h2><button class="quiet" data-action="records">전체 보기 ↗</button></div>${history.length?history.map(e=>`<div class="list-row"><div class="date">${full(e.date)}<p>${TYPES[e.type].label}</p></div><strong>${num(amount(e,state.rules))}<small> mL</small></strong></div>`).join(''):empty('내 기록을 한곳에','여러 날짜가 있다면 복사해서 한 번에 붙여넣을 수도 있어요.','import-text','여러 기록 붙여넣기')}</section>`;
}
function calendarHTML(view,range){
  const emphasize=displayEnabled('recordHighlight');
  let html=view==='month'?'일월화수목금토'.split('').map((x,i)=>`<div class="weekday ${i===0?'weekday-sunday':i===6?'weekday-saturday':''}">${x}</div>`).join(''):'';
  for(let i=0;i<range.offset;i++)html+='<div aria-hidden="true"></div>';
  for(const date of range.dates){
    const {record,plan,choices}=availabilityForDate(date,state.records,state.plans,state.rules,restrictions()),past=date<today(),due=plan&&!record&&date<=today();
    const blocked=activeRestrictions(date,restrictions()).length>0;
    const statuses=choices.map(({type,result})=>({type,result,label:record?(record.type===type?'완료':'—'):blocked?'제한':past?'과거':result.ok?'가능':'제한',style:record?(record.type===type&&emphasize?'record-status completed-record':'record-status'):blocked?'cannot-donate':past?'past-status':result.ok?'can-donate':'cannot-donate'}));
    const flag=record?'기록':blocked?'제한':due?'확인 필요':plan?'계획':date===today()?'오늘':'',holiday=holidays.day(date);
    const summary=statuses.map(s=>`${TYPES[s.type].label} ${s.label}`).join(', ');
    html+=`<button type="button" data-calendar-date="${date}" data-action="day" data-date="${date}" data-day-summary="${summary}" class="day is-${holiday.kind} ${record?'recorded':plan?'planned':past?'past-day':''} ${blocked&&!record?'manually-restricted':''} ${record&&emphasize?'highlighted-record':''} ${selected===date?'selected':''} ${date===today()?'today':''}" aria-label="${full(date)}${holiday.names.length?', '+escape(holiday.names.join(' · ')):''}, ${summary} 날짜 상세 열기" aria-haspopup="dialog" aria-pressed="${selected===date}"><span class="day-heading"><span class="day-number">${Number(date.slice(8))}${record&&emphasize?'<span class="day-recorded-mark" aria-hidden="true">✓</span>':''}</span><span class="day-holiday" title="${escape(holiday.names.join(' · '))}" ${holiday.names.length?'':'hidden'}>${escape(holiday.names.join(' · '))}</span>${flag?`<span class="day-flag">${flag}</span>`:''}</span><span class="day-statuses">${statuses.map(s=>`<span class="day-status ${s.style}${plan?.type===s.type?' chosen-plan':''}" data-type="${s.type}"><span class="donation-name">${s.type==='mixed'?'혈소판<br>혈장':TYPES[s.type].label}</span><strong>${s.label}</strong></span>`).join('')}</span></button>`;
  }return html;
}
function updateHolidayUI(){
  if(page!=='planner')return;
  app.querySelectorAll('[data-calendar-date]').forEach(cell=>{
    const date=cell.dataset.calendarDate,day=holidays.day(date);
    for(const kind of ['weekday','saturday','sunday','holiday'])cell.classList.toggle('is-'+kind,day.kind===kind);
    const label=cell.querySelector('.day-holiday'),name=day.names.join(' · ');
    label.textContent=name;label.title=name;label.hidden=!name;
    cell.setAttribute('aria-label',full(date)+(name?', '+name:'')+', '+cell.dataset.daySummary+' 날짜 상세 열기');
  });
  const status=$('#holiday-status'),button=$('[data-action="refresh-holidays"]');
  if(!status||!button)return;
  const info=holidays.info(),visibleYears=[...new Set([...app.querySelectorAll('[data-calendar-date]')].map(cell=>cell.dataset.calendarDate.slice(0,4)))],missing=visibleYears.filter(year=>!info.years.includes(year)),known=!missing.length;
  const timestamp=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  status.textContent=holidayConsentId?'인터넷 사용 허용을 기다리고 있습니다.':info.loading?'공휴일 자료 확인 중…':!known?`${missing.join('·')}년 공휴일 자료가 아직 없습니다. 해당 연도는 주말만 표시합니다.`:info.error?'최신 공휴일을 확인하지 못했습니다. 저장된 자료로 표시합니다.':info.checkedAt?`공휴일 최근 확인: ${timestamp(info.checkedAt)}`:`공휴일 기본 자료: ${info.snapshotAt.slice(0,10)} 기준`;
  status.classList.toggle('holiday-sync-warning',!known||info.error);
  button.disabled=info.loading||!!holidayConsentId;
  button.setAttribute('aria-busy',String(info.loading));
  scheduleHolidayFit();
}
function requestHolidayRefresh(){
  if(holidayConsentId||holidays.info().loading)return;
  if(!window.BloodNoteAndroid?.requestHolidayConsent){toast('인터넷 사용 확인을 열지 못했습니다. 앱을 다시 시작해 주세요.');return;}
  holidayConsentId=uid();updateHolidayUI();
  try{window.BloodNoteAndroid.requestHolidayConsent(holidayConsentId);}
  catch{holidayConsentId=null;updateHolidayUI();toast('공휴일 갱신을 시작하지 못했습니다.');}
}
window.bloodNoteHolidayConsent=(requestId,allowed)=>{
  if(requestId!==holidayConsentId)return;
  holidayConsentId=null;
  if(allowed!==true){updateHolidayUI();return;}
  void holidays.refresh().finally(()=>window.BloodNoteAndroid?.finishHolidayRefresh?.(requestId));
};
function scheduleHolidayFit(){
  cancelAnimationFrame(holidayFitFrame);
  holidayFitFrame=requestAnimationFrame(fitHolidayLabels);
}
function fitHolidayLabels(){
  if(page!=='planner')return;
  app.querySelectorAll('.day-holiday:not([hidden])').forEach(label=>{
    const maximum=10;
    label.style.fontSize=maximum+'px';
    const available=label.clientWidth;
    if(!available||label.scrollWidth<=available)return;
    let size=Math.max(6,Math.floor(maximum*available/label.scrollWidth*4)/4);
    label.style.fontSize=size+'px';
    while(size>6&&label.scrollWidth>available){size=Math.max(6,size-.25);label.style.fontSize=size+'px';}
  });
}
function planSelectionToolbar(){
  return `<div class="plan-bulk-toolbar" aria-label="계획 선택과 삭제"><div class="plan-selection-summary"><label class="checkline"><input type="checkbox" id="select-all-plans">전체 선택</label><span id="plan-selection-count" aria-live="polite">0 / ${state.plans.length}건 선택</span></div><div class="actions"><button class="secondary small danger-text" data-action="delete-selected-plans" id="delete-selected-plans" disabled>선택 삭제 (0)</button><button class="secondary small danger-text" data-action="delete-all-plans">전체 삭제</button></div></div>`;
}
function nearestReservationPlan(){
  const current=today(),completed=new Set(state.records.map(record=>record.date));
  return state.plans.reduce((nearest,plan)=>plan.date>=current&&!completed.has(plan.date)&&(!nearest||plan.date<nearest.date)?plan:nearest,null);
}
function redConnectButton(action,id=''){
  return `<button type="button" class="secondary red-connect-button" data-action="${action}"${id?` data-id="${escape(id)}"`:''} ${demoMode?'disabled':''}>레드커넥트 열기 <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4L10 14M10 4H4v16h16v-6"/></svg></button>`;
}
function requestRedConnect(){
  if(demoMode)return;
  if(!window.BloodNoteAndroid?.requestRedConnect){toast('레드커넥트 실행은 Android 앱에서 이용할 수 있습니다.');return;}
  try{window.BloodNoteAndroid.requestRedConnect();}
  catch{toast('레드커넥트 실행 안내를 열지 못했습니다. 잠시 후 다시 시도해 주세요.');}
}
function openPlanRedConnect(id){
  if(demoMode||!displayEnabled('redConnectPlan'))return;
  if(!id||nearestReservationPlan()?.id!==id){render();toast('예정일이나 계획이 바뀌었습니다. 현재 가장 가까운 계획을 확인해 주세요.');return;}
  requestRedConnect();
}
function openDayRedConnect(){
  if(demoMode||!displayEnabled('redConnectCalendar')||!currentDayPopup())return;
  if(dayPopup.date<today()||state.records.some(record=>record.date===dayPopup.date)){renderDayPopup();return;}
  requestRedConnect();
}
function planRow({event:e,...r},nearestId){
  const due=e.date<=today();
  return `<div class="plan-row${due?' needs-review':''}" data-plan-id="${escape(e.id)}"><div class="row"><div class="plan-summary"><label class="plan-checkbox"><input type="checkbox" data-plan-select="${escape(e.id)}" aria-label="${full(e.date)} ${TYPES[e.type].label} 계획 선택" ${selectedPlanIds.has(e.id)?'checked':''}></label><div><strong style="font-size:13px">${full(e.date)}</strong> <span class="chip">${TYPES[e.type].label}</span>${due?'<span class="badge plan-review-label">헌혈 여부 확인</span>':''}<p class="sub">실행 후 잔여 ${num(r.remaining)}mL · ${r.ok?'계산 조건 충족':'조정 필요'}</p></div></div><div class="actions">${due?completePlanButton(e):''}<button class="icon-button" data-action="edit-plan" data-id="${escape(e.id)}">수정</button><button class="icon-button danger-text" data-action="delete-plan" data-id="${escape(e.id)}">삭제</button></div></div>${r.issues.map(i=>`<p class="reason">${escape(i.text)}</p>`).join('')}${displayEnabled('redConnectPlan')&&e.id===nearestId?`<div class="red-connect-shortcut"><p><strong>가장 가까운 예정 헌혈</strong>예약은 레드커넥트에서 진행하세요.</p>${redConnectButton('plan-red-connect',e.id)}</div>`:''}</div>`;
}
function completePlanButton(plan,compact=false){
  return `<button type="button" class="primary plan-complete-button" data-action="complete-plan" data-id="${escape(plan.id)}" aria-label="${full(plan.date)} ${TYPES[plan.type].label} 헌혈 기록으로 남기기">${compact?'기록 남기기':'헌혈 기록으로 남기기'}</button>`;
}
function completePlan(id){
  const plan=state.plans.find(entry=>entry.id===id);
  if(!plan)return;
  if(plan.date>today()){toast('예정일이 되면 헌혈 기록으로 남길 수 있습니다.');return;}
  if(state.records.some(entry=>entry.id===plan.id||entry.date===plan.date)){toast('같은 날짜의 헌혈 기록이 이미 있습니다. 기존 기록을 확인해 주세요.');return;}
  return change(()=>{state.records.push({...plan});state.plans=state.plans.filter(entry=>entry.id!==id);},'헌혈 기록으로 남겼습니다. 계획 목록에서 완료 기록으로 옮겼습니다.');
}
function updatePlanSelectionUI(){
  const all=$('#select-all-plans');
  if(!all)return;
  const count=selectedPlanIds.size,total=state.plans.length;
  all.checked=total>0&&count===total;
  all.indeterminate=count>0&&count<total;
  $('#plan-selection-count').textContent=`${count} / ${total}건 선택`;
  const remove=$('#delete-selected-plans');
  remove.disabled=count===0;remove.textContent=`선택 삭제 (${count})`;
  app.querySelectorAll('[data-plan-select]').forEach(input=>input.checked=selectedPlanIds.has(input.dataset.planSelect));
  app.querySelectorAll('[data-plan-id]').forEach(row=>row.classList.toggle('is-selected',selectedPlanIds.has(row.dataset.planId)));
}
function openPlanDeletion(all=false){
  const targets=state.plans.filter(e=>all||selectedPlanIds.has(e.id)).sort((a,b)=>a.date.localeCompare(b.date));
  if(!targets.length)return;
  const ids=new Set(targets.map(e=>e.id));
  openDialog(all?'전체 계획을 삭제할까요?':'선택한 계획을 삭제할까요?',`${targets.length}건의 헌혈 계획이 삭제됩니다.`,
    `<div class="table-preview">${targets.map(e=>`<div class="list-row"><strong style="font-size:12px">${full(e.date)}</strong>${typeLabel(e.type)}</div>`).join('')}</div><p class="settings-note">삭제 직후 화면 아래의 ‘되돌리기’를 누르면 복원할 수 있습니다.</p><div class="card-foot"><button class="secondary" data-action="close-dialog">취소</button><button class="primary danger-button" id="confirm-delete-plans">${targets.length}건 삭제</button></div>`);
  $('#confirm-delete-plans').onclick=()=>{
    const count=state.plans.filter(e=>ids.has(e.id)).length;
    if(!count){dialog.close();return;}
    change(()=>state.plans=state.plans.filter(e=>!ids.has(e.id)),`계획 ${count}건을 삭제했습니다.`);
    dialog.close();
  };
}
function calendarNavigation(view,range,position){
  const unit='달';
  return `<div class="actions calendar-navigation" data-calendar-nav="${position}" role="group" aria-label="달력 ${position==='bottom'?'아래쪽':'위쪽'} 날짜 이동"><button type="button" class="icon-button" data-action="calendar-prev" data-calendar-position="${position}" aria-label="이전 ${unit}" ${range.previous?'':'disabled'}>‹</button><button type="button" class="quiet" data-action="month-today" data-calendar-position="${position}" aria-label="오늘이 포함된 ${unit} 보기">오늘</button><button type="button" class="icon-button" data-action="calendar-next" data-calendar-position="${position}" aria-label="다음 ${unit}" ${range.next?'':'disabled'}>›</button></div>`;
}
function navigateCalendar(button,date){
  const position=button.dataset.calendarPosition||'top';
  const before=position==='bottom'?button.getBoundingClientRect().top:null;
  selected=date;moveCalendar(date);render();
  const replacement=$(`[data-calendar-nav="${position}"] [data-action="${button.dataset.action}"]`);
  if(!replacement)return;
  const focusTarget=replacement.disabled?$(`[data-calendar-nav="${position}"] [data-action="month-today"]`):replacement;
  focusTarget?.focus({preventScroll:true});
  // Months can have different row counts. Keep the lower controls at the same
  // viewport position so the user can continue browsing without scrolling up.
  if(before!==null)window.scrollTo({top:Math.max(0,window.scrollY+replacement.getBoundingClientRect().top-before),left:window.scrollX,behavior:'auto'});
}
function installCalendarSwipe(){
  let swipe=null,suppressClickUntil=0;
  const ready=()=>page==='planner'&&!dialog.open;
  const stamp=event=>Number.isFinite(event.timeStamp)?event.timeStamp:Date.now();
  const track=event=>{
    if(!swipe||event.pointerId!==swipe.id)return;
    const dx=Math.abs(event.clientX-swipe.x),dy=Math.abs(event.clientY-swipe.y);
    if(Math.max(dx,dy)>=16)swipe.moved=true;
    if(dy>=16&&dy>dx)swipe.vertical=true;
  };
  app.addEventListener('pointerdown',event=>{
    // A second finger cancels month navigation, leaving pinch zoom to WebView.
    if(swipe&&event.pointerId!==swipe.id){swipe=null;return;}
    swipe=null;suppressClickUntil=0;
    if(!ready()||event.isPrimary===false||event.button!==0||!['touch','pen'].includes(event.pointerType))return;
    const region=event.target.closest?.('.calendar-scroll');
    if(!region||region!==$('.calendar-scroll'))return;
    const bounds=region.getBoundingClientRect();
    swipe={id:event.pointerId,x:event.clientX,y:event.clientY,time:stamp(event),region,anchor:calendarAnchor,
      threshold:Math.max(36,Math.min(72,(bounds.right-bounds.left)*.12)),moved:false,vertical:false};
  },{passive:true});
  app.addEventListener('pointermove',track,{passive:true});
  app.addEventListener('pointercancel',()=>{swipe=null;},{passive:true});
  app.addEventListener('pointerup',event=>{
    if(!swipe||event.pointerId!==swipe.id)return;
    track(event);const gesture=swipe;swipe=null;
    if(!ready()||gesture.region!==$('.calendar-scroll')||gesture.anchor!==calendarAnchor)return;
    // A drag must not turn into a date tap, including after the calendar rerenders.
    if(gesture.moved)suppressClickUntil=Date.now()+400;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y,elapsed=stamp(event)-gesture.time;
    if(gesture.vertical||Math.abs(dx)<gesture.threshold||Math.abs(dx)<Math.abs(dy)*1.5||elapsed<0||elapsed>900)return;
    event.preventDefault();
    const range=calendarWindow(calendarAnchor,calendarView()),target=dx<0?range.next:range.previous;
    if(target){selected=target;moveCalendar(target);render();}
  });
  app.addEventListener('click',event=>{
    // Keyboard and accessibility clicks remain available after a swipe.
    if(event.detail===0||Date.now()>suppressClickUntil||!event.target.closest?.('.calendar-scroll'))return;
    suppressClickUntil=0;event.preventDefault();event.stopPropagation();
  },true);
}
function planner(){
  const view=calendarView(),range=calendarWindow(calendarAnchor,view);
  const evaluations=inspectPlan(state.records,state.plans,state.rules,restrictions()),invalid=evaluations.filter(x=>!x.ok).length,nearestId=displayEnabled('redConnectPlan')?nearestReservationPlan()?.id:null;
  const bars=Array.from({length:12},(_,i)=>{const [y,m]=today().split('-').map(Number);const d=new Date(Date.UTC(y,m+i,0)).toISOString().slice(0,10);const s=stats([...state.records,...state.plans],d,state.rules);return {month:Number(d.slice(5,7)),...s};});
  return '<h1 class="sr-only">일정 시뮬레이터</h1>'+incompleteNotice()+
    (invalid?`<div class="notice error">계획 ${invalid}건이 계산 조건을 충족하지 않습니다. 아래 계획 목록에서 날짜·종류를 조정해 주세요. 뒤 일정도 모든 계획을 실행한다고 가정한 값입니다.</div>`:'')+`
    <section class="card calendar-card" data-view="${view}"><div class="calendar-head"><div><h2 aria-live="polite">${Number(calendarMonth.slice(0,4))}년 ${Number(calendarMonth.slice(5))}월</h2><p class="calendar-range" aria-live="polite">월간 달력</p></div>${calendarNavigation(view,range,'top')}</div><p class="calendar-instruction">좌우로 쓸어 달을 넘기고, 날짜를 눌러 헌혈 종류와 예상 잔여량을 확인하세요.</p><div class="calendar-scroll" tabindex="0" role="region" aria-label="네 종류의 헌혈 가능 여부가 표시된 월간 달력"><div class="calendar calendar-${view}">${calendarHTML(view,range)}</div></div><div class="calendar-bottom"><p class="calendar-bottom-label">${Number(calendarMonth.slice(0,4))}년 ${Number(calendarMonth.slice(5))}월</p>${calendarNavigation(view,range,'bottom')}</div><div class="legend day-legend" aria-label="날짜 배경색 안내">${displayEnabled('recordHighlight')?'<span><i class="done" aria-hidden="true">✓</i>헌혈 완료</span>':''}<span><i class="offday"></i>토·일요일 / 공휴일(대체·임시 포함)</span><span><i class="manual-restriction"></i>등록한 헌혈 제한</span></div><div class="legend"><span><i class="yes"></i>가능</span><span><i class="limited"></i>제한</span><span><i class="no"></i>과거</span><span><i class="plan"></i>기존 계획</span></div><p class="intro-note">확인창에서 예상 잔여량과 제한 이유를 확인할 수 있습니다. 계획이 있는 날은 선택한 종류로 변경할 수 있습니다.</p><div class="holiday-sync"><p id="holiday-status" role="status" aria-live="polite"></p><button type="button" class="holiday-refresh" data-action="refresh-holidays" aria-label="공휴일 수동 갱신" aria-describedby="holiday-status" title="공휴일 수동 갱신"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 11 A7 7 0 0 1 18 7 M18 3 V7 H14 M19 13 A7 7 0 0 1 6 17 M6 21 V17 H10"></path></svg></button></div><p class="hint holiday-source">🔃 버튼을 누르고 이번 갱신의 인터넷 사용을 허용한 경우에만 최신 공휴일을 확인합니다. 그전까지 저장된 자료로 표시합니다. 임시공휴일은 자료 제공처에 등록된 뒤 갱신할 수 있습니다. <a href="https://github.com/hyunbinseo/holidays-kr" target="_blank" rel="noopener noreferrer">자료 출처 ↗</a></p><hr class="divider"><label>다른 날짜로 바로 이동<input id="sim-date" type="date" value="${selected}" min="1900-01-01" max="2199-12-31"></label></section>
    <section class="card section-gap"><div class="card-head"><div><h2>나의 장기 계획</h2><p>예정일이 오늘이거나 지난 계획은 ‘헌혈 기록으로 남기기’ 또는 ‘삭제’를 선택하세요.</p></div><button class="secondary small" data-action="auto-plan">월별 초안 만들기</button></div>${evaluations.length?planSelectionToolbar()+evaluations.map(evaluation=>planRow(evaluation,nearestId)).join(''):empty('아직 세워 둔 계획이 없어요','달력에서 날짜를 누르고 헌혈 종류를 선택해 계획을 추가하세요.','','')}</section>
    ${restrictionList()}<section class="card section-gap"><div class="card-head"><div><h2>앞으로 12개월의 연간 계산량</h2><p>완료 기록과 모든 계획을 포함한 월말 예상값 · 한도 ${num(state.rules.cap)}mL</p></div></div><div class="annual-bars" role="img" aria-label="${bars.map(b=>`${b.month}월 ${b.used}mL`).join(', ')}">${bars.map(b=>`<div class="annual-bar ${b.used>state.rules.cap?'over':''}" title="${b.end}: ${num(b.used)}mL"><span style="height:${Math.max(3,Math.min(85,b.used/state.rules.cap*85))}px"></span><small>${b.month}월</small></div>`).join('')}</div></section>`;
}
function moveRecordPage(index){
  if(!Number.isInteger(index))return;
  recordPageIndex=index;render();
  $('#records-list')?.scrollIntoView({block:'start',behavior:'auto'});
  $('#record-page')?.focus({preventScroll:true});
}
function recordsPage(){
  const list=state.records.filter(e=>recordFilter==='all'||e.type===recordFilter).sort((a,b)=>b.date.localeCompare(a.date));
  const pages=Math.max(1,Math.ceil(list.length/RECORDS_PER_PAGE));
  recordPageIndex=Math.max(0,Math.min(recordPageIndex,pages-1));
  const start=recordPageIndex*RECORDS_PER_PAGE,visible=list.slice(start,start+RECORDS_PER_PAGE);
  const pagination=list.length?`<nav class="record-pagination" aria-label="헌혈 기록 페이지"><button class="secondary small" data-action="records-prev" ${recordPageIndex===0?'disabled':''} aria-label="이전 기록 페이지">‹ 이전</button><label><span class="sr-only">기록 페이지 선택</span><select id="record-page">${Array.from({length:pages},(_,i)=>`<option value="${i}" ${i===recordPageIndex?'selected':''}>${i+1} / ${pages} 페이지</option>`).join('')}</select></label><button class="secondary small" data-action="records-next" ${recordPageIndex===pages-1?'disabled':''} aria-label="다음 기록 페이지">다음 ›</button><p role="status" aria-live="polite">${recordFilter==='all'?'전체':'선택한 종류'} ${list.length}건 중 ${start+1}–${start+visible.length}건</p></nav>`:'';
  return '<h1 class="sr-only">헌혈 기록</h1>'+`
    <div class="notice"><label class="checkline"><input id="history-complete" type="checkbox" ${state.complete?'checked':''}>최근 1년의 헌혈 기록을 빠짐없이 입력했습니다.</label><p class="hint">처음에는 최소 최근 1년 내역을 입력해 주세요. 누락된 기록은 잔여량과 예상일에 영향을 줍니다.</p></div>
    <section class="card"><div class="toolbar"><button class="primary small" data-action="add-record">+ 기록 추가</button><button class="secondary small" data-action="import-certificate">증명서 PDF 불러오기</button><button class="secondary small" data-action="import-text">여러 기록 붙여넣기</button></div><div id="records-list" class="card-head section-gap"><span class="muted" style="font-size:12px">총 ${state.records.length}건</span><select id="record-filter" style="width:150px"><option value="all" ${recordFilter==='all'?'selected':''}>모든 종류</option>${typeOptions(recordFilter)}</select></div>${list.length?`<div class="table-scroll"><table class="record-table" role="table" aria-label="완료한 헌혈 기록"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">헌혈일</th><th role="columnheader" scope="col">종류</th><th role="columnheader" scope="col">계산량</th><th role="columnheader" scope="col">관리</th></tr></thead><tbody role="rowgroup">${visible.map(e=>`<tr role="row"><td role="cell" class="record-date"><strong>${fmt(e.date,true)}</strong><br><small>${'일월화수목금토'[weekday(e.date)]}요일</small></td><td role="cell" class="record-type">${typeLabel(e.type)}</td><td role="cell" class="record-amount"><span class="record-amount-label">계산량 </span>${num(amount(e,state.rules))}mL</td><td role="cell" class="record-actions"><div class="actions"><button class="icon-button" data-action="edit-record" data-id="${escape(e.id)}">수정</button><button class="icon-button danger-text" data-action="delete-record" data-id="${escape(e.id)}">삭제</button></div></td></tr>`).join('')}</tbody></table></div>${pagination}`:empty('날짜와 종류, 두 가지만 입력하세요','공식 계정 자동 조회는 연결되어 있지 않습니다. 직접 입력하거나 날짜·종류가 있는 글을 붙여넣어 시작할 수 있어요.')}<p class="intro-note">표의 mL는 설정한 연간 한도 계산값입니다. 실제 성분 채혈액 전체 부피와 같은 의미는 아닙니다.</p></section>`;
}
function settingsPage(){return heading('MAKE IT YOURS','계산 기준과 보관','내 기준을 확인하고 기록을 안전하게 옮기세요.')+`
  <section class="card start-page-card"><div class="card-head"><div><h2>첫 화면 설정</h2><p>앱을 새로 열 때 표시할 화면을 선택하세요.</p></div></div><label for="start-page">앱 시작 화면</label><select id="start-page" aria-describedby="start-page-help" ${demoMode?'disabled':''}>${Object.entries(START_PAGES).map(([value,label])=>`<option value="${value}" ${startPageChoiceOf(demoMode?realState:state)===value?'selected':''}>${label}</option>`).join('')}</select><p id="start-page-help" class="settings-note">${demoMode?'예시 체험을 종료한 뒤 변경할 수 있습니다.':startPageChoiceOf(state)==='last'?'종료 전에 보던 화면(설정 포함)으로 다시 시작합니다. 팝업과 저장 전 입력은 다시 열지 않습니다. 선택은 자동 저장되며 백업에도 포함됩니다.':'선택하면 자동 저장됩니다. 앱을 다시 열어도 유지되며, 백업에도 포함됩니다.'}</p></section>
  <section class="card display-options-card"><div class="card-head"><div><h2>화면 표시</h2><p>표시 항목을 각각 켜거나 끌 수 있습니다.</p></div></div>${Object.entries(DISPLAY_OPTIONS).map(([key,option])=>{const enabled=displayEnabled(key,demoMode?realState:state);return `<label class="display-toggle" for="display-${key}"><span class="display-toggle-copy"><strong>${option.label}</strong><small id="display-${key}-help">${option.description}</small></span><span class="display-toggle-control"><span aria-hidden="true">${enabled?'켬':'끔'}</span><input type="checkbox" role="switch" id="display-${key}" data-display-option="${key}" aria-describedby="display-${key}-help" ${enabled?'checked':''} ${demoMode?'disabled':''}></span></label>`;}).join('')}<p class="settings-note">${demoMode?'예시 체험을 종료한 뒤 변경할 수 있습니다.':'선택은 자동 저장되고 백업에 포함됩니다. 표시를 꺼도 기록과 계산 결과는 유지됩니다.'}</p></section>
  <section class="card app-update-card"><div class="card-head"><div><h2>앱 업데이트</h2><p>현재 v2.4.1 · GitHub 정식 배포판</p></div></div><p class="settings-note">버튼을 누르고 데이터 사용 안내에 동의한 경우에만 새 버전을 확인합니다. 새 APK의 버전과 용량을 확인한 뒤 다운로드를 선택할 수 있습니다.</p><div class="card-foot" style="justify-content:start"><button type="button" class="primary small" data-action="check-update" ${demoMode?'disabled':''}>업데이트 확인</button></div><p class="settings-note">보안 설정·앱 설치 제한에 따라 업데이트가 완료되지 않을 수 있습니다. 개인이 제작한 비공식 앱이며, 사용·설치·업데이트는 이용자 본인의 판단과 책임으로 진행해 주세요. 중요한 기록은 먼저 백업해 주세요.</p></section>
  <div class="settings-grid"><section class="card"><div class="card-head"><div><h2>연간 계산 기준</h2><p>사용자 지정 계산값을 사용합니다.</p></div></div><form id="rules-form" class="form-stack"><label>연간 한도 (mL)<input name="cap" type="number" min="1" max="100000" step="1" required value="${state.rules.cap}"></label><div class="rules-table"><span class="rule-label">헌혈 종류</span><small>계산량 (mL)</small><small>이후 간격 (일)</small>${Object.entries(TYPES).map(([key,t])=>`<span class="rule-label">${t.label}</span><input aria-label="${t.label} 계산량" name="volume-${key}" type="number" min="1" max="10000" required value="${state.rules.volumes[key]}"><input aria-label="${t.label} 이후 간격" name="wait-${key}" type="number" min="1" max="1000" required value="${state.rules.waits[key]}">`).join('')}</div><div class="two-fields"><label>직전 1년 전혈 한도 (회)<input name="wholeLimit" type="number" min="1" max="1000" value="${state.rules.wholeLimit}" required></label><label>혈소판·혈소판 혈장 성분횟수 조건<input name="componentLimit" type="number" min="1" max="1000" value="${state.rules.componentLimit}" required></label></div><label>정확히 1년 전 같은 날짜의 기록<select name="boundary"><option value="exclude" ${state.rules.boundary==='exclude'?'selected':''}>합산에서 제외</option><option value="include" ${state.rules.boundary==='include'?'selected':''}>합산에 포함</option></select></label><p class="settings-note">1년은 365일 고정이 아닌 달력의 전년 같은 날짜로 계산합니다. 2월 29일의 전년 기준일은 2월 28일입니다. 경계일 포함 여부는 기관 안내와 맞춰 주세요.</p><div class="card-foot"><button type="button" class="secondary small" data-action="reset-rules">처음 기준으로</button><button class="primary small" type="submit">계산 기준 저장</button></div></form></section>
  <div><section class="card"><div class="card-head"><h2>백업과 복원</h2><span class="badge">내 기기 보관</span></div><p class="settings-note">기록·계획·헌혈 제한 기간·계산 설정과 저장된 공휴일 자료는 기기 안에서 암호화해 보관합니다. 앱이나 앱 데이터를 삭제하면 기록도 삭제됩니다. 기기를 바꾸거나 앱을 삭제하기 전에 백업해 주세요. 새 백업에는 기록·계획·계산 기준·헌혈 제한 기간을 비밀번호로 암호화해 넣습니다. 비밀번호를 잊으면 백업을 복원할 수 없습니다. 이전 JSON 백업도 불러올 수 있습니다.</p><div class="card-foot" style="justify-content:start"><button class="primary small" data-action="export-backup">암호화 백업 저장</button><button class="secondary small" data-action="import-backup">백업 불러오기</button><button class="secondary small" data-action="import-certificate">증명서 PDF 불러오기</button></div><p class="settings-note">기기에 저장한 대한적십자사 헌혈확인증명서(개인) PDF에서 날짜·종류를 읽어 검토 후 등록합니다. 인터넷 없이 동작하며 Android 15 이상에서 사용할 수 있습니다. 사진·스캔본은 지원하지 않습니다. 원본 파일은 변경하지 않습니다.</p><input type="file" id="backup-file" accept="application/json,.json" hidden><hr class="divider"><h3>연간채혈량 계산기 · 안드로이드 2.4.1 · 작은 월간 달력</h3><p class="settings-note">화면과 계산 기능은 인터넷 없이 사용할 수 있습니다. 공휴일 🔃 갱신과 앱 업데이트 확인은 매번 인터넷 사용 안내에 동의해야 연결됩니다. 취소하면 저장된 자료를 유지합니다. 외부 링크는 브라우저에서 열립니다. 백업은 파일 선택창에서 기기 저장 공간을 선택하면 데이터가 필요하지 않습니다.</p><p class="settings-note">새로 설치하면 기록과 계획은 비어 있습니다. 이전 앱에서 저장한 기록·계획은 위의 ‘백업 불러오기’로 옮겨 주세요. 휴대폰과 태블릿 화면 폭에 맞춰 배치가 자동으로 바뀝니다.</p><div class="actions"><button class="quiet" data-action="install">앱 정보 · 기록 옮기기</button><button class="quiet" data-action="demo">${demoMode?'예시 체험 종료':'예시로 둘러보기'}</button></div></section>
  <section class="card section-gap"><h2>앱 정보와 출처</h2><p class="settings-note">연간채혈량 계산기는 개인이 제작한 비공식 기록·계획 도구입니다. 대한적십자사 등 헌혈기관의 승인·인증을 받은 앱이 아닙니다.</p><button type="button" class="secondary license-menu" data-action="open-licenses" aria-haspopup="dialog"><span>오픈소스 라이선스</span><span aria-hidden="true">›</span></button><p class="settings-note">공휴일 자료의 출처와 라이선스 전문을 인터넷 없이 확인할 수 있습니다.</p></section>
  <section class="card section-gap"><h2>계산에 포함되는 것</h2><div class="settings-note"><p>① 선택한 기준일 직전 1년의 계산량<br>② 직전 헌혈 종류에 따른 대기 간격<br>③ 전혈 횟수와 혈소판·혈소판 혈장의 성분헌혈 횟수 조건<br>④ 앞선 가상 일정 및 뒤에 잡힌 계획에 미치는 영향<br>⑤ 직접 등록한 헌혈 제한 기간</p><p>기본값 2,160 / 430 / 90 / 45mL는 사용자가 제시한 기준입니다. 실제 성분 채혈액 전체 부피를 뜻하지 않습니다.</p><p>혈소판·혈소판 혈장 계획은 직전 1년의 모든 성분헌혈 횟수(혈장 포함)에 새 1회를 더해 24회 조건을 확인합니다. 혈장만 선택할 때는 이 횟수 제한을 적용하지 않습니다.</p><p><a href="https://emi.bloodinfo.net/emi4.do?lang=ko" target="_blank" rel="noopener noreferrer">대한적십자사 헌혈 자격조건 ↗</a>의 간격·횟수 안내를 참고했습니다. 계산이 맞아도 문진·검사 등에서 헌혈이 제한될 수 있습니다.</p><p>공식 헌혈 기록 자동 조회, 자동 예약, 검사 결과 연동은 제공하지 않습니다.</p></div></section></div></div>`;}

function openDialog(title,description,content){dayPopup=null;restrictionEditor=null;dialog.classList.remove('calendar-date-dialog');dialog.removeAttribute?.('aria-labelledby');$('#dialog-content').innerHTML=`<div class="dialog-head"><div><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div><button class="close" data-action="close-dialog" aria-label="닫기">×</button></div>${content}`;if(!dialog.open)dialog.showModal();}
function openLicenses(){
  openDialog('오픈소스 라이선스','앱에 포함된 고지이며, 인터넷 연결 없이 읽을 수 있습니다.',
    `<section class="license-notice" aria-labelledby="holiday-license-title"><h3 id="holiday-license-title">holidays-kr · 공휴일 데이터</h3><p class="settings-note">저작권자: Hyunbin Seo<br>라이선스: MIT<br>기본 공휴일 자료: 2026. 10. 17. 기준 (2018–2027년)</p><p class="settings-note"><a href="https://github.com/hyunbinseo/holidays-kr" target="_blank" rel="noopener noreferrer">원본 프로젝트 ↗</a> · <a href="https://github.com/hyunbinseo/holidays-kr/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">원본 라이선스 ↗</a><br>외부 링크를 누르면 브라우저가 열리며 인터넷을 사용합니다.</p><pre class="license-text" aria-label="공휴일 데이터 출처 및 MIT 라이선스 전문">${escape(HOLIDAY_DATA_LICENSE)}</pre></section><section class="license-notice"><h3>기타 구성 요소</h3><p class="settings-note">별도의 JavaScript 라이브러리나 CSS 프레임워크는 포함하지 않습니다. 화면 표시, PDF 읽기, 암호화와 기본 글꼴은 기기에 설치된 Android·WebView 기능을 사용합니다.</p><p class="settings-note">공휴일 자료는 사용자가 수동 갱신을 허용했을 때만 내려받습니다. 이 메뉴를 여는 것만으로는 갱신하지 않습니다.</p></section><div class="card-foot"><button type="button" class="primary" data-action="close-dialog">닫기</button></div>`);
}
function planSnapshot(){return JSON.stringify({records:state.records,plans:state.plans,rules:state.rules,restrictions:restrictions()});}
const restrictionRange=item=>`${fmt(item.start,true)} ~ ${fmt(item.end,true)}`;
function restrictionNotice(date){
  const active=activeRestrictions(date,restrictions());
  return active.length?`<div class="notice error restriction-notice"><div><strong>등록한 헌혈 제한이 적용 중입니다.</strong>${active.map(item=>`<p>${escape(restrictionRange(item))}${item.reason?' · '+escape(item.reason):''}</p>`).join('')}</div><button class="quiet" data-action="day" data-date="${date}">확인·수정</button></div>`:'';
}
function restrictionRow(item){return `<div class="restriction-row"><div><strong>${escape(item.reason||'사유 미입력')}</strong><p>${escape(restrictionRange(item))}</p></div><div class="actions"><button type="button" class="secondary small" data-action="restriction-edit" data-id="${escape(item.id)}">수정</button><button type="button" class="quiet danger-text" data-action="restriction-delete" data-id="${escape(item.id)}">삭제</button></div></div>`;}
function restrictionDayDetails(date){
  const active=activeRestrictions(date,restrictions());
  return active.length?`<section class="restriction-day"><h3>등록한 헌혈 제한</h3>${active.map(restrictionRow).join('')}</section>`:'';
}
function restrictionList(){
  const rows=restrictions();
  return rows.length?`<details class="card section-gap restriction-list"><summary>헌혈 제한 기간 <span class="badge">${rows.length}건</span></summary>${[...rows].sort((a,b)=>b.start.localeCompare(a.start)).map(restrictionRow).join('')}</details>`:'';
}
function openRestrictionEditor(date,id=null){
  const item=id?restrictions().find(row=>row.id===id):null;
  if(id&&!item){toast('이 제한 기간은 이미 삭제되었습니다.');return;}
  const start=item?.start||date;if(!validAnchorDate(start))return;
  const returnDay=dayPopup?{...dayPopup}:null,days=item?daysBetween(item.start,item.end)+1:1;
  openDialog('헌혈 제한 설정','',`<button type="button" class="quiet restriction-back" data-action="restriction-back">‹ ${returnDay?'날짜 선택으로':'돌아가기'}</button><form id="restriction-form" class="form-stack" autocomplete="off" novalidate>
    <label>시작일<input name="start" type="date" value="${start}" min="1900-01-01" max="2199-12-31" required></label>
    <label>헌혈금지사유 <span class="muted">(선택)</span><input name="reason" type="text" value="${escape(item?.reason||'')}" maxlength="40" placeholder="사유를 입력하세요" autocomplete="off" spellcheck="false"></label>
    <label for="restriction-days">헌혈금지기간</label><div class="restriction-stepper"><button type="button" class="secondary" data-action="restriction-less" aria-label="하루 줄이기">−</button><div><input id="restriction-days" name="days" type="number" min="1" max="${RESTRICTION_MAX_DAYS}" step="1" value="${days}" inputmode="numeric" required><span>일</span></div><button type="button" class="secondary" data-action="restriction-more" aria-label="하루 늘리기">＋</button></div>
    <div class="restriction-period"><span>제한 적용 기간</span><strong id="restriction-range"></strong></div>
    <p id="restriction-feedback" class="form-feedback error" role="alert" hidden></p>
    <div class="date-popup-footer"><button type="button" class="secondary" data-action="restriction-back">취소</button><button type="submit" class="primary">제한 저장</button></div></form>`);
  restrictionEditor={id,returnDay,snapshot:JSON.stringify(restrictions())};
  const form=$('#restriction-form');
  form.addEventListener('input',()=>updateRestrictionForm(false));
  form.onsubmit=event=>{event.preventDefault();saveRestriction();};
  updateRestrictionForm(false);
}
function restrictionFormValues(){
  const form=$('#restriction-form');if(!restrictionEditor||!dialog.open||!form)throw Error('헌혈 제한 설정을 다시 열어 주세요.');
  const start=form.elements.start.value,days=Number(form.elements.days.value);
  if(!validAnchorDate(start))throw Error('시작일을 확인해 주세요.');
  if(!/^\d+$/.test(form.elements.days.value)||!Number.isInteger(days)||days<1||days>RESTRICTION_MAX_DAYS)throw Error(`기간은 1~${num(RESTRICTION_MAX_DAYS)}일 사이의 정수로 입력해 주세요.`);
  const end=addDays(start,days-1);if(!validAnchorDate(end))throw Error('종료일은 2199년 12월 31일 이내여야 합니다.');
  return {start,end,reason:normalizeRestrictionReason(form.elements.reason.value)};
}
function updateRestrictionForm(showError){
  const feedback=$('#restriction-feedback'),range=$('#restriction-range');
  try{const values=restrictionFormValues();range.textContent=restrictionRange(values);feedback.hidden=true;feedback.textContent='';return values;}
  catch(error){range.textContent='입력한 내용을 확인해 주세요.';if(showError){feedback.textContent=error.message;feedback.hidden=false;}return null;}
}
function stepRestrictionDays(delta){
  if(!restrictionEditor||!dialog.open)return;
  const input=$('#restriction-form').elements.days,current=Number(input.value);
  input.value=String(Math.min(RESTRICTION_MAX_DAYS,Math.max(1,(Number.isInteger(current)?current:1)+delta)));updateRestrictionForm(false);
}
function returnFromRestrictionEditor(){
  if(!restrictionEditor)return;
  const previous=restrictionEditor.returnDay;restrictionEditor=null;
  if(previous){dayPopup={...previous,snapshot:planSnapshot()};renderDayPopup();}
  else dialog.close();
}
function saveRestriction(){
  if(!restrictionEditor||!dialog.open)return;
  const values=updateRestrictionForm(true);if(!values)return;
  const editor=restrictionEditor,feedback=$('#restriction-feedback');
  if(editor.snapshot!==JSON.stringify(restrictions())){feedback.textContent='저장된 제한 기간이 바뀌었습니다. 닫은 뒤 다시 확인해 주세요.';feedback.hidden=false;return;}
  try{
    const item={id:editor.id||uid(),...values},next=validateRestrictions(editor.id?restrictions().map(row=>row.id===editor.id?item:row):[...restrictions(),item]);
    if(change(()=>{state.restrictions=next;},'헌혈 제한 기간을 저장했습니다.')){
      if(editor.returnDay){restrictionEditor=editor;returnFromRestrictionEditor();}else{restrictionEditor=null;openDayPopup(values.start);}
    }else{feedback.textContent='저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.';feedback.hidden=false;}
  }catch(error){feedback.textContent=error.message;feedback.hidden=false;}
}
function deleteRestriction(id){
  if(!restrictions().some(row=>row.id===id))return;
  const previous=dayPopup?{...dayPopup}:null;
  if(change(()=>{state.restrictions=restrictions().filter(row=>row.id!==id);},'헌혈 제한 기간을 삭제했습니다.')&&previous){dayPopup={...previous,snapshot:planSnapshot()};renderDayPopup();}
}
function openDayPopup(date){
  if(!validAnchorDate(date))return;
  selected=date;moveCalendar(date);render();
  dayPopup={date,type:state.plans.find(plan=>plan.date===date)?.type||null,snapshot:planSnapshot()};
  renderDayPopup();
}
function renderDayPopup(){
  if(!dayPopup)return;
  const {date}=dayPopup,{record,plan,choices}=availabilityForDate(date,state.records,state.plans,state.rules,restrictions());
  const past=date<today(),due=plan&&!record&&date<=today(),readOnly=!!record||past,blocked=activeRestrictions(date,restrictions()).length>0;
  const chosen=record?.type||dayPopup.type,choice=choices.find(item=>item.type===chosen),result=choice?.result;
  const [year,month,day]=date.split('-').map(Number),holiday=holidays.day(date).names.join(' · ');
  dayPopup.snapshot=planSnapshot();
  let detail='';
  if(record)detail=`<p class="date-popup-note">${TYPES[record.type].label} 헌혈 기록이 저장되어 있습니다.</p>`;
  else if(past&&!plan)detail='<p class="date-popup-note">지난 날짜입니다. 실제로 헌혈하셨다면 기록을 추가해 주세요.</p>';
  else if(!past&&result){
    const warnings=[...result.issues.map(issue=>issue.text),...result.conflicts.map(conflict=>`${full(conflict.event.date)} ${TYPES[conflict.event.type].label} 계획에 영향: ${conflict.issues.map(issue=>issue.text).join(' / ')}`)];
    detail=`<div class="date-popup-totals"><span>계획 후 연간 계산량<strong>${num(result.projected)} <small>mL</small></strong></span><span>계획 후 잔여량<strong class="${result.remaining<0?'negative':'positive'}">${num(result.remaining)} <small>mL</small></strong></span></div>${warnings.length?`<div class="date-popup-warning" role="note"><strong>계산상 제한이 있는 가정입니다.</strong><ul>${warnings.map(warning=>`<li>${escape(warning)}</li>`).join('')}</ul></div>`:'<p class="date-popup-note">입력된 기록과 계획을 기준으로 계산한 결과입니다.</p>'}`;
  }else if(!past)detail='<p class="date-popup-note">종류를 선택하면 예상 잔여량과 제한 사유를 보여드려요.</p>';
  if(plan&&!record)detail+=`<div class="date-popup-plan"><div><strong>${due?'헌혈하셨나요?':'저장된 계획'}</strong><span>${TYPES[plan.type].label}${due?' 예정이었던 날입니다.':' 계획을 변경하거나 취소할 수 있어요.'}</span></div><div class="date-popup-plan-actions">${due&&!past?'<button type="button" class="secondary" data-action="day-complete">기록으로 남기기</button>':''}<button type="button" class="quiet danger-text" data-action="day-delete">계획 취소</button></div></div>`;
  if(displayEnabled('redConnectCalendar')&&!past&&!record)detail+=`<div class="red-connect-shortcut date-popup-booking">${redConnectButton('day-red-connect')}<p>${plan?.type===chosen?'저장된 계획의 예약을 레드커넥트에서 진행하세요.':'선택한 계획은 ‘선택 완료’로 저장해 주세요. 예약은 별도로 진행합니다.'}</p></div>`;
  detail+=restrictionDayDetails(date)+`<button type="button" class="secondary restriction-entry" data-action="restriction-new">헌혈 제한 사유·기간 입력 <span aria-hidden="true">›</span></button>`;
  if(dayPopup.message)detail+=`<p class="date-popup-warning" role="status">${escape(dayPopup.message)}</p>`;
  const confirmAction=record?'day-edit-record':past?(plan?'day-complete':'day-add-record'):'day-confirm';
  const confirmLabel=record?'기록 수정':past?(plan?'헌혈 기록으로 남기기':'이 날짜 기록 추가'):result&&!result.ok?'제한 있는 가정으로 저장':'선택 완료';
  $('#dialog-content').innerHTML=`<header class="date-popup-head"><span class="date-popup-year">${year}년</span><h2 id="date-popup-title" tabindex="-1">${month}월 ${day}일 <span>${'일월화수목금토'[weekday(date)]}요일</span></h2>${holiday?`<p class="date-popup-holiday">${escape(holiday)}</p>`:''}<p class="date-popup-subtitle">${record?'저장된 헌혈 기록을 확인하세요':past?'이 날짜의 헌혈 내역을 확인하세요':'헌혈 방식을 선택해 주세요'}</p><button type="button" class="date-popup-close" data-action="close-dialog" aria-label="날짜 상세 닫기">×</button></header><div class="date-popup-choices" role="group" aria-label="헌혈 종류 선택">${choices.map(({type,result})=>{
    const active=chosen===type,status=record?(record.type===type?'완료':'—'):blocked?'제한':past?'과거':result.ok?'가능':'제한';
    const tone=record?'neutral':blocked?'restricted':readOnly?'neutral':result.ok?'available':'restricted';
    return `<button type="button" class="date-popup-choice ${tone}${active?' is-selected':''}" data-action="day-type" data-type="${type}" aria-pressed="${active}" ${readOnly?'disabled':''}><span class="date-popup-check" aria-hidden="true">${active?'✓':''}</span><strong>${TYPES[type].label}</strong><span class="date-popup-status">${status}</span></button>`;
  }).join('')}</div><div class="date-popup-detail">${detail}</div><div class="date-popup-footer"><button type="button" class="secondary" data-action="close-dialog">취소</button><button type="button" class="primary${!readOnly&&result&&!result.ok?' danger-button':''}" data-action="${confirmAction}" ${!readOnly&&!chosen?'disabled':''}>${confirmLabel}</button></div>`;
  dialog.classList.add('calendar-date-dialog');dialog.setAttribute('aria-labelledby','date-popup-title');
  if(!dialog.open){dialog.showModal();$('#date-popup-title')?.focus({preventScroll:true});}
}
function selectDayType(type){
  if(!dayPopup||!dialog.open||!Object.hasOwn(TYPES,type)||dayPopup.date<today()||state.records.some(row=>row.date===dayPopup.date))return;
  dayPopup.type=type;dayPopup.message='';renderDayPopup();
  dialog.querySelector?.(`[data-action="day-type"][data-type="${type}"]`)?.focus({preventScroll:true});
}
function currentDayPopup(){
  if(!dayPopup||!dialog.open)return false;
  if(dayPopup.snapshot!==planSnapshot()){
    dayPopup.message='기록이나 계획이 바뀌었습니다. 다시 계산한 내용을 확인해 주세요.';renderDayPopup();return false;
  }
  return true;
}
function confirmDayPlan(){
  if(!currentDayPopup())return;
  const {date,type}=dayPopup;
  if(!Object.hasOwn(TYPES,type)||state.records.some(row=>row.date===date))return;
  if(date<today()){dayPopup.message='날짜가 지났습니다. 헌혈 기록으로 남기거나 계획을 취소해 주세요.';renderDayPopup();return;}
  const plan=state.plans.find(row=>row.date===date);
  if(plan?.type===type){dialog.close();return;}
  const item={id:plan?.id||uid(),date,type};
  if(change(()=>{if(plan)state.plans=state.plans.map(row=>row.id===plan.id?item:row);else state.plans.push(item);},`${fmt(date)} ${TYPES[type].label} 계획을 ${plan?'변경':'추가'}했습니다.`))dialog.close();
  else dayPopupSaveError();
}
function dayPopupSaveError(){if(dayPopup){dayPopup.message='저장하지 못했습니다. 기존 기록은 유지됩니다. 저장 공간을 확인하고 다시 시도해 주세요.';renderDayPopup();}}
function completeDayPlan(){
  if(!currentDayPopup())return;
  const plan=state.plans.find(row=>row.date===dayPopup.date);
  if(plan&&plan.date<=today()){if(completePlan(plan.id))dialog.close();else dayPopupSaveError();}
}
function deleteDayPlan(){
  if(!currentDayPopup())return;
  const plan=state.plans.find(row=>row.date===dayPopup.date);
  if(plan){if(change(()=>state.plans=state.plans.filter(row=>row.id!==plan.id),'계획을 취소했습니다.'))dialog.close();else dayPopupSaveError();}
}
function editDayRecord(){
  if(!currentDayPopup())return;
  const {date}=dayPopup,record=state.records.find(row=>row.date===date);
  if(date<=today()&&!state.plans.some(row=>row.date===date))openEditor('record',record?.id||null,date);
}
function openRecordChoices(){
  openDialog('헌혈 기록 추가','어떤 방법으로 기록을 추가할까요?',`<div class="record-entry-options"><button type="button" class="record-entry-option" data-action="add-record"><strong>직접 입력</strong><span>헌혈 날짜와 종류를 직접 입력합니다.</span></button><button type="button" class="record-entry-option" data-action="import-certificate"><strong>증명서 PDF 등록</strong><span>기기에 저장한 증명서를 읽고 검토합니다.</span></button></div>`);
}
function openEditor(kind,id=null,date=null,type=null){
  const list=kind==='record'?state.records:state.plans,e=id?list.find(x=>x.id===id):null;if(id&&!e)return;
  openDialog(`${e?'수정하기':kind==='record'?'헌혈 기록 추가':'가상 일정 추가'}`,kind==='record'?'실제로 헌혈한 날짜와 종류를 입력하세요.':'완료 기록과 분리해 계획만 저장합니다.',`<form id="event-form" class="form-stack" data-kind="${kind}" data-id="${e?escape(e.id):''}"><label>헌혈 날짜<input name="date" type="date" required value="${e?.date||date||today()}" min="${kind==='record'?'1900-01-01':e?.date<today()?e.date:today()}" max="${kind==='record'?today():'2199-12-31'}"></label><label>헌혈 종류<select name="type">${typeOptions(type||e?.type||'whole')}</select></label><div id="event-feedback" class="form-feedback"></div><div class="card-foot"><button type="button" class="secondary" data-action="close-dialog">취소</button><button class="primary" type="submit">${e?'수정 저장':kind==='record'?'기록 저장':'가정 저장'}</button></div></form>`);
  const form=$('#event-form');const update=()=>{const d=form.elements.date.value,t=form.elements.type.value;if(!validDate(d)){$('#event-feedback').textContent='날짜를 선택해 주세요.';return;}const records=state.records.filter(x=>x.id!==e?.id),plans=state.plans.filter(x=>x.id!==e?.id);const r=simulate({id:e?.id||'__candidate__',date:d,type:t},records,plans,state.rules,restrictions());$('#event-feedback').classList.toggle('error',!r.ok);$('#event-feedback').innerHTML=`연간 한도 계산값: <strong>${num(state.rules.volumes[t])}mL</strong><br>이후 최소 간격: <strong>${state.rules.waits[t]}일</strong><br>해당 날짜 실행 후 잔여: <strong>${num(r.remaining)}mL</strong>${r.issues.map(i=>`<br>${escape(i.text)}`).join('')}${r.conflicts.map(c=>`<br>${c.event.date} 계획에 영향: ${escape(c.issues.map(i=>i.text).join(' / '))}`).join('')}${kind==='record'&&!r.ok?'<br>실제 완료 기록은 입력한 사실대로 저장하고 계산 조건과 다른 부분을 확인해 주세요.':''}`;};form.addEventListener('input',update);update();
  form.addEventListener('submit',event=>{event.preventDefault();const d=form.elements.date.value,t=form.elements.type.value;if(!validDate(d)||d<'1900-01-01'||d>'2199-12-31'||kind==='record'&&d>today()||kind==='plan'&&!e&&d<today()){toast('저장할 날짜를 확인해 주세요.');return;}if([...state.records,...state.plans].some(x=>x.id!==e?.id&&x.date===d)){toast('같은 날짜의 기록 또는 계획이 이미 있습니다.');return;}const item={id:e?.id||uid(),date:d,type:t};change(()=>{const target=kind==='record'?state.records:state.plans;const ix=target.findIndex(x=>x.id===item.id);if(ix>=0)target[ix]=item;else target.push(item);},'저장했습니다.');dialog.close();});
}
function openTextImport(){
  openDialog('여러 기록 붙여넣기','한 줄에 날짜와 헌혈 종류를 적어 주세요.',`<label>헌혈 기록<textarea id="import-text" placeholder="2026-01-05 전혈\n2026-03-06 혈소판혈장\n2026-03-20 혈장"></textarea></label><p class="hint">YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD 형식을 읽습니다. 이미지 자동 인식 기능은 아직 없습니다.</p><div id="import-preview"></div><div class="card-foot"><button class="secondary" id="parse-import">내용 확인</button><button class="primary" id="save-import" disabled>기록 가져오기</button></div>`);
  let pending=[];$('#import-text').addEventListener('input',()=>{$('#save-import').disabled=true;pending=[];$('#import-preview').innerHTML='';});
  $('#parse-import').onclick=()=>{const result=parseLines($('#import-text').value),errors=[...result.errors],seen=new Set([...state.records,...state.plans].map(e=>e.date)),accepted=[],duplicates=[];
    for(const row of result.rows){if(row.date>today()||row.date<'1900-01-01'){errors.push(`${row.line}번째 줄: 완료 기록의 날짜를 확인해 주세요.`);continue;}if(seen.has(row.date)){duplicates.push(row.date);continue;}seen.add(row.date);accepted.push({id:uid(),date:row.date,type:row.type});}
    pending=accepted;$('#import-preview').innerHTML=`${errors.length?`<div class="notice error">${errors.map(escape).join('<br>')}<br>오류를 고친 뒤 다시 확인해 주세요.</div>`:''}${duplicates.length?`<div class="notice">중복 날짜 ${duplicates.length}건은 건너뜁니다. 같은 날짜의 종류가 다르면 기존 기록을 직접 수정해 주세요.</div>`:''}<div class="table-preview">${accepted.map(e=>`<div class="list-row"><strong>${e.date}</strong>${typeLabel(e.type)}<span>${state.rules.volumes[e.type]}mL</span></div>`).join('')}</div><p class="count-row">가져올 기록 ${accepted.length}건</p>`;$('#save-import').disabled=errors.length>0||accepted.length===0;};
  $('#save-import').onclick=()=>{if(!pending.length)return;const rows=pending;change(()=>state.records.push(...rows),`${rows.length}건의 기록을 가져왔습니다.`);dialog.close();};
}
function openAutoPlan(){
  openDialog('월별 계획 초안','금요일을 우선으로, 달마다 한 번씩 가능한 일정을 찾아요.',`<div class="form-stack"><div class="two-fields"><label>시작 날짜<input id="draft-start" type="date" value="${today()}" min="${today()}" max="2197-12-31"></label><label>기간<select id="draft-months"><option value="6">6개월</option><option value="12" selected>12개월</option><option value="24">24개월</option></select></label></div><label>우선할 헌혈<select id="draft-preference"><option value="whole">전혈 → 혈소판 혈장 → 혈소판 → 혈장 순서</option><option value="mixed">혈소판 혈장 → 혈장 순서</option><option value="platelet">혈소판 → 혈장 순서</option><option value="plasma">혈장만</option></select></label><p class="settings-note">기존 계획을 유지하며 월별로 순서대로 찾는 초안입니다. 전혈 횟수를 최대화하는 최적화 결과는 아닙니다. 토·일요일을 제외하며 공휴일·기관 운영일은 반영하지 않습니다.</p><div id="draft-preview"></div><div class="card-foot"><button class="secondary" id="generate-draft">초안 확인</button><button class="primary" id="save-draft" disabled>내 계획에 추가</button></div></div>`);
  let draft=[];const invalidate=()=>{draft=[];$('#save-draft').disabled=true;$('#draft-preview').innerHTML='';};['draft-start','draft-months','draft-preference'].forEach(id=>$('#'+id).addEventListener('change',invalidate));
  $('#generate-draft').onclick=()=>{const start=$('#draft-start').value;if(!validDate(start)||start<today()||start>'2197-12-31'){toast('시작 날짜를 확인해 주세요.');return;}const result=proposeMonthly(state.records,state.plans,start,Number($('#draft-months').value),$('#draft-preference').value,state.rules,restrictions());draft=result.draft.map(e=>({...e,id:uid()}));$('#draft-preview').innerHTML=`<div class="table-preview">${draft.map(e=>`<div class="list-row"><strong style="font-size:12px">${full(e.date)}</strong>${typeLabel(e.type)}</div>`).join('')}</div><p class="count-row">새 계획 ${draft.length}건${result.skipped.length?` · 가능한 날짜를 찾지 못한 달: ${result.skipped.join(', ')}`:''}</p>${!draft.length?'<p class="hint">이미 계획이 있는 달 또는 조건을 충족하지 못하는 달은 추가하지 않았습니다.</p>':''}`;$('#save-draft').disabled=!draft.length;};
  $('#save-draft').onclick=()=>{if(!draft.length)return;const rows=draft;change(()=>state.plans.push(...rows),`${rows.length}건의 계획을 추가했습니다.`);dialog.close();};
}
function download(name,data,type){if(!window.BloodNoteAndroid){toast('파일 저장 기능을 열지 못했습니다. 앱을 다시 시작해 주세요.');return;}window.BloodNoteAndroid.saveText(name,type,String(data));toast('파일을 저장할 위치를 선택해 주세요.');}
let backupTask=0;
function requestBackupPassword(title,confirm,perform){
  const ticket=++backupTask;
  openDialog(title,confirm?'비밀번호는 이 기기에 저장하지 않습니다. 잊으면 백업을 복원할 수 없습니다.':'백업을 저장할 때 정한 비밀번호를 입력해 주세요.',`<form id="backup-password-form" class="form-stack"><label>백업 비밀번호<input name="password" type="password" minlength="10" maxlength="1024" required autocomplete="off"></label>${confirm?'<label>비밀번호 확인<input name="confirm" type="password" minlength="10" maxlength="1024" required autocomplete="off"></label>':''}<p id="backup-password-status" class="settings-note" role="status">10자 이상으로 입력해 주세요. 인터넷은 사용하지 않습니다.</p><div class="card-foot"><button type="button" class="secondary" data-action="close-dialog">취소</button><button class="primary" type="submit">${confirm?'암호화하여 저장':'백업 열기'}</button></div></form>`);
  const form=$('#backup-password-form'),status=$('#backup-password-status'),button=form.querySelector('[type="submit"]');
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const password=form.elements.password.value;
    if(password.length<10||password.length>1024){status.textContent='비밀번호를 10~1,024자로 입력해 주세요.';return;}
    if(confirm&&password!==form.elements.confirm.value){status.textContent='입력한 두 비밀번호가 다릅니다.';return;}
    busy=true;button.disabled=true;form.reset();status.textContent=confirm?'백업을 암호화하고 있습니다…':'백업을 열고 있습니다…';
    const active=()=>ticket===backupTask&&dialog.open;
    try{await perform(password,active);}catch(error){if(active())status.textContent=error.message;}
    finally{busy=false;button.disabled=false;}
  });
}
function exportBackup(){
  requestBackupPassword('암호화 백업 저장',true,async(password,active)=>{
    const encrypted=await encryptBackup(JSON.stringify(state),password);
    if(!active())return;
    dialog.close();download(`blood-note-backup-${today()}${demoMode?'-example':''}.json`,encrypted,'application/json');
  });
}
function installHelp(){openDialog('연간채혈량 계산기 2.4.1','작은 월간 달력',`<div class="modal-message"><p>화면, 기록 저장, 계산, 일정 계획은 인터넷 없이 사용할 수 있습니다. 공휴일 자료는 달력의 🔃 버튼을 누르고 이번 갱신의 인터넷 사용을 허용해야 갱신합니다. 앱 업데이트는 설정에서 직접 확인하고 데이터 사용에 동의했을 때만 연결합니다.</p><p class="settings-note">이전 앱에서 저장한 백업이 있다면 ⚙ 설정의 ‘백업 불러오기’를 통해 기록과 계획을 옮길 수 있습니다.</p><p class="settings-note">기록은 이 기기의 앱 저장 공간에 보관됩니다. 앱 삭제나 앱 데이터 삭제 전에 백업 파일을 저장해 주세요.</p></div>`);}
function toggleDemo(){
  selectedPlanIds.clear();
  if(demoMode){state=realState;realState=null;demoMode=false;toast('내 기록으로 돌아왔습니다.');}
  else{realState=state;state=fresh();state.complete=true;state.records=[[-330,'whole'],[-250,'whole'],[-170,'whole'],[-90,'whole'],[-30,'mixed'],[-16,'mixed']].map(([offset,type])=>({id:uid(),date:addDays(today(),offset),type}));demoMode=true;toast('예시 데이터입니다. 실제 기록에는 저장되지 않습니다.');}
  setPage('dashboard');
}
app.addEventListener('change',e=>{
  if(e.target.id==='start-page'){saveStartPage(e.target.value);return;}
  if(e.target.dataset.displayOption){saveDisplayOption(e.target.dataset.displayOption,e.target.checked);return;}
  if(e.target.id==='select-all-plans'){selectedPlanIds.clear();if(e.target.checked)state.plans.forEach(plan=>selectedPlanIds.add(plan.id));updatePlanSelectionUI();}
  if(e.target.dataset.planSelect){const id=e.target.dataset.planSelect;if(e.target.checked)selectedPlanIds.add(id);else selectedPlanIds.delete(id);updatePlanSelectionUI();}
  if(e.target.id==='sim-date'&&validDate(e.target.value)){selected=e.target.value;moveCalendar(selected);render();}
  if(e.target.id==='record-filter'){recordFilter=e.target.value;recordPageIndex=0;render();}
  if(e.target.id==='record-page')moveRecordPage(Number(e.target.value));
  if(e.target.id==='history-complete')change(()=>state.complete=e.target.checked,e.target.checked?'기록 입력 완료로 표시했습니다.':'입력 기록 기준 예상값으로 표시합니다.');
  if(e.target.id==='backup-file')restoreBackup(e.target.files[0]);
});
let certificateStage=null;
function openCertificateImport(){
  if(demoMode){toast('예시 체험을 종료한 뒤 내 증명서를 불러와 주세요.');return;}
  if(storageFailed){toast('기록 저장 공간을 확인한 뒤 다시 시도해 주세요. 먼저 백업을 보관해 주세요.');return;}
  if(!window.BloodNoteAndroid?.importCertificate){toast('증명서 PDF 가져오기는 Android 15 이상의 연간채혈량 계산기 앱에서 사용할 수 있습니다.');return;}
  certificateStage={phase:'reading',page:0,selected:new Set()};
  openDialog('증명서 PDF 불러오기','기기에 저장한 헌혈확인증명서(개인)를 선택해 주세요.',`<div class="certificate-progress" aria-live="polite"><strong id="certificate-progress-label">파일 선택을 기다리고 있습니다.</strong><progress id="certificate-progress" max="100" value="0"></progress><p class="settings-note">파일은 기기 안에서만 읽습니다. 잠긴 PDF는 암호를 입력해 열 수 있으며, 암호는 저장·전송하지 않습니다. 검토 후 등록 버튼을 눌러야 기록에 반영됩니다.</p></div><div class="card-foot"><button class="secondary" data-action="close-dialog">취소</button></div>`);
  window.BloodNoteAndroid.importCertificate();
}
function updateCertificateSelection(){
  if(!certificateStage||certificateStage.phase!=='review')return;
  const count=certificateStage.selected.size,button=$('[data-action="certificate-commit"]');
  if(button){button.disabled=count===0;button.textContent=`선택한 ${count}건 등록`;}
  const summary=$('#certificate-selection');if(summary)summary.textContent=`${count}건 선택`;
}
function renderCertificateReview(){
  const stage=certificateStage;if(!stage?.review)return;
  const rows=stage.review,perPage=20,pages=Math.ceil(rows.length/perPage);
  stage.page=Math.max(0,Math.min(pages-1,stage.page));
  const visible=rows.slice(stage.page*perPage,(stage.page+1)*perPage);
  const fresh=rows.filter(row=>['new','plan'].includes(row.status)).length;
  const duplicate=rows.filter(row=>!row.selectable).length;
  const conflicts=rows.filter(row=>['conflict','plan-conflict'].includes(row.status)).length;
  const status=row=>row.status==='new'?'새 기록':row.status==='duplicate'?'이미 등록됨':row.status==='file-duplicate'?'파일 안의 중복':row.status==='plan'?'계획 → 기록':`${row.status==='conflict'?'기존 기록':'계획'} ${TYPES[row.existingType].label} → ${TYPES[row.type].label}`;
  openDialog('헌혈 기록 검토',`PDF ${stage.payload.pages}쪽에서 ${rows.length}건을 읽었습니다.`,`
    <div class="certificate-summary"><span>새 기록 <strong>${fresh}</strong></span><span>중복 <strong>${duplicate}</strong></span><span>종류 확인 <strong>${conflicts}</strong></span></div>
    <p class="settings-note">중복은 다시 등록하지 않습니다. 종류가 다른 항목은 선택한 경우에만 PDF 내용으로 수정합니다. 같은 날짜의 계획은 기록으로 옮깁니다.</p>
    <div class="certificate-toolbar"><span id="certificate-selection" aria-live="polite"></span><div class="actions"><button class="quiet" data-action="certificate-select-new">새 기록 선택</button><button class="quiet" data-action="certificate-select-none">선택 해제</button></div></div>
    <div class="certificate-list">${visible.map(row=>`<label class="certificate-row ${row.selectable?'':'is-duplicate'}"><input type="checkbox" data-certificate-index="${row.index}" ${stage.selected.has(row.index)?'checked':''} ${row.selectable?'':'disabled'} aria-label="${escape(row.date)} ${TYPES[row.type].label} ${escape(status(row))}"><span><strong>${escape(row.date)}</strong><span class="certificate-type">${TYPES[row.type].label}</span><small>${row.page}쪽 · ${escape(status(row))}</small></span></label>`).join('')}</div>
    <div class="certificate-pagination"><button class="secondary small" data-action="certificate-prev" ${stage.page===0?'disabled':''} aria-label="이전 기록">‹ 이전</button><span>${stage.page+1} / ${pages}</span><button class="secondary small" data-action="certificate-next" ${stage.page===pages-1?'disabled':''} aria-label="다음 기록">다음 ›</button></div>
    <p class="settings-note">저장되는 정보는 헌혈 날짜와 종류뿐입니다. 이름·생년월일·주민등록번호·증서번호·PDF 암호는 저장하지 않으며, 원본 PDF를 읽기 전용으로 열며 앱 안에 PDF 복사본을 만들지 않습니다.</p>
    <div class="card-foot certificate-confirm"><button class="secondary" data-action="close-dialog">취소</button><button class="primary" data-action="certificate-commit"></button></div>`);
  updateCertificateSelection();
  dialog.scrollTop=0;
}
function commitCertificateImport(){
  const stage=certificateStage;if(stage?.phase!=='review')return;
  try{
    const current=reviewCertificate(stage.payload,state.records,state.plans,today());
    if(current.some((row,i)=>row.status!==stage.review[i].status||row.existingType!==stage.review[i].existingType)){
      stage.review=current;stage.selected=new Set(current.filter(row=>row.selected).map(row=>row.index));renderCertificateReview();
      toast('기존 기록이 변경되어 검토 목록을 새로 확인해 주세요.');return;
    }
    const merged=mergeCertificate(state,stage.payload,[...stage.selected],today(),uid),next=validateState(merged.state),before=clone(state);
    // Write once before touching the visible state. Quota errors cannot leave a partial import.
    appStorage.setItem(KEY,JSON.stringify(next));
    state=next;recordPageIndex=0;recordFilter='all';certificateStage=null;dialog.close();render();
      toast(`${merged.added}건 추가${merged.updated?` · ${merged.updated}건 수정`:''}${merged.converted?` · 계획 ${merged.converted}건 완료`:''}`,()=>{
      try{appStorage.setItem(KEY,JSON.stringify(before));state=before;render();}catch{toast('되돌리기를 저장하지 못했습니다. 저장 공간을 확인해 주세요.');}
    });
  }catch(error){toast('등록하지 못했습니다. '+(error.name==='QuotaExceededError'?'저장 공간을 확인해 주세요.':error.message));}
}
window.bloodNoteCertificateEvent=(phase,payload)=>{
  if(!certificateStage||certificateStage.phase!=='reading')return;
  if(phase==='cancelled'){certificateStage=null;dialog.close();return;}
  if(phase==='password'){const label=$('#certificate-progress-label');if(label)label.textContent='PDF 암호 입력을 기다리고 있습니다.';return;}
  if(phase==='error'){
    certificateStage=null;
    const title=payload?.code==='future-date'||payload?.code==='current-date'?'날짜 설정을 확인해 주세요.':payload?.code==='invalid-row'?'증명서 내용을 확인해 주세요.':'증명서를 읽지 못했습니다.';
    openDialog(title,'기존 기록은 변경되지 않았습니다.',`<p class="modal-message">${escape(payload?.message||'파일을 다시 확인해 주세요.')}</p><div class="card-foot"><button class="secondary" data-action="close-dialog">닫기</button></div>`);return;
  }
  if(phase==='reading'||phase==='progress'){
    const label=$('#certificate-progress-label'),progress=$('#certificate-progress');
    if(label)label.textContent=phase==='reading'?'PDF를 읽을 준비를 하고 있습니다.':`${payload.done} / ${payload.total}쪽 확인 중`;
    if(progress&&phase==='progress'){progress.max=payload.total;progress.value=payload.done;}return;
  }
  if(phase==='ready'){
    try{
      const review=reviewCertificate(payload,state.records,state.plans,today());
      certificateStage={phase:'review',payload,review,page:0,selected:new Set(review.filter(row=>row.selected).map(row=>row.index))};
      renderCertificateReview();
    }catch(error){window.bloodNoteCertificateEvent('error',{code:error.code,message:error.message});}
  }
};
dialog.addEventListener('change',e=>{
  if(e.target.dataset?.certificateIndex!==undefined&&certificateStage?.phase==='review'){const i=Number(e.target.dataset.certificateIndex);if(certificateStage.review[i]?.selectable){if(e.target.checked)certificateStage.selected.add(i);else certificateStage.selected.delete(i);updateCertificateSelection();}}
});
// Require a tap that both starts and ends outside the panel. Padding and drags
// from inside the panel must not discard an editor or a pending date selection.
let backdropTap=false;
function outsideDialog(event){
  if(event.target!==dialog)return false;
  const bounds=dialog.getBoundingClientRect();
  return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
}
dialog.addEventListener('pointerdown',event=>{backdropTap=event.isPrimary!==false&&event.button===0&&outsideDialog(event);});
dialog.addEventListener('pointercancel',()=>{backdropTap=false;});
dialog.addEventListener('click',event=>{
  const dismiss=backdropTap&&outsideDialog(event);backdropTap=false;
  if(dismiss&&dialog.open){event.preventDefault();event.stopPropagation();dialog.close();}
});
dialog.addEventListener('close',()=>{
  backdropTap=false;
  const date=dayPopup?.date||restrictionEditor?.returnDay?.date;dayPopup=null;restrictionEditor=null;dialog.classList.remove('calendar-date-dialog');dialog.removeAttribute?.('aria-labelledby');
  if(date)app.querySelector?.(`[data-calendar-date="${date}"]`)?.focus({preventScroll:true});
  backupTask++;
  if(certificateStage){window.BloodNoteAndroid?.cancelCertificateImport?.();certificateStage=null;}
});

function confirmBackupRestore(backup){
  openDialog('백업을 복원할까요?','복원하면 현재 기록과 계획이 백업 내용으로 바뀝니다.',`<div class="modal-message">완료 기록 <strong>${backup.records.length}건</strong>, 계획 <strong>${backup.plans.length}건</strong>, 헌혈 제한 기간 <strong>${backup.restrictions?.length||0}건</strong><p class="settings-note">현재 내용을 먼저 보관하려면 백업을 저장한 뒤 복원하세요.</p></div><div class="card-foot"><button class="secondary" id="backup-current">현재 내용 백업</button><button class="primary" id="confirm-restore">이 백업으로 복원</button></div>`);
  $('#backup-current').onclick=exportBackup;
  $('#confirm-restore').onclick=()=>{
    backup.appliedImports=[...new Set([...backup.appliedImports,...state.appliedImports])];
    if(!backup.calculationAnchor&&state.calculationAnchor)backup.calculationAnchor=clone(state.calculationAnchor);
    storageFailed=false;
    if(change(()=>{state=backup;recordPageIndex=0;recordFilter='all';},'백업을 복원했습니다.'))dialog.close();
  };
}
async function restoreBackup(file){
  if(!file)return;if(file.size>5000000){toast('5MB 이하의 백업 파일을 선택해 주세요.');return;}
  try{
    const raw=JSON.parse(await file.text());
    if(isEncryptedBackup(raw))requestBackupPassword('암호화 백업 열기',false,async(password,active)=>{
      const text=await decryptBackup(raw,password);if(!active())return;
      const backup=validateState(JSON.parse(text));backupTask++;confirmBackupRestore(backup);
    });
    else confirmBackupRestore(validateState(raw));
  }catch(error){toast('복원하지 못했습니다. '+error.message);}
}
app.addEventListener('submit',e=>{if(e.target.id!=='rules-form')return;e.preventDefault();const form=e.target,rules={cap:Number(form.elements.cap.value),wholeLimit:Number(form.elements.wholeLimit.value),componentLimit:Number(form.elements.componentLimit.value),boundary:form.elements.boundary.value,volumes:{},waits:{}};for(const t of Object.keys(TYPES)){rules.volumes[t]=Number(form.elements['volume-'+t].value);rules.waits[t]=Number(form.elements['wait-'+t].value);}try{validateState({...state,rules});}catch(error){toast(error.message);return;}change(()=>state.rules=rules,'계산 기준을 바꾸고 전체 일정을 다시 계산했습니다.');});
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-page]');if(nav){e.preventDefault();setPage(nav.dataset.page);return;}
  const button=e.target.closest('[data-action]');if(!button||button.disabled)return;const {action,id,date,type}=button.dataset;
  if(['dashboard','planner','records','settings'].includes(action)){setPage(action);return;}
  if(action==='close-dialog')dialog.close();
  else if(action==='add-record')openEditor('record');
  else if(action==='edit-record')openEditor('record',id);
  else if(action==='add-plan')openEditor('plan',null,date,type);
  else if(action==='edit-plan')openEditor('plan',id,null,type);
  else if(action==='day-type')selectDayType(type);
  else if(action==='day-confirm')confirmDayPlan();
  else if(action==='restriction-new'){if(currentDayPopup())openRestrictionEditor(dayPopup.date);}
  else if(action==='restriction-edit')openRestrictionEditor(null,id);
  else if(action==='restriction-delete')deleteRestriction(id);
  else if(action==='restriction-back')returnFromRestrictionEditor();
  else if(action==='restriction-less'||action==='restriction-more')stepRestrictionDays(action==='restriction-more'?1:-1);
  else if(action==='day-red-connect')openDayRedConnect();
  else if(action==='plan-red-connect')openPlanRedConnect(id);
  else if(action==='day-complete')completeDayPlan();
  else if(action==='day-delete')deleteDayPlan();
  else if(action==='day-add-record'||action==='day-edit-record')editDayRecord();
  else if(action==='delete-record')change(()=>{state.records=state.records.filter(x=>x.id!==id);state.complete=false;},'기록을 삭제했습니다. 최근 1년 기록의 완전성을 다시 확인해 주세요.');
  else if(action==='delete-plan')change(()=>state.plans=state.plans.filter(x=>x.id!==id),'계획을 삭제했습니다.');
  else if(action==='delete-selected-plans')openPlanDeletion(false);
  else if(action==='delete-all-plans')openPlanDeletion(true);
  else if(action==='complete-plan')completePlan(id);
  else if(action==='refresh-holidays')requestHolidayRefresh();
  else if(action==='open-licenses')openLicenses();
  else if(action==='check-update'){if(demoMode)return;if(!window.BloodNoteAndroid?.requestAppUpdate){toast('업데이트 기능을 열지 못했습니다. 앱을 다시 시작해 주세요.');return;}window.BloodNoteAndroid.requestAppUpdate();}
  else if(action==='records-prev'||action==='records-next')moveRecordPage(recordPageIndex+(action==='records-next'?1:-1));
  else if(action==='day')openDayPopup(date);
  else if(action==='month-today')navigateCalendar(button,today());
  else if(action==='calendar-prev'||action==='calendar-next'){const range=calendarWindow(calendarAnchor,calendarView()),target=action==='calendar-prev'?range.previous:range.next;if(target)navigateCalendar(button,target);}
  else if(action==='import-text')openTextImport();
  else if(action==='import-certificate')openCertificateImport();
  else if(action==='certificate-prev'||action==='certificate-next'){if(certificateStage?.phase==='review'){certificateStage.page+=action==='certificate-next'?1:-1;renderCertificateReview();}}
  else if(action==='certificate-select-new'){if(certificateStage?.review){certificateStage.selected=new Set(certificateStage.review.filter(row=>row.selected).map(row=>row.index));renderCertificateReview();}}
  else if(action==='certificate-select-none'){if(certificateStage){certificateStage.selected.clear();renderCertificateReview();}}
  else if(action==='certificate-commit')commitCertificateImport();
  else if(action==='auto-plan')openAutoPlan();
  else if(action==='export-backup')exportBackup();
  else if(action==='import-backup')$('#backup-file').click();
  else if(action==='reset-rules')change(()=>state.rules=clone(DEFAULT_RULES),'처음 계산 기준으로 되돌렸습니다.');
  else if(action==='install')installHelp();
  else if(action==='demo')toggleDemo();
});
$('#quick-add').onclick=openRecordChoices;$('#exit-demo').onclick=toggleDemo;$('#install').onclick=installHelp;

window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(APP_PAGES.includes(next)&&page!==next){page=next;rememberPage();render();}});
installCalendarSwipe();
if(!storageFailed)persist();
render();
if('ResizeObserver'in window){
  let lastWidth=0;
  new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width!==lastWidth){lastWidth=width;scheduleHolidayFit();}}).observe(app);
}else window.addEventListener('resize',scheduleHolidayFit);
document.fonts?.ready.then(scheduleHolidayFit);

// Local date checks only: no network request or automatic record creation.
window.bloodNoteRefreshDay=refreshLocalDay;
window.addEventListener('focus',refreshLocalDay);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshLocalDay();});
refreshLocalDay();


// Route only genuinely external HTTPS links to Android. Hash links stay inside the app.
document.addEventListener('click',event=>{
  // An actual click cancels exit; pointer-down also occurs during Android's back swipe.
  window.BloodNoteAndroid?.cancelExitHint?.();
  const link=event.target.closest('a[href]');if(!link)return;
  const target=new URL(link.href,location.href);
  if(target.protocol!=='https:'||target.origin===location.origin)return;
  event.preventDefault();window.BloodNoteAndroid?.openLink(target.href);
},true);
