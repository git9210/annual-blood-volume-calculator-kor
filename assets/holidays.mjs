import {validDate,weekday} from './engine.mjs?v=20261018-bottom-navigation';
import {HOLIDAY_SNAPSHOT} from './holiday-snapshot.mjs?v=20261018-bottom-navigation';

export const HOLIDAY_URL='https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/basic.json';
export const HOLIDAY_CACHE_KEY='blood-note-holidays-v1';

// Accept full years only: an empty, truncated or malformed response must not
// erase the last usable calendar. Each accepted year replaces its old dates,
// so withdrawn temporary holidays disappear on the next successful refresh.
export function normalizeHolidayYears(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid holiday data');
  const entries=Object.entries(raw),years={};
  if(!entries.length||entries.length>300)throw Error('Invalid holiday years');
  for(const [year,dates] of entries){
    if(!/^\d{4}$/.test(year)||Number(year)<1900||Number(year)>2199||!dates||typeof dates!=='object'||Array.isArray(dates))throw Error('Invalid holiday year');
    const rows=Object.entries(dates),clean={};
    if(rows.length<10||rows.length>100||!Object.hasOwn(dates,year+'-01-01')||!Object.hasOwn(dates,year+'-12-25'))throw Error('Incomplete holiday year');
    for(const [date,names] of rows){
      if(!validDate(date)||!date.startsWith(year+'-')||!Array.isArray(names)||!names.length||names.length>6||names.some(name=>typeof name!=='string'||!name.trim()||name.length>100))throw Error('Invalid holiday entry');
      clean[date]=[...new Set(names.map(name=>name.trim()))];
    }
    years[year]=clean;
  }
  return years;
}

export function holidayDay(date,years){
  const names=years[date.slice(0,4)]?.[date]||[],day=weekday(date);
  return {names,known:Object.hasOwn(years,date.slice(0,4)),kind:names.length?'holiday':day===0?'sunday':day===6?'saturday':'weekday'};
}

export function createHolidayStore({storage,fetcher=globalThis.fetch,now=()=>Date.now(),onChange=()=>{},snapshot=HOLIDAY_SNAPSHOT}={}){
  let years=normalizeHolidayYears(snapshot.years),checkedAt=0,snapshotAt=snapshot.checkedAt,loading=false,error=false,pending=null,cachedData=false;
  try{
    const cached=JSON.parse(storage?.getItem(HOLIDAY_CACHE_KEY)||'null');
    if(cached?.version===1&&Number.isFinite(cached.checkedAt)&&cached.checkedAt>=0&&cached.checkedAt<=now()+60000){
      years=normalizeHolidayYears(cached.years);checkedAt=cached.checkedAt;cachedData=true;
      if(typeof cached.snapshotAt==='string'&&Number.isFinite(Date.parse(cached.snapshotAt)))snapshotAt=cached.snapshotAt;
    }
  }catch{/* The bundled snapshot remains available if the cache is damaged. */}
  const save=()=>{try{storage?.setItem(HOLIDAY_CACHE_KEY,JSON.stringify({version:1,years,checkedAt,snapshotAt}));}catch{/* Storage may be unavailable; keep the current in-memory data. */}};
  // Keep even the first bundled calendar until the user explicitly refreshes.
  // A later app release must not silently replace their saved holiday dates.
  if(!cachedData)save();
  const info=()=>({checkedAt,loading,error,snapshotAt,years:Object.keys(years).sort()});
  function refresh(){
    if(pending)return pending;
    loading=true;error=false;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    pending=Promise.resolve().then(async()=>{
      try{
        const response=await fetcher(HOLIDAY_URL,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',mode:'cors'});
        if(!response.ok)throw Error('Holiday request failed');
        const text=await response.text();
        if(text.length>1000000)throw Error('Holiday data too large');
        const incoming=normalizeHolidayYears(JSON.parse(text));
        years={...years,...incoming};checkedAt=now();
        save();
        return {ok:true};
      }catch{error=true;return {ok:false};}
      finally{clearTimeout(timeout);loading=false;pending=null;onChange();}
    });
    onChange();
    return pending;
  }
  return {day:date=>holidayDay(date,years),info,refresh};
}
