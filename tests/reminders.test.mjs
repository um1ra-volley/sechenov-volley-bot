import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
import {applyCommand} from '../src/application/commands.ts';
const reminders=await import('../src/core/reminders.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const jobs=await import('../src/application/jobs.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const telegram=await import('../src/adapters/telegram/transport.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const week='2026-10-19T16:30:00.000Z',day='2026-10-25T16:30:00.000Z';
function fixture(){
 const s=createState('gas-primary',1);
 for(const id of ['2','3']){s.users[id]={telegramUserId:id,privateChatId:id,fullName:'Игрок '+id,role:'member',accessStatus:'approved',stage:'ready',registeredAt:week,deliveryStatus:'active'};s.subscriptions[id]=['MSSI'];}
 s.events.G={eventId:'G',sourceKey:'MSSI',scope:'MSSI',kind:'game',team:'Сеченовский университет',opponent:'ГУЗ',localDate:'2026-10-26',startAtUtc:'2026-10-26T16:30:00.000Z',venue:'Зал',status:'scheduled',revision:1,attendanceRevision:1};
 return s;
}
function plan(s,now){assert.equal(typeof reminders.planNotifications,'function','notification planner missing');return reminders.planNotifications(s,now)}
function notifications(s){return Object.values(s.notifications).filter(n=>n.status!=='cancelled')}
function answer(s,id,value,at=week){s.participation['G:'+id]={eventId:'G',telegramUserId:id,attendanceRevision:1,answer:value,invitedAt:week,firstPollSentAt:at,pollRevision:1,answeredAt:value?week:null,answerSource:value?'user':null};}
function previousPoll(s,id,at=week){
 answer(s,id,null,at);s.notifications['old-'+id]={notificationId:'old-'+id,eventId:'G',userId:id,scope:'MSSI',revision:1,attendanceRevision:1,type:'poll',fulfills:['poll'],dueAt:at,status:'sent',attempts:1,message:{chatId:id,text:'Вопрос'},sentAt:at};
}
class Repository {
 constructor(state,now){this.state=state;this.now=now;this.serial=0}
 read(){return structuredClone(this.state)}
 transact(c,expected){if(expected&&(expected.epoch!==this.state.runtime.epoch||expected.id!==this.state.runtime.id)||this.state.runtime.paused)throw new Error('Неактивная среда');const result=applyCommand(this.state,c,this.now);this.state=result.state;return result}
}
function deliver(repo,transport){assert.equal(typeof jobs.deliverDue,'function','delivery worker missing');return jobs.deliverDue(repo,transport,repo.now,10)}
test('seven-day poll is created once per subscribed user with personal buttons',()=>{
 let s=plan(fixture(),week);assert.equal(notifications(s).length,2);
 assert.ok(notifications(s).every(n=>n.fulfills.includes('poll')&&n.message.buttons[0][0].data.includes('G')));
 s=plan(s,week);assert.equal(notifications(s).length,2);
});
test('one follow-up is sent only to unanswered users 24 hours after real first poll',()=>{
 let s=fixture();previousPoll(s,'2');previousPoll(s,'3');answer(s,'2','no');
 s=plan(s,'2026-10-20T16:30:00.000Z');
 const extra=notifications(s).filter(n=>n.status==='pending');assert.deepEqual(extra.map(n=>n.userId),['3']);assert.ok(extra[0].fulfills.includes('followup'));
 s=plan(s,'2026-10-21T16:30:00.000Z');assert.equal(notifications(s).filter(n=>n.fulfills.includes('followup')).length,1);
});
test('day-before reminder includes both yes and no answers',()=>{
 let s=fixture();previousPoll(s,'2');previousPoll(s,'3');answer(s,'2','yes');answer(s,'3','no');s=plan(s,day);
 assert.deepEqual(notifications(s).filter(n=>n.fulfills.includes('day')).map(n=>n.userId).sort(),['2','3']);
});
test('late subscription combines first poll and day reminder instead of two messages',()=>{
 const s=plan(fixture(),'2026-10-26T10:00:00.000Z');
 assert.equal(notifications(s).length,2);assert.ok(notifications(s).every(n=>n.fulfills.includes('poll')&&n.fulfills.includes('day')));
});
test('coincident unanswered follow-up and day reminder become one message',()=>{
 let s=fixture();previousPoll(s,'2','2026-10-24T16:30:00.000Z');previousPoll(s,'3','2026-10-24T16:30:00.000Z');s=plan(s,day);
 const pending=notifications(s).filter(n=>n.status==='pending');assert.equal(pending.length,2);assert.ok(pending.every(n=>n.fulfills.includes('day')&&n.fulfills.includes('followup')));
});
test('date-only event uses previous calendar day at Moscow noon',()=>{
 let s=fixture();s.events.G.startAtUtc=null;s=plan(s,'2026-10-25T08:59:00.000Z');
 assert.equal(notifications(s).filter(n=>n.fulfills.includes('day')).length,0);
 s=plan(s,'2026-10-25T09:00:00.000Z');
 assert.equal(notifications(s).filter(n=>n.fulfills.includes('day')).length,2);
 assert.ok(notifications(s).at(-1).message.text.includes('не указано'));
});
test('cancelled subscription and started event invalidate pending polls',()=>{
 let s=plan(fixture(),week);s.subscriptions['2']=[];s=plan(s,week);
 assert.equal(notifications(s).filter(n=>n.userId==='2').length,0);
 s=plan(s,'2026-10-26T16:30:00.000Z');assert.equal(notifications(s).length,0);
});
test('same scheduling policy covers training subscription independently of leagues',()=>{
 let s=fixture();s.events.G={...s.events.G,scope:'TRAINING',kind:'training',venue:'Буревестник',opponent:''};s.subscriptions['2']=['TRAINING'];s.subscriptions['3']=['MSSI'];s=plan(s,week);
 assert.deepEqual(notifications(s).map(n=>n.userId),['2']);assert.ok(notifications(s)[0].message.text.includes('Буревестник'));
});
test('transfer notification merges renewed poll and retains previous answer in history',()=>{
 let s=fixture();previousPoll(s,'2');answer(s,'2','yes');const old=structuredClone(s.events.G);
 s.events.G={...old,localDate:'2026-10-25',startAtUtc:'2026-10-25T16:30:00.000Z',revision:2,attendanceRevision:2};
 s.operations.push({operationId:'change-G-2',action:'EVENT_CHANGED',targetId:'G',previous:old,next:s.events.G,at:week,result:'ok'});
 s=plan(s,week);const change=notifications(s).filter(n=>n.status==='pending'&&n.userId==='2');
 assert.equal(change.length,1);assert.ok(change[0].fulfills.includes('change'));assert.ok(change[0].fulfills.includes('poll'));
 assert.equal(s.participation['G:2'].answer,'yes');assert.equal(s.participation['G:2'].attendanceRevision,1);
});
test('successful delivery persists message receipt and real poll delivery time',()=>{
 const repo=new Repository(plan(fixture(),week),week);let id=10;
 deliver(repo,{send:()=>String(++id),edit:()=>{},acknowledge:()=>{}});
 assert.ok(Object.values(repo.state.notifications).every(n=>n.status==='sent'&&n.messageId));
 assert.equal(repo.state.participation['G:2'].firstPollSentAt,week);
});
test('uncertain delivery is held and never automatically retried',()=>{
 const repo=new Repository(plan(fixture(),week),week);
 const transport={send(){assert.equal(typeof telegram.TelegramError,'function','Telegram error classification missing');throw new telegram.TelegramError(0,0,true)},edit(){},acknowledge(){}};
 deliver(repo,transport);assert.ok(Object.values(repo.state.notifications).every(n=>n.status==='uncertain'&&n.attempts===1));
 deliver(repo,transport);assert.ok(Object.values(repo.state.notifications).every(n=>n.status==='uncertain'&&n.attempts===1));
});
test('Telegram 429 uses retry_after without sleeping or losing pending work',()=>{
 const repo=new Repository(plan(fixture(),week),week);
 deliver(repo,{send(){assert.equal(typeof telegram.TelegramError,'function');throw new telegram.TelegramError(429,60,false)},edit(){},acknowledge(){}});
 assert.ok(Object.values(repo.state.notifications).every(n=>n.status==='retry'&&n.nextAttemptAt==='2026-10-19T16:31:00.000Z'));
});
test('expired sending lease becomes uncertain rather than repeated',()=>{
 const s=plan(fixture(),week);for(const n of Object.values(s.notifications)){n.status='sending';n.sendingAt='2026-10-19T16:20:00.000Z';n.attempts=1}
 const repo=new Repository(s,week);deliver(repo,{send(){throw new Error('Should not send lease recovery')},edit(){},acknowledge(){}});
 assert.ok(Object.values(repo.state.notifications).every(n=>n.status==='uncertain'));
});
test('Telegram transport encodes callback payload and does not expose token on timeout',()=>{
 assert.equal(typeof telegram.TelegramApiTransport,'function','Telegram transport missing');
 let captured;
 const transport=new telegram.TelegramApiTransport({http:{request(method,url,body){captured=body;return {status:200,body:JSON.stringify({ok:true,result:{message_id:123}}),headers:{}}}},token:'synthetic-token'});
 assert.equal(transport.send({chatId:'2',text:'Игра',buttons:[[{text:'Буду',data:'r|G|1|y'}]]}),'123');
 assert.equal(captured.reply_markup.inline_keyboard[0][0].callback_data,'r|G|1|y');
 const failed=new telegram.TelegramApiTransport({http:{request(){throw new Error('synthetic-token in low-level error')}},token:'synthetic-token'});
 assert.throws(()=>failed.send({chatId:'2',text:'Игра'}),e=>e.uncertain===true&&!e.message.includes('synthetic-token'));
});
