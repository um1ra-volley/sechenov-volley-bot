import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
import {applyCommand} from '../src/application/commands.ts';
import {eventList,history} from '../src/application/ui.ts';
const archive=await import('../src/core/archive.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z';
function fixture(){
 const s=createState('gas-primary',1);for(const id of ['1','2']){s.users[id]={telegramUserId:id,privateChatId:id,fullName:id==='1'?'Владелец Команды':'Игрок Два',role:id==='1'?'owner':'member',accessStatus:'approved',stage:'ready',registeredAt:now,deliveryStatus:'active'};s.subscriptions[id]=['MSSI','TRAINING'];}
 s.events.G={eventId:'G',sourceKey:'MSSI',scope:'MSSI',kind:'game',team:'Сеченовский университет',opponent:'МФТИ',localDate:'2026-10-18',startAtUtc:'2026-10-18T14:00:00.000Z',venue:'Зал',status:'scheduled',revision:1,attendanceRevision:1};return s;
}
test('stale-source menu clearly shows last verification in Moscow time',()=>{
 const s=fixture();s.sourceState.MSSI={missing:{},lastSuccessAt:now,lastError:'Источник недоступен'};
 const output=eventList(s,s.users['2'],'week',0,now);
 assert.match(output.text,/проверк|проверен/i);assert.match(output.text,/17\.10\.26/);assert.match(output.text,/12:00/);
});
test('training move at Moscow 00:30 may have previous UTC date',()=>{
 const s=fixture();s.events.T={...s.events.G,eventId:'T',sourceKey:'TRAINING',scope:'TRAINING',kind:'training'};
 const r=applyCommand(s,{type:'TRAINING_EXCEPTION',operationId:'move-midnight',actorId:'1',data:{eventId:'T',action:'move',localDate:'2026-10-20',startAtUtc:'2026-10-19T21:30:00.000Z'}},now);
 assert.equal(r.state.events.T.localDate,'2026-10-20');assert.equal(r.state.events.T.startAtUtc,'2026-10-19T21:30:00.000Z');
});
test('owner may correct past declared answer while participant cannot submit late RSVP',()=>{
 const s=fixture();s.events.G.startAtUtc='2026-10-17T08:00:00.000Z';
 assert.throws(()=>applyCommand(s,{type:'RSVP',operationId:'member-late',actorId:'2',data:{eventId:'G',revision:1,answer:'yes'}},now),/начал|заверш/i);
 const r=applyCommand(s,{type:'RSVP',operationId:'owner-correct',actorId:'1',data:{eventId:'G',userId:'2',revision:1,answer:'no'}},now);
 assert.equal(r.state.participation['G:2'].answerSource,'admin');
});
test('named audit history shows actor target and declared new answer',()=>{
 let s=fixture();s=applyCommand(s,{type:'RSVP',operationId:'manual-no',actorId:'1',data:{eventId:'G',userId:'2',revision:1,answer:'no'}},now).state;
 const output=history(s,s.users['1'],0);assert.match(output.text,/Владелец Команды/);assert.match(output.text,/Игрок Два/);assert.match(output.text,/Не будет|Не буду/);
});
test('old finished data is archived in GitHub write set without removing users or future games',()=>{
 assert.equal(typeof archive.archiveState,'function','GitHub archive transform missing');
 const s=fixture();s.events.OLD={...s.events.G,eventId:'OLD',localDate:'2026-03-01',startAtUtc:'2026-03-01T14:00:00.000Z',status:'played'};
 s.participation['OLD:2']={eventId:'OLD',telegramUserId:'2',attendanceRevision:1,answer:'no',invitedAt:'2026-02-22T09:00:00.000Z',firstPollSentAt:null,answeredAt:'2026-02-23T09:00:00.000Z',answerSource:'user'};
 const result=archive.archiveState(s,now);
 assert.equal(result.state.events.OLD,undefined);assert.ok(result.state.events.G);assert.ok(result.state.users['2']);assert.equal(result.state.participation['OLD:2'],undefined);
 const file=result.writes.find(f=>f.path.startsWith('archive/2026/03/'));assert.ok(file);const saved=JSON.parse(file.content);assert.equal(saved.events.OLD.eventId,'OLD');assert.equal(saved.participation['OLD:2'].answer,'no');
 assert.ok(result.state.archives.includes(file.path));assert.ok(s.events.OLD);
});

for(const action of ['cancel','move'])test('scheduled tick retains a concurrent owner training '+action,async()=>{
 const {handleTick}=await import('../src/application/jobs.ts'),{generateTrainings}=await import('../src/core/training.ts');
 const repository={state:fixture(),read(){return structuredClone(this.state)},transact(c){
  if(action==='move'&&c.type==='SYNC_SOURCES'&&!interleaved){interleaved=true;this.state=applyCommand(this.state,exception,now).state;}
  const result=applyCommand(this.state,c,now);this.state=result.state;return result;
 }};
 let interleaved=false;const event=generateTrainings(now,1,[])[0];repository.state.events[event.eventId]=event;
 const exception={type:'TRAINING_EXCEPTION',operationId:'owner-concurrent-'+action,actorId:'1',data:{eventId:event.eventId,action,localDate:'2026-10-20',startAtUtc:'2026-10-20T16:30:00.000Z'}};
 handleTick({repository,clock:{now:()=>now},source:{readEvents(){
  if(action==='cancel'){repository.state=applyCommand(repository.state,exception,now).state;interleaved=true;}return [];
 }},transport:{send:()=> '100',edit(){},acknowledge(){}}});
 const saved=repository.state.events[event.eventId];assert.equal(saved.status,action==='cancel'?'cancelled':'postponed');assert.equal(saved.revision,2);
 if(action==='move')assert.equal(saved.localDate,'2026-10-20');
});
test('archived games remain archived across source sync and an explicit future restoration starts a new revision',async()=>{
 const {synchronize}=await import('../src/core/schedule.ts');
 const s=fixture(),old={...s.events.G,eventId:'OLD',localDate:'2026-03-01',startAtUtc:'2026-03-01T14:00:00.000Z',status:'played',revision:4,attendanceRevision:3};s.events.OLD=old;
 s.participation['OLD:2']={eventId:'OLD',telegramUserId:'2',attendanceRevision:3,answer:'no',invitedAt:'2026-02-22T09:00:00.000Z',firstPollSentAt:null,answeredAt:'2026-02-23T09:00:00.000Z',answerSource:'user'};
 const archived=archive.archiveState(s,now);let current=archived.state;
 for(let i=0;i<3;i++)current=synchronize(current,[{sourceId:'MSSI',ok:true,events:[{...old,revision:1,attendanceRevision:1},s.events.G],observedAt:now}],now);
 assert.equal(current.events.OLD,undefined);
 const repeated=archive.archiveState(current,now);assert.equal(repeated.writes.length,0);
 assert.equal(JSON.parse(archived.writes.find(w=>w.path.includes('/03/')).content).participation['OLD:2'].answer,'no');
 const future={...old,status:'postponed',localDate:'2026-10-26',startAtUtc:'2026-10-26T16:30:00.000Z',revision:1,attendanceRevision:1};
 current=synchronize(current,[{sourceId:'MSSI',ok:true,events:[future,s.events.G],observedAt:now}],now);
 assert.equal(current.events.OLD.localDate,'2026-10-26');assert.equal(current.events.OLD.revision,5);assert.equal(current.events.OLD.attendanceRevision,4);
 assert.equal(current.participation['OLD:2'],undefined);
});
