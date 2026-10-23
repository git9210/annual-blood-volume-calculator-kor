import {TYPES,validDate,clone} from './engine.mjs';

function reviewError(code,message){return Object.assign(Error(message),{code});}

// Only minimal, validated record fields cross into storage. No PDF, identity or certificate number.
export function reviewCertificate(payload,records,plans,currentDate){
  if(!payload||!Number.isInteger(payload.pages)||payload.pages<1||payload.pages>300||
    !Number.isInteger(payload.expected)||!Array.isArray(payload.rows)||!payload.rows.length||
    payload.rows.length>3000||payload.expected!==payload.rows.length)throw Error('증명서 전체 기록을 확인하지 못했습니다.');
  if(!validDate(currentDate)||currentDate<'1900-01-01'||currentDate>'2199-12-31')
    throw reviewError('current-date','앱에서 오늘 날짜를 확인하지 못했습니다. 기기의 날짜·시간 설정을 확인한 뒤 앱을 다시 열어 주세요.');
  const existing=new Map(records.map(row=>[row.date,row])),planned=new Map(plans.map(row=>[row.date,row])),seen=new Map();
  const allowedSources={whole:['전혈'],mixed:['혈소판혈장'],platelet:['혈소판'],plasma:['혈장']};
  const review=payload.rows.map((item,index)=>{
    if(!item||!validDate(item.date)||item.date<'1900-01-01'||item.date>'2199-12-31'||typeof item.type!=='string'||!Object.hasOwn(TYPES,item.type)||
      !allowedSources[item.type].includes(item.sourceType)||!Number.isInteger(item.page)||item.page<1||item.page>payload.pages)
      throw reviewError('invalid-row',`PDF의 ${index+1}번째 기록에서 날짜·헌혈 종류·쪽 정보를 확인하지 못했습니다. 원본 내용을 확인해 주세요.`);
    const row={index,date:item.date,type:item.type,sourceType:item.sourceType,page:item.page};
    if(seen.has(row.date)){
      if(seen.get(row.date)!==row.type)throw Error('PDF 안에 같은 날짜로 서로 다른 종류가 있습니다. 원본을 확인해 주세요.');
      return {...row,status:'file-duplicate',selectable:false,selected:false};
    }
    seen.set(row.date,row.type);
    const actual=existing.get(row.date),plan=planned.get(row.date);
    if(actual)return {...row,status:actual.type===row.type?'duplicate':'conflict',existingType:actual.type,selectable:actual.type!==row.type,selected:false};
    if(plan)return {...row,status:plan.type===row.type?'plan':'plan-conflict',existingType:plan.type,selectable:true,selected:plan.type===row.type};
    return {...row,status:'new',selectable:true,selected:true};
  });
  const latest=review.reduce((date,item)=>item.date>date?item.date:date,'');
  if(latest>currentDate)throw reviewError('future-date',`PDF는 읽었지만 가장 최근 헌혈일(${latest})이 앱의 오늘 날짜(${currentDate}, 한국 시간)보다 뒤입니다. 휴대폰 또는 앱플레이어의 날짜·시간 설정과 PDF 날짜를 확인한 뒤 다시 불러와 주세요. 미래 날짜는 헌혈 기록으로 등록하지 않습니다.`);
  return review;
}

export function mergeCertificate(state,payload,indices,currentDate,newId){
  const review=reviewCertificate(payload,state.records,state.plans,currentDate);
  if(!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=review.length))throw Error('선택한 항목을 확인해 주세요.');
  const selected=new Set(indices),rows=review.filter(row=>selected.has(row.index)&&row.selectable);
  if(!rows.length)throw Error('등록할 새 기록 또는 수정할 항목을 선택해 주세요.');
  const next=clone(state),records=new Map(next.records.map(row=>[row.date,row]));
  const plans=new Map(next.plans.map(row=>[row.date,row]));
  let added=0,updated=0,converted=0;
  for(const row of rows){
    const actual=records.get(row.date),plan=plans.get(row.date);
    if(actual){actual.type=row.type;updated++;}
    else{records.set(row.date,{id:plan?.id||newId(),date:row.date,type:row.type});added++;}
    if(plan){plans.delete(row.date);converted++;}
  }
  next.records=[...records.values()];next.plans=[...plans.values()];
  if(next.records.length+next.plans.length>3000)throw Error('기록과 계획은 합계 3,000건까지 저장할 수 있습니다.');
  return {state:next,added,updated,converted};
}
