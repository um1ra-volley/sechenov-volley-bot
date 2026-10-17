import type { State, User } from './model.ts';
export function eventStats(state:State,eventId:string,_now:string):{yes:User[];no:User[];unanswered:User[];reconfirm:User[]} {
 const event=state.events[eventId];if(!event)throw new Error('Игра не найдена');
 const result:{yes:User[];no:User[];unanswered:User[];reconfirm:User[]}={yes:[],no:[],unanswered:[],reconfirm:[]};
 for(const user of Object.values(state.users)){
  if(user.accessStatus!=='approved'||!(state.subscriptions[user.telegramUserId]??[]).includes(event.scope))continue;
  const p=state.participation[eventId+':'+user.telegramUserId];
  if(p?.answer&&p.attendanceRevision!==event.attendanceRevision)result.reconfirm.push(user);
  else if(p?.answer==='yes')result.yes.push(user);
  else if(p?.answer==='no')result.no.push(user);
  else result.unanswered.push(user);
 }
 for(const list of Object.values(result))list.sort((a,b)=>a.fullName.localeCompare(b.fullName,'ru'));
 return result;
}
