import type { Clock, Event, Scope, SourceSnapshot } from '../../core/model.ts';
import { moscowInstant, validateDate } from '../../core/time.ts';
const statuses:Record<string,Event['status']>={'В расписании':'scheduled','Перенос':'postponed','Отменена':'cancelled','Сыграна':'played'};
const clean=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ');
const name=(value:unknown)=>clean(value).toLowerCase().replace(/ё/g,'е');
function fullDate(value:string):string {
 let match=value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
 if(match)return validateDate(match[3]+'-'+match[2]+'-'+match[1]);
 return validateDate(value);
}
function time(value:string):string|null{
 if(!value)return null;const match=value.match(/^(\d{1,2}):(\d{2})(?::00)?$/);
 if(!match)throw new Error('Некорректное время в таблице');
 return match[1].padStart(2,'0')+':'+match[2];
}
export function normalizeOwnRows(rows:unknown[][],scope:Scope):Event[]{
 if(!['MSSI','LVL','LCHB'].includes(scope))throw new Error('Неизвестный лист');
 if(name(rows[0]?.[0])!=='id игры')throw new Error('Изменилась структура таблицы');
 const seen=new Set<string>(),events:Event[]=[];
 for(const raw of rows.slice(1)){
  const row=Array.from({length:6},(_,i)=>clean(raw[i]));if(!row.some(Boolean))continue;
  const[id,date,clock,opponent,venue,statusValue]=row;
  if(!id||!new RegExp('^'+scope+'-[A-Za-z0-9-]{1,30}$').test(id)||seen.has(id))throw new Error('Некорректный или повторяющийся ID игры');
  seen.add(id);const localDate=fullDate(date),t=time(clock);
  if(!opponent||opponent.length>300||venue.length>500)throw new Error('Некорректный соперник или место');
  const status=statuses[statusValue||'В расписании'];if(!status)throw new Error('Неизвестный статус игры');
  events.push({eventId:id,sourceKey:scope,scope,kind:'game',team:scope==='LCHB'?'Росэнергоатом':'Сеченовский университет',opponent,localDate,startAtUtc:t?moscowInstant(localDate,t):null,venue,status,revision:1,attendanceRevision:1});
 }
 return events.sort((a,b)=>a.eventId.localeCompare(b.eventId));
}
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function championshipDate(raw:string,firstYear:number,lastYear:number):string{
 if(/^\d{2}\.\d{2}\.\d{4}$/.test(raw)||/^\d{4}-\d{2}-\d{2}$/.test(raw))return fullDate(raw);
 const dotted=raw.match(/^(\d{1,2})\.(\d{1,2})$/);
 const word=raw.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/);
 const day=dotted?Number(dotted[1]):word?Number(word[1]):0;
 const month=dotted?Number(dotted[2]):word?months.indexOf(word[2])+1:0;
 if(!day||!month)throw new Error('Некорректная дата ЧМ');
 const year=word?.[3]?Number(word[3]):month>=7?firstYear:lastYear;
 return validateDate(String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'));
}
export function normalizeChampionshipRows(rows:unknown[][],season:string):Event[]{
 const match=season.match(/(20\d{2})\s*[/-]\s*((?:20)?\d{2})/);
 if(!match)throw new Error('Не указан сезон ЧМ');
 const first=Number(match[1]),last=Number(match[2].length===2?'20'+match[2]:match[2]);
 if(last!==first+1)throw new Error('Некорректный сезон ЧМ');
 const events:Event[]=[],seen=new Set<string>();
 for(const raw of rows){
  const row=raw.map(clean),home=row[8]??'',away=row[18]??'';
  if(name(home)!=='сеченовский университет'&&name(away)!=='сеченовский университет')continue;
  if(!/^\d+$/.test(row[0]))throw new Error('Не указан номер игры ЧМ');
  const id='CHM-'+first+'-'+last+'-'+row[0];if(seen.has(id))throw new Error('Повторяющийся ID ЧМ');seen.add(id);
  const localDate=championshipDate(row[5]||row[4],first,last),t=time(row[6]);
  events.push({eventId:id,sourceKey:'CHM',scope:'CHM',kind:'game',team:'Сеченовский университет',opponent:name(home)==='сеченовский университет'?away:home,localDate,startAtUtc:t?moscowInstant(localDate,t):null,venue:row[7],status:row[5]?'postponed':'scheduled',revision:1,attendanceRevision:1});
 }
 return events.sort((a,b)=>a.eventId.localeCompare(b.eventId));
}
export interface SheetReader {read(bookId:string,sheetName:string,range:string):unknown[][]}
export interface SourcesConfig {ownSpreadsheetId:string;ownSheets:{scope:Scope;sheetName:string}[];championship:{spreadsheetId:string;sheetName:string;season:string}}
export class SheetScheduleSource {
 constructor(privateOptions:{reader:SheetReader;clock:Clock;config:SourcesConfig}){this.options=privateOptions;}
 private options:{reader:SheetReader;clock:Clock;config:SourcesConfig};
 readEvents():SourceSnapshot[]{
  const {reader,clock,config}=this.options;
  const jobs=config.ownSheets.map(item=>({id:item.scope,read:()=>normalizeOwnRows(reader.read(config.ownSpreadsheetId,item.sheetName,'A5:F1000'),item.scope)}));
  jobs.push({id:'CHM',read:()=>{
   const rows=reader.read(config.championship.spreadsheetId,config.championship.sheetName,'A1:S200');
   const title=rows.slice(0,3).flat().map(clean).join(' '),season=title.match(/20\d{2}\s*[/-]\s*(?:20)?\d{2}/)?.[0]??config.championship.season;
   return normalizeChampionshipRows(rows,season);
  }});
  return jobs.map(job=>{try{return {sourceId:job.id,ok:true,events:job.read(),observedAt:clock.now()};}catch{return {sourceId:job.id,ok:false,events:[],observedAt:clock.now(),error:'Не удалось прочитать расписание '+job.id};}});
 }
}
