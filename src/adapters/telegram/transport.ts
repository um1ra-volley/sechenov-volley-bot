import type {HttpClient,Message} from '../../core/model.ts';
export class TelegramError extends Error{
 status:number;retryAfter:number;uncertain:boolean;
 constructor(status:number,retryAfter=0,uncertain=false){super('Telegram: ошибка доставки ('+status+')');this.status=status;this.retryAfter=retryAfter;this.uncertain=uncertain;}
}
export class TelegramApiTransport {
 private http:HttpClient;private token:string;
 constructor(options:{http:HttpClient;token:string}){this.http=options.http;this.token=options.token;}
 private call(method:string,body:Record<string,unknown>):unknown{
  let response;try{response=this.http.request('POST','https://api.telegram.org/bot'+this.token+'/'+method,body);}catch{throw new TelegramError(0,0,true);}
  let data:{ok?:boolean;result?:unknown;error_code?:number;parameters?:{retry_after?:number};description?:string};
  try{data=JSON.parse(response.body);}catch{throw new TelegramError(response.status,0,true);}
  if(data.ok===true)return data.result;
  if(method==='editMessageText'&&data.description?.includes('message is not modified'))return true;
  throw new TelegramError(data.error_code??response.status,data.parameters?.retry_after??0,false);
 }
 private payload(message:Message):Record<string,unknown>{
  if(!message.text||message.text.length>4000)throw new TelegramError(400);
  const markup=message.buttons?{inline_keyboard:message.buttons.map(row=>row.map(button=>{
   if(!/^[\x20-\x7E]{1,64}$/.test(button.data))throw new TelegramError(400);
   return {text:button.text,callback_data:button.data};
  }))}:undefined;
  return {chat_id:message.chatId,text:message.text,reply_markup:markup};
 }
 send(message:Message):string {
  const result=this.call('sendMessage',this.payload(message)) as {message_id?:number};
  if(!Number.isSafeInteger(result?.message_id))throw new TelegramError(502,0,true);
  return String(result.message_id);
 }
 edit(message:Message):void{if(!message.messageId)throw new TelegramError(400);this.call('editMessageText',{...this.payload(message),message_id:Number(message.messageId)});}
 acknowledge(callbackId:string):void{this.call('answerCallbackQuery',{callback_query_id:callbackId});}
}
