import type {Clock,HttpClient,HttpRequest,HttpResponse} from '../../core/model.ts';
import {GitHubStateRepository} from '../github/repository.ts';
import {TelegramApiTransport} from '../telegram/transport.ts';
import {SheetScheduleSource} from '../google-sheets/source.ts';
import sourceConfig from '../../../config/sources.json' with {type:'json'};
import type {SourcesConfig} from '../google-sheets/source.ts';
declare const Sheets:{Spreadsheets:{Values:{get(id:string,range:string,options:Record<string,string>):{values?:unknown[][]}}}};
export interface Settings{telegramToken:string;githubToken:string;webhookSecret:string;ownerSecret:string;runtimeId:string;runtimeEpoch:number;dataBranch:string}
export function settings():Settings{
 const values=PropertiesService.getScriptProperties().getProperties();
 const token=(values.TELEGRAM_BOT_TOKEN??'').trim(),github=(values.BOT_GITHUB_TOKEN??'').trim(),secret=(values.WEBHOOK_SECRET??'').trim();
 if(!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)||!github||secret.length<32)throw new Error('Настройте секреты проекта');
 const runtimeEpoch=Number(values.RUNTIME_EPOCH??'1');if(!Number.isSafeInteger(runtimeEpoch)||runtimeEpoch<1)throw new Error('Некорректный epoch');
 return {telegramToken:token,githubToken:github,webhookSecret:secret,ownerSecret:(values.OWNER_SETUP_SECRET??'').trim(),runtimeId:values.RUNTIME_ID??'gas-primary',runtimeEpoch,dataBranch:values.DATA_BRANCH??'codex/bot-data'};
}
export class GoogleHttpClient implements HttpClient{
 private requestOptions(request:HttpRequest):GoogleAppsScript.URL_Fetch.URLFetchRequest{
  if(!/^https:\/\/(api\.github\.com|api\.telegram\.org)\//.test(request.url))throw new Error('Недопустимый адрес API');
  return {url:request.url,method:request.method.toLowerCase() as GoogleAppsScript.URL_Fetch.HttpMethod,headers:request.headers??{},contentType:'application/json',payload:request.body===undefined?undefined:JSON.stringify(request.body),muteHttpExceptions:true,followRedirects:true};
 }
 private convert(response:GoogleAppsScript.URL_Fetch.HTTPResponse):HttpResponse{
  return {status:response.getResponseCode(),body:response.getContentText(),headers:Object.fromEntries(Object.entries(response.getAllHeaders()).map(([key,value])=>[key.toLowerCase(),String(value)]))};
 }
 request(method:string,url:string,body?:unknown,headers?:Record<string,string>):HttpResponse{
  const {url:target,...parameters}=this.requestOptions({method,url,body,headers});
  try{return this.convert(UrlFetchApp.fetch(String(target),parameters));}catch{throw new Error('Сетевая ошибка API');}
 }
 batch(requests:HttpRequest[]):HttpResponse[]{
  try{return UrlFetchApp.fetchAll(requests.map(request=>this.requestOptions(request))).map(response=>this.convert(response));}catch{throw new Error('Сетевая ошибка API');}
 }
}
export function environment(){
 const config=settings(),http=new GoogleHttpClient(),clock:Clock={now:()=>new Date().toISOString()};
 const repository=new GitHubStateRepository({http,token:config.githubToken,repo:'um1ra/sechenov-volley-bot',branch:config.dataBranch,runtime:{id:config.runtimeId,epoch:config.runtimeEpoch},clock});
 const source=new SheetScheduleSource({clock,config:sourceConfig as SourcesConfig,reader:{read(book,sheet,range){
  if(typeof Sheets==='undefined')throw new Error('Подключите Sheets API v4');
  const value=Sheets.Spreadsheets.Values.get(book,"'"+sheet.replace(/'/g,"''")+"'!"+range,{valueRenderOption:'FORMATTED_VALUE'});
  return value.values??[];
 }}});
 const transport=new TelegramApiTransport({http,token:config.telegramToken});
 return {config,http,clock,repository,source,transport,ownerSetupSecret:config.ownerSecret};
}
