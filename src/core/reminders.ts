import type {Button,Event,Notification,State,User} from './model.ts';
import {countdown,dateLabel,eventInstant,isUpcoming,localTimeOf} from './time.ts';
export const SCOPE_LABELS:Record<string,string>={MSSI:'МССИ',LVL:'ЛВЛ',CHM:'ЧМ',LCHB:'ЛЧБ',TRAINING:'Тренировка'};
export function attendanceButtons(event:Event):Button[][]{
 return [[{text:'✅ Буду',data:'r|'+event.eventId+'|'+event.attendanceRevision+'|y'},{text:'❌ Не буду',data:'r|'+event.eventId+'|'+event.attendanceRevision+'|n'}]];
}
export function eventCard(event:Event,now:string):string{
 const title=event.kind==='training'?'🏐 Тренировка':SCOPE_LABELS[event.scope]+' · '+event.team+' — '+event.opponent;
 return title+'\n'+dateLabel(event.localDate)+' · '+countdown(event.localDate,now)+'\n'+(event.startAtUtc?localTimeOf(event.startAtUtc)+' МСК':'Время игры пока не указано')+'\nМесто: '+(event.venue||'пока не указано');
}
export function canDeliver(state:State,n:Notification,now:string):boolean{
 const user=state.users[n.userId];if(!user||user.deliveryStatus==='blocked')return false;
 if(!n.eventId)return true;
 const e=state.events[n.eventId];if(!e||user.accessStatus!=='approved'||!(state.subscriptions[n.userId]??[]).includes(e.scope)||e.revision!==n.revision)return false;
 return n.type==='change'||isUpcoming(e,now);
}
function has(state:State,e:Event,u:User,kind:string):boolean{
 return Object.values(state.notifications).some(n=>n.eventId===e.eventId&&n.userId===u.telegramUserId&&n.attendanceRevision===e.attendanceRevision&&n.status!=='cancelled'&&(n.fulfills??[n.type]).includes(kind));
}
function create(state:State,e:Event,u:User,kinds:string[],text:string,now:string,type:string,dueAt:string):void{
 const id='notice:'+e.eventId+':'+e.attendanceRevision+':'+u.telegramUserId+':'+(kinds.includes('change')?'change-'+e.revision:kinds.slice().sort().join('+'));
 if(state.notifications[id]&&state.notifications[id].status!=='cancelled')return;
 if(kinds.includes('poll')){
  const key=e.eventId+':'+u.telegramUserId,old=state.participation[key];
  state.participation[key]=old??{eventId:e.eventId,telegramUserId:u.telegramUserId,attendanceRevision:e.attendanceRevision,answer:null,invitedAt:now,firstPollSentAt:null,answeredAt:null,answerSource:null};
  if(state.participation[key].pollRevision!==e.attendanceRevision){state.participation[key].pollRevision=e.attendanceRevision;state.participation[key].firstPollSentAt=null;}
 }
 const warning=state.sourceState[e.sourceKey]?.lastError?'\n⚠️ Источник временно недоступен. Последняя проверка: '+(state.sourceState[e.sourceKey].lastSuccessAt??'не завершена'):'';
 state.notifications[id]={notificationId:id,eventId:e.eventId,userId:u.telegramUserId,scope:e.scope,revision:e.revision,attendanceRevision:e.attendanceRevision,type,fulfills:kinds,dueAt,status:'pending',attempts:0,message:{chatId:u.privateChatId,text:text+warning,buttons:isUpcoming(e,now)?attendanceButtons(e):undefined}};
}
export function planNotifications(input:State,now:string):State{
 const state:State=JSON.parse(JSON.stringify(input)),ms=Date.parse(now),day=86400000;
 for(const n of Object.values(state.notifications))if(['pending','retry'].includes(n.status)&&!canDeliver(state,n,now))n.status='cancelled';
 const changes=new Map<string,typeof state.operations[number]>();
 for(const operation of state.operations)if(operation.action==='EVENT_CHANGED'&&operation.targetId)changes.set(operation.targetId,operation);
 for(const [id,operation]of changes){
  const e=state.events[id],old=operation.previous as Event|null;
  if(!e||(!isUpcoming(e,now)&&(!old||!isUpcoming(old,now))))continue;
  const prefix=e.status==='cancelled'?'❌ Событие отменено.':e.status==='removed'?'Событие снято из расписания. Ожидается подтверждение организатора.':old?'🔄 Расписание изменилось.':'Добавлено событие.';
  const before=old?'\nБыло: '+dateLabel(old.localDate)+(old.startAtUtc?' '+localTimeOf(old.startAtUtc):'')+' · '+(old.venue||'место не указано'):'';
  for(const u of Object.values(state.users)){
   if(u.accessStatus!=='approved'||u.deliveryStatus==='blocked'||!(state.subscriptions[u.telegramUserId]??[]).includes(e.scope))continue;
   if(Object.values(state.notifications).some(n=>n.eventId===id&&n.userId===u.telegramUserId&&n.revision===e.revision&&n.status!=='cancelled'&&(n.fulfills??[]).includes('change')))continue;
   const kinds=['change'],distance=Date.parse(eventInstant(e))-ms;
   if(isUpcoming(e,now)&&distance<=7*day&&!has(state,e,u,'poll'))kinds.push('poll');
   if(isUpcoming(e,now)&&distance<=day&&!has(state,e,u,'day'))kinds.push('day');
   create(state,e,u,kinds,prefix+before+'\n\nСтало:\n'+eventCard(e,now)+(kinds.includes('poll')?'\nПодтвердите участие заново.':''),now,'change',now);
  }
 }
 for(const e of Object.values(state.events)){
  if(!isUpcoming(e,now))continue;
  const instant=Date.parse(eventInstant(e)),pollAt=new Date(instant-7*day).toISOString(),dayAt=new Date(instant-day).toISOString();
  for(const u of Object.values(state.users)){
   if(u.accessStatus!=='approved'||u.deliveryStatus==='blocked'||!(state.subscriptions[u.telegramUserId]??[]).includes(e.scope))continue;
   const p=state.participation[e.eventId+':'+u.telegramUserId],kinds:string[]=[];
   if(ms>=instant-7*day&&!has(state,e,u,'poll'))kinds.push('poll');
   if(ms>=instant-day&&!has(state,e,u,'day'))kinds.push('day');
   const needsAnswer=!p?.answer||p.attendanceRevision!==e.attendanceRevision;
   if(needsAnswer&&p?.pollRevision===e.attendanceRevision&&p.firstPollSentAt&&ms>=Date.parse(p.firstPollSentAt)+day&&!has(state,e,u,'followup'))kinds.push('followup');
   if(!kinds.length)continue;
   const title=kinds.includes('day')?'⏰ Напоминание о ближайшем событии':kinds.includes('followup')?'Вы ещё не ответили. Будете?':'Будете участвовать?';
   const due=kinds.includes('day')?dayAt:kinds.includes('followup')?new Date(Date.parse(p!.firstPollSentAt!)+day).toISOString():pollAt;
   create(state,e,u,kinds,title+'\n\n'+eventCard(e,now),now,kinds.includes('day')?'day':kinds.includes('followup')?'followup':'poll',due);
  }
 }
 for(const operation of state.operations){
  if(!['SOURCE_ERROR','SOURCE_RESTORED'].includes(operation.action))continue;
  for(const u of Object.values(state.users).filter(u=>u.role==='owner'&&u.accessStatus==='approved')){
   const id='health:'+operation.operationId+':'+u.telegramUserId;
   if(state.notifications[id])continue;
   state.notifications[id]={notificationId:id,userId:u.telegramUserId,type:'health',dueAt:now,status:'pending',attempts:0,message:{chatId:u.privateChatId,text:(operation.action==='SOURCE_ERROR'?'⚠️ Ошибка источника ':'✅ Источник восстановлен ')+operation.targetId}};
  }
 }
 return state;
}
