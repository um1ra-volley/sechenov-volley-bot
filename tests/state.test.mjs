import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/core/state.ts';
const commands=await import('../src/application/commands.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const attendance=await import('../src/core/attendance.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z';
let serial=0;
const command=(type,actorId,data={},extra={})=>({type,actorId,data,operationId:'test-'+(++serial),...extra});
const apply=(s,c)=>{assert.equal(typeof commands.applyCommand,'function','state reducer not implemented');return commands.applyCommand(s,c,now)};
function start(s,id,owner=false){return apply(s,command('START',id,{chatId:id,bootstrapOwner:owner})).state}
function name(s,id,value){return apply(s,command('SET_NAME',id,{fullName:value})).state}
function ready(){
 let s=createState('gas-primary',1);s=start(s,'1',true);s=name(s,'1','Владелец Команды');
 s=start(s,'2');s=name(s,'2','Игрок Второй');
 s=apply(s,command('SET_SCOPE','2',{scope:'MSSI',enabled:true})).state;
 s=apply(s,command('FINISH_REGISTRATION','2')).state;
 s=apply(s,command('APPROVE','1',{userId:'2'})).state;
 s.events.G={eventId:'G',sourceKey:'MSSI',scope:'MSSI',kind:'game',team:'Сеченовский университет',opponent:'ГУЗ',localDate:'2026-10-26',startAtUtc:'2026-10-26T16:30:00.000Z',venue:'Зал',status:'scheduled',revision:1,attendanceRevision:1};
 return s;
}
test('first ordinary start never becomes administrator',()=>{
 const s=start(createState('gas-primary',1),'2');assert.equal(s.users['2'].role,'member');assert.equal(s.users['2'].accessStatus,'pending');
});
test('owner bootstrap is single-use even if another start carries owner flag',()=>{
 let s=start(createState('gas-primary',1),'1',true);s=start(s,'2',true);
 assert.equal(s.users['1'].role,'owner');assert.equal(s.users['2'].role,'member');
});
test('same FIO for different Telegram IDs creates separate users',()=>{
 let s=start(createState('gas-primary',1),'1');s=name(s,'1','Иван Иванов');
 s=start(s,'2');s=name(s,'2','Иван Иванов');
 assert.equal(Object.keys(s.users).length,2);
});
test('repeat start preserves the existing name and subscription',()=>{
 let s=ready();s=start(s,'2');assert.equal(s.users['2'].fullName,'Игрок Второй');assert.deepEqual(s.subscriptions['2'],['MSSI']);
});
test('FIO validation rejects empty text and normalizes whitespace',()=>{
 let s=start(createState('gas-primary',1),'2');assert.throws(()=>apply(s,command('SET_NAME','2',{fullName:'  '})),/ФИО/);
 s=name(s,'2','  Иван   Иванов  ');assert.equal(s.users['2'].fullName,'Иван Иванов');
});
test('non-owner cannot approve another participant',()=>{
 const s=ready();assert.throws(()=>apply(s,command('APPROVE','2',{userId:'3'})),/доступ|прав/i);
});
test('RSVP changes one personal row, unanswered is not a refusal',()=>{
 let s=ready();
 s=apply(s,command('RSVP','2',{eventId:'G',revision:1,answer:'yes'})).state;
 s=apply(s,command('RSVP','2',{eventId:'G',revision:1,answer:'no'})).state;
 assert.equal(Object.keys(s.participation).length,1);assert.equal(s.participation['G:2'].answer,'no');
 assert.equal(attendance.eventStats?.(s,'G',now)?.no[0].fullName,'Игрок Второй');
});
test('statistics lists subscribed unanswered users by name',()=>{
 const s=ready();const result=attendance.eventStats?.(s,'G',now);
 assert.deepEqual(result?.unanswered.map(u=>u.telegramUserId),['2']);
 assert.deepEqual(result?.no,[]);
});
test('manual absent mark records administrator instead of pretending player voted',()=>{
 let s=ready();s=apply(s,command('RSVP','1',{eventId:'G',revision:1,answer:'no',userId:'2'})).state;
 assert.equal(s.participation['G:2'].answerSource,'admin');
 assert.equal(s.operations.at(-1).actorId,'1');
});
test('stale revision and unauthorized target cannot overwrite participation',()=>{
 const s=ready();assert.throws(()=>apply(s,command('RSVP','2',{eventId:'G',revision:0,answer:'yes'})),/верси|перенес|устар/i);
 assert.throws(()=>apply(s,command('RSVP','2',{eventId:'G',revision:1,answer:'yes',userId:'1'})),/доступ|прав/i);
 assert.equal(Object.keys(s.participation).length,0);
});
test('repeated update does not repeat a mutation or operation record',()=>{
 const s=ready(),cmd=command('RSVP','2',{eventId:'G',revision:1,answer:'yes'},{updateId:'500'});
 const first=apply(s,cmd);const again=apply(first.state,cmd);
 assert.equal(again.duplicate,true);assert.equal(again.state.stateVersion,first.state.stateVersion);
 assert.equal(again.state.operations.length,first.state.operations.length);
});
test('unsubscribed or started event refuses new RSVP',()=>{
 let s=ready();s=apply(s,command('SET_SCOPE','2',{scope:'MSSI',enabled:false})).state;
 assert.throws(()=>apply(s,command('RSVP','2',{eventId:'G',revision:1,answer:'yes'})),/подпис/i);
 s=ready();s.events.G.startAtUtc='2026-10-17T08:00:00.000Z';
 assert.throws(()=>apply(s,command('RSVP','2',{eventId:'G',revision:1,answer:'yes'})),/начал|заверш/i);
});
test('UI confirmations are queued durably with command state',()=>{
 const s=ready();const c=command('RSVP','2',{eventId:'G',revision:1,answer:'yes'});
 c.effects=[{kind:'send',chatId:'2',userId:'2',text:'Ответ сохранён'}];
 const result=apply(s,c);
 assert.equal(Object.values(result.state.notifications)[0].message.text,'Ответ сохранён');
 assert.equal(result.state.participation['G:2'].answer,'yes');
});
