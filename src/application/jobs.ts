import type {Clock,StateRepository,TelegramTransport,SourceSnapshot} from '../core/model.ts';
import {canDeliver} from '../core/reminders.ts';
import {localDateOf} from '../core/time.ts';
import {TelegramError} from '../adapters/telegram/transport.ts';
export function deliverDue(repository:StateRepository,transport:TelegramTransport,now:string,limit:number,targetUsers?:string[]):{sent:number;failed:number}{
 const report={sent:0,failed:0};
 let initial=repository.read();if(initial.runtime.paused)return report;
 const expected={id:initial.runtime.id,epoch:initial.runtime.epoch};
 for(const n of Object.values(initial.notifications)){
  if(n.status==='sending'&&n.sendingAt&&Date.parse(now)-Date.parse(n.sendingAt)>=5*60*1000)
   repository.transact({type:'DELIVERY_RECOVER',operationId:'recover:'+n.notificationId+':'+n.sendingAt,data:{notificationId:n.notificationId}},expected);
 }
 initial=repository.read();
 const ready=Object.values(initial.notifications).filter(n=>(!targetUsers||targetUsers.includes(n.userId))&&['pending','retry'].includes(n.status)&&Date.parse(n.nextAttemptAt??n.dueAt)<=Date.parse(now)).sort((a,b)=>(a.type==='ui'?-1:0)-(b.type==='ui'?-1:0)||a.dueAt.localeCompare(b.dueAt)).slice(0,limit);
 for(const candidate of ready){
  const lease='claim:'+candidate.notificationId+':'+now;
  let claimed;
  try{claimed=repository.transact({type:'DELIVERY_CLAIM',operationId:lease,data:{notificationId:candidate.notificationId}},expected);}catch{report.failed++;continue;}
  if(claimed.duplicate)continue;
  const n=claimed.state.notifications[candidate.notificationId];if(n.status!=='sending'||n.lease!==lease)continue;
  const finish=(status:string,extra:Record<string,unknown>={})=>repository.transact({type:'DELIVERY_RESULT',operationId:lease+':result',data:{notificationId:n.notificationId,lease,status,...extra}},expected);
  try{
   const latest=repository.read();
   if(latest.runtime.id!==expected.id||latest.runtime.epoch!==expected.epoch||latest.runtime.paused)throw new Error('Неактивная среда');
   if(!canDeliver(latest,n,now)){finish('cancelled');continue;}
   let messageId:string;
   if(n.message.messageId){transport.edit(n.message);messageId=n.message.messageId;}else messageId=transport.send(n.message);
   finish('sent',{messageId});report.sent++;
  }catch(error){
   report.failed++;
   let status='uncertain',extra:Record<string,unknown>={error:'Неопределённый результат доставки'};
   if(error instanceof TelegramError&&!error.uncertain){
    if(error.status===403){status='cancelled';extra={blocked:true,terminal:true,error:'Пользователь заблокировал бота'};}
    else if((error.status===429||error.status>=500)&&n.attempts<5){status='retry';extra={nextAttemptAt:new Date(Date.parse(now)+Math.max(error.retryAfter,Math.min(3600,30*2**n.attempts))*1000).toISOString(),error:'Временная ошибка Telegram'};}
    else{status='cancelled';extra={terminal:true,error:'Telegram отклонил сообщение'};}
   }
   try{finish(status,extra);}catch{/* A failed receipt stays sending and will be recovered as uncertain. */}
  }
 }
 return report;
}
export interface TickDependencies{repository:StateRepository;transport:TelegramTransport;source:{readEvents():SourceSnapshot[]};clock:Clock}
export function handleTick(dependencies:TickDependencies):{sent:number;failed:number}{
 const {repository,transport,source,clock}=dependencies,now=clock.now(),state=repository.read();
 if(state.runtime.paused)return {sent:0,failed:0};
 const snapshots=source.readEvents();
 repository.transact({type:'SYNC_SOURCES',operationId:'sync:'+now,data:{snapshots,generateTrainings:true}});
 repository.transact({type:'PLAN_NOTIFICATIONS',operationId:'plan:'+now,data:{}});
 const report=deliverDue(repository,transport,clock.now(),20);
 const current=repository.read();if(!current.lastArchiveAt||localDateOf(current.lastArchiveAt)!==localDateOf(now))repository.transact({type:'ARCHIVE',operationId:'archive:'+localDateOf(now),data:{}});
 return report;
}
