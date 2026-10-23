import {addDays,validDate,weekday} from './engine.mjs';

const MIN='1900-01-01',MAX='2199-12-31';
const clamp=date=>date<MIN?MIN:date>MAX?MAX:date;

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
