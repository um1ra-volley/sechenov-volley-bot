import type {Button,Effect,Event,Scope,State,User} from '../core/model.ts';
import {SCOPES} from '../core/model.ts';
import {eventStats} from '../core/attendance.ts';
import {attendanceButtons,eventCard,SCOPE_LABELS} from '../core/reminders.ts';
import {addDays,dateLabel,listUpcoming,localDateOf,localTimeOf} from '../core/time.ts';
export function message(user:User,text:string,buttons:Button[][]=[],purpose:'dialog'|'admin'='dialog'):Effect{
 return {kind:'send',chatId:user.privateChatId,userId:user.telegramUserId,text,buttons,purpose};
}
export function menu(user:User,prefix='Выберите действие'):Effect{
 const rows:Button[][]=[
 [{text:'Игры на этой неделе',data:'list|week|0'},{text:'Игры в этом месяце',data:'list|month|0'}],
 [{text:'Тренировки',data:'list|training|0'},{text:'Мои ответы',data:'answers|0'}],
 [{text:'Мои подписки',data:'subs'},{text:'Изменить ФИО',data:'name'}],
 [{text:'Остановить уведомления',data:'stop'}]
 ];
 if(user.role==='owner')rows.push([{text:'Статистика',data:'admin|events|0'},{text:'Заявки',data:'admin|requests|0'}],[{text:'Управление тренировками',data:'admin|training|0'},{text:'История',data:'admin|history|0'}],[{text:'Система',data:'admin|status'},{text:'Проверить расписание',data:'admin|sync'}]);
 return message(user,prefix,rows);
}
export const back=():Button[][]=>[[{text:'В меню',data:'menu'}]];
export function subscriptions(user:User,selected:Scope[]):Effect{
 return message(user,'Выберите лиги и тренировки. Можно несколько.',[
 ...SCOPES.map(scope=>[{text:(selected.includes(scope)?'✅ ':'⬜ ')+SCOPE_LABELS[scope],data:'sub|'+scope+'|'+(selected.includes(scope)?'0':'1')}]),
 [{text:'Готово',data:'finish'}]
 ]);
}
export function fullCard(user:User,event:Event,now:string,prefix=''):Effect{
 return message(user,(prefix?prefix+'\n\n':'')+eventCard(event,now),[...attendanceButtons(event),...back()]);
}
function page<T>(items:T[],index:number,size=3):T[]{return items.slice(Math.max(0,index)*size,(Math.max(0,index)+1)*size);}
function pages(index:number,count:number,prefix:string,size=3):Button[][]{
 const buttons:Button[]=[];if(index>0)buttons.push({text:'←',data:prefix+'|'+(index-1)});if((index+1)*size<count)buttons.push({text:'→',data:prefix+'|'+(index+1)});return buttons.length?[buttons]:[];
}
export function eventList(state:State,user:User,period:string,index:number,now:string):Effect{
 const scopes=state.subscriptions[user.telegramUserId]??[];
 const active=period==='training'?scopes.filter(s=>s==='TRAINING'):scopes.filter(s=>s!=='TRAINING');
 const events=listUpcoming(Object.values(state.events),active,period==='week'?'week':period==='month'?'month':'all',now),items=page(events,index);
 return message(user,items.length?items.map(e=>eventCard(e,now)).join('\n\n'):'В этом периоде событий по вашим подпискам нет.',[
 ...items.map(e=>[{text:'Ответить · '+e.localDate.slice(8)+'.'+e.localDate.slice(5,7)+' · '+SCOPE_LABELS[e.scope],data:'view|'+e.eventId}]),
 ...pages(index,events.length,'list|'+period),...back()]);
}
export function answers(state:State,user:User,index:number,now:string):Effect{
 const entries=Object.values(state.participation).filter(p=>p.telegramUserId===user.telegramUserId&&state.events[p.eventId]).sort((a,b)=>state.events[a.eventId].localDate.localeCompare(state.events[b.eventId].localDate));
 const items=page(entries,index);
 return message(user,items.length?items.map(p=>eventCard(state.events[p.eventId],now)+'\nОтвет: '+(p.attendanceRevision!==state.events[p.eventId].attendanceRevision?'нужно подтвердить заново':p.answer==='yes'?'Буду':p.answer==='no'?'Не буду':'не ответили')).join('\n\n'):'Ответов пока нет.',[...items.map(p=>[{text:'Открыть '+p.eventId,data:'view|'+p.eventId}]),...pages(index,entries.length,'answers'),...back()]);
}
export function adminEvents(state:State,user:User,index:number,now:string,training=false):Effect{
 const start=addDays(localDateOf(now),-30);
 const events=Object.values(state.events).filter(e=>e.localDate>=start&&(!training||e.kind==='training')).sort((a,b)=>a.localDate.localeCompare(b.localDate)||a.eventId.localeCompare(b.eventId));
 const items=page(events,index,8),prefix=training?'train|':'s|';
 return message(user,training?'Выберите тренировку':'Выберите событие для статистики',[
 ...items.map(e=>[{text:e.localDate.slice(8)+'.'+e.localDate.slice(5,7)+' · '+SCOPE_LABELS[e.scope]+' · '+(e.opponent||e.venue).slice(0,35),data:prefix+e.eventId}]),
 ...pages(index,events.length,'admin|'+(training?'training':'events'),8),...back()]);
}
export function requests(state:State,user:User,index:number):Effect{
 const pending=Object.values(state.users).filter(u=>u.accessStatus==='pending'&&u.stage==='ready'),items=page(pending,index,8);
 return message(user,items.length?'Заявки:\n'+items.map(u=>u.fullName+' · ID '+u.telegramUserId).join('\n'):'Новых заявок нет.',[
 ...items.flatMap(u=>[[{text:'✅ '+u.fullName.slice(0,35),data:'access|'+u.telegramUserId+'|approve'},{text:'Отказать',data:'access|'+u.telegramUserId+'|reject'}]]),
 ...pages(index,pending.length,'admin|requests',8),...back()]);
}
const categories:Record<string,string>={yes:'✅ Будут',no:'❌ Не будут',unanswered:'⏳ Не ответили',reconfirm:'🔄 Нужно подтвердить заново'};
export function statistics(state:State,user:User,event:Event,now:string,category?:string,index=0):Effect{
 const stats=eventStats(state,event.eventId,now);
 if(category&&category in categories){
  const list=stats[category as keyof typeof stats],items=page(list,index,10);
  return message(user,categories[category]+'\n'+dateLabel(event.localDate)+'\n\n'+(items.length?items.map(u=>u.fullName).join('\n'):'Нет участников.'),[...pages(index,list.length,'sl|'+event.eventId+'|'+category,10),[{text:'Назад к статистике',data:'s|'+event.eventId}],...back()]);
 }
 return message(user,eventCard(event,now)+'\n\n'+Object.entries(categories).map(([key,label])=>label+' — '+stats[key as keyof typeof stats].length).join('\n'),[
 ...Object.entries(categories).map(([key,label])=>[{text:label,data:'sl|'+event.eventId+'|'+key+'|0'}]),
 [{text:'Отметить вручную',data:'mark|'+event.eventId+'|0'}],...back()]);
}
export function manualParticipants(state:State,user:User,event:Event,index:number):Effect{
 const members=Object.values(state.users).filter(u=>u.accessStatus==='approved'&&(state.subscriptions[u.telegramUserId]??[]).includes(event.scope));
 return message(user,'Кого отметить?',[
 ...page(members,index,8).map(u=>[{text:u.fullName.slice(0,50),data:'mp|'+event.eventId+'|'+u.telegramUserId}]),
 ...pages(index,members.length,'mark|'+event.eventId,8),...back()]);
}
export function history(state:State,user:User,index:number):Effect{
 const entries=state.operations.filter(o=>o.action==='RSVP'||o.action==='TRAINING_EXCEPTION').slice().reverse(),items=page(entries,index,6);
 return message(user,items.length?items.map(o=>dateLabel(localDateOf(o.at))+' '+localTimeOf(o.at)+' · '+(o.actorId?state.users[o.actorId]?.fullName??o.actorId:'система')+' · '+o.action+' · '+(o.targetId??'')).join('\n'):'История ответов пока пуста.',[...pages(index,entries.length,'admin|history',6),...back()]);
}
export function status(state:State,user:User):Effect{
 const counts:Record<string,number>={};for(const n of Object.values(state.notifications))counts[n.status]=(counts[n.status]??0)+1;
 const sources=Object.entries(state.sourceState).map(([key,s])=>key+': '+(s.lastError?'ошибка':s.lastSuccessAt?dateLabel(localDateOf(s.lastSuccessAt))+' '+localTimeOf(s.lastSuccessAt)+' МСК':'не проверен'));
 return message(user,'Среда: '+state.runtime.id+' · epoch '+state.runtime.epoch+'\nВерсия данных: '+state.stateVersion+'\nУчастников: '+Object.values(state.users).filter(u=>u.accessStatus==='approved').length+'\nДоставка: '+JSON.stringify(counts)+'\n\n'+sources.join('\n'),back());
}
export function trainingCard(user:User,event:Event,now:string):Effect{
 return message(user,eventCard(event,now)+'\nСтатус: '+event.status,[
 [{text:event.status==='cancelled'?'Восстановить':'Отменить занятие',data:(event.status==='cancelled'?'tr|':'tc|')+event.eventId}],
 [{text:'Перенести занятие',data:'tm|'+event.eventId}],...back()]);
}
