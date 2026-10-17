import { moscowInstant, validateDate } from '../core/time.ts';
import { planNotifications, canDeliver } from '../core/reminders.ts';
import { synchronize } from '../core/schedule.ts';
import type { SourceSnapshot } from '../core/model.ts';
import { SCOPES } from '../core/model.ts';
import type { ApplyResult, Command, Scope, State, User } from '../core/model.ts';
import { isUpcoming } from '../core/time.ts';
function text(data:Record<string,unknown>,key:string):string {
 const value=data[key];if(typeof value!=='string'||!value)throw new Error('Некорректные данные: '+key);return value;
}
function userId(value:string):string {if(!/^\d{1,20}$/.test(value))throw new Error('Некорректный Telegram ID');return value;}
function requireUser(state:State,id?:string):User {const user=id?state.users[id]:undefined;if(!user)throw new Error('Сначала нажмите /start');return user;}
function owner(state:State,id?:string):User {const user=requireUser(state,id);if(user.role!=='owner'||user.accessStatus!=='approved')throw new Error('Нет прав доступа');return user;}
function scope(value:unknown):Scope {if(typeof value!=='string'||!SCOPES.includes(value as Scope))throw new Error('Неизвестная лига');return value as Scope;}
export function applyCommand(input:State,command:Command,now:string):ApplyResult {
 if(!command.operationId||typeof command.operationId!=='string')throw new Error('Нужен ID операции');
 if((command.updateId&&input.processedUpdates[command.updateId])||input.operations.some(o=>o.operationId===command.operationId))return {state:input,effects:[],duplicate:true};
 const state:State=JSON.parse(JSON.stringify(input)), data=command.data, actor=command.actorId;
 let previous:unknown,next:unknown,targetId:string|undefined;
 switch(command.type){
 case 'START':{
  const id=userId(actor??'');const chatId=userId(text(data,'chatId'));if(id!==chatId)throw new Error('Нужен личный чат');
  if(!state.users[id]){
   const isOwner=data.bootstrapOwner===true&&!Object.values(state.users).some(u=>u.role==='owner');
   state.users[id]={telegramUserId:id,privateChatId:chatId,fullName:'',role:isOwner?'owner':'member',accessStatus:isOwner?'approved':'pending',stage:'name',registeredAt:now,deliveryStatus:'active'};
   state.subscriptions[id]=[];
  }else state.users[id].deliveryStatus='active';
  break;
 }
 case 'SET_NAME':{
  const user=requireUser(state,actor),name=text(data,'fullName').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>120||!/[\p{L}]/u.test(name))throw new Error('Введите ФИО, от 2 до 120 символов');
  previous=user.fullName;user.fullName=name;next=name;
  if(user.stage==='name'){user.stage=user.editName?'ready':'subscriptions';delete user.editName;}
  break;
 }
 case 'ASK_NAME':{
  const user=requireUser(state,actor);user.editName=Boolean(user.fullName);user.stage='name';delete user.pendingAction;break;
 }
 case 'CANCEL_DIALOG':{const user=requireUser(state,actor);user.stage=user.fullName?'ready':'name';delete user.pendingAction;delete user.editName;break;}
 case 'BEGIN_TRAINING_MOVE':{
  const user=owner(state,actor),event=state.events[text(data,'eventId')];if(!event||event.kind!=='training')throw new Error('Нужна тренировка');
  user.pendingAction={kind:'move-training',eventId:event.eventId};break;
 }
 case 'TRAINING_EXCEPTION':{
  const user=owner(state,actor),event=state.events[text(data,'eventId')];if(!event||event.kind!=='training')throw new Error('Нужна тренировка');
  previous=JSON.parse(JSON.stringify(event));targetId=event.eventId;
  if(data.action==='cancel')event.status='cancelled';
  else if(data.action==='restore'){event.status='scheduled';event.attendanceRevision++;}
  else if(data.action==='move'){
   const date=validateDate(text(data,'localDate')),instant=text(data,'startAtUtc');
   if(!Number.isFinite(Date.parse(instant))||Date.parse(instant)<=Date.parse(now)||instant.slice(0,10)!==date)throw new Error('Некорректная будущая дата');
   event.localDate=date;event.startAtUtc=instant;event.status='postponed';event.attendanceRevision++;
  }else throw new Error('Некорректная команда тренировки');
  event.revision++;next=JSON.parse(JSON.stringify(event));delete user.pendingAction;
  state.operations.push({operationId:command.operationId+':event',action:'EVENT_CHANGED',targetId:event.eventId,at:now,result:'ok',previous,next});
  break;
 }
 case 'SET_SCOPE':{
  const user=requireUser(state,actor);if(user.accessStatus==='rejected')throw new Error('Нет доступа');
  const selected=scope(data.scope);if(typeof data.enabled!=='boolean')throw new Error('Некорректная подписка');
  const list=state.subscriptions[user.telegramUserId]??[];
  state.subscriptions[user.telegramUserId]=data.enabled?Array.from(new Set([...list,selected])):list.filter(s=>s!==selected);
  break;
 }
 case 'STOP':{const user=requireUser(state,actor);state.subscriptions[user.telegramUserId]=[];break;}
 case 'FINISH_REGISTRATION':{
  const user=requireUser(state,actor);if(!user.fullName)throw new Error('Сначала введите ФИО');user.stage='ready';break;
 }
 case 'APPROVE':case 'REJECT':{
  owner(state,actor);const id=userId(text(data,'userId')),user=requireUser(state,id);
  if(user.role==='owner')throw new Error('Нельзя изменить доступ владельца');
  user.accessStatus=command.type==='APPROVE'?'approved':'rejected';targetId=id;break;
 }
 case 'RSVP':{
  const performer=requireUser(state,actor);
  const id=typeof data.userId==='string'?userId(data.userId):performer.telegramUserId;
  if(id!==performer.telegramUserId)owner(state,actor);
  const user=requireUser(state,id);if(user.accessStatus!=='approved')throw new Error('Нет доступа');
  const eventId=text(data,'eventId'),event=state.events[eventId];if(!event)throw new Error('Игра не найдена');
  if(!isUpcoming(event,now))throw new Error('Событие уже началось или завершено');
  if(!(state.subscriptions[id]??[]).includes(event.scope))throw new Error('Нет подписки на эту лигу');
  if(data.revision!==event.attendanceRevision)throw new Error('Устаревшая версия игры: откройте новую карточку');
  if(data.answer!=='yes'&&data.answer!=='no')throw new Error('Выберите Буду или Не буду');
  const key=eventId+':'+id,old=state.participation[key];previous=old??null;targetId=key;
  state.participation[key]={eventId,telegramUserId:id,attendanceRevision:event.attendanceRevision,answer:data.answer,invitedAt:old?.invitedAt??now,firstPollSentAt:old?.firstPollSentAt??null,answeredAt:now,answerSource:id===performer.telegramUserId?'user':'admin'};
  next=state.participation[key];break;
 }
 case 'PLAN_NOTIFICATIONS':{
  if(actor!==undefined)throw new Error('Нет прав доступа');
  Object.assign(state,planNotifications(state,now));
  if(JSON.stringify(state)===JSON.stringify(input))return {state:input,effects:[],duplicate:false};
  break;
 }
 case 'DELIVERY_CLAIM':case 'DELIVERY_RESULT':case 'DELIVERY_RECOVER':{
  if(actor!==undefined)throw new Error('Нет прав доступа');
  const id=text(data,'notificationId'),notification=state.notifications[id];if(!notification)throw new Error('Уведомление не найдено');
  if(command.type==='DELIVERY_CLAIM'){
   if(!['pending','retry'].includes(notification.status)||Date.parse(notification.nextAttemptAt??notification.dueAt)>Date.parse(now))throw new Error('Уведомление уже обрабатывается');
   if(!canDeliver(state,notification,now)){notification.status='cancelled';break;}
   notification.status='sending';notification.attempts++;notification.sendingAt=now;notification.lease=command.operationId;
  }else if(command.type==='DELIVERY_RECOVER'){
   if(notification.status!=='sending'||!notification.sendingAt||Date.parse(now)-Date.parse(notification.sendingAt)<300000)throw new Error('Нет просроченной отправки');
   notification.status='uncertain';notification.error='Истёк срок подтверждения отправки';
  }else{
   if(notification.status!=='sending'||notification.lease!==data.lease)throw new Error('Устаревшее подтверждение отправки');
   if(!['sent','retry','uncertain','cancelled'].includes(String(data.status)))throw new Error('Некорректная доставка');
   notification.status=data.status as 'sent'|'retry'|'uncertain'|'cancelled';
   notification.error=typeof data.error==='string'?data.error:undefined;
   if(notification.status==='sent'){
    notification.messageId=text(data,'messageId');notification.sentAt=now;
    if((notification.fulfills??[notification.type]).includes('poll')&&notification.eventId){
     const p=state.participation[notification.eventId+':'+notification.userId];
     if(p&&p.pollRevision===notification.attendanceRevision)p.firstPollSentAt=now;
    }
   }
   if(notification.status==='retry')notification.nextAttemptAt=text(data,'nextAttemptAt');
   if(data.blocked===true&&state.users[notification.userId])state.users[notification.userId].deliveryStatus='blocked';
  }
  break;
 }
 case 'SYNC_SOURCES':{
  if(actor!==undefined)throw new Error('Нет прав доступа');
  if(!Array.isArray(data.snapshots))throw new Error('Некорректный снимок');
  Object.assign(state,synchronize(state,data.snapshots as SourceSnapshot[],now));
  if(JSON.stringify(state)===JSON.stringify(input))return {state:input,effects:[],duplicate:false};
  break;
 }
 case 'QUEUE_MESSAGES': {requireUser(state,actor);break;}
 default:throw new Error('Неизвестная команда');
 }
 const effects=command.effects??[];
 for(let index=0;index<effects.length;index++){
  const effect=effects[index],id=command.operationId+':ui:'+index;
  if(effect.purpose!=='admin')for(const old of Object.values(state.notifications))if(old.userId===(effect.userId??effect.chatId)&&old.type==='ui'&&['pending','retry'].includes(old.status))old.status='cancelled';
  state.notifications[id]={notificationId:id,userId:effect.userId??effect.chatId,type:effect.purpose==='admin'?'admin':'ui',dueAt:now,status:'pending',attempts:0,message:{chatId:effect.chatId,text:effect.text,buttons:effect.buttons,messageId:effect.kind==='edit'?effect.messageId:undefined}};
 }
 if(command.updateId)state.processedUpdates[command.updateId]=now;
 state.stateVersion++;
 state.operations.push({operationId:command.operationId,actorId:actor,action:command.type,targetId,at:now,result:'ok',previous,next});
 return {state,effects,duplicate:false};
}
