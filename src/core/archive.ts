import type {State} from './model.ts';
import {addDays,localDateOf} from './time.ts';
export function archiveState(input:State,now:string):{state:State;writes:{path:string;content:string}[]}{
 const state:State=JSON.parse(JSON.stringify(input)),cutoff=addDays(localDateOf(now),-90),technicalCutoff=Date.parse(now)-7*86400000;
 const groups:Record<string,Record<string,Record<string,unknown>>>={};
 function move(month:string,section:string,key:string,value:unknown):void{
  groups[month]??={};groups[month][section]??={};groups[month][section][key]=value;
 }
 const oldIds=new Set(Object.values(state.events).filter(e=>e.localDate<cutoff&&!Object.values(state.notifications).some(n=>n.eventId===e.eventId&&['pending','retry','sending','uncertain'].includes(n.status))).map(e=>e.eventId));
 for(const id of oldIds){const e=state.events[id];move(e.localDate.slice(0,7),'events',id,e);delete state.events[id];}
 for(const [key,p]of Object.entries(state.participation))if(oldIds.has(p.eventId)){move(input.events[p.eventId].localDate.slice(0,7),'participation',key,p);delete state.participation[key];}
 for(const [key,n]of Object.entries(state.notifications)){
  if((n.eventId&&oldIds.has(n.eventId))||(['sent','cancelled'].includes(n.status)&&n.dueAt.slice(0,10)<cutoff)){
   move((n.eventId?input.events[n.eventId]?.localDate:n.sentAt??n.dueAt)?.slice(0,7)??n.dueAt.slice(0,7),'notifications',key,n);delete state.notifications[key];
  }
 }
 state.operations=state.operations.filter(o=>{if(o.at.slice(0,10)>=cutoff)return true;move(o.at.slice(0,7),'operations',o.operationId,o);return false;});
 for(const [id,at]of Object.entries(state.processedUpdates))if(Date.parse(at)<technicalCutoff){move(at.slice(0,7),'processedUpdates',id,at);delete state.processedUpdates[id];}
 const writes=Object.entries(groups).map(([month,data])=>({path:'archive/'+month.replace('-','/')+'/state-'+state.stateVersion+'.json',content:JSON.stringify(data)}));
 state.archives=Array.from(new Set([...(state.archives??[]),...writes.map(w=>w.path)]));
 state.lastArchiveAt=now;
 return {state,writes};
}
