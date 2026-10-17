import type { Event } from './model.ts';
import { addDays, localDateOf, moscowInstant } from './time.ts';
export function generateTrainings(now:string,weeks:number,existing:Event[]):Event[] {
  if(!Number.isInteger(weeks)||weeks<1||weeks>52)throw new Error('Некорректный горизонт');
  const start=localDateOf(now), end=addDays(start,weeks*7), result:Record<string,Event>={};
  for(let date=start;date<end;date=addDays(date,1)){
    const day=new Date(date+'T09:00:00Z').getUTCDay();
    if(day!==1&&day!==4)continue;
    const id='TRAINING-'+date, saved=existing.find(e=>e.eventId===id);
    const item:Event=saved??{eventId:id,sourceKey:'TRAINING',scope:'TRAINING',kind:'training',team:'Сеченовский университет',opponent:'',localDate:date,startAtUtc:moscowInstant(date,'19:30'),venue:'Буревестник',status:'scheduled',revision:1,attendanceRevision:1};
    if(!item.startAtUtc||Date.parse(item.startAtUtc)>Date.parse(now))result[id]=item;
  }
  for(const item of existing)if(item.kind==='training'&&item.localDate>=start&&item.localDate<end&&(!item.startAtUtc||Date.parse(item.startAtUtc)>Date.parse(now)))result[item.eventId]=item;
  return Object.values(result).sort((a,b)=>a.localDate.localeCompare(b.localDate)||a.eventId.localeCompare(b.eventId));
}
