import type { ApplyResult, Clock, Command, HttpClient, HttpResponse, Runtime, State } from '../../core/model.ts';
import { applyCommand } from '../../application/commands.ts';
const sections:Record<string,keyof State>={
 'state/users.json':'users','state/subscriptions.json':'subscriptions','state/events.json':'events',
 'state/participation.json':'participation','state/notifications.json':'notifications',
 'state/processed-updates.json':'processedUpdates','state/source-state.json':'sourceState','state/operations.json':'operations'
};
interface Snapshot { head:string; tree:string; state:State; files:Record<string,string> }
interface Options {http:HttpClient;token:string;repo:string;branch:string;runtime:{id:string;epoch:number};clock:Clock}
export class GitHubError extends Error {
 status:number;
 constructor(status:number){super('GitHub временно недоступен ('+status+')');this.status=status;}
}
export class GitHubStateRepository {
 private options:Options;
 constructor(options:Options){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)||!/^codex\/[A-Za-z0-9/-]+$/.test(options.branch))throw new Error('Некорректный репозиторий');
  this.options=options;
 }
 private response(method:string,path:string,body?:unknown,raw=false):HttpResponse {
  let result:HttpResponse;
  try {result=this.options.http.request(method,'https://api.github.com/repos/'+this.options.repo+'/'+path,body,{Authorization:'Bearer '+this.options.token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});}
  catch{throw new GitHubError(0);}
  return result;
 }
 private json<T>(method:string,path:string,body?:unknown):T {
  const result=this.response(method,path,body);
  if(result.status<200||result.status>=300)throw new GitHubError(result.status);
  try{return JSON.parse(result.body) as T;}catch{throw new GitHubError(502);}
 }
 private refPath():string{return 'heads/'+this.options.branch.split('/').map(encodeURIComponent).join('/');}
 private snapshot():Snapshot {
  const ref=this.json<{object:{sha:string}}>('GET','git/ref/'+this.refPath());
  const commit=this.json<{tree:{sha:string}}>('GET','git/commits/'+encodeURIComponent(ref.object.sha));
  const tree=this.json<{truncated:boolean;tree:{path:string;type:string;sha:string;mode:string}[]}>('GET','git/trees/'+encodeURIComponent(commit.tree.sha)+'?recursive=1');
  if(tree.truncated)throw new Error('GitHub: снимок данных неполный');
  const files:Record<string,string>={};
  for(const path of ['state/manifest.json',...Object.keys(sections)]){
   const item=tree.tree.find(item=>item.path===path&&item.type==='blob'&&item.mode==='100644');
   if(!item)throw new Error('GitHub: хранилище не настроено');
   const response=this.response('GET','git/blobs/'+encodeURIComponent(item.sha),undefined,true);
   if(response.status!==200)throw new GitHubError(response.status);
   files[path]=response.body;
  }
  let manifest:{schemaVersion:1;stateVersion:number;runtime:Runtime};
  try{manifest=JSON.parse(files['state/manifest.json']);}catch{throw new Error('GitHub: повреждён манифест');}
  if(manifest.schemaVersion!==1||!Number.isSafeInteger(manifest.stateVersion)||!manifest.runtime?.id||!Number.isSafeInteger(manifest.runtime.epoch))throw new Error('GitHub: неизвестный формат данных');
  const state={...manifest} as State;
  for(const [path,key]of Object.entries(sections)){
   let data:unknown;try{data=JSON.parse(files[path]);}catch{throw new Error('GitHub: повреждены данные');}
   if(key==='operations'?!Array.isArray(data):!data||typeof data!=='object'||Array.isArray(data))throw new Error('GitHub: повреждены данные');
   (state as unknown as Record<string,unknown>)[key]=data;
  }
  return {head:ref.object.sha,tree:commit.tree.sha,state,files};
 }
 read():State{return this.snapshot().state;}
 transact(command:Command,expectedRuntime=this.options.runtime):ApplyResult {
  for(let attempt=0;attempt<3;attempt++){
   const base=this.snapshot(),runtime=base.state.runtime;
   if(runtime.id!==expectedRuntime.id||runtime.epoch!==expectedRuntime.epoch||runtime.id!==this.options.runtime.id||runtime.epoch!==this.options.runtime.epoch||runtime.paused)throw new Error('Неактивная среда или epoch');
   const result=applyCommand(base.state,command,this.options.clock.now());
   if(result.duplicate||result.state===base.state)return result;
   const values:Record<string,unknown>={'state/manifest.json':{schemaVersion:result.state.schemaVersion,stateVersion:result.state.stateVersion,runtime:result.state.runtime}};
   for(const[path,key]of Object.entries(sections))values[path]=result.state[key];
   const changes=Object.entries(values).map(([path,value])=>({path,mode:'100644',type:'blob',content:JSON.stringify(value)})).filter(item=>item.content!==base.files[item.path]);
   const tree=this.json<{sha:string}>('POST','git/trees',{base_tree:base.tree,tree:changes});
   const commit=this.json<{sha:string}>('POST','git/commits',{message:'bot: '+command.type.toLowerCase()+' state update',tree:tree.sha,parents:[base.head]});
   const update=this.response('PATCH','git/refs/'+this.refPath(),{sha:commit.sha,force:false});
   if(update.status>=200&&update.status<300)return result;
   if(update.status!==409&&update.status!==422)throw new GitHubError(update.status);
   const current=this.json<{object:{sha:string}}>('GET','git/ref/'+this.refPath());
   if(current.object.sha===base.head)throw new GitHubError(update.status);
  }
  throw new Error('GitHub: данные изменяются одновременно, повторите запрос');
 }
}
