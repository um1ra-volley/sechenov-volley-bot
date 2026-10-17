import type {Command,Effect,Event,State,StateRepository,TelegramTransport,Clock,User} from '../core/model.ts';
import {SCOPES} from '../core/model.ts';
import {deliverDue} from './jobs.ts';
import {moscowInstant} from '../core/time.ts';
import * as ui from './ui.ts';
type Obj=Record<string,unknown>;
const object=(value:unknown):Obj=>value&&typeof value==='object'&&!Array.isArray(value)?value as Obj:{};
const index=(value:string|undefined)=>value&&/^\d{1,4}$/.test(value)?Number(value):0;
export interface BotDependencies{repository:StateRepository;transport:TelegramTransport;clock:Clock;ownerSetupSecret:string;sync?:()=>unknown}
export function handleUpdate(update:unknown,dependencies:BotDependencies):{accepted:boolean}{
 const raw=object(update),query=object(raw.callback_query),callback=typeof query.data==='string',incoming=callback?object(query.message):object(raw.message),sender=object(callback?query.from:incoming.from),chat=object(incoming.chat);
 if(!Number.isSafeInteger(raw.update_id)||!Number.isSafeInteger(sender.id)||Number(sender.id)<=0||sender.is_bot===true||chat.type!=='private'||chat.id!==sender.id)return {accepted:false};
 if(callback&&(String(query.data).length>64||typeof query.id!=='string'))return {accepted:false};
 const id=String(sender.id),updateId=String(raw.update_id),now=dependencies.clock.now();
 if(callback)try{dependencies.transport.acknowledge(String(query.id));}catch{/* Expired callback acknowledgement does not invalidate the answer. */}
 let state=dependencies.repository.read(),user=state.users[id];
 if(state.processedUpdates[updateId])return {accepted:true};
 const text=typeof incoming.text==='string'?incoming.text.trim():'',parts=callback?String(query.data).split('|'):[];
 const command:Command={type:'QUEUE_MESSAGES',actorId:id,operationId:'tg:'+updateId,updateId,data:{},effects:[]};
 let effects:Effect[]=[];
 const event=(key:string|undefined):Event=>{
  if(!key||!Object.prototype.hasOwnProperty.call(state.events,key))throw new Error('Игра не найдена');return state.events[key];
 };
 const owner=()=>{if(user?.role!=='owner'||user.accessStatus!=='approved')throw new Error('Доступ только владельцу');};
 const available=(e:Event)=>{if(user.accessStatus!=='approved'||!(state.subscriptions[id]??[]).includes(e.scope))throw new Error('Нет доступа к этой подписке');};
 try{
  if(!user||(!callback&&/^\/start(?:\s|$)/.test(text))){
   command.type='START';command.data={chatId:id,bootstrapOwner:!callback&&text==='/start '+dependencies.ownerSetupSecret&&Boolean(dependencies.ownerSetupSecret)};
   let recipient=user??{telegramUserId:id,privateChatId:id,fullName:'',role:'member',accessStatus:'pending',stage:'name',registeredAt:now,deliveryStatus:'active'} as User;
   if(command.data.bootstrapOwner===true&&!Object.values(state.users).some(u=>u.role==='owner'))recipient={...recipient,role:'owner',accessStatus:'approved'};
   effects=[!recipient.fullName||recipient.stage==='name'?ui.message(recipient,'Введите ваше ФИО.',ui.back()):recipient.stage==='subscriptions'?ui.subscriptions(recipient,state.subscriptions[id]??[]):recipient.accessStatus==='approved'?ui.menu(recipient):ui.message(recipient,'Заявка ожидает подтверждения владельца.',[[{text:'Мои подписки',data:'subs'}]])];
  }else if(!callback&&user.pendingAction?.kind==='move-training'){
   owner();const match=text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})$/);
   if(!match)throw new Error('Введите дату и время: ДД.ММ.ГГГГ ЧЧ:ММ');
   const date=match[3]+'-'+match[2]+'-'+match[1],start=moscowInstant(date,match[4]);
   command.type='TRAINING_EXCEPTION';command.data={eventId:user.pendingAction.eventId,action:'move',localDate:date,startAtUtc:start};effects=[ui.message(user,'Тренировка перенесена.',ui.back())];
  }else if(!callback&&user.stage==='name'){
   command.type='SET_NAME';command.data={fullName:typeof incoming.text==='string'?incoming.text:''};
   effects=[user.editName?ui.menu(user,'ФИО обновлено.'):ui.subscriptions(user,state.subscriptions[id]??[])];
  }else if(callback&&parts[0]==='name'){
   command.type='ASK_NAME';effects=[ui.message(user,'Введите новое ФИО.',ui.back())];
  }else if(callback&&parts[0]==='subs'){
   effects=[ui.subscriptions(user,state.subscriptions[id]??[])];
  }else if(callback&&parts[0]==='sub'&&parts.length===3&&SCOPES.includes(parts[1] as typeof SCOPES[number])&&['0','1'].includes(parts[2])){
   const scope=parts[1] as typeof SCOPES[number],selected=state.subscriptions[id]??[];
   command.type='SET_SCOPE';command.data={scope,enabled:parts[2]==='1'};
   effects=[ui.subscriptions(user,parts[2]==='1'?Array.from(new Set([...selected,scope])):selected.filter(s=>s!==scope))];
  }else if(callback&&parts[0]==='finish'){
   command.type='FINISH_REGISTRATION';
   effects=[user.accessStatus==='approved'?ui.menu(user):ui.message(user,'Заявка отправлена. Ожидайте подтверждения владельца.',[[{text:'Мои подписки',data:'subs'}]])];
   if(user.accessStatus==='pending'&&user.stage!=='ready')for(const admin of Object.values(state.users).filter(u=>u.role==='owner'&&u.accessStatus==='approved'))effects.push(ui.message(admin,'Новая заявка: '+user.fullName,[[{text:'Подтвердить',data:'access|'+id+'|approve'},{text:'Отказать',data:'access|'+id+'|reject'}]],'admin'));
  }else if(callback&&parts[0]==='stop'){
   command.type='STOP';effects=[ui.menu(user,'Все уведомления отключены. Подписки можно включить снова.')];
  }else if(user.accessStatus!=='approved'){
   effects=[ui.message(user,'Доступ к расписанию откроется после подтверждения владельца.',[[{text:'Мои подписки',data:'subs'}]])];
  }else if(callback&&parts[0]==='list'&&['week','month','training'].includes(parts[1])){
   effects=[ui.eventList(state,user,parts[1],index(parts[2]),now)];
  }else if(callback&&parts[0]==='view'&&parts.length===2){
   const e=event(parts[1]);available(e);effects=[ui.fullCard(user,e,now,'',state)];
  }else if(callback&&parts[0]==='answers'){
   effects=[ui.answers(state,user,index(parts[1]),now)];
  }else if(callback&&parts[0]==='r'&&parts.length===4&&['y','n'].includes(parts[3])){
   const e=event(parts[1]);available(e);
   if(Number(parts[2])!==e.attendanceRevision)effects=[ui.fullCard(user,e,now,'Расписание изменилось. Подтвердите участие заново.',state)];
   else{command.type='RSVP';command.data={eventId:e.eventId,revision:Number(parts[2]),answer:parts[3]==='y'?'yes':'no'};effects=[ui.fullCard(user,e,now,'Ваш ответ: '+(parts[3]==='y'?'Буду':'Не буду'),state)];}
  }else if(callback&&parts[0]==='access'&&parts.length===3){
   owner();const target=state.users[parts[1]];if(!target)throw new Error('Участник не найден');
   command.type=parts[2]==='approve'?'APPROVE':'REJECT';command.data={userId:target.telegramUserId};
   effects=[ui.message(user,'Доступ участника обновлён.',[[{text:'Заявки',data:'admin|requests|0'}],...ui.back()])];
   effects.push(parts[2]==='approve'?ui.menu(target,'Доступ подтверждён. Добро пожаловать!'):ui.message(target,'Заявка отклонена владельцем.'));
  }else if(callback&&['s','sl','mark','mp','m','train','tc','tr','tm'].includes(parts[0])){
   owner();const e=event(parts[1]);
   if(parts[0]==='s')effects=[ui.statistics(state,user,e,now)];
   else if(parts[0]==='sl')effects=[ui.statistics(state,user,e,now,parts[2],index(parts[3]))];
   else if(parts[0]==='mark')effects=[ui.manualParticipants(state,user,e,index(parts[2]))];
   else if(parts[0]==='mp'){
    const target=state.users[parts[2]];if(!target)throw new Error('Участник не найден');
    effects=[ui.message(user,'Отметить: '+target.fullName,[[{text:'Будет',data:'m|'+e.eventId+'|'+target.telegramUserId+'|'+e.attendanceRevision+'|y'},{text:'Не будет',data:'m|'+e.eventId+'|'+target.telegramUserId+'|'+e.attendanceRevision+'|n'}],[{text:'Статистика',data:'s|'+e.eventId}]])];
   }else if(parts[0]==='m'&&parts.length===5&&['y','n'].includes(parts[4])){
    command.type='RSVP';command.data={eventId:e.eventId,userId:parts[2],revision:Number(parts[3]),answer:parts[4]==='y'?'yes':'no'};
    effects=[ui.message(user,'Участник отмечен: '+(parts[4]==='y'?'Будет':'Не будет'),[[{text:'Статистика',data:'s|'+e.eventId}]])];
   }else if(parts[0]==='train')effects=[ui.trainingCard(user,e,now)];
   else if(parts[0]==='tm'){command.type='BEGIN_TRAINING_MOVE';command.data={eventId:e.eventId};effects=[ui.message(user,'Введите новую дату и время: ДД.ММ.ГГГГ ЧЧ:ММ',ui.back())];}
   else if(parts[0]==='tc'||parts[0]==='tr'){command.type='TRAINING_EXCEPTION';command.data={eventId:e.eventId,action:parts[0]==='tc'?'cancel':'restore'};effects=[ui.message(user,parts[0]==='tc'?'Тренировка отменена.':'Тренировка восстановлена.',ui.back())];}
   else throw new Error('Некорректная кнопка');
  }else if(callback&&parts[0]==='admin'){
   owner();const page=index(parts[2]);
   if(parts[1]==='events')effects=[ui.adminEvents(state,user,page,now)];
   else if(parts[1]==='training')effects=[ui.adminEvents(state,user,page,now,true)];
   else if(parts[1]==='requests')effects=[ui.requests(state,user,page)];
   else if(parts[1]==='history')effects=[ui.history(state,user,page)];
   else if(parts[1]==='status')effects=[ui.status(state,user)];
   else if(parts[1]==='sync'){dependencies.sync?.();state=dependencies.repository.read();effects=[ui.status(state,user)];}
   else throw new Error('Некорректная кнопка');
  }else{
   command.type=callback&&parts[0]==='menu'?'CANCEL_DIALOG':'QUEUE_MESSAGES';effects=[ui.menu(user)];
  }
  command.effects=effects;
  dependencies.repository.transact(command);
 }catch(error){
  if(!user)throw error;
  const description=error instanceof Error&&/^(Нет |Доступ |Сначала |Введите |Некоррект|Устарев|Расписание |Событие |Игра |Участник |Нельзя )/.test(error.message)?error.message:'Не удалось сохранить действие. Повторите позже.';
  effects=[ui.message(user,description,ui.back())];
  dependencies.repository.transact({...command,type:'QUEUE_MESSAGES',data:{},effects});
 }
 const recipients=Array.from(new Set(effects.map(e=>e.userId??e.chatId)));
 deliverDue(dependencies.repository,dependencies.transport,dependencies.clock.now(),Math.max(3,effects.length),recipients);
 return {accepted:true};
}
