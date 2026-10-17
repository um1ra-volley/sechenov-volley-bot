import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
const module=await import('../src/adapters/github/repository.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z';
const paths={'state/users.json':'users','state/subscriptions.json':'subscriptions','state/events.json':'events','state/participation.json':'participation','state/notifications.json':'notifications','state/processed-updates.json':'processedUpdates','state/source-state.json':'sourceState','state/operations.json':'operations'};
function manifest(state){return {schemaVersion:state.schemaVersion,stateVersion:state.stateVersion,runtime:state.runtime}}
class GitServer {
 constructor(conflict=false){this.current='base';this.states={base:createState('gas-primary',1)};this.trees={};this.parents={};this.serial=0;this.conflict=conflict;this.forceSeen=false}
 response(status,body){return {status,body:typeof body==='string'?body:JSON.stringify(body),headers:{}}}
 request(method,url,body,headers){
  assert.equal(headers.Authorization,'Bearer synthetic-token');
  const path=decodeURIComponent(url.split('/repos/example/bot/')[1]);
  if(method==='GET'&&path.startsWith('git/ref/'))return this.response(200,{ref:'refs/heads/codex/bot-data',object:{type:'commit',sha:this.current}});
  if(method==='GET'&&path.startsWith('git/commits/')){const sha=path.slice(12);return this.response(200,{sha,tree:{sha:'tree-'+sha}})}
  if(method==='GET'&&path.startsWith('git/trees/')){
   const sha=path.slice(10).split('?')[0].replace(/^tree-/,'');
   return this.response(200,{sha:'tree-'+sha,truncated:false,tree:['state/manifest.json',...Object.keys(paths)].map(p=>({path:p,mode:'100644',type:'blob',sha:sha+'|'+p}))});
  }
  if(method==='GET'&&path.startsWith('git/blobs/')){
   const [sha,p]=path.slice(10).split('|');return this.response(200,JSON.stringify(p==='state/manifest.json'?manifest(this.states[sha]):this.states[sha][paths[p]]));
  }
  if(method==='POST'&&path==='git/trees'){
   const previous=body.base_tree.replace(/^tree-/,'');const state=structuredClone(this.states[previous]);
   for(const item of body.tree){const value=JSON.parse(item.content);if(item.path==='state/manifest.json')Object.assign(state,value);else state[paths[item.path]]=value;}
   const tree='new-tree-'+(++this.serial);this.trees[tree]=state;return this.response(201,{sha:tree});
  }
  if(method==='POST'&&path==='git/commits'){
   const sha='commit-'+(++this.serial);this.states[sha]=this.trees[body.tree];this.parents[sha]=body.parents[0];return this.response(201,{sha});
  }
  if(method==='PATCH'&&path.startsWith('git/refs/')){
   this.forceSeen ||= body.force!==false;
   if(this.conflict){this.conflict=false;const other=structuredClone(this.states[this.current]);
    other.users['9']={telegramUserId:'9',privateChatId:'9',fullName:'Другой Игрок',role:'member',accessStatus:'pending',stage:'ready',registeredAt:now,deliveryStatus:'active'};
    this.states.external=other;this.current='external';return this.response(422,{message:'Update is not a fast forward'});
   }
   if(this.parents[body.sha]!==this.current)return this.response(422,{message:'Update is not a fast forward'});
   this.current=body.sha;return this.response(200,{object:{sha:this.current}});
  }
  throw new Error('Unexpected Git request '+method+' '+path);
 }
}
function repository(http){assert.equal(typeof module.GitHubStateRepository,'function','GitHub state repository not implemented');return new module.GitHubStateRepository({http,token:'synthetic-token',repo:'example/bot',branch:'codex/bot-data',runtime:{id:'gas-primary',epoch:1},clock:{now:()=>now}})}
test('Git conflict replays personal mutation on fresh state and retains concurrent participant',()=>{
 const http=new GitServer(true),repo=repository(http);
 repo.transact({type:'START',operationId:'register-2',actorId:'2',data:{chatId:'2'}});
 const state=repo.read();assert.deepEqual(Object.keys(state.users).sort(),['2','9']);assert.equal(http.forceSeen,false);
});
test('wrong runtime epoch cannot commit or confirm a new participant',()=>{
 const http=new GitServer(),repo=repository(http);
 assert.throws(()=>repo.transact({type:'START',operationId:'register-2',actorId:'2',data:{chatId:'2'}},{id:'old-runtime',epoch:0}),/сред|epoch|актив/i);
 assert.equal(http.current,'base');assert.equal(Object.keys(http.states.base.users).length,0);
});
test('GitHub error never pretends to preserve a registration',()=>{
 const http={request(){return {status:503,body:'unavailable',headers:{}}}};
 const repo=repository(http);assert.throws(()=>repo.transact({type:'START',operationId:'x',actorId:'2',data:{chatId:'2'}}),/GitHub|доступ/i);
});

test('request-scoped state cache reuses unchanged blobs but checks branch head every read',()=>{
 const http=new GitServer();let requests=0;const request=http.request.bind(http);
 http.request=(...args)=>{requests++;return request(...args)};
 const repo=repository(http);repo.read();const before=requests;repo.read();assert.equal(requests-before,1,'unchanged snapshot should only read branch head');
 const changed=structuredClone(http.states.base);changed.users['8']={telegramUserId:'8',privateChatId:'8',fullName:'Новый Игрок',role:'member',accessStatus:'approved',stage:'ready',registeredAt:now,deliveryStatus:'active'};
 http.states.external=changed;http.current='external';assert.equal(repo.read().users['8'].fullName,'Новый Игрок');
});

test('bootstrap uses canonical repository metadata URL and preserves an existing private store',()=>{
 const http=new GitServer(),request=http.request.bind(http);
 http.states.base.users['8']={telegramUserId:'8',privateChatId:'8',fullName:'Существующий Игрок',role:'member',accessStatus:'approved',stage:'ready',registeredAt:now,deliveryStatus:'active'};
 http.request=(method,url,body,headers)=>{
  if(url==='https://api.github.com/repos/example/bot')return http.response(200,{private:true});
  if(url==='https://api.github.com/repos/example/bot/')return http.response(404,{message:'Not Found'});
  return request(method,url,body,headers);
 };
 const result=repository(http).initialise(createState('other',1));
 assert.equal(result.users['8'].fullName,'Существующий Игрок');assert.equal(result.runtime.id,'gas-primary');assert.equal(http.current,'base');
});
