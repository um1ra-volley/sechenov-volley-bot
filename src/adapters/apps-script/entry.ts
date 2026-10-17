import type {TickDependencies} from '../../application/jobs.ts';
import type {BotDependencies} from '../../application/bot.ts';
import {handleUpdate} from '../../application/bot.ts';
import {handleTick} from '../../application/jobs.ts';
import {createState} from '../../core/state.ts';
import {environment} from './environment.ts';
declare const __BUILD_SHA__:string;
interface WebRequest{pathInfo?:string;postData?:{type?:string;contents?:string}}
export function createRuntime(options:{secret:string;dependencies:BotDependencies&TickDependencies;output:(text:string)=>unknown}){
 return {
  doPost(request:WebRequest):unknown{
   if(request.pathInfo!=='hook/'+options.secret)throw new Error('Нет доступа к webhook');
   const data=request.postData;
   if(!data||!data.type?.toLowerCase().startsWith('application/json')||typeof data.contents!=='string'||data.contents.length>65536)throw new Error('Некорректный webhook');
   let update:unknown;try{update=JSON.parse(data.contents);}catch{throw new Error('Некорректный JSON webhook');}
   try{handleUpdate(update,{...options.dependencies,sync:()=>handleTick(options.dependencies)});return options.output('ok');}catch{throw new Error('Не удалось обработать webhook');}
  },
  scheduledTick(){return handleTick(options.dependencies);}
 };
}
export function doPost(request:WebRequest):unknown{
 const env=environment();return createRuntime({secret:env.config.webhookSecret,dependencies:env,output:text=>HtmlService.createHtmlOutput(text)}).doPost(request);
}
export function scheduledTick():unknown{
 const env=environment();return createRuntime({secret:env.config.webhookSecret,dependencies:env,output:text=>text}).scheduledTick();
}
export function setup():unknown{
 const env=environment();
 if(env.config.ownerSecret.length<32)throw new Error('Укажите одноразовый код владельца длиной от 32 символов');
 let me:{ok?:boolean;result?:{username?:string}};
 try{const response=env.http.request('POST','https://api.telegram.org/bot'+env.config.telegramToken+'/getMe',{});me=JSON.parse(response.body);}catch{throw new Error('Не удалось проверить Telegram');}
 if(!me.ok||me.result?.username!=='sechenov_volley_bot')throw new Error('Проверьте токен бота sechenov_volley_bot');
 const initial=createState(env.config.runtimeId,env.config.runtimeEpoch);initial.runtime.paused=true;
 env.repository.initialise(initial);
 return {stateCreated:true,paused:true,build:__BUILD_SHA__};
}
function triggerCleanup():void{
 for(const trigger of ScriptApp.getProjectTriggers())if(trigger.getHandlerFunction()==='scheduledTick')ScriptApp.deleteTrigger(trigger);
}
export function activateRuntime():unknown{
 const env=environment(),state=env.repository.read();
 if(!Object.values(state.users).some(u=>u.role==='owner')&&env.config.ownerSecret.length<32)throw new Error('Укажите одноразовый код владельца');
 env.repository.transact({type:'SET_PAUSED',operationId:'activate:'+env.clock.now(),data:{paused:false}});
 triggerCleanup();ScriptApp.newTrigger('scheduledTick').timeBased().everyMinutes(5).create();
 return {active:true};
}
export function pauseRuntime():unknown{
 const env=environment();env.repository.transact({type:'SET_PAUSED',operationId:'pause:'+env.clock.now(),data:{paused:true}});triggerCleanup();return {paused:true};
}
export function configureWebhook():unknown{
 const env=environment(),base=ScriptApp.getService().getUrl();
 if(!base||!base.endsWith('/exec'))throw new Error('Сначала разверните Web app');
 const url=base+'/hook/'+env.config.webhookSecret;
 function probe(payload:string):number{
  try{return UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload,muteHttpExceptions:true,followRedirects:false}).getResponseCode();}catch{throw new Error('Не удалось проверить HTTP webhook');}
 }
 const ignored=JSON.stringify({update_id:1,message:{message_id:1,from:{id:1,is_bot:false},chat:{id:-1,type:'group'},text:'/start'}});
 const success=probe(ignored),failure=probe('{invalid-json');
 if(success<200||success>=300)throw new Error('Webhook не возвращает прямой успешный HTTP-ответ');
 if(failure>=200&&failure<300)throw new Error('Google вернул 2xx при ошибке webhook. Telegram не подключён: требуется другой входной адаптер.');
 const response=env.http.request('POST','https://api.telegram.org/bot'+env.config.telegramToken+'/setWebhook',{url,allowed_updates:['message','callback_query'],max_connections:2,drop_pending_updates:false});
 let result:{ok?:boolean};try{result=JSON.parse(response.body);}catch{throw new Error('Не удалось настроить Telegram webhook');}
 if(!result.ok)throw new Error('Telegram отклонил настройку webhook');
 return {configured:true,httpSuccess:success,httpFailure:failure};
}
export function status():unknown{
 const env=environment(),state=env.repository.read(),delivery:Record<string,number>={};
 for(const item of Object.values(state.notifications))delivery[item.status]=(delivery[item.status]??0)+1;
 const summary={build:__BUILD_SHA__,runtime:state.runtime,version:state.stateVersion,approved:Object.values(state.users).filter(u=>u.accessStatus==='approved').length,pending:Object.values(state.users).filter(u=>u.accessStatus==='pending').length,sources:state.sourceState,delivery};
 console.info(JSON.stringify(summary));return summary;
}
