import test from 'node:test';
import assert from 'node:assert/strict';
const load = async path => import(path).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const time = await load('../src/core/time.ts');
const training = await load('../src/core/training.ts');
const state = await load('../src/core/state.ts');
const now = '2026-10-17T09:00:00.000Z';
test('Moscow midnight changes calendar days independently of UTC day', () => {
  assert.equal(time.calendarDaysUntil?.('2026-10-18','2026-10-17T21:01:00.000Z'),0);
  assert.equal(time.calendarDaysUntil?.('2026-10-19',now),2);
});
test('event labels use Russian weekday and dd.mm.yy', () => {
  const label=time.dateLabel?.('2026-10-19');
  assert.equal(label,'понедельник, 19.10.26');
});
test('countdown handles today tomorrow and a later date', () => {
  assert.equal(time.countdown?.('2026-10-17',now),'сегодня');
  assert.equal(time.countdown?.('2026-10-18',now),'завтра');
  assert.equal(time.countdown?.('2026-10-19',now),'через 2 дня');
  assert.equal(time.countdown?.('2026-11-07',now),'через 21 день');
});
test('Moscow 19:30 is UTC 16:30', () => {
  assert.equal(time.moscowInstant?.('2026-10-19','19:30'),'2026-10-19T16:30:00.000Z');
});
test('new year calendar arithmetic is not month subtraction', () => {
  assert.equal(time.calendarDaysUntil?.('2027-01-01','2026-12-31T10:00:00.000Z'),1);
});
const event=(id,date,start,scope='LCHB')=>({eventId:id,sourceKey:id,scope,kind:'game',team:'Росэнергоатом',opponent:'Соперник',localDate:date,startAtUtc:start,venue:'Зал',status:'scheduled',revision:1,attendanceRevision:1});
test('week and month menus retain two distinct matches on the same day', () => {
  const events=[event('A','2026-10-18','2026-10-18T11:00:00.000Z'),event('B','2026-10-18','2026-10-18T13:00:00.000Z'),event('C','2026-10-26','2026-10-26T11:00:00.000Z'),event('D','2026-11-01','2026-11-01T11:00:00.000Z'),event('PAST','2026-10-16','2026-10-16T11:00:00.000Z'),event('OTHER','2026-10-18','2026-10-18T11:00:00.000Z','MSSI')];
  assert.deepEqual(time.listUpcoming?.(events,['LCHB'],'week',now)?.map(e=>e.eventId),['A','B']);
  assert.deepEqual(time.listUpcoming?.(events,['LCHB'],'month',now)?.map(e=>e.eventId),['A','B','C']);
});
test('training generator creates Monday and Thursday at Burevestnik', () => {
  const events=training.generateTrainings?.(now,1,[]);
  assert.deepEqual(events?.map(e=>[e.localDate,e.startAtUtc,e.venue]),[
    ['2026-10-19','2026-10-19T16:30:00.000Z','Буревестник'],
    ['2026-10-22','2026-10-22T16:30:00.000Z','Буревестник']
  ]);
  assert.equal(new Set(events?.map(e=>e.eventId)).size,2);
});
test('training exceptions preserve cancelled date and stable event identity', () => {
  const existing={...event('TRAINING-2026-10-19','2026-10-19','2026-10-19T16:30:00.000Z','TRAINING'),kind:'training',status:'cancelled',revision:2};
  const events=training.generateTrainings?.(now,1,[existing]);
  assert.equal(events?.find(e=>e.eventId===existing.eventId)?.status,'cancelled');
  assert.equal(events?.length,2);
});
test('fresh state has no invented participants and records runtime epoch', () => {
  const s=state.createState?.('gas-primary',1);
  assert.deepEqual(s?.users,{});
  assert.deepEqual(s?.runtime,{id:'gas-primary',epoch:1,paused:false});
});
