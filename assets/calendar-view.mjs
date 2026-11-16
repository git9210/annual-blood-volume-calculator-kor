import {addDays,validDate,weekday} from './engine.mjs';

const MIN='1900-01-01',MAX='2199-12-31';
const clamp=date=>date<MIN?MIN:date>MAX?MAX:date;

export function calendarPartRange(part){
  if(part==='year')return {min:1900,max:2199,unit:'년',label:'연도'};
  if(part==='month')return {min:1,max:12,unit:'월',label:'월'};
  throw Error('Invalid calendar part');
}

// Strict digits only: reject blank, fractions, signs and exponential notation.
export function calendarPartValue(part,value){
  const {min,max}=calendarPartRange(part),text=String(value).trim();
  if(!/^\d{1,4}$/.test(text))return null;
  const number=Number(text);
  return Number.isInteger(number)&&number>=min&&number<=max?number:null;
}

export function calendarWithPart(anchor,part,value){
  const number=calendarPartValue(part,value);
  if(number===null)throw Error('Invalid calendar value');
  let [year,month]=String(anchor).split('-').map(Number);
  if(part==='year')year=number;else month=number;
  return calendarWithParts(anchor,year,month);
}

// Keep the original day until both draft parts have been chosen. Switching
// through February must not permanently trim January 31 before confirmation.
export function calendarWithParts(anchor,year,month){
  if(!validDate(anchor)||anchor<MIN||anchor>MAX)throw Error('Invalid calendar anchor');
  year=calendarPartValue('year',year);month=calendarPartValue('month',month);
  if(year===null||month===null)throw Error('Invalid calendar value');
  const day=Math.min(Number(anchor.slice(8)),new Date(Date.UTC(year,month,0)).getUTCDate());
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// Navigation changes the visible dates only; donation records and plans are untouched.
export function calendarWindow(anchor,view='month'){
  if(!validDate(anchor)||anchor<MIN||anchor>MAX||!['week','month'].includes(view))throw Error('Invalid calendar view');
  const [year,month]=anchor.split('-').map(Number);
  const first=view==='week'?addDays(anchor,-weekday(anchor)):anchor.slice(0,7)+'-01';
  const length=view==='week'?7:new Date(Date.UTC(year,month,0)).getUTCDate();
  const dates=Array.from({length},(_,i)=>addDays(first,i)).filter(date=>date>=MIN&&date<=MAX);
  const start=dates[0],end=dates.at(-1);
  const move=step=>clamp(view==='week'?addDays(anchor,step*7):new Date(Date.UTC(year,month-1+step,1)).toISOString().slice(0,10));
  return {dates,start,end,offset:view==='month'?weekday(first):0,previous:start>MIN?move(-1):null,next:end<MAX?move(1):null};
}
