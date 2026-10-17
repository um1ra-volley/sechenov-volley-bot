import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
import {applyCommand} from '../src/application/commands.ts';
import {generateTrainings} from '../src/core/training.ts';
const bot=await import('../src/application/bot.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z';let sequence=100;
class Repository{
 constructor(s){this.state=s}
 read(){return structuredClone(this.state)}
 transact(command,expected){if(expected&&(expected.id!==this.state.runtime.id||expected.epoch!==this.state.runtime.epoch))throw new Error('Неактивная среда');const r=applyCommand(this.state,command,now);this.state=r.state;return r}
}
function fixture(empty=false){
 const s=createState('gas-primary',1);
 if(!empty)for(const id of ['1','2','3']){
  s.users[id]={telegramUserId:id,privateChatId:id,fullName:id==='1'?'Владелец Команды':id==='2'?'Игрок Два':'Игрок Три',role:id==='1'?'owner':'member',accessStatus:'approved',stage:'ready',registeredAt:now,deliveryStatus:'active'};
  s.subscriptions[id]=id==='1'?[]:['MSSI','TRAINING'];
 }
 s.events.G={eventId:'G',sourceKey:'MSSI',scope:'MSSI',kind:'game',team:'Сеченовский университет',opponent:'МФТИ',localDate:'2026-10-18',startAtUtc:'2026-10-18T14:00:00.000Z',venue:'Зал',status:'scheduled',revision:1,attendanceRevision:1};
 s.events.N={...s.events.G,eventId:'N',opponent:'ГУЗ',localDate:'2026-10-26',startAtUtc:'2026-10-26T16:30:00.000Z'};
 for(const event of generateTrainings(now,1,[]))s.events[event.eventId]=event;
 const messages=[],repository=new Repository(s);
 return {repository,messages,clock:{now:()=>now},ownerSetupSecret:'synthetic-owner-once',transport:{send(m){messages.push(structuredClone(m));return String(messages.length)},edit(m){messages.push(structuredClone(m))},acknowledge(){}},sync(){}};
}
function message(user,text){const id=++sequence;return {update_id:id,message:{message_id:id,from:{id:Number(user),is_bot:false,first_name:'Тест'},chat:{id:Number(user),type:'private'},text}}}
function callback(user,data){const id=++sequence;return {update_id:id,callback_query:{id:'query-'+id,from:{id:Number(user),is_bot:false,first_name:'Тест'},message:{message_id:50,chat:{id:Number(user),type:'private'}},data}}}
function run(d,update){assert.equal(typeof bot.handleUpdate,'function','Telegram command handler missing');return bot.handleUpdate(update,d)}
const last=d=>d.messages.at(-1)?.text??'';
test('registration collects FIO and multiple scopes, then waits for owner approval',()=>{
 const d=fixture(true);run(d,message('2','/start'));run(d,message('2','Иван Иванов'));run(d,callback('2','sub|MSSI|1'));run(d,callback('2','sub|TRAINING|1'));run(d,callback('2','finish'));
 assert.equal(d.repository.state.users['2'].fullName,'Иван Иванов');assert.deepEqual(d.repository.state.subscriptions['2'],['MSSI','TRAINING']);
 assert.equal(d.repository.state.users['2'].accessStatus,'pending');assert.match(last(d),/подтверждени|заявк/i);
});
test('owner enrollment requires explicit one-time setup secret and never stores it in user data',()=>{
 const d=fixture(true);run(d,message('2','/start'));run(d,message('1','/start synthetic-owner-once'));run(d,message('3','/start synthetic-owner-once'));
 assert.equal(d.repository.state.users['2'].role,'member');assert.equal(d.repository.state.users['1'].role,'owner');assert.equal(d.repository.state.users['3'].role,'member');
 assert.equal(JSON.stringify(d.repository.state).includes('synthetic-owner-once'),false);
});
test('pending participant cannot read league schedule',()=>{
 const d=fixture(true);run(d,message('2','/start'));run(d,message('2','Игрок Два'));run(d,callback('2','list|week|0'));
 assert.equal(last(d).includes('МФТИ'),false);
});
test('repeat start retains registered name and subscriptions',()=>{
 const d=fixture();run(d,message('2','/start'));assert.equal(d.repository.state.users['2'].fullName,'Игрок Два');assert.deepEqual(d.repository.state.subscriptions['2'],['MSSI','TRAINING']);
});
test('change FIO edits existing profile without resetting leagues',()=>{
 const d=fixture();run(d,callback('2','name'));run(d,message('2','Новое Имя'));
 assert.equal(d.repository.state.users['2'].fullName,'Новое Имя');assert.equal(d.repository.state.users['2'].stage,'ready');assert.deepEqual(d.repository.state.subscriptions['2'],['MSSI','TRAINING']);
});
test('week and month cards show league Russian weekday date and countdown',()=>{
 const d=fixture();run(d,callback('2','list|week|0'));assert.match(last(d),/МССИ/);assert.match(last(d),/воскресенье, 18\.10\.26/);assert.match(last(d),/завтра/);assert.equal(last(d).includes('ГУЗ'),false);
 run(d,callback('2','list|month|0'));assert.match(last(d),/ГУЗ/);assert.match(last(d),/понедельник, 26\.10\.26/);
});
test('personal RSVP saves refusal under actual Telegram ID',()=>{
 const d=fixture();run(d,callback('2','r|G|1|n'));
 assert.equal(d.repository.state.participation['G:2'].answer,'no');assert.match(last(d),/Не буду/);
});
test('extra target in personal callback cannot answer on behalf of somebody else',()=>{
 const d=fixture();run(d,callback('2','r|G|1|n|3'));assert.equal(Object.keys(d.repository.state.participation).length,0);
});
test('stale attendance button returns current card without applying old answer',()=>{
 const d=fixture();d.repository.state.events.G.attendanceRevision=2;d.repository.state.events.G.revision=2;
 run(d,callback('2','r|G|1|y'));assert.equal(d.repository.state.participation['G:2'],undefined);assert.match(last(d),/измен|устар/i);
 assert.ok(d.messages.at(-1).buttons.flat().some(b=>b.data==='r|G|2|y'));
});
test('ordinary member cannot open administrative named statistics',()=>{
 const d=fixture();run(d,callback('2','s|G'));assert.match(last(d),/доступ|владел/i);assert.equal(last(d).includes('Игрок Три'),false);
});
test('owner lists unanswered names and manually marks absent with audit identity',()=>{
 const d=fixture();run(d,callback('1','sl|G|unanswered|0'));assert.match(last(d),/Игрок Два/);assert.match(last(d),/Игрок Три/);
 run(d,callback('1','m|G|2|1|n'));assert.equal(d.repository.state.participation['G:2'].answer,'no');assert.equal(d.repository.state.participation['G:2'].answerSource,'admin');
 run(d,callback('1','sl|G|no|0'));assert.match(last(d),/Игрок Два/);assert.equal(last(d).includes('Игрок Три'),false);
 run(d,callback('1','admin|history|0'));assert.match(last(d),/Владелец Команды/);
});
test('owner approves applicant and participant receives menu',()=>{
 const d=fixture();d.repository.state.users['2'].accessStatus='pending';run(d,callback('1','access|2|approve'));
 assert.equal(d.repository.state.users['2'].accessStatus,'approved');assert.ok(d.messages.some(m=>m.chatId==='2'&&m.text.includes('подтвержд')));
});
test('training cancellation preserves future Thursday in series',()=>{
 const d=fixture();run(d,callback('1','tc|TRAINING-2026-10-19'));
 assert.equal(d.repository.state.events['TRAINING-2026-10-19'].status,'cancelled');assert.equal(d.repository.state.events['TRAINING-2026-10-22'].status,'scheduled');
});
test('owner can move one training by entering full date and Moscow time',()=>{
 const d=fixture();run(d,callback('1','tm|TRAINING-2026-10-19'));run(d,message('1','20.10.2026 18:00'));
 const event=d.repository.state.events['TRAINING-2026-10-19'];assert.equal(event.localDate,'2026-10-20');assert.equal(event.startAtUtc,'2026-10-20T15:00:00.000Z');assert.equal(event.attendanceRevision,2);
});
test('stop disables selected leagues and training notifications together',()=>{
 const d=fixture();run(d,callback('2','stop'));assert.deepEqual(d.repository.state.subscriptions['2'],[]);
});
test('same Telegram update does not repeat response or operation',()=>{
 const d=fixture(),update=callback('2','r|G|1|y');run(d,update);const before=structuredClone(d.repository.state);const count=d.messages.length;
 run(d,update);assert.equal(d.repository.state.operations.length,before.operations.length);assert.equal(d.messages.length,count);
});
test('group chat updates do not create profiles or disclose scheduling',()=>{
 const d=fixture(true),update=message('2','/start');update.message.chat={id:-100,type:'group'};const result=run(d,update);
 assert.equal(result.accepted,false);assert.equal(Object.keys(d.repository.state.users).length,0);assert.equal(d.messages.length,0);
});
test('old queued name prompt is cancelled when user submits FIO',()=>{
 const d=fixture();d.repository.state.users['2'].stage='name';d.repository.state.users['2'].fullName='';
 d.repository.state.notifications.old={notificationId:'old',userId:'2',type:'ui',dueAt:now,status:'pending',attempts:0,message:{chatId:'2',text:'Старый вопрос: введите ФИО'}};
 run(d,message('2','Новое Имя'));assert.equal(d.repository.state.notifications.old.status,'cancelled');assert.equal(d.messages.some(m=>m.text.includes('Старый вопрос')),false);
});

test('owner bootstrap promotes an existing profile once and preserves their registration',()=>{
 const d=fixture(true);
 run(d,message('1','/start'));run(d,message('1','Владелец Команды'));run(d,callback('1','sub|MSSI|1'));run(d,callback('1','finish'));
 assert.equal(d.repository.state.users['1'].role,'member');
 run(d,message('1','/start synthetic-owner-once'));
 assert.equal(d.repository.state.users['1'].role,'owner');assert.equal(d.repository.state.users['1'].accessStatus,'approved');
 assert.equal(d.repository.state.users['1'].fullName,'Владелец Команды');assert.deepEqual(d.repository.state.subscriptions['1'],['MSSI']);
 assert.ok(d.messages.at(-1).buttons.flat().some(b=>b.data==='admin|events|0'));
 run(d,message('2','/start synthetic-owner-once'));assert.equal(d.repository.state.users['2'].role,'member');
});
