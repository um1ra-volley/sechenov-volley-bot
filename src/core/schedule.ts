import {isUpcoming} from './time.ts';
import type { Event, Operation, SourceSnapshot, State } from './model.ts';
const fields:(keyof Event)[]=['localDate','startAtUtc','opponent','venue','status','team'];
const attendanceFields:(keyof Event)[]=['localDate','startAtUtc','opponent','venue'];
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function synchronize(input:State,snapshots:SourceSnapshot[],now:string):State{
 const state=clone(input);
 const record=(id:string,action:string,previous:unknown,next:unknown,targetId?:string)=>{
  const operation:Operation={operationId:id,action,at:now,result:'ok',targetId,previous,next};state.operations.push(operation);
 };
 for(const snapshot of snapshots){
  const id=snapshot.sourceId,previous=state.sourceState[id],oldEvents=Object.values(state.events).filter(e=>e.sourceKey===id);
  let error=snapshot.ok?undefined:snapshot.error??'Недоступен источник';
  const seen=new Set(snapshot.events.map(e=>e.eventId));
  if(snapshot.ok&&(seen.size!==snapshot.events.length||snapshot.events.some(e=>e.sourceKey!==id)))error='Некорректные ID источника';
  if(snapshot.ok&&snapshot.events.length===0&&oldEvents.some(e=>e.status!=='removed'))error='Пустой источник требует проверки';
  if(error){
   state.sourceState[id]={...(previous??{missing:{}}),lastError:error};
   if(previous?.lastError!==error)record('source:'+id+':error:'+now,'SOURCE_ERROR',previous?.lastError??null,error,id);
   continue;
  }
  const first=!previous?.lastSuccessAt;
  const missing={...(previous?.missing??{})};
  for(const sourceEvent of snapshot.events){
   const old=state.events[sourceEvent.eventId];
   if(old&&old.sourceKey!==id)throw new Error('ID принадлежит другому источнику');
   missing[sourceEvent.eventId]=0;
   if(!old){
    const archived=state.archivedEvents?.[sourceEvent.eventId];
    if(archived&&!isUpcoming(sourceEvent,now))continue;
    const added=archived?{...sourceEvent,revision:archived.revision+1,attendanceRevision:archived.attendanceRevision+1}:clone(sourceEvent);
    state.events[added.eventId]=added;if(archived)delete state.archivedEvents![added.eventId];
    if(!first)record('event:'+added.eventId+':'+added.revision,'EVENT_CHANGED',null,added,added.eventId);continue;
   }
   if(!fields.some(key=>old[key]!==sourceEvent[key]))continue;
   const reconfirm=attendanceFields.some(key=>old[key]!==sourceEvent[key])||(['removed','cancelled'].includes(old.status)&&!['removed','cancelled'].includes(sourceEvent.status));
   const updated={...sourceEvent,revision:old.revision+1,attendanceRevision:old.attendanceRevision+(reconfirm?1:0)};
   state.events[updated.eventId]=updated;record('event:'+updated.eventId+':'+updated.revision,'EVENT_CHANGED',old,updated,updated.eventId);
  }
  for(const old of oldEvents){
   if(seen.has(old.eventId)||old.status==='removed'||id==='TRAINING')continue;
   missing[old.eventId]=(missing[old.eventId]??0)+1;
   if(missing[old.eventId]>=2){
    const updated={...old,status:'removed' as const,revision:old.revision+1};state.events[old.eventId]=updated;
    record('event:'+updated.eventId+':'+updated.revision,'EVENT_CHANGED',old,updated,updated.eventId);
   }
  }
  const changed=state.operations.length!==input.operations.length;
  const heartbeat=!previous?.lastSuccessAt||Date.parse(now)-Date.parse(previous.lastSuccessAt)>=15*60*1000;
  state.sourceState[id]={missing,lastSuccessAt:heartbeat||changed||previous?.lastError?now:previous.lastSuccessAt};
  if(previous?.lastError)record('source:'+id+':restored:'+now,'SOURCE_RESTORED',previous.lastError,null,id);
 }
 return state;
}
