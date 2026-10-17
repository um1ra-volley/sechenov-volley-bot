export const SCOPES = ['MSSI','LVL','CHM','LCHB','TRAINING'] as const;
export type Scope = typeof SCOPES[number];
export type Answer = 'yes'|'no'|null;
export type EventStatus = 'scheduled'|'postponed'|'cancelled'|'played'|'removed';
export interface Runtime { id:string; epoch:number; paused:boolean }
export interface User {
  telegramUserId:string; privateChatId:string; fullName:string; role:'owner'|'member';
  accessStatus:'pending'|'approved'|'rejected'; stage:'name'|'subscriptions'|'ready';
  registeredAt:string; deliveryStatus:'active'|'blocked'; editName?:boolean; pendingAction?:{kind:'move-training';eventId:string};
}
export interface Event {
  eventId:string; sourceKey:string; scope:Scope; kind:'game'|'training'; team:string;
  opponent:string; localDate:string; startAtUtc:string|null; venue:string; status:EventStatus;
  revision:number; attendanceRevision:number;
}
export interface Participation {
  eventId:string; telegramUserId:string; attendanceRevision:number; answer:Answer;
  invitedAt:string; firstPollSentAt:string|null; answeredAt:string|null;
  answerSource:'user'|'admin'|null; pollRevision?:number;
}
export interface Button { text:string; data:string }
export interface Message { chatId:string; text:string; buttons?:Button[][]; messageId?:string }
export interface Effect extends Message { kind:'send'|'edit'; userId?:string; purpose?:'dialog'|'admin' }
export interface Notification {
  notificationId:string; eventId?:string; userId:string; scope?:Scope; revision?:number;
  attendanceRevision?:number; type:string; dueAt:string; status:'pending'|'sending'|'sent'|'retry'|'uncertain'|'cancelled';
  attempts:number; nextAttemptAt?:string; messageId?:string; sentAt?:string; sendingAt?:string;
  message:Message; error?:string; fulfills?:string[]; lease?:string;
}
export interface SourceState { lastSuccessAt?:string; lastError?:string; missing:Record<string,number>; snapshotHash?:string }
export interface Operation { operationId:string; actorId?:string; action:string; targetId?:string; at:string; result:string; previous?:unknown; next?:unknown }
export interface State {
  schemaVersion:1; stateVersion:number; runtime:Runtime;
  users:Record<string,User>; subscriptions:Record<string,Scope[]>; events:Record<string,Event>;
  participation:Record<string,Participation>; notifications:Record<string,Notification>;
  processedUpdates:Record<string,string>; sourceState:Record<string,SourceState>; operations:Operation[];
}
export interface Command { type:string; operationId:string; updateId?:string; actorId?:string; data:Record<string,unknown>; effects?:Effect[] }
export interface ApplyResult { state:State; effects:Effect[]; duplicate:boolean }
export interface SourceSnapshot { sourceId:string; ok:boolean; events:Event[]; observedAt:string; error?:string }
export interface HttpResponse { status:number; body:string; headers:Record<string,string> }
export interface HttpClient { request(method:string,url:string,body?:unknown,headers?:Record<string,string>):HttpResponse }
export interface Clock { now():string }
export interface StateRepository { read():State; transact(command:Command,expectedRuntime?:{id:string;epoch:number}):ApplyResult }
export interface TelegramTransport { send(message:Message):string; edit(message:Message):void; acknowledge(callbackId:string):void }
