// Fixed identifiers only. Saved layouts never contain HTML or donation data.
export const LAYOUT_WIDGETS={
  dashboard:[
    {id:'balance',label:'연간 잔여 계산량',kind:'card'},
    {id:'next',label:'다음 헌혈 예상일',kind:'card'},
    {id:'whole-count',label:'직전 1년 전혈',kind:'metric'},
    {id:'component-count',label:'직전 1년 성분헌혈',kind:'metric'},
    {id:'plan-count',label:'세워 둔 계획',kind:'metric'},
    {id:'upcoming',label:'다가오는 계획',kind:'card'},
    {id:'releases',label:'계산에서 빠지는 기록',kind:'card'},
    {id:'recent',label:'최근 헌혈 기록',kind:'full'}
  ],
  planner:[
    {id:'calendar',label:'캘린더',kind:'full'},
    {id:'plans',label:'나의 장기 계획',kind:'full'},
    {id:'restrictions',label:'헌혈 제한 기간',kind:'full'},
    {id:'annual',label:'앞으로 12개월의 연간 계산량',kind:'full'}
  ],
  records:[
    {id:'history-status',label:'최근 1년 기록 입력 확인',kind:'full'},
    {id:'entry',label:'기록 추가 · 증명서',kind:'full'},
    {id:'counts',label:'헌혈 종류별 횟수',kind:'full'},
    {id:'history',label:'헌혈 기록 목록',kind:'full'},
    {id:'volunteer',label:'봉사시간',kind:'full'}
  ]
};
export function layoutOrder(page,layouts){
  const defaults=(Object.hasOwn(LAYOUT_WIDGETS,page)?LAYOUT_WIDGETS[page]:[]).map(item=>item.id),known=new Set(defaults);
  const raw=layouts?.[page],saved=Array.isArray(raw)&&raw.length<=32?raw:[];
  return [...new Set([...saved.filter(id=>typeof id==='string'&&known.has(id)),...defaults])];
}
export function validateScreenLayouts(raw){
  const clean={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return clean;
  for(const page of Object.keys(LAYOUT_WIDGETS)){
    if(Object.hasOwn(raw,page)&&Array.isArray(raw[page])&&raw[page].length<=32)clean[page]=layoutOrder(page,raw);
  }
  return clean;
}
export function hiddenWidgetIds(page,hidden){
  const known=new Set((Object.hasOwn(LAYOUT_WIDGETS,page)?LAYOUT_WIDGETS[page]:[]).map(item=>item.id));
  const raw=hidden?.[page];
  return Array.isArray(raw)&&raw.length<=32?[...new Set(raw.filter(id=>typeof id==='string'&&known.has(id)))]:[];
}
export function validateScreenHidden(raw){
  const clean={};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return clean;
  for(const page of Object.keys(LAYOUT_WIDGETS)){
    if(Object.hasOwn(raw,page)&&Array.isArray(raw[page])&&raw[page].length<=32)clean[page]=hiddenWidgetIds(page,raw);
  }
  return clean;
}
export function insertLayoutBefore(order,id,beforeId){
  if(!order.includes(id)||id===beforeId||beforeId!==null&&!order.includes(beforeId))return [...order];
  const result=order.filter(key=>key!==id),position=beforeId===null?result.length:result.indexOf(beforeId);
  result.splice(position,0,id);return result;
}
export function shiftLayout(order,id,delta){
  const from=order.indexOf(id),to=from+delta;
  if(![-1,1].includes(delta)||from<0||to<0||to>=order.length)return [...order];
  const result=[...order];[result[from],result[to]]=[result[to],result[from]];return result;
}
// Adjacent cards pair on wide displays. Scattered metrics expand without gaps.
export function layoutSpans(page,ids){
  const widgets=Object.hasOwn(LAYOUT_WIDGETS,page)?LAYOUT_WIDGETS[page]:[],kind=id=>widgets.find(item=>item.id===id)?.kind||'full',spans={};
  for(let i=0;i<ids.length;){
    const type=kind(ids[i]);let count=1;
    if(type==='metric')while(count<3&&kind(ids[i+count])===type)count++;
    else if(type==='card'&&kind(ids[i+1])===type)count=2;
    for(let j=0;j<count;j++)spans[ids[i+j]]=6/count;
    i+=count;
  }
  return spans;
}
