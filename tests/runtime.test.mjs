import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/state.ts';
import {applyCommand} from '../src/application/commands.ts';
const entry=await import('../src/adapters/apps-script/entry.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const now='2026-10-17T09:00:00.000Z',secret='synthetic-webhook-secret-000000000000';
function context(){
 const messages=[],repository={state:createState('gas-primary',1),reads:0,read(){this.reads++;return structuredClone(this.state)},transact(c){const r=applyCommand(this.state,c,now);this.state=r.state;return r}};
 const dependencies={repository,transport:{send(m){messages.push(m);return String(messages.length)},edit(){},acknowledge(){}},clock:{now:()=>now},ownerSetupSecret:'synthetic-owner-secret',source:{readEvents:()=>[]}};
 assert.equal(typeof entry.createRuntime,'function','Apps Script runtime missing');
 const runtime=entry.createRuntime({secret,dependencies,output:text=>({content:text})});
 return {runtime,repository,messages,dependencies};
}
const update={update_id:90,message:{message_id:90,from:{id:2,is_bot:false},chat:{id:2,type:'private'},text:'/start'}};
const request=value=>({pathInfo:'hook/'+secret,postData:{type:'application/json',contents:JSON.stringify(value)}});
test('wrong webhook secret is rejected before accessing GitHub or sending data',()=>{
 const d=context();assert.throws(()=>d.runtime.doPost({...request(update),pathInfo:'wrong'}),/webhook|доступ/i);assert.equal(d.repository.reads,0);assert.equal(d.messages.length,0);
});
test('malformed JSON is rejected without leaking contents',()=>{
 const d=context();assert.throws(()=>d.runtime.doPost({pathInfo:'hook/'+secret,postData:{type:'application/json',contents:'synthetic-secret-invalid-json'}}),e=>!e.message.includes('synthetic-secret'));assert.equal(d.repository.reads,0);
});
test('successful webhook returns actual output and duplicate leaves a single registration',()=>{
 const d=context(),response=d.runtime.doPost(request(update));assert.equal(response.content,'ok');assert.equal(response instanceof Promise,false);
 const count=d.messages.length;d.runtime.doPost(request(update));assert.equal(d.messages.length,count);assert.equal(Object.keys(d.repository.state.users).length,1);
});
test('failure before persistence does not return a false successful output',()=>{
 const d=context();d.repository.read=()=>{throw new Error('synthetic-secret from low level')};
 assert.throws(()=>d.runtime.doPost(request(update)),e=>!e.message.includes('synthetic-secret'));assert.equal(Object.keys(d.repository.state.users).length,0);
});
