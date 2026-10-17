import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
import {eventStats} from '../src/core/attendance.ts';
const source=await import('../src/adapters/google-sheets/source.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const schedule=await import('../src/core/schedule.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z';
const header=['ID игры','Дата','Время, МСК','Соперник','Место / адрес','Статус'];
const event=(id,date='2026-10-26',venue='Зал')=>({eventId:id,sourceKey:'MSSI',scope:'MSSI',kind:'game',team:'Сеченовский университет',opponent:'ГУЗ',localDate:date,startAtUtc:date+'T16:30:00.000Z',venue,status:'scheduled',revision:1,attendanceRevision:1});
function normalize(rows,scope='MSSI'){assert.equal(typeof source.normalizeOwnRows,'function','sheet normalizer missing');return source.normalizeOwnRows(rows,scope)}
function sync(state,events,at=now,ok=true){assert.equal(typeof schedule.synchronize,'function','schedule synchronizer missing');return schedule.synchronize(state,[{sourceId:'MSSI',ok,events,observedAt:at,error:ok?undefined:'Недоступен источник'}],at)}
test('own rows preserve full year, missing time and user CITY/BJORN dates',()=>{
 const rows=[header,['LVL-002','05.11.2026','','CITY','','В расписании'],['LVL-006','05.12.2026','20:00:00','SV BJORN','Буревестник','Перенос']];
 const events=normalize(rows,'LVL');
 assert.deepEqual(events.map(e=>[e.localDate,e.startAtUtc]),[['2026-11-05',null],['2026-12-05','2026-12-05T17:00:00.000Z']]);
 assert.equal(events[1].status,'postponed');
});
test('two LCHB matches remain separate and use Rosenergoatom team',()=>{
 const events=normalize([header,['LCHB-003','17.10.2026','14:00','ЛАНИТ','Площадка № 2','В расписании'],['LCHB-004','17.10.2026','16:00','СИСТЕМНЫЙ ОПЕРАТОР','Площадка № 1','В расписании']],'LCHB');
 assert.deepEqual(events.map(e=>[e.eventId,e.startAtUtc,e.team]),[['LCHB-003','2026-10-17T11:00:00.000Z','Росэнергоатом'],['LCHB-004','2026-10-17T13:00:00.000Z','Росэнергоатом']]);
});
test('source rejects duplicate IDs, broken dates and data row without ID',()=>{
 assert.throws(()=>normalize([header,['MSSI-1','31.02.2026','','Команда','','В расписании']]),/дат/i);
 assert.throws(()=>normalize([header,['','26.10.2026','','Команда','','В расписании']]),/ID/i);
 assert.throws(()=>normalize([header,['MSSI-1','26.10.2026','','А','','В расписании'],['MSSI-1','27.10.2026','','Б','','В расписании']]),/ID|дублик/i);
});
const chm=(id,date,home,away,transfer='')=>{const r=Array(19).fill('');r[0]=id;r[3]='1';r[4]=date;r[5]=transfer;r[6]='11:45';r[7]='Алабяна 13к1';r[8]=home;r[18]=away;return r};
function championship(rows){assert.equal(typeof source.normalizeChampionshipRows,'function','championship normalizer missing');return source.normalizeChampionshipRows(rows,'2026/2027')}
test('CHM filters exact team in either home or away instead of all university names',()=>{
 const events=championship([['Чемпионат сезон 2026/2027'],chm('41','24 октября','Сеченовский Университет','СШ Москва 98'),chm('50','6 декабря','Московский Метрополитен',' сеченовский   университет '),chm('60','20 декабря','Другой университет','Первый ДСК')]);
 assert.deepEqual(events.map(e=>[e.eventId,e.opponent]),[['CHM-2026-2027-41','СШ Москва 98'],['CHM-2026-2027-50','Московский Метрополитен']]);
});
test('CHM January belongs to next season year and transfer replaces original date',()=>{
 const e=championship([chm('70','5 января','Сеченовский университет','Соперник','8 января')])[0];
 assert.equal(e.localDate,'2027-01-08');assert.equal(e.startAtUtc,'2027-01-08T08:45:00.000Z');
});
test('score and row order changes do not alter normalized CHM events',()=>{
 const a=chm('41','24 октября','Сеченовский университет','Соперник'),b=[...a];b[15]='3';b[17]='1';
 assert.deepEqual(championship([a]),championship([b]));
});
test('date transfer preserves identity and old answer but requests reconfirmation',()=>{
 let s=createState('gas-primary',1);s=sync(s,[event('MSSI-1')]);
 s.users['2']={telegramUserId:'2',privateChatId:'2',fullName:'Игрок Два',role:'member',accessStatus:'approved',stage:'ready',registeredAt:now,deliveryStatus:'active'};s.subscriptions['2']=['MSSI'];
 s.participation['MSSI-1:2']={eventId:'MSSI-1',telegramUserId:'2',attendanceRevision:1,answer:'yes',invitedAt:now,firstPollSentAt:now,answeredAt:now,answerSource:'user'};
 const updated=sync(s,[event('MSSI-1','2026-10-27')],'2026-10-17T09:05:00.000Z');
 assert.equal(updated.events['MSSI-1'].attendanceRevision,2);assert.equal(updated.participation['MSSI-1:2'].answer,'yes');
 assert.deepEqual(eventStats(updated,'MSSI-1',now).reconfirm.map(u=>u.telegramUserId),['2']);
 assert.equal(s.events['MSSI-1'].localDate,'2026-10-26');
});
test('venue change requires reconfirmation but identical rows do not create event revision',()=>{
 let s=sync(createState('gas-primary',1),[event('MSSI-1')]);
 s=sync(s,[event('MSSI-1')],'2026-10-17T09:05:00.000Z');assert.equal(s.events['MSSI-1'].revision,1);
 s=sync(s,[event('MSSI-1','2026-10-26','Другой зал')],'2026-10-17T09:10:00.000Z');assert.equal(s.events['MSSI-1'].attendanceRevision,2);
});
test('source error and suspicious empty response preserve scheduled matches',()=>{
 let s=sync(createState('gas-primary',1),[event('MSSI-1')]);
 s=sync(s,[],'2026-10-17T09:05:00.000Z',false);assert.equal(s.events['MSSI-1'].status,'scheduled');
 s=sync(s,[],'2026-10-17T09:10:00.000Z');assert.equal(s.events['MSSI-1'].status,'scheduled');assert.ok(s.sourceState.MSSI.lastError);
 s=sync(s,[event('MSSI-1')],'2026-10-17T09:15:00.000Z');assert.equal(s.sourceState.MSSI.lastError,undefined);
});
test('missing one row is suspended only after two valid readings',()=>{
 let s=sync(createState('gas-primary',1),[event('MSSI-1'),event('MSSI-2')]);
 s=sync(s,[event('MSSI-2')],'2026-10-17T09:05:00.000Z');assert.equal(s.events['MSSI-1'].status,'scheduled');
 s=sync(s,[event('MSSI-2')],'2026-10-17T09:10:00.000Z');assert.equal(s.events['MSSI-1'].status,'removed');
 s=sync(s,[event('MSSI-1'),event('MSSI-2')],'2026-10-17T09:15:00.000Z');assert.equal(s.events['MSSI-1'].status,'scheduled');
});
test('initial snapshot never emits historical change alerts',()=>{
 const s=sync(createState('gas-primary',1),[event('MSSI-1')]);
 assert.equal(s.operations.filter(o=>o.action==='EVENT_CHANGED').length,0);
});
