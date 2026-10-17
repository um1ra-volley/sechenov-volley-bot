import type { Event, Scope } from './model.ts';
const DAY=86400000;
export function localDateOf(now:string):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export function validateDate(date:string):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) throw new Error('Некорректная дата');
  return date;
}
export function addDays(date:string,n:number):string {
  validateDate(date); return new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
}
export function calendarDaysUntil(date:string,now:string):number {
  validateDate(date); return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(localDateOf(now)+'T00:00:00Z'))/DAY);
}
export function dateLabel(date:string):string {
  validateDate(date);
  const d=new Date(date+'T09:00:00Z');
  const day=new Intl.DateTimeFormat('ru-RU',{weekday:'long',timeZone:'Europe/Moscow'}).format(d);
  return day+', '+date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(2,4);
}
export function countdown(date:string,now:string):string {
  const n=calendarDaysUntil(date,now);
  if(n===0)return 'сегодня'; if(n===1)return 'завтра'; if(n<0)return 'прошло';
  const m=n%100; const unit=m>=11&&m<=14?'дней':n%10===1?'день':n%10>=2&&n%10<=4?'дня':'дней';
  return 'через '+n+' '+unit;
}
export function moscowInstant(date:string,time:string):string {
  validateDate(date);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Некорректное время');
  return new Date(date+'T'+time+':00+03:00').toISOString();
}
export function localTimeOf(instant:string):string {
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(instant));
}
export function eventInstant(event:Event):string {
  return event.startAtUtc??moscowInstant(event.localDate,'12:00');
}
export function isUpcoming(event:Event,now:string):boolean {
  if(event.status==='cancelled'||event.status==='played'||event.status==='removed')return false;
  return event.startAtUtc?Date.parse(event.startAtUtc)>Date.parse(now):event.localDate>=localDateOf(now);
}
export function listUpcoming(events:Event[],scopes:Scope[],period:'week'|'month'|'all',now:string):Event[] {
  const today=localDateOf(now), weekday=new Date(today+'T09:00:00Z').getUTCDay();
  const weekEnd=addDays(today,(7-weekday)%7);
  return events.filter(e=>scopes.includes(e.scope)&&isUpcoming(e,now)&&(period==='all'||(period==='week'?e.localDate<=weekEnd:e.localDate.slice(0,7)===today.slice(0,7))))
    .sort((a,b)=>eventInstant(a).localeCompare(eventInstant(b))||a.eventId.localeCompare(b.eventId));
}
